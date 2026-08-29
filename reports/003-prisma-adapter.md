# Phase 2 — Prisma Adapter

Status: **complete.** No HTTP API, no NestJS controllers, no admin UI.

---

## 1. Executive Summary

Phase 2 implements the first working ORM integration: `PrismaAdapter`, which
satisfies Core's `OrmAdapter` contract against a real Prisma Client.

Delivered:

- **Metadata acquisition** isolated to one module (`metadata/read-dmmf.ts`), the
  only file in the repository permitted to import `@prisma/get-dmmf`.
- **DMMF → `ModelMetadata` mapping**, covering types, primary keys, required and
  optional, unique, list, enum values, relations with cardinality, and defaults.
- **Generic CRUD** — `getModels`, `list`, `findOne`, `create`, `update`,
  `delete` — with no model-specific code anywhere.
- **Dynamic model resolution** guarded by a metadata-derived allowlist, with the
  single type escape confined to one file.
- **Pagination, sorting, filtering and search**, every field name validated
  against metadata before it reaches the client.
- **71 tests**, of which the CRUD and query suites run against a real SQLite
  database with nothing mocked.

Two findings changed the design during implementation:

1. **Multi-file schemas need no work at all.** `getDMMF` accepts
   `[filename, content]` tuples natively. Phase 1 listed this as an open risk
   assuming concatenation would be required; it is not.
2. **Phase 1's `isGenerated` guidance was wrong**, and the tests caught it.
   `hasDefaultValue || isUpdatedAt` would have made `active Boolean @default(true)`
   uneditable. The correct discriminator is the _shape_ of the default.

A third finding came out of a failing test rather than analysis: free-text
search across "all string fields" matched records by their `cuid` primary key,
so searching `"e"` returned rows whose random id happened to contain an `e`.
Fixed by excluding generated string fields from search.

---

## 2. Starting Point

Two commits existed: the monorepo foundation and the Phase 1 spike.

`packages/core` held contract types only — `OrmAdapter`, `ModelMetadata`,
`ListQuery`, `Page`, `NestAdminConfig` — plus a single `NestAdminError` base
class. `packages/prisma` contained `export {}` and a build config. No runtime
logic existed anywhere in the repository.

The Core contract was verified from the repository rather than assumed. Two
details differed from the shapes sketched in the Phase 2 brief, and the existing
contract was followed as instructed:

| Brief sketch                       | Actual Core contract                                | Kept           |
| ---------------------------------- | --------------------------------------------------- | -------------- |
| `findMany()`                       | `list()`                                            | `list()`       |
| `pageSize`                         | `perPage`                                           | `perPage`      |
| `Page.items`                       | `Page.data`                                         | `Page.data`    |
| `filters: Record<string, unknown>` | `filters: FilterRule[]` with a typed operator union | `FilterRule[]` |

The existing `FilterRule` shape is better than the sketch: a `Record` cannot
express `price >= 30`, and the closed `FilterOperator` union forces every future
adapter to declare support or reject explicitly.

---

## 3. Multi-file Schema Investigation

Phase 1 flagged this as an open question: Prisma allows `schema` to point at a
directory, while `getDMMF` was assumed to take a single string.

### What was tested

A three-file schema directory with a relation spanning two files:

```text
schema/
├── base.prisma      datasource
├── user.prisma      model User  { posts Post[] }
└── post.prisma      model Post  { author User @relation(...) }
```

1. **Does the Prisma 7 CLI accept a schema folder?** Yes, with no preview
   feature: `prisma validate` reported `The schemas at schema are valid`.
2. **Can `getDMMF` consume it directly?** Yes. Its signature is
   `getDMMF(options: GetDMMFOptions): DMMF.Document | GetDMMFError` with
   `datamodel: SchemaFileInput`, and:

   ```ts
   type MultipleSchemaTuple = [filename: string, content: string]
   type SchemaFileInput = string | Array<MultipleSchemaTuple>
   ```

3. **Does it resolve cross-file relations?** Yes:
   `Post.author -> User from=["authorId"] to=["id"]`.
4. **Do relative filenames work?** Yes, absolute and relative both parse.
5. **Does naive concatenation also work?** Yes for this schema — but it is the
   wrong approach, because it throws away the filenames Prisma uses in
   validation errors.

### Decision

**Multi-file schemas are supported in the MVP.** They are free: the reader
passes tuples, which is the shape `getDMMF` already wants. `readSchemaFiles()`
stats the path, reads `*.prisma` from a directory (sorted, for determinism) or
the single file, and hands over tuples.

No custom Prisma parser was written, and none is needed.

### Implications

- No `@prisma/schema-files-loader` dependency (it is not resolvable from
  `prisma` anyway — Prisma bundles its internals).
- A directory with no `.prisma` files fails loudly as "schema not found" rather
  than silently producing zero models.
- Locked in by two tests that read a real multi-file fixture and assert the
  cross-file relation maps correctly in both directions.

### One correction to Phase 1

Phase 1 stated that `getDMMF` "resolves with an error object". It is
**synchronous** and _returns_ `DMMF.Document | GetDMMFError`. The practical
hazard is identical — it never throws, so `result.datamodel.models` on a failure
yields a bare `TypeError` with none of Prisma's diagnostics — but the signature
in the Phase 1 report was wrong.

---

## 4. Architecture

```text
              packages/core                     no Prisma, no NestJS, no deps
              ┌──────────────────┐
              │ OrmAdapter       │  contract
              │ ModelMetadata    │  vocabulary
              │ ListQuery / Page │
              │ error types      │
              └────────▲─────────┘
                       │ implements
              ┌────────┴─────────┐
              │  PrismaAdapter   │  packages/prisma
              └────────┬─────────┘
                       │ uses
              ┌────────▼─────────┐
              │  Prisma Client   │  constructed by the consuming application
              └──────────────────┘
```

The dependency rule holds and is mechanically verifiable: `packages/core` has
no dependencies at all, and no file under `packages/core/src` mentions Prisma
outside a comment.

Internal structure of `packages/prisma`:

```text
src/
  adapter.ts                 PrismaAdapter - orchestration only
  metadata/
    read-dmmf.ts             the ONLY importer of @prisma/get-dmmf
    to-metadata.ts           DMMF -> ModelMetadata; no DMMF type escapes here
  query/
    to-prisma-args.ts        ListQuery -> findMany args, with validation
  client/
    delegate.ts              dynamic model resolution; the one type escape
```

Each boundary exists for a reason:

- **`read-dmmf.ts`** confines the metadata _source_. Migrating to the build-time
  Prisma generator recommended in Phase 1 is a change to this file alone.
- **`to-metadata.ts`** confines Prisma's _vocabulary_. It is deliberately
  independent of how the DMMF was obtained, so it survives that migration
  untouched — it is the durable asset.
- **`delegate.ts`** confines the _type escape_.
- **`to-prisma-args.ts`** confines _query translation_ and is where all field
  validation happens.

---

## 5. Metadata Pipeline

```text
schema.prisma (file or directory)
        │  readSchemaFiles - [filename, content] tuples
        ▼
   getDMMF()                     @prisma/get-dmmf, pinned to 7.10.0
        │  DMMF.Document | GetDMMFError
        ▼
   readPrismaDmmf()              detects the error return, throws loudly
        │  DMMF.Document
        ▼
   toModelMetadata()             the only translation point
        │
        ▼
   ModelMetadata[]               Core vocabulary; nothing Prisma-shaped survives
```

Metadata is read once per adapter instance and memoised. Every operation
validates against it, so re-parsing the schema per call would be wasteful; and
the schema is static at runtime, so caching cannot go stale within a process.

### Schema location

`schemaPath` may be given explicitly. When absent, `prisma/schema.prisma`,
`prisma/schema` and `schema.prisma` are tried in order relative to `cwd`, and
failure lists every path attempted. There is no clever project-root discovery —
a wrong guess here produces a confusing failure far from its cause.

### Field mapping

| Core field     | Derived from                                                        |
| -------------- | ------------------------------------------------------------------- |
| `kind`         | `field.kind` + `field.type` through a scalar table                  |
| `isId`         | `field.isId`                                                        |
| `isRequired`   | `field.isRequired`                                                  |
| `isUnique`     | `field.isUnique`                                                    |
| `isList`       | `field.isList`                                                      |
| `isGenerated`  | `isUpdatedAt \|\| isFunctionDefault(default)` — see below           |
| `defaultValue` | `default`, only when it is a literal                                |
| `enumValues`   | the schema's enum declaration, looked up by type name               |
| `relation`     | `{ targetModel: field.type, cardinality: isList ? 'many' : 'one' }` |
| `primaryKey`   | model-level `primaryKey.fields` (`@@id`), else the `@id` fields     |

`BigInt`, `Decimal` and `Bytes` map to `'unknown'` rather than being squeezed
into `'number'` or `'string'`. They do not round-trip through JSON without
losing precision, and editing them has not been tested — claiming support that
was never verified would be worse than declaring them unhandled. They still
appear in metadata, so an admin can display them read-only.

### The generated-field correction

Phase 1's Core docstring recommended deriving `isGenerated` as
`hasDefaultValue || isUpdatedAt`. **That is wrong**, and the tests caught it.

Measured against Prisma 7.10.0, DMMF distinguishes the two cases by _shape_:

```text
@default(cuid())           -> { name: 'cuid', args: [1] }         object
@default(now())            -> { name: 'now', args: [] }           object
@default(autoincrement())  -> { name: 'autoincrement', args: [] } object
@default(dbgenerated(...)) -> { name: 'dbgenerated', args: [..] } object
@default(true)             -> true                                primitive
@default(0)                -> 0                                   primitive
@default("USER")           -> "USER"                              primitive
```

A **function default** is an object carrying `name` — the database or ORM
produces the value. A **literal default** is a primitive — an ordinary editable
field that arrives pre-filled.

Phase 1's rule would have marked `active Boolean @default(true)` and
`role Role @default(USER)` as generated, hiding both from every create form.
The rule is now `isUpdatedAt || isFunctionDefault(default)`, and the literal is
surfaced separately as `defaultValue` for form pre-fill.

The Core docstring has been corrected, and five tests lock the distinction in.

---

## 6. CRUD Implementation

All six operations are model-agnostic. Every one resolves its delegate by name
at runtime; there is no `prisma.user.*` anywhere in the source.

| Operation     | Implementation                                                         |
| ------------- | ---------------------------------------------------------------------- |
| `getModels()` | `readPrismaDmmf()` → `toModelMetadata()`, memoised                     |
| `list()`      | `findMany(args)` and `count({ where })` in parallel, returning `Page`  |
| `findOne()`   | `findUnique({ where })` built from the primary key; `null` when absent |
| `create()`    | payload validated against metadata, then `create({ data })`            |
| `update()`    | `where` by primary key + validated payload, then `update()`            |
| `delete()`    | `delete({ where })`, `P2025` mapped to `RecordNotFoundError`           |

`list()` issues the row query and the count concurrently — the count must ignore
the page window but respect the filter, so it takes `where` and drops
`skip`/`take`.

`findOne()` returns `null` for a missing record, while `update()` and `delete()`
throw `RecordNotFoundError`. That asymmetry is deliberate: "show me this record"
answering "there isn't one" is a normal outcome, whereas "modify this record"
failing silently is not.

### Write payload validation

Unknown keys are **rejected**, not silently dropped. Quietly discarding a field
a user filled in produces a save that appears to succeed and loses data.
Relation and list fields are rejected explicitly, because nested writes are not
implemented and letting them through would surface as an opaque Prisma error.

---

## 7. Dynamic Model Resolution

Prisma exposes `model User` as `prisma.user` — the model name with only its
first character lower-cased (`UserProfile` → `userProfile`, _not_ general
camelCase). `toDelegateKey()` implements exactly that.

Resolution is layered so the type escape is the last step, not the first:

1. **Allowlist check.** The requested name must appear in metadata derived from
   the schema. A name that fails here never reaches the client at all. This is
   the real guard: attacker-controlled input cannot address arbitrary client
   properties.
2. **Forbidden-key check.** `__proto__`, `constructor` and `prototype` are
   rejected outright — defence in depth behind the allowlist.
3. **Client shape check.** The client must be a non-null object.
4. **The cast**, in one place: `(client as Record<string, unknown>)[key]`.
5. **Shape assertion.** The resolved value must expose `findMany`, `findUnique`,
   `count`, `create`, `update` and `delete` as functions. A client generated
   from a different schema than the one we read fails here with a message
   naming the cause and the fix (`re-run prisma generate`) rather than a
   `TypeError` deep in a query.

The delegate is typed structurally (`PrismaModelDelegate`) rather than imported
from `@prisma/client`. The client is generated in the consumer's project against
their schema, so there is no meaningful shared type to import, and depending on
one would couple us to a Prisma version we do not control.

No `any` appears anywhere in the package. The single escape is a narrowed
`Record<string, unknown>` cast, asserted immediately afterwards.

---

## 8. Query Design

### Pagination

1-based `page` with `perPage`, defaulting to 25 and clamped to 100. Clamped
rather than rejected — a UI asking for too much should get a capped page, not an
error. A non-integer or sub-1 value _is_ rejected, because that is a caller bug
rather than an ambitious request. `total` is the unpaginated count under the
same filter, which is what a pager needs.

Cursor pagination was not implemented: the Core contract is page-based, and
nothing in the MVP requires it.

### Sorting

Multiple `SortRule`s map to a Prisma `orderBy` array, preserving caller order.
Every field is validated; unknown, relation and list fields are rejected.

### Filtering

Each `FilterRule` becomes one Prisma condition; multiple rules are combined
with `AND`. Operator/type compatibility is enforced before the query is built:

- `contains`, `startsWith`, `endsWith` require a string field.
- `gt`, `gte`, `lt`, `lte` are rejected on booleans.
- `in` requires an array value.

These checks exist so a bad request produces a precise framework error instead
of a Prisma validation dump.

### Search

`contains` across the model's string fields, OR-ed together, then AND-ed with
any filters.

**Generated string fields are excluded**, and this was a real bug found by a
test rather than by inspection. The `Product` fixture has `id String @id
@default(cuid())`. Searching `"e"` returned `Drill`, whose name contains no `e`
— its random cuid did. Including opaque machine identifiers in free text makes
short searches match essentially at random. Looking a record up by id is an
exact-match concern and belongs in a filter.

Case sensitivity is left to the database. Prisma's `mode: 'insensitive'` is
PostgreSQL-only and throws on SQLite; applying it would make behaviour depend on
the provider in a way this phase has not tested. Recorded as a limitation.

---

## 9. Error Handling

Five error types were added to Core, all extending `NestAdminError`. They live
in Core because they are ORM-independent and the future HTTP layer must map them
to status codes without knowing which adapter raised them.

| Error                 | Raised when                                  | Likely HTTP mapping |
| --------------------- | -------------------------------------------- | ------------------- |
| `ModelNotFoundError`  | model absent from metadata                   | 404                 |
| `FieldNotFoundError`  | unknown/unusable field in a query or payload | 400                 |
| `RecordNotFoundError` | update/delete against a missing id           | 404                 |
| `InvalidQueryError`   | malformed pagination, bad operator/value     | 400                 |
| `AdapterError`        | ORM or database failure                      | 500                 |

Each carries structured context (`model`, `field`, `id`) so the HTTP layer can
build a response without parsing message strings. `ModelNotFoundError` lists the
known models, which turns a casing mistake into a self-answering error.

`AdapterError` always preserves the original as `cause`.

Prisma failures are identified by their `code` property, not `instanceof`.
Importing `@prisma/client` for its error classes would load a second copy of a
package the consumer owns and tie us to their Prisma version. Only `P2025` is
translated today; everything else becomes an `AdapterError` naming the model.

---

## 10. Testing

**71 tests across 3 files, all passing.** The CRUD and query suites run against
a real SQLite database with a real generated Prisma Client. Nothing is mocked —
faking the client would only prove our stubs match our expectations, which is
precisely the bug class these tests exist to catch.

`test/global-setup.ts` runs `prisma generate` and `prisma db push` before the
suite, invoking Prisma's entrypoint with the current Node binary (no shell, same
behaviour on POSIX and Windows). It lives in Vitest's global setup rather than a
`pretest` script so it runs however the tests are invoked — `pnpm test` from the
workspace root calls Vitest directly and would never see a package script.

Per-test isolation deletes rows; the schema is never dropped.

| Suite              | Tests | Covers                                                                                                                                                                                                                                                                                                               |
| ------------------ | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata.test.ts` |    21 | model discovery, primary keys, scalar kinds, required/optional, unique, list, enum values, relations in both directions, generated vs literal defaults, multi-file schemas, cross-file relations, schema-not-found, invalid-schema reporting                                                                         |
| `crud.test.ts`     |    26 | create/findOne/update/delete, generated field population, schema defaults, unknown-field rejection, relation-write rejection, unique-constraint surfacing, dynamic resolution across all four models, unknown model, prototype-key rejection, missing-client rejection, wrong-client diagnosis, numeric-id coercion  |
| `query.test.ts`    |    24 | default and explicit pagination, page windows, totals under filters, past-the-end pages, perPage clamping, invalid pagination, asc/desc sorting, sort validation, all six filter operator families, multi-filter conjunction, filter validation, search, blank search, search+filter, search excluding generated ids |

Notable behaviours locked in:

- **Multi-file relations resolve** across separate files, both directions.
- **`active @default(true)` is editable**; `id @default(cuid())` is not.
- **Search ignores cuid ids** — the regression test for the bug in §8.
- **String ids coerce to numbers** for `Int @id`, since ids arriving from a URL
  are always strings.
- **`list('__proto__')` is rejected** before the client is touched.
- **An empty object as a client** produces a message naming the missing delegate
  and telling the developer to re-run `prisma generate`.

### What is not covered

- Only SQLite. PostgreSQL and MySQL behaviour is untested, and case-insensitive
  search differs between them.
- Composite primary keys — no fixture model has one; the adapter's rejection
  path is asserted only indirectly.
- `BigInt`, `Decimal`, `Bytes` and `Json` round-trips.
- Concurrency and transactions.

---

## 11. Files Changed

### Added — `packages/prisma`

| File                                 | Purpose                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `src/adapter.ts`                     | `PrismaAdapter`, implements `OrmAdapter`                                 |
| `src/metadata/read-dmmf.ts`          | schema location, reading, DMMF parsing; sole `@prisma/get-dmmf` importer |
| `src/metadata/to-metadata.ts`        | DMMF → `ModelMetadata`                                                   |
| `src/query/to-prisma-args.ts`        | `ListQuery` → `findMany` args, with validation                           |
| `src/client/delegate.ts`             | dynamic model resolution                                                 |
| `vitest.config.ts`                   | global setup, source alias, serial execution                             |
| `test/global-setup.ts`               | generates the fixture client and database                                |
| `test/client.ts`                     | test client construction and row cleanup                                 |
| `test/fixtures/schema.prisma`        | `User`, `Product`, `Post`, `Counter`, `Role`                             |
| `test/fixtures/multi-file/*.prisma`  | three-file schema with a cross-file relation                             |
| `test/fixtures/broken/broken.prisma` | invalid schema, for error-path tests                                     |
| `test/{metadata,crud,query}.test.ts` | the suites above                                                         |

### Modified — `packages/core`

| File                    | Change                                                      |
| ----------------------- | ----------------------------------------------------------- |
| `src/errors/errors.ts`  | added five error types                                      |
| `src/index.ts`          | export them                                                 |
| `src/metadata/model.ts` | added `defaultValue`; corrected the `isGenerated` docstring |

### Modified — other

`packages/prisma/{package.json,tsconfig.json,index.ts,README.md}`,
`.gitignore` (ignore `**/test/.generated/`), `docs/status.md`.

`packages/prisma/src/index.ts` exports only `PrismaAdapter`,
`PrismaAdapterOptions` and the two schema errors. Verified against the built
`dist/index.d.ts`: no internal helper and no Prisma type leaks into the public
surface.

---

## 12. Dependencies

| Package                                 | Type              | Why                                                                                                                                                                                                                                                       |
| --------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@prisma/get-dmmf@7.10.0`               | **dependency**    | The Phase 1 decision. Exact pin: the parser enforces its own Prisma version's schema rules. Ours to ship, so a real dependency — unlike `@prisma/client`.                                                                                                 |
| `@prisma/dmmf@7.10.0`                   | **devDependency** | DMMF types, `import type` only. Verified the emitted `dist/index.d.ts` does not reference it, so consumers never need it — hence dev, not runtime. Prisma flags this package internal; it is pinned in lockstep with `get-dmmf` and used for types alone. |
| `prisma@7.10.0`                         | devDependency     | CLI for generating the test fixture client and database.                                                                                                                                                                                                  |
| `@prisma/adapter-better-sqlite3@7.10.0` | devDependency     | Prisma 7 requires a driver adapter to construct a client. SQLite keeps integration tests reproducible with no external service and no Docker.                                                                                                             |

`@prisma/client` remains a **peer** dependency, unchanged. Nothing was added to
Core — it still has zero dependencies.

---

## 13. Known Limitations

Stated plainly; none of these are claimed as working.

1. **Composite primary keys are rejected.** Represented in metadata
   (`primaryKey` is an array) but `RecordId` is a single scalar, so `findOne`,
   `update` and `delete` throw `InvalidQueryError` naming the model and its key
   columns. Deliberate: silently querying on the first column would return the
   wrong record.
2. **No nested relation writes.** Relation fields are rejected in create and
   update payloads. Relations exist in metadata only.
3. **No relation filtering or sorting.** Rejected with a specific message.
4. **Search case-sensitivity depends on the database.** Untested outside SQLite.
5. **`BigInt`, `Decimal`, `Bytes` map to `'unknown'`.** Listed but not
   editable-by-contract, and untested.
6. **Only SQLite is tested.**
7. **`getModels()` caches for the adapter's lifetime.** Correct at runtime;
   means a dev-server process will not see a schema edit without a restart.
8. **No transactions**, and no bulk operations.
9. **Only `P2025` is translated.** Unique-constraint violations (`P2002`) become
   a generic `AdapterError` — tested, but the message is Prisma's.
10. **No `mode: 'insensitive'`**, deliberately, as it is PostgreSQL-only.
11. **Schema discovery is a fixed three-path list.** It does not read
    `prisma.config.ts`, so a project with a custom `schema` there must pass
    `schemaPath` explicitly.

---

## 14. Architecture Risks

| #   | Risk                                                                                                                                             | Notes                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1   | **Schema must exist at runtime.** Slim Docker images often omit `prisma/`. Fails loudly, but fails.                                              | The strongest argument for migrating to the build-time generator.                          |
| 2   | **`@prisma/get-dmmf` is pinned exactly.** A consumer on a different Prisma major has a valid schema our parser may reject.                       | Carried over from Phase 1, now load-bearing. No version gate is implemented yet — see §15. |
| 3   | **`prisma.config.ts` is not consulted.** Prisma 7 moved schema location there; we re-implement a subset of that resolution.                      | Divergence will grow.                                                                      |
| 4   | **Delegate naming is inferred.** `toDelegateKey` assumes first-character lower-casing. Correct for Prisma 7, but it is a convention, not an API. | The shape assertion turns a wrong guess into a clear error rather than a crash.            |
| 5   | **`RecordId` will not survive relations.** Composite keys and relation addressing both press on it.                                              | Widening it is a Core contract change; better done deliberately than incrementally.        |
| 6   | **Metadata caching vs. long-lived processes.** Fine in production, awkward in dev.                                                               | Needs an invalidation story once the CLI and dev server exist.                             |
| 7   | **`FilterOperator` is closed by design.** Every richer query need forces a Core change that all adapters must answer.                            | This is the intended cost of the abstraction, but it will feel slow.                       |
| 8   | **Search performance.** OR-ing `contains` across string fields does not use indexes.                                                             | Fine for admin-sized tables; will not scale.                                               |
| 9   | **Only one ORM implements the contract.** The abstraction is unvalidated until a second adapter exists.                                          | Nothing here is proven ORM-agnostic — only designed to be.                                 |

---

## 15. Next Phase Recommendation

**Phase 3 should be the generic Admin HTTP API**, and nothing else. Not
implemented here.

The adapter now works standalone, which is exactly the separation that makes the
HTTP layer debuggable: a failure will be in the transport, not the ORM.

Recommended scope:

1. `AdminModule.forRoot({ adapter })` — dependency injection and lifecycle only.
2. Two endpoint families, both speaking Core vocabulary: **metadata**
   (resources and fields, so the UI renders generically) and **records**
   (list/read/create/update/delete).
3. **Map Core errors to status codes.** The five error types were designed for
   this; the mapping belongs in a Nest exception filter, and no controller
   should construct an HTTP error itself.
4. Parse and validate query strings into `ListQuery` at the edge. The adapter
   validates field _names_ but assumes `page` is a number, not `"abc"`.
5. Write the HTTP contract down before implementing it — it is the seam the
   admin UI and every future adapter are built against.

Two smaller items worth doing early, both cheap now and expensive later:

- **A Prisma version gate.** Risk 2 has no mitigation in code yet. Detect the
  consumer's Prisma version at startup and fail with a message naming both
  versions rather than surfacing a confusing parse error.
- **An import-boundary lint rule.** "Core imports no Prisma" and
  "`@prisma/get-dmmf` is imported by one module" are currently enforced by
  documentation and review. A failing build enforces them better.

Explicitly **not** next: the admin UI, authentication, the CLI `init` command,
the Prisma generator, or a second ORM adapter.

---

## 16. Verification

Run from a clean working tree at the end of the phase:

```text
pnpm build         PASS (exit 0)
pnpm typecheck     PASS (exit 0)  - 7 projects, tests included
pnpm test          PASS (exit 0)  - 71 tests, 3 files
pnpm format:check  PASS (exit 0)
```

Test output:

```text
 Test Files  3 passed (3)
      Tests  71 passed (71)
```

Typecheck covers `src`, `test` and config files for `packages/prisma`; the
generated fixture client is excluded, as it ships `@ts-nocheck` and is a build
artefact.

The public type surface was inspected directly rather than assumed:

```text
declare class PrismaAdapter implements OrmAdapter
interface PrismaAdapterOptions
declare class PrismaSchemaNotFoundError extends NestAdminError
declare class PrismaSchemaInvalidError extends NestAdminError
```

No internal helper, no DMMF type, and no `@prisma/*` import appears in the
emitted declarations.
