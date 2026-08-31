# 021 — A second adapter, and the documentation

`0.10.0 → 0.11.0`

Three pieces of work, and two of them were scheduled later. They were moved
forward for the same reason: 1.0 freezes things, and neither gets easier by
waiting.

1. `apps/` collapsed into `packages/`, and the empty component package removed.
2. A **Drizzle adapter** — the second implementation of `OrmAdapter`.
3. The documentation, rebuilt, because it had drifted three releases behind.

---

## 1. One `packages` tree

`packages/ui` was twelve lines of comment. Its contents were only ever going to
be the components the interface already has: vendored from shadcn, bundled into
one artefact, with no second consumer to extract them for. It was versioned
every release and built every build for nothing, so it is gone.

`apps/` held exactly one thing, and that thing is consumed by `packages/nestjs`
at build time like any other workspace package. `apps/admin-ui` is now
`packages/admin-ui` and `apps/` no longer exists — the workspace has two kinds
of directory instead of three: packages that build, and examples that consume
them.

The package name `@nest-admin/admin-ui` did not change, so no import changed and
no source changed. What changed is nine references to a path: the workspace
file, the build script, the Vitest projects, `.gitignore`, the asset copier, and
four comments.

---

## 2. The Drizzle adapter

### Why

`OrmAdapter` was written against Prisma, and until this release Prisma was the
only implementation. That made "contract" and "description of Prisma"
indistinguishable — and the in-memory test double used by the HTTP suites is
written against the same assumptions, so it was weaker evidence of generality
than it looked.

Freezing an interface with one implementation is the standard way to discover at
1.1 that it needed a breaking change. The question had to be asked before the
freeze, not after.

Drizzle is the useful opposite of Prisma:

|                         | Prisma                             | Drizzle                   |
| ----------------------- | ---------------------------------- | ------------------------- |
| Metadata                | DMMF, generated from a schema file | the schema module object  |
| Errors                  | `P2xxx` with a `meta` object       | whatever the driver threw |
| Case-insensitive search | `mode: 'insensitive'`              | nothing portable          |
| `contains` escaping     | done for you                       | not done for you          |
| Relations               | always present, always named       | only if declared          |
| Many-to-many            | first-class                        | does not exist            |

If the contract had Prisma baked into it, this is where it would show.

### The answer

**Core needed no changes.** Not one type, not one field, not one error.

**Nothing above the adapter needed changes.** The module, the controller, the
query parser, the metadata DTO, the exception filter, the dashboard and the
interface are the same code both adapters run under.
`packages/nestjs/test/drizzle-e2e.test.ts` boots the whole admin over Drizzle
and drives the routes the Prisma end-to-end suite drives — metadata, filters,
sorting, search, writes, constraint mapping, nested relation routes, and the
dashboard. Sixteen tests, and nothing above the adapter changed to make them
pass.

Not a line of `packages/admin-ui` changed. That is now asserted rather than
observed: a boundary test fails the build if the interface imports an ORM, an
adapter or Core.

### What had to be done inside the adapter

**Metadata, from the schema object.** There is no generated artefact — Drizzle
Kit reads the table definitions directly, and so does this. Tables are found
with `is(value, Table)`, columns with `getTableColumns`, foreign keys through
the dialect's `getTableConfig`.

The dialect is detected without importing any dialect: every column's
`columnType` is prefixed with it (`SQLiteText`, `PgInteger`, `MySqlInt`), so the
matching core is imported on demand and a SQLite application never loads the
Postgres one.

**Names are the developer's.** A table exported as `users` is the model `users`;
a column declared `createdAt: integer('created_at')` is the field `createdAt`.
Those are the names their own queries use — and, since Drizzle returns rows
keyed by property, the names the data already arrives under. Using SQL names
would produce an admin whose URLs disagree with the schema file on the
developer's screen.

**Relations, twice over.** Declared `relations()` are read by calling the config
with Drizzle's own helpers, and their names win. Where none are declared, both
ends are derived from the foreign key: `posts.authorId` produces `author` on a
post and `posts` on a user. Both paths give both ends the _same_ relation name,
because that is what `inverseRelationField` pairs on — without it, nested
relation routes cannot work at all.

**`lower()` instead of `ilike`.** Prisma has `mode: 'insensitive'` on some
providers; Drizzle has `ilike` on Postgres only. Rather than branch per dialect,
both sides go through `lower()`, which every supported dialect has. It costs an
index unless one is declared on the expression, and that is written down beside
the code rather than discovered later.

**Escaping `LIKE`.** Prisma escapes `%` and `_` inside `contains`. Building the
pattern by hand means doing it here, or a search for `100%` matches every row.
A test asserts all three cases.

**Reading the driver's error.** There are no normalised codes. SQLite reports
`SQLITE_CONSTRAINT_UNIQUE` with `UNIQUE constraint failed: users.email`;
Postgres reports `23505` with the columns in `detail`. Both are read, and the
column names are translated **back into the schema's vocabulary** — the driver
says `author_id`, every other layer says `authorId`, and reporting the former
would point the interface at a field the form has not got.

### What was refused

**MySQL**, at startup, with a reason. It has no `RETURNING`, so `create` and
`update` could not report the stored row without a second query and a
driver-specific way to identify it. An adapter that returned the submitted data
instead would hide every default and every trigger — silently, which is the
worst way to be wrong. Better to refuse than to ship untested and confident.

PostgreSQL takes the same code path as SQLite and is expected to work, but has
not been tested and is recorded as such.

**Many-to-many.** Drizzle does not have it. A join table is a table, and appears
in the admin as its own resource with a to-one on each side — which is exactly
what Prisma does for an explicit join table with payload. Inventing a relation
the schema does not have would be a lie the first migration exposes.

### What the exercise found

Three things, all recorded rather than patched over.

**The dashboard route was declared in the wrong place** — this one was found in
0.10.0 and is mentioned because the same class of mistake was checked for here.

**`RecordId` is a single value.** A model with a composite primary key can be
listed but not opened. The Drizzle adapter refuses `findOne` on one with a
message saying why. Prisma has the same limitation; it had simply never been
hit, because a Prisma schema tends to have an `@id`. This is a contract question
and belongs to the freeze.

**Constraint field names are best-effort.** The contract assumed an adapter can
always report which column a violation was about. Prisma can. A raw driver can
only sometimes, by parsing a message, and on some drivers for some violations it
genuinely cannot. `ConstraintError` already allowed an empty list and the
interface already degrades to a banner — so it held, but by luck rather than by
design. Also for the freeze.

### Packaging

`@nest-admin/nestjs/drizzle`, beside `./prisma`, arranged identically. The
subpath split was built in 0.2.0 so that an application which never touches an
ORM never loads its code; this is the first thing to actually use it.

The packed-package checks grew from 48 to 56 and now assert the Core-copy counts
for the third entrypoint: one shared chunk in ESM, one inlined copy per CJS
entrypoint. That invariant is what makes `Symbol.for` branding necessary instead
of `instanceof`, and it still holds with three entrypoints.

---

## 3. The documentation

### The drift, measured

| Document                | Claimed                                                       | Actual                       |
| ----------------------- | ------------------------------------------------------------- | ---------------------------- |
| `README.md`             | "Status: 0.8.0" and "None of the above works yet"             | 0.10.0, and all of it worked |
| `docs/status.md`        | 304 tests                                                     | 913                          |
| `docs/project-state.md` | an analysis of 0.7.0                                          | three releases stale         |
| `docs/architecture.md`  | `packages/ui`, `apps/admin-ui`, "how they _will_ communicate" | neither path existed by then |

Reports do not drift, because each is written once about one release and never
revised. Living documents drift, because nothing fails when they do.

### What was written

**New:**

- [`docs/getting-started.md`](getting-started.md) — from an existing NestJS
  application to a working admin, in the order you actually do it: install, wire
  the module, put it behind a login, customise, add rules, add a dashboard, and
  the Drizzle variant.
- [`docs/configuration.md`](configuration.md) — every option, with the closed
  lists spelled out, the query-string grammar, and the error table. The
  reference you look things up in rather than read.
- [`docs/adapters.md`](adapters.md) — the contract, the two adapters compared
  line by line, how to write a third, and what the second one proved.

**Rewritten:**

- `README.md` — what it is, what it is _not_, and an accurate status.
- `docs/status.md` — the implemented list, and a "not implemented" section split
  into _planned_ and _deliberately absent_, because those are different promises.
- `docs/project-state.md` — the assessment, at 0.11.0, with risks re-ranked.
- `docs/README.md` — an index that distinguishes using it from understanding it.

**Updated:** `architecture.md` (two open decisions marked resolved, two new ones
recorded), `publishing.md`, `roadmap.md`, and `mvp-scope.md` — the last marked
historical rather than deleted, because the reasoning at the bottom of it is why
the seams held.

### One correction

A draft of `project-state.md` stated a precise defect count across all releases.
That number was not derived from anything — the reports record defects
individually and nothing tallies them. It was replaced with the categories and
named examples, keeping only the count that was actually measured at the 0.7.0
review.

### Risks re-ranked

The second adapter moved the top risk. `OrmAdapter` having one implementation
was the number one entry in the 0.7.0 assessment; it is now fourth, and the new
first is **row-level permissions**, which do not exist and are API-shaped — so
they must land before the freeze rather than after it. The roadmap moved them
into the next release accordingly.

---

## Verification

|                              |                                                       |
| ---------------------------- | ----------------------------------------------------- |
| Tests                        | 913 → **936** (52 files)                              |
| Packed-package checks        | 48 → **56**                                           |
| Drizzle adapter suite        | 49, against real in-memory SQLite                     |
| Drizzle over the whole admin | 16, over real HTTP                                    |
| Boundary checks              | 7 → **13**                                            |
| Bundle                       | 137.8 KB gzip (unchanged; the adapter is server-side) |
| Typecheck                    | clean across every package                            |

---

## Numbers

|                    | 0.10.0  | 0.11.0                     |
| ------------------ | ------- | -------------------------- |
| Packages           | 6       | 6 (one removed, one added) |
| Published packages | 1       | 1                          |
| Entrypoints in it  | 2       | 3                          |
| ORMs               | 1       | 2                          |
| Source lines       | ~15,200 | ~16,600                    |
| Living documents   | 8       | 10                         |

---

## What is not here

- **No Postgres test run.** The dialect is written for and untested. `pglite`
  would make it testable in-process and is the obvious next step if the claim
  is to be made rather than qualified.
- **No Drizzle example application.** The reference consumer is still Prisma.
  The adapter's own suites and the end-to-end suite cover the behaviour; a
  second example would mostly duplicate the first.
- **No documentation site.** The content now exists and is current, which was
  the prerequisite. The site is 0.12.0.
- **The npm scope is still unclaimed.** Checked during this release:
  `@nest-admin/nestjs` is free, while the unscoped `nest-admin` and
  `nestjs-admin` are both taken by packages abandoned in 2022 — which is itself
  the argument for the scope. Claiming it needs an npm account and is the one
  item here that someone else can take away.

Next, per the roadmap: 0.11.5, customisation — including row-level
authorization.
