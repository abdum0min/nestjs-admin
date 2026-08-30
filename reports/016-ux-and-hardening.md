# 0.7.0 — UX and Hardening

Status: **complete.** No docs site, no demo, nothing published.

---

## 1. Executive Summary

The measurement this release opened with, against the playground running the
packed tarball:

```
takroriy unique email              500 INTERNAL_ERROR
mavjud bo'lmagan tashqi kalit      500 INTERNAL_ERROR
majburiy maydonsiz                 500 INTERNAL_ERROR
bog'liq yozuvi bor User o'chirish  500 INTERNAL_ERROR
```

Every ordinary mistake a person makes in a form answered with "an internal
error occurred" and nothing else. That is the correct treatment for a broken
database and the wrong treatment for someone who typed the same address twice —
and it was the largest UX defect in the product.

The same measurement now:

```
takroriy unique email              409 CONSTRAINT_VIOLATION  Another User already has this email.
majburiy maydonsiz                 400 CONSTRAINT_VIOLATION  email is required.
mavjud bo'lmagan tashqi kalit      409 CONSTRAINT_VIOLATION  foreign-key
bog'liq yozuvli o'chirish          409 CONSTRAINT_VIOLATION  foreign-key
```

Also delivered: refusals shown under the input they are about, multi-select and
bulk delete, deliberate empty states, an accessibility and contrast pass, a
responsive layout, provider-correct case-insensitive search, and a list
profiled at fifty thousand rows.

**627 tests** (was 562), **48/48** packed-consumer checks (was 40/40).

---

## 2. Constraint Violations

### Where the message comes from

`ConstraintError` carries a constraint kind, a model and the fields involved,
and **builds its own message**:

```ts
new ConstraintError('unique', 'User', ['email'])
// "Another User already has this email."
```

It does not forward the ORM's text, and that is a security decision rather than
a stylistic one. Prisma's own message for the same failure renders the call
site, an absolute path, and the data that was submitted:

```
Invalid `prisma.user.create()` invocation in
D:\...\node_modules\@nest-admin\nestjs\dist\prisma.cjs:41:9
{ data: { email: "ada@example.com", password: "hunter2" } }
```

Forwarding any of that is exactly what the generic 500 existed to prevent. So
the taxonomy gained a type whose message is _constructed_, and the exception
filter can forward it without having to read it.

### Two shapes, both real

The mapping is by Prisma error code, not `instanceof` — the reason the adapter
already gives, that importing `@prisma/client` here would load a second copy of
a package the consumer owns.

Two defects surfaced only by running it against a real install:

| Symptom                                | Cause                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields: []` on every unique violation | Prisma 7 **with a driver adapter** nests the columns at `meta.driverAdapterError.cause.constraint.fields`. `meta.target` — the shape reported without a driver adapter — is absent. |
| A missing required value stayed a 500  | It never reaches the database. Prisma refuses it as `PrismaClientValidationError`, which carries **no `code`**, so a code-based mapping matched nothing.                            |

Both shapes are now read. The validation error is recognised by constructor
name, and exactly one thing is taken from its message: the ``Argument `x` is
missing.`` phrase. There is a test that pushes a message containing a password
and a filesystem path through it and asserts neither reaches the output.

Where a connector names an index rather than its columns — `User_email_key` —
the columns are recovered from the convention, and only when the shape matches
exactly. A message that blames the wrong field is worse than one that blames
none, so anything unrecognised produces "Another User already has one of these
values."

### Status codes

A unique clash or a reference still in use is a **409**: it conflicts with data
that already exists, and repeating the request unchanged will fail again. A
missing required value is a **400**: the request itself was incomplete.

---

## 3. Where a Refusal Is Shown

The server names the fields; the interface uses the names. The message goes
under the input, `aria-invalid` marks the control, and `aria-describedby` links
the two so a screen reader announces the message as part of that field rather
than as loose text elsewhere on the page.

Three rules, each because the obvious behaviour is wrong:

- **A message the form cannot attach still gets the banner.** A failure naming
  a hidden or read-only column would otherwise vanish, leaving a submission
  that appears to do nothing.
- **`details` is read defensively.** It is free-form on the wire; a form that
  trusted its shape would break against a server that sent something else.
- **The message clears when that value is edited.** It was about the value that
  was submitted. Once that value is gone the message is stale, and leaving it
  reads as though the person had not answered it.

`ValidationError` gained an optional field list, so an application's own
refusal lands in the same place as the database's.

### A wrapping label was renaming the field

Putting the message inside the `<label>` that wrapped each control changed the
field's accessible name from `email *` to `email * Another User already has
this email.` — announced on every visit to the box thereafter. Naming and
describing are different jobs. Labels now associate by `for`/`id`, and the
message sits outside the label with `aria-describedby` pointing at it.

Caught by a test that could no longer find the input by its label.

---

## 4. Multi-Select and Bulk Delete

`DELETE /admin/:model` with `{ "ids": [...] }`. One segment, so it cannot be
confused with `/:model/:id`; the ids are in the body because a selection of two
hundred would not survive a URL length limit.

**A loop, not a `deleteMany`.** The adapter contract has no bulk delete, and
giving it one would oblige every adapter to have one. More to the point, hooks
are per-record: 0.6.0's example refuses to delete a pinned post, and it must
still refuse when the post is one of forty checkboxes. A single `deleteMany`
would step past every one of those refusals at once — the opposite of what a
confirmation dialog leads someone to expect.

**A partial result is a 200.** Deleting thirty records where two are still
referenced is not a failed request; twenty-eight rows are gone, and an error
response would say nothing about which. The response carries both lists and the
interface reports both halves, because nothing is rolled back and either
omission leaves someone with a wrong idea of what the database now contains.

**A 200 is not a licence to leak.** Per-record messages go through the same rule
the exception filter applies to a whole response, so a hook that objected
explains itself and a hook that broke stays generic. There is a test that
`connect ECONNREFUSED 10.0.0.5:5432` does not appear in a 200.

**A limit of 200 ids**, checked before the loop starts. Not a performance limit
— a blast-radius limit. The loop runs every hook, so a request naming fifty
thousand ids would hold a connection for minutes and be unstoppable halfway
through.

In the interface: a checkbox per row named after the record — "Select Ada
Lovelace", not "checkbox" forty times — and a header checkbox with three states.
The third has no HTML attribute (`indeterminate` is a property, set through a
ref), and without it a partial selection is indistinguishable from an empty one,
which makes the next click do the opposite of what it appears to.

---

## 5. Case-Insensitive Search

Previously a documented limitation, on the grounds that `mode: 'insensitive'`
is not universal. It is not — and the failure mode is not a no-op, it is Prisma
rejecting the query outright. So the provider is read from the schema and the
option is sent only where it is accepted:

| Provider            | Sent? | Why                                           |
| ------------------- | ----- | --------------------------------------------- |
| postgresql, mongodb | yes   | Prisma documents `mode` for these.            |
| mysql               | no    | Default collations end in `_ci`.              |
| sqlite              | no    | `LIKE` ignores ASCII case by default.         |
| sqlserver           | no    | Default collation is case-insensitive.        |
| cockroachdb         | no    | Support undocumented; not the place to guess. |

The provider is read from the schema text, because it is not in the DMMF and
cannot be asked of a client the application built. An unreadable provider
degrades to the previous behaviour, never to a panel whose every search fails.

The `contains`, `startsWith` and `endsWith` **filters** get the same treatment.
It would be strange for the search box to ignore case and the filter box not to,
and stranger to have to know which.

---

## 6. States, Accessibility, Layout

**Empty means two different things.** An empty table and an empty search result
look identical and have opposite remedies, so they now say different things —
"No People records yet" with _Create the first one_, against "No People matches
this search" with _Clear search and filters_.

**A page change keeps the rows.** Previously the table was replaced by a line of
text and then put back — a flash, which reads as a bug. The rows now stay and
dim, with `aria-busy` saying the same thing to a reader who cannot see dimming.
Only the first load blanks the screen.

**A skip link**, because the navigation holds one link per model: on a schema of
thirty models a keyboard user passes thirty links to reach the table, on every
page. It is a button that moves focus rather than an `<a href="#main">` — the
route lives in the hash, so a fragment link would navigate as well as jump.

**Contrast.** Two failures, measured rather than eyeballed:

|                                          | Before               | After                              |
| ---------------------------------------- | -------------------- | ---------------------------------- |
| `--muted` on the page background (light) | 4.28:1 — fails AA    | **5.04:1**                         |
| Active nav item, white on accent (dark)  | 2.52:1 — badly fails | **7.33:1** via a new `--on-accent` |

The second was on the one element that marks where you are.

**The whole CRUD flow works without a mouse**, walked through the real bundle
rather than assumed: skip link, create, edit, search, select and bulk delete,
each control reached by tab order and driven with keyboard events only. Two
findings came out of it. Every `onClick` in the interface is already on a
`<button>` or an `<a>`, so there was nothing mouse-only to fix. And the search
box announced "Search User" on a resource the rest of the interface calls
"People" — the raw model name had survived in a handful of visible strings,
which only a screen reader would have noticed.

**Also**: one `:focus-visible` ring rather than whichever the engine provides;
`prefers-reduced-motion` honoured; tables named, because a detail page shows
related records beside the record itself and "table" does not say which; and the
resource list becomes a scrolling row below 700px rather than thirty rows to
scroll past on a phone.

---

## 7. Fifty Thousand Rows

50,000 Product rows, SQLite, through HTTP, median of five:

```
first page, 25 rows            6 ms      page 400                6 ms
last page (offset 49,975)      6 ms      perPage=100             5 ms
sorted by name                10 ms      sorted by price desc    9 ms
filter price >= 500            7 ms      search "gasket"         8 ms
search one letter (37k hits)   9 ms      search + sort + filter 13 ms
metadata                       1 ms
```

Nothing needed changing. Two things worth stating because they were checked
rather than assumed:

- `perPage=100000` returns **100 rows**. The server-side cap holds; a client
  cannot ask for the table.
- Bulk delete of 100 records took **703 ms** — about 7 ms each, which is the
  cost of the per-record loop §4 explains. A full selection of 200 is therefore
  around 1.4 s. That is the trade for hooks running, and it is in the changelog.

Deep pagination is fast here because 50k rows of five columns is a small table.
It is an `OFFSET`, and it will not stay flat an order of magnitude up — noted
rather than fixed, because keyset pagination changes the API's shape and belongs
to a release that can afford it.

---

## 8. Verified in a Real Consumer

Against the packed tarball, over HTTP:

```
duplicate email                  409 CONSTRAINT_VIOLATION
  message                        Another User already has this email.
  fields                         ["email"]
missing required                 400 CONSTRAINT_VIOLATION  "email is required."
  paths or data leaked           no
bad foreign key                  409 foreign-key
delete a referenced User         409 foreign-key

search gasket / GASKET / GaSkEt  6238 / 6238 / 6238 matches
filter contains ANVIL            6237 matches

bulk delete of 5                 200, 5 deleted, 0 failed
re-delete plus a bad id          200, 0 deleted, 6 failed
  failure message                No Product record found for id "cmtf…"
as readonly                      403 FORBIDDEN
bad body                         400 INVALID_QUERY
```

Through the real UI bundle, in a real DOM:

```
table is named                   People
skip link                        moves focus to admin-main, route unchanged
checkboxes                       "Select all People on this page" / "Select Ada Lovelace"
header box on a partial page     indeterminate = true
declined confirmation            selection kept, nothing sent

message under the input          "Another User already has this email."
input marked invalid             true
message linked to the input      yes
label reads only the label       "Email address *"
no banner as well                yes
message clears on edit           yes
console                          no errors
```

Keyboard only, no mouse events dispatched at all:

```
focusable stops on the list page   25
skip link                          stop 1, lands on admin-main
create button                      stop 7 -> form -> Save at stop 3 -> record created
Edit                               stop 8 -> renamed
search box                         stop 8, named "Search People"
space on a checkbox                selected, "2 selected"
Delete selected                    stop 15 -> "2 deleted."
console                            no errors
```

---

## 9. Verification

| Check                 | Result                   |
| --------------------- | ------------------------ |
| `pnpm build`          | 0                        |
| `pnpm typecheck`      | 0                        |
| `pnpm format:check`   | 0                        |
| `pnpm test`           | **627 passed**, 34 files |
| `pnpm verify:package` | **48/48**                |

New tests: 65.

| File                                                                    | Covers                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/prisma/test/constraints.test.ts` (13)                         | Both Prisma metadata shapes, index-name recovery, the validation-error branch, and that no ORM text escapes  |
| `packages/prisma/test/search-mode.test.ts` (8)                          | Which providers are sent `mode`, and which must not be                                                       |
| `packages/nestjs/test/bulk-delete.test.ts` (10)                         | Partial results, per-record hooks, a withheld message in a 200, the id limit, the body shape, route ordering |
| `apps/admin-ui/test/field-errors.test.tsx` (9)                          | Where a refusal appears, the ARIA wiring, when it clears, and the banner fallback                            |
| `apps/admin-ui/test/bulk-select.test.tsx` (11)                          | Selection, the three-state header box, the confirmation, both halves reported, hidden without permission     |
| `apps/admin-ui/test/accessibility.test.tsx` (8)                         | Skip link, names, `aria-current`, announced states                                                           |
| Updated: `crud.test.ts`, `e2e.test.ts`, `query.test.ts`, `app.test.tsx` | Two tests encoded the old 500 behaviour; they now assert the new one                                         |

The packed-consumer script gained a `@unique` column and four checks. That was
deliberate: the driver-adapter metadata shape §2 describes does not occur in
this repository's own tests, which build clients differently. Only a real
install produces it.

---

## 10. Known Limitations

- **Bulk delete is not transactional**, and neither are hooks. Twenty-eight
  deleted and two refused leaves twenty-eight deleted.
- **A bulk delete costs one round trip per record** — roughly 1.4 s at the
  200-id limit.
- **Search on SQLite ignores case for ASCII only.** `LIKE` is defined that way
  and Prisma offers no option to change it there.
- **Deep pagination is an `OFFSET`.** Flat at 50k rows; it will not stay flat.
- **No column sorting from the table header** — sorting is a toolbar control.
- **Dark mode follows the operating system**; there is still no toggle.
- **No automated accessibility audit.** The checks here are hand-written
  assertions about specific things; nothing runs axe over the rendered page.

---

## 11. Result

```
ordinary mistakes are readable, not 500:       PASS
constraint errors name the field:              PASS
no ORM text, path or submitted data leaks:     PASS
refusals appear under their input:             PASS
application refusals do the same:              PASS
multi-select and bulk delete:                  PASS
per-record hooks still refuse in bulk:         PASS
partial results reported honestly:             PASS
case-insensitive search, correct per provider: PASS
empty, loading, error and forbidden states:    PASS
keyboard navigation, ARIA, contrast:           PASS
responsive layout:                             PASS
profiled at 50,000 rows:                       PASS
verified against a real consumer:              PASS
automated a11y audit, keyset pagination:       NOT IN SCOPE — §10
```

|               | Before | After     |
| ------------- | ------ | --------- |
| Tests         | 562    | **627**   |
| Packed checks | 40/40  | **48/48** |
| Version       | 0.6.0  | 0.7.0     |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.8.0 — documentation, a demo, and publishing preparation.**
