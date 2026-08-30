# 0.3.0 — Relations I: to-one

Status: **complete.** No to-many loading, no many-to-many, no nested creation,
no field overrides, nothing published.

---

## 1. Executive Summary

Before this release the admin could display a relation only as the cuid stored
in its column. That is correct and useless: an interface that renders
`cmtf50g710000mocjbygyfyfr` where it means "Ada Lovelace" cannot be used to do
the work an admin exists for.

Delivered:

- **`displayFieldFor`** in Core — one rule for which field names a record,
  used by both the adapter and the metadata document so they cannot disagree.
- **Relations load with the record**, selecting exactly two columns.
- **Filtering by relation name**, translated to the foreign key.
- **A search picker** in the form, replacing a text box that asked for an id.
- **Links** in the list and on the detail page.
- **A search bug fixed**: foreign keys were being matched by free-text search.

**405 tests** (was 395), 40/40 packed-consumer checks. Verified end to end
against a real consumer application with a real relation.

---

## 2. What the Metadata Gained

Two additions, both small, both load-bearing.

`RelationMetadata.from` names the scalar column a to-one relation is stored in;
`to` names the field it points at. Without `from`, a filter on `author` cannot
be translated and a form has nothing to submit — the relation is display-only.
Prisma's DMMF supplies both as `relationFromFields` / `relationToFields`, and
they are empty on the non-owning side, which is exactly the distinction needed:
an empty array means "no column here", not "unknown".

`ModelMetadata` gained no field. `displayField` is **computed**, not stored:

```
name → title → label → displayName → username → email → slug
     → any unique string → any string → the primary key
```

Skipping non-strings, lists, relations, and generated strings — a generated
string is a cuid, which is readable characters with no meaning.

The rule lives in Core rather than in the adapter because it is a question about
a model, not about an ORM. It matters that there is one rule: the adapter uses
it to decide which column to `select`, and the metadata document uses it to tell
the UI what to render. Two implementations would drift, and the symptom would be
a blank column.

The last step — falling back to the primary key — is honest rather than good. A
model with nothing but an id and a timestamp has no readable field, and showing
the id beats showing nothing.

---

## 3. Loading the Relation

`toIncludeClause` builds a Prisma `include` for every to-one relation the model
owns, carrying an explicit `select`:

```ts
{ author: { select: { id: true, name: true } } }
```

**The `select` is a security boundary, not an optimisation.** `include: { author:
true }` would attach the entire related row to every record, so listing `Post`
would publish every column of `User` — including a password hash. Naming two
columns means a relation can never widen what a response contains. There is a
test asserting the response carries exactly those two keys.

A relation whose target is missing from the model set is skipped rather than
guessed at. The target may have been excluded by `resources`, and inventing a
column name would produce a Prisma error blaming the consumer's schema.

**To-many relations are not loaded.** They have no column on this side, they can
be unbounded, and one `include` per row would make a list page cost an
unpredictable amount.

### The N+1 claim is measured

The point of `include` is avoiding a query per row, and results look identical
whether or not that succeeded. So the test counts:

```
1 row   → N queries
30 rows → N queries   (asserted equal)
```

using a client constructed with query-event logging. Asserting from the shape of
the results would have proved nothing — which is the mistake `reports/009` made
about ESM chunks, and worth not repeating.

---

## 4. Querying

**Filtering by relation name works.** `?filter=author:eq:<id>` resolves through
`from` to `authorId`. The two spellings produce the same query, asserted by
comparing their results.

**Sorting by relation name is refused.** This is the more interesting decision,
because it would have worked: `authorId` is a sortable column. But it holds a
cuid, so the result would be ordered by a random-looking string — stable,
plausible, and meaningless. Someone asking to sort by `author` wants the
author's _name_, which is a field on another model and is not this release. The
error says so rather than returning a page in an order nobody can explain.

The two cases are asymmetric, so the resolver takes the purpose as an argument
rather than inferring it.

### A bug found on the way

Free-text search was matching foreign keys.

`toSearchCondition` deliberately excludes generated string fields, because a
cuid primary key makes single-letter searches match at random. A foreign key is
the same kind of value — an opaque cuid — but it is **not generated**, so that
exclusion missed it. On any model referencing another, `?search=e` matched
almost every row, because most cuids contain an `e`.

Found while writing the roadmap, not by a failing test: the fixture schemas had
relations, but nothing searched a model that had one. Now excluded, with a test
that searches for a fragment of an actual foreign key and asserts it matches
nothing.

---

## 5. The Interface

| Where        | Before                | Now                                     |
| ------------ | --------------------- | --------------------------------------- |
| List cell    | `cmtf50g710000…`      | **Ada Lovelace**, linking to the record |
| List heading | `authorId`            | `author`                                |
| Detail       | "Related User"        | **Ada Lovelace**, linking to the record |
| Form         | text input for a cuid | search picker over `User`               |

The column heading matters more than it looks: with the cell showing a name and
the heading saying `authorId`, the table labels its values with the name of
something else.

The picker searches rather than listing every row. A `<select>` of the whole
target table works until the table is large and then fails quietly by being
enormous; a search costs one page regardless. The trade is that the current
value has to be resolved separately — editing a record starts with a key and no
label, and that key is not in the suggestion list until someone searches for it
— so the picker reads it directly. If that read fails, because the record was
deleted or is hidden from this principal, it shows the raw key rather than
failing the form.

**What the form submits is unchanged**: `{ "authorId": "u1" }`. The picker is a
different way of choosing a value for a field the API already accepted.

---

## 6. Verified in a Real Consumer

Against the playground — a NestJS application outside the repository, running
the packed tarball, with a `Post → User` relation added to its own schema.

```
displayField per model           User=name, Product=name, Post=title
list author object               {"id":"cmtf50g71…","name":"Ada Lovelace"}
author keys                      id,name              (not email, role, createdAt)
authorId still present           yes
detail author                    {"id":"cmtf50g71…","name":"Ada Lovelace"}
filter=author:eq:<id>            200 → 2 records
filter=authorId:eq:<id>          200 → 2 records      (same query)
sort=author:asc                  400 FIELD_NOT_FOUND
sort=title:asc                   200
search=<fragment of an id>       0 records            (was: nearly all)
search=Ada                       1 record
User response contains `posts`   no
```

And through the real UI bundle, executed against that server:

```
column headings                  id, title, body, published, author, createdAt
list cell                        "Ada Lovelace" → #/User/<id>
detail                           "Ada Lovelace" → #/User/<id>
picker search "Alan"             GET /admin/User?perPage=8&search=Alan
suggestion shown                 "Alan Turing"
submitted body                   {"title":"…","authorId":"cmtf50g72…"}
POST /admin/Post                 201
console errors                   none
```

### One thing this exposed

The playground was still importing `@nest-admin/nest-admin`, the name used
before 0.1.0, and the old package was still in its `node_modules`. It ran
happily against pre-0.1.0 code and reported none of these features — which cost
some time to diagnose, since the installed package plainly contained them. Not a
product defect, but a reminder that the rename is real and that a stale install
fails silently rather than loudly.

---

## 7. Verification

| Check                 | Result                   |
| --------------------- | ------------------------ |
| `pnpm build`          | 0                        |
| `pnpm typecheck`      | 0                        |
| `pnpm format:check`   | 0                        |
| `pnpm test`           | **405 passed**, 20 files |
| `pnpm verify:package` | **40/40**                |

New tests: 37.

| File                                            | Covers                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/core/test/display-field.test.ts` (13) | Every step of the rule, and what it refuses to pick                                    |
| `packages/prisma/test/relations.test.ts` (16)   | The include clause, the two-column select, the measured N+1, filtering, the search fix |
| `apps/admin-ui/test/relations.test.tsx` (10)    | The metadata helpers, the list link and heading, the picker submitting a key           |

Existing tests updated rather than worked around: the DTO key whitelists in
three files now expect `displayField`, and the relation-shape assertions expect
`from` / `to`. Those tests exist to notice contract changes, and they did.

---

## 8. Known Limitations

- **To-many relations are display-only.** Named on the detail page, not loaded,
  not editable. 0.4.0.
- **Many-to-many is untouched**, and the fixture schemas have none — so the
  metadata mapping for an implicit m2m relation is unverified.
- **Self-relations are untested.** Nothing in the code treats them specially and
  the include is one level deep, so recursion is not possible, but a schema with
  one has not been run.
- **Sorting by a related field** (`author.name`) is not supported. Refusing to
  sort by the relation is the honest half of that; the useful half is later.
- **Composite foreign keys** take only the first column: `from` and `to` are
  single names. Prisma supports multi-column relations; this does not, and would
  mis-translate a filter on one.
- **The display field cannot be overridden.** The rule picks well on
  conventional schemas and has no escape hatch when it picks badly. That is
  0.5.0's field-override work.
- **The picker has no keyboard navigation** — options are reachable by tab, but
  there is no arrow-key or type-ahead handling. 0.7.0.

---

## 9. Result

```
displayField detected from the schema:        PASS
relation loaded with the record:              PASS
only primary key + display field selected:    PASS
N+1 avoided (measured, not assumed):          PASS
filter by relation name:                      PASS
sort by relation refused with a reason:       PASS
foreign keys excluded from search:            PASS
list and detail link to the related record:   PASS
form picker submits the foreign key:          PASS
verified against a real consumer:             PASS
to-many relations:                            NOT IN SCOPE — 0.4.0
```

|               | Before | After   |
| ------------- | ------ | ------- |
| Tests         | 395    | **405** |
| Packed checks | 40/40  | 40/40   |
| Version       | 0.2.0  | 0.3.0   |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.4.0 — Relations II, to-many.** Paginated inline lists on the parent,
navigation into a pre-filtered child list, and many-to-many attach/detach. The
fixture schemas need a many-to-many and a self-relation before that work starts.
