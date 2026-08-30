# 0.4.0 — Relations II: to-many

Status: **complete.** No nested creation, no multi-level editing, no sorting by
a related field, nothing published.

---

## 1. Executive Summary

0.3.0 made a record's _parent_ readable. This makes its _children_ reachable: a
user's posts are listed on the user, a post's tags can be added and removed, and
"all the posts by this author" is a link.

The work divided along a line that is invisible from the parent. `User.posts`
and `Post.tags` both render as "a list of related records", but they are not the
same thing:

|                      | one-to-many                                                          | many-to-many                       |
| -------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| Where the link lives | a column on the child                                                | a join table                       |
| Attaching            | rewrites that column — **moves** the child away from whoever held it | adds a row, changes neither record |
| Detaching            | clears the column, **impossible** when it is required                | removes a row                      |

An interface that offers the same two buttons for both is lying about one of
them. Most of this release is about not doing that.

**458 tests** (was 447), 40/40 packed-consumer checks, verified end to end
against a real consumer with a real many-to-many.

---

## 2. Fixtures First

`reports/012` said this work should not start until the fixture schemas had a
many-to-many and a self-relation, because neither had ever been exercised. That
was right: adding them broke four assertions immediately, and one of the four
was **new correct behaviour** rather than a regression — `toIncludeClause(User)`
stopped being `undefined` because `User.manager` is a to-one the user owns.

The self-relation also settled a question 012 left open: an include is one level
deep by construction, so a cycle is not expressible. There is now a test that
says so.

---

## 3. Telling the Two Apart

`relationShape` answers `to-one`, `one-to-many` or `many-to-many` by looking at
the **other half** of the relation: a to-many whose inverse is also a list is a
many-to-many. Finding that other half needs a shared identifier, so
`RelationMetadata` gained `name` — Prisma's relation name, which both sides
carry. Without it, `Post.author` and `Post.reviewer` (both to `User`) are
indistinguishable.

When the inverse cannot be seen — no relation name, or a target outside this
admin — the answer is `one-to-many`. That is the conservative direction:
one-to-many is the shape whose writes have preconditions, so a wrong guess
refuses an operation rather than performing a damaging one.

`detachBlockedReason` answers the second question: a one-to-many whose child key
is required cannot be detached from, because clearing a required column is not
something the database permits.

Both live in Core, and both are **sent in the metadata document** rather than
left for a client to derive — the same decision as `displayField` in 0.3.0. The
rule needs the other half of the relation, and a client that implemented it
independently would eventually disagree, offering a button that cannot work.

---

## 4. The Routes

```
GET    /admin/:model/:id/:relation              a page of related records
POST   /admin/:model/:id/:relation   { id }     link an existing record
DELETE /admin/:model/:id/:relation/:targetId    unlink, without deleting
```

Three segments, so nothing collides with `/:model/:id`.

### Listing is an ordinary list

`listRelated` asks the **target** model with one extra condition rather than
fetching through the parent:

```
User.posts  →  Post where { author: { is: { id: <parent> } } }
Post.tags   →  Tag  where { posts: { some: { id: <parent> } } }
```

Both are relation filters on the target, so neither needs to know where a
foreign key lives. The payoff is that pagination, sorting, filtering and
relation loading are the code that already existed — a related list is a list
that happens to be constrained. The children arrive with their own to-one
relations resolved, so a user's posts show their author.

### Authorization is the part a nested route makes easy to get wrong

`GET /admin/User/u1/posts` returns **Post** records. Checking only that the
caller may read the user would publish posts to someone forbidden from listing
them, through a route that does not look like a post list.

| Operation       | Requires                                              |
| --------------- | ----------------------------------------------------- |
| list related    | `read` on the parent **and** `list` on the target     |
| attach / detach | `update` on the parent **and** `update` on the target |

The second row is the one worth arguing about. Across a many-to-many nothing
changes on either record, so `update` on the target is arguably too strict.
Across a one-to-many it is exactly right: the child's foreign key is what
changes, and permitting that with rights over the parent alone would be rights
to edit records otherwise out of reach. The rule is the same for both because a
policy that differs by relation shape is a policy nobody can state.

A parent that does not exist is a 404, not an empty page — an empty page reads
as "this record has no children". The relation field is validated **before** the
record is looked up: a bad field name is wrong whether or not the record exists,
and rejecting it costs no query.

---

## 5. What the Interface Does With It

Each to-many relation gets its own section on the detail page, paginated at
five, loaded by its own request — a parent with several kinds of child does not
become one enormous response.

What appears in that section depends on the shape:

|               | one-to-many                                                                           | many-to-many                    |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| Detach button | not offered when the key is required, with the reason shown                           | offered                         |
| Attach        | offered, with "attaching moves the record here, away from whatever it belongs to now" | offered, no warning             |
| View all      | links to the child list, filtered to this parent                                      | absent — no column to filter on |

The warning is worth more than it looks. Attaching across a one-to-many changes
a record the reader is not looking at, and the change is destructive to whatever
held it. Saying so before the click is cheaper than explaining it afterwards.

### Filtered lists became linkable

"View all Posts for this User" needs the list to open already filtered, which
means the filter has to be in the URL. The hash route gained an optional
`?filter=field:op:value` — the API's own syntax, so no new vocabulary — and the
list seeds its filter from it.

That exposed a bug the moment it was tried: the list resets its state when the
model changes, and that effect **also runs on mount**, so it cleared the filter
one render after applying it. The observable symptom was two requests, the
second unfiltered, and the wrong rows. Fixed by resetting to the URL's filter
rather than to nothing, which is correct in both cases.

---

## 6. Verified in a Real Consumer

The playground gained a `Tag` model and a `Post ↔ Tag` many-to-many.

```
User.posts   shape=one-to-many, detachBlocked="Post.author is required…"
Post.tags    shape=many-to-many

GET /User/<id>/posts             200 → 2 records, each with its author resolved
   ?page=1&perPage=1             1 record, total 2
GET /User/nope/posts             404 RECORD_NOT_FOUND
GET /User/<id>/email             400 FIELD_NOT_FOUND

POST   /Post/<id>/tags {id}      201    → tags: 1 ("prisma")
GET    /Tag/<id>/posts           1 record, visible from the other side
DELETE /Post/<id>/tags/<tagId>   200    → tags: 0
GET    /Tag/<tagId>              200    the record survived the unlink

DELETE /User/<id>/posts/<postId> 400 INVALID_QUERY — "Post.author is required…"
```

Through the real UI bundle against that server:

```
User detail        section "posts (2)", 2 rows
                   Detach not offered; the reason is shown
                   "Attaching moves the Post record here…"
                   "View all Post for this User" → #/Post?filter=authorId:eq:<id>
following it       one filtered request, 2 rows
Post detail        section "tags (0)"
                   search "prisma" → GET /Tag?perPage=8&search=prisma
                   Attach → POST /Post/<id>/tags → 201 → "tags (1)"
                   Detach now offered
console errors     none
```

---

## 7. Verification

| Check                 | Result                   |
| --------------------- | ------------------------ |
| `pnpm build`          | 0                        |
| `pnpm typecheck`      | 0                        |
| `pnpm format:check`   | 0                        |
| `pnpm test`           | **458 passed**, 23 files |
| `pnpm verify:package` | **40/40**                |

New tests: 53.

| File                                                | Covers                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/core/test/relation-shape.test.ts` (13)    | Pairing the halves, the three shapes, the conservative fallback, when detaching is impossible |
| `packages/nestjs/test/related-records.test.ts` (18) | The three routes, pagination, 404 vs 400, and both halves of the authorization rule           |
| `packages/prisma/test/relations.test.ts` (+11)      | Related listing against the database, many-to-many from both sides, the self-relation         |
| `apps/admin-ui/test/related-list.test.tsx` (11)     | Which controls each shape offers, the filtered link, the URL round trip                       |

One test was **rewritten rather than made to pass**. It asserted that denying
`metadata` on the target made the nested route fail. It does not, and should
not: `metadata` controls the document and `list` controls the records, and
`GET /admin/Post` returns 200 under the same policy. The nested route being
stricter would be a rule that exists in one place and not the other. The test
now asserts the consistency, and a separate one covers the structural case
(`resources` exclusion), which does make the relation unreachable.

---

## 8. Known Limitations

- **`update` on the target is required to attach across a many-to-many**, where
  nothing about the target record changes. Deliberately strict, and stated in §4
  rather than hidden.
- **No nested creation.** A child can be linked, not created from the parent's
  page with the key filled in. It was in the roadmap for this release and is
  deferred: it needs the create form to accept a seeded value, which is closer
  to 0.5.0's field-override work.
- **No sorting or filtering controls on a related list.** The API accepts both -
  it is an ordinary list query - but the section renders a fixed page.
- **Composite foreign keys still take only the first column.** Unchanged from
  0.3.0, and now reaches the relation filters too.
- **A relation with no name from the adapter degrades to one-to-many**, which
  means a many-to-many would refuse detaching rather than perform it. Safe, but
  wrong; Prisma always supplies a name, so this only affects a future adapter
  that does not.
- **The detach warning is not a confirmation.** Attaching across a one-to-many
  says what it will do but does not ask. A confirmation step belongs with the
  bulk actions in 0.7.0.

---

## 9. Result

```
listRelated, paginated:                        PASS
authorized against both models:                PASS
404 for a missing parent, 400 for a bad field: PASS
attach and detach across many-to-many:         PASS
detach refused on a required key, with reason: PASS
shape and detachBlocked in the metadata:       PASS
inline sections on the detail page:            PASS
filtered link into the child list:             PASS
verified against a real consumer:              PASS
nested creation:                               NOT DONE — §8
```

|               | Before | After   |
| ------------- | ------ | ------- |
| Tests         | 447    | **458** |
| Packed checks | 40/40  | 40/40   |
| Version       | 0.3.0  | 0.4.0   |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.5.0 — field overrides and permissions in the metadata.** Hiding a
field must be enforced on the server, not only in the interface: the adapter
uses neither `select` nor `omit` today, so a `passwordHash` is returned whether
or not anything renders it.
