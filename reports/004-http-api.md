# Phase 3 — Generic Admin HTTP API

Status: **complete.** No admin UI, no authentication, no CLI, no Prisma
generator, no second ORM adapter.

---

## 1. Executive Summary

Phase 3 puts an HTTP boundary in front of the Phase 2 adapter. One generic
controller serves every model; a metadata endpoint describes the schema in
framework vocabulary so a future frontend can render CRUD screens without
knowing an ORM exists.

Delivered:

- `AdminModule.forRoot({ adapter })` — NestJS wiring, no global state, no
  client construction, not `@Global()`.
- Six routes under `/admin`: one metadata endpoint and five REST CRUD routes,
  all served by a **single** controller resolving models by name at runtime.
- A query parser converting HTTP strings into Core's `ListQuery`, with
  **type-directed value coercion** — `?filter=age:gte:30` reaches the adapter
  as the number `30`.
- A public metadata DTO written as an explicit whitelist, so nothing an adapter
  attaches internally can reach a client.
- A consistent response envelope and a centralised exception filter mapping
  Core errors to status codes.
- A **Prisma version gate** (Phase 3.9) in `packages/prisma`, which fails open
  when the version cannot be read.
- **Mechanically enforced import boundaries** (Phase 3.10) — six assertions
  replacing what was previously enforced by review.

**146 tests** pass, up from 71.

Three findings worth carrying forward:

1. The HTTP layer is tested primarily against a **second, non-Prisma adapter**.
   That is the strongest available evidence that the layer is genuinely
   ORM-agnostic rather than merely intended to be.
2. **The published type declarations do not resolve.** The JS bundle correctly
   inlines the workspace packages; the `.d.ts` still imports from
   `@nest-admin/core`, which is private and never published. Pre-existing,
   found by the `.d.ts` inspection this phase mandated, and not fixed — see §16.
3. The admin base path is **fixed at `/admin`**, not configurable, despite Core
   declaring `NestAdminConfig.path`. Reasoning in §5.

---

## 2. Starting Point

Three commits: the foundation, the metadata spike, the Prisma adapter.

`packages/nestjs` contained only re-exports — `src/index.ts` forwarding Core
types and `src/prisma.ts` forwarding the adapter for the published `./prisma`
subpath. No module, no controller, no runtime logic.

Baseline before any change: build, typecheck, format all exit 0; 71 tests pass.

The Core contract was read from source rather than taken from the Phase 2
report. Two details in the Phase 3 brief did not match the repository, and the
repository won, as instructed:

| Brief sketch                       | Actual Core contract            | Used            |
| ---------------------------------- | ------------------------------- | --------------- |
| `Page.items`                       | `Page.data`                     | `Page.data`     |
| `pageSize`                         | `perPage`                       | `perPage`       |
| `filter[age][gte]=18` bracket form | `FilterRule[]` + operator union | colon form (§6) |

No Core contract was changed in this phase. The HTTP layer was designed to fit
the existing vocabulary, which is the outcome the seam was built for.

---

## 3. Architecture

```text
HTTP request
     │
     ▼
AdminController          @Controller('admin'), @UseFilters(AdminExceptionFilter)
     │  route params, query object, body
     ▼
AdminService             coordination; Core vocabulary only
     │  parseListQuery(raw, metadata)
     ▼
OrmAdapter               Core contract  ◀── the only thing below this line
     │                                      that the HTTP layer knows about
     ▼
PrismaAdapter → Prisma Client → SQLite
```

Dependency direction is unchanged and now mechanically checked:

```text
                 ┌───────────────┐
                 │     Core      │   no NestJS, no Prisma, zero dependencies
                 └───────▲───────┘
                         │
             ┌───────────┴───────────┐
      ┌──────┴──────┐        ┌───────┴───────┐
      │   Prisma    │        │    NestJS     │
      │   Adapter   │        │  HTTP / Admin │
      └──────┬──────┘        └───────────────┘
             │
      Prisma Client
```

Files added to `packages/nestjs/src`:

```text
module.ts                  AdminModule.forRoot
tokens.ts                  ADMIN_ADAPTER injection token (a Symbol)
admin/
  controller.ts            the single generic controller
  service.ts               coordination
  metadata.dto.ts          public HTTP metadata shape + mapper
http/
  query-parser.ts          HTTP strings -> ListQuery
  response.ts              envelope types and helpers
  exception.filter.ts      Core errors -> HTTP responses
```

The Phase 3 brief sketched `admin/dto/` and `admin/mapper/` directories. Both
would have held one file each, so they were collapsed into `metadata.dto.ts` —
the DTO and its mapper are one concern, and the brief also asked to avoid
unnecessary folders.

---

## 4. HTTP Contract

### Response envelope

The repository had no existing convention (nothing HTTP existed), so the shape
from the brief was adopted:

```jsonc
// success
{ "success": true, "data": <payload> }

// list responses additionally carry pagination
{ "success": true, "data": [ … ], "meta": { "total": 3, "page": 1, "perPage": 25 } }

// failure
{ "success": false, "error": { "code": "MODEL_NOT_FOUND", "message": "…", "details": { … } } }
```

One deliberate divergence: list responses put rows in `data` and pagination in
`meta`, rather than nesting the whole Core `Page` under `data`. Serialising
`Page` directly would produce `data.data` for every list, which is an awkward
thing to hand a frontend for no gain.

`DELETE` returns `200` with `"data": null` rather than `204`, so every endpoint
answers with the same envelope and a client needs exactly one response shape.

### Error codes

`error.code` is a stable, machine-readable string — `MODEL_NOT_FOUND`,
`RECORD_NOT_FOUND`, `FIELD_NOT_FOUND`, `INVALID_QUERY`, `INTERNAL_ERROR`.
Clients branch on the code, never on the message, so messages stay free to
improve.

---

## 5. Route Design

| Method   | Route               | Purpose  |
| -------- | ------------------- | -------- |
| `GET`    | `/admin/meta`       | Metadata |
| `GET`    | `/admin/:model`     | List     |
| `GET`    | `/admin/:model/:id` | Read one |
| `POST`   | `/admin/:model`     | Create   |
| `PATCH`  | `/admin/:model/:id` | Update   |
| `DELETE` | `/admin/:model/:id` | Delete   |

**Model naming.** `:model` is the model name exactly as the adapter reports it —
`User`, not `users` or `user`. Matching is case-sensitive. No pluralisation or
case transformation is applied anywhere: any such mapping would have to be
inverted on every request and would break the moment a schema used a name the
transformation did not round-trip. A wrong case returns 404 listing the models
that do exist, which makes the mistake self-correcting.

**One controller, not many.** There is no `UsersController`. Models are resolved
by name at runtime, so a schema change needs no rebuild and the schema is not
restated in a second place.

**Route collision.** `/admin/meta` is declared before `/admin/:model`, so the
literal segment wins. A model named exactly `meta` would be shadowed. Prisma
model names are conventionally capitalised and matching is case-sensitive, so
`Meta` is unaffected; the corner is narrow, real, and documented rather than
hidden.

**Fixed base path — a deliberate limitation.** Core declares
`NestAdminConfig.path`, but `AdminModule` mounts at a hard-coded `/admin`.
NestJS binds controller paths through a decorator at class-definition time, so
a configurable prefix needs either a dynamically constructed controller class or
`RouterModule`. The first is fragile (route metadata and inheritance interact
badly); the second changes how consumers import the module. More importantly it
would buy nothing yet: `apps/admin-ui`'s Vite `base` is also hard-coded to
`/admin/`, so a configurable server path without a configurable client path
produces a broken UI. Both should move together, in the phase that serves the
UI. Recorded as deferred work rather than half-built.

---

## 6. Query Syntax

```text
?page=2
?perPage=25
?search=ada
?sort=email:asc&sort=createdAt:desc
?filter=age:gte:18&filter=role:in:ADMIN,USER
```

`sort` and `filter` are repeatable; order is preserved.

### Why colon form and not brackets

The brief suggested `filter[age][gte]=18`. Bracket syntax depends on the HTTP
platform enabling a nested query parser — `qs` under Express — and arrives as a
single literal key where it is not enabled. Colon form parses identically on any
platform and on any Nest HTTP adapter, and it makes `sort` and `filter` share
one visual grammar.

A filter is split into **at most three parts**, so colons inside a value
survive: `filter=startedAt:gte:2024-01-01T00:00:00Z` parses as field
`startedAt`, operator `gte`, value `2024-01-01T00:00:00Z`. There is a test for
exactly this.

Operators are Core's existing union, restated as a runtime array because a
TypeScript union cannot validate a string arriving over HTTP. A compile-time
assignment keeps the two in lockstep — if Core adds an operator the parser does
not accept, the build fails. No new operators were added.

### Type coercion is the reason the parser needs metadata

HTTP delivers strings; the adapter expects values. `?filter=age:gte:30` must
reach Prisma as the number `30`, or the comparison is done lexically or rejected
outright. Only the schema knows `age` is a number, so `parseListQuery` takes the
model's metadata and coerces by declared kind:

| Kind       | Coercion                            |
| ---------- | ----------------------------------- |
| `number`   | `Number()`, non-finite rejected     |
| `boolean`  | `true` / `false` only               |
| `datetime` | `new Date()`, invalid date rejected |
| others     | passed through as a string          |

`in` splits on commas and coerces each element. Values containing a comma
cannot be expressed — a documented limitation of the syntax.

**Unknown field names are deliberately not validated here.** The adapter already
owns that rule and rejects them with `FieldNotFoundError`. The parser skips
coercion for a field it cannot find and lets the value through, so the rule
lives in exactly one place. The client still gets a 400 either way.

`page` and `perPage` are validated with an explicit digit test rather than
`Number()`, which would otherwise accept `1e3`, `0x10` and `' 12 '`.

---

## 7. Metadata Response Design

`GET /admin/meta` returns:

```jsonc
{
  "success": true,
  "data": {
    "models": [
      {
        "name": "User",
        "primaryKey": ["id"],
        "fields": [
          { "name": "id",     "kind": "string",  "isId": true,  "isRequired": true,  "isUnique": false, "isList": false, "isGenerated": true },
          { "name": "email",  "kind": "string",  "isId": false, "isRequired": true,  "isUnique": true,  "isList": false, "isGenerated": false },
          { "name": "active", "kind": "boolean", …, "isGenerated": false, "defaultValue": true },
          { "name": "role",   "kind": "enum",    …, "enumValues": ["USER", "ADMIN"] },
          { "name": "posts",  "kind": "relation",…, "isList": true, "relation": { "targetModel": "Post", "cardinality": "many" } }
        ]
      }
    ]
  }
}
```

This is a **separately declared DTO with an explicit mapper**, not a serialised
`ModelMetadata`. Two reasons, both load-bearing:

1. Core's contract is `@experimental` and will keep moving. The wire format must
   not move with it by accident.
2. The mapper is a whitelist. It builds each field property by property; a
   spread would forward anything a future adapter attaches to `FieldMetadata`
   straight onto the wire.

A test asserts the response contains only the documented keys, and another
asserts the payload contains no `prisma`, `dmmf`, `relationName`,
`hasDefaultValue`, `isUpdatedAt` or `dbName` — the Prisma vocabulary that must
never surface. Both run against the real Prisma adapter too.

The `isGenerated` / `defaultValue` split from Phase 2 survives to the wire,
which is what lets a frontend render `id` and `createdAt` as read-only while
pre-filling `active` with `true`.

---

## 8. CRUD Flow

```text
GET /admin/User?page=2&filter=age:gte:30
     │
AdminController.list       extracts :model and the raw query object
     │
AdminService.list          getModels() -> find 'User' -> ModelNotFoundError if absent
     │                     parseListQuery(raw, metadata)  ← coercion happens here
     ▼
OrmAdapter.list('User', { page: 2, filters: [{ field: 'age', operator: 'gte', value: 30 }] })
     │
     ▼
Page<RecordData>  →  { success: true, data: [...], meta: { total, page, perPage } }
```

The controller is thin: params, query, body, response. The service holds
coordination and no ORM knowledge.

`findOne` is the one place the service adds behaviour: the adapter returns
`null` for a missing record, which over HTTP is a 404, so the service raises
`RecordNotFoundError` rather than letting a `null` body through.

`create`, `update` and `delete` pass the body straight to the adapter, which
already validates it against metadata — unknown keys, relation writes and list
writes are rejected there. Duplicating that in the HTTP layer would put one rule
in two places.

---

## 9. Error Mapping

Centralised in `AdminExceptionFilter`. No controller method constructs an HTTP
exception.

| Core error            | Status | Code               | Message forwarded? |
| --------------------- | -----: | ------------------ | ------------------ |
| `ModelNotFoundError`  |    404 | `MODEL_NOT_FOUND`  | yes                |
| `RecordNotFoundError` |    404 | `RECORD_NOT_FOUND` | yes                |
| `FieldNotFoundError`  |    400 | `FIELD_NOT_FOUND`  | yes                |
| `InvalidQueryError`   |    400 | `INVALID_QUERY`    | yes                |
| everything else       |    500 | `INTERNAL_ERROR`   | **no**             |

The allowlist is a security decision, not a stylistic one. `AdapterError` wraps
raw ORM failures whose messages contain absolute source paths and generated
query fragments — Phase 2's own test output shows a Prisma error quoting
`D:/IT/.../packages/prisma/src/adapter.ts:120`. `PrismaSchemaNotFoundError` and
`PrismaSchemaInvalidError` likewise carry filesystem paths. All are
`NestAdminError` subclasses, so a mapping keyed on the base class would have
leaked every one of them. Matching on specific classes and defaulting to a
generic 500 means a **new** internal error type cannot start leaking by default.

Unexpected errors are logged server-side with their stack before the generic
response is returned, so nothing is lost operationally.

`HttpException`s thrown by Nest itself are rethrown untouched — a 404 from an
unmatched route is not ours to reinterpret.

**The filter is applied with `@UseFilters` on the controller, not registered as
an `APP_FILTER`.** An `APP_FILTER` provider from a library would silently
replace error handling for the entire host application. That is not a library's
decision to make.

---

## 10. NestJS Dependency Injection

```ts
AdminModule.forRoot({ adapter })
```

returns a `DynamicModule` providing:

- `ADMIN_ADAPTER` (a `Symbol`, so it cannot collide with a host token or be
  injected by accident) → `useValue: options.adapter`
- `AdminService`, injecting that token
- `AdminExceptionFilter`, so Nest can resolve it for `@UseFilters`
- `controllers: [AdminController]`

No module-level mutable state, so two instances in one process cannot interfere.
Not `@Global()` — making a library's providers globally visible in someone
else's application is the application's decision. `AdminService` is exported for
consumers who want to reuse the coordination layer outside HTTP.

`forRoot` throws immediately if `adapter` is missing, with a message naming the
fix, rather than failing later with an injection error.

**`forRootAsync` was considered and deliberately not implemented.** It is a real
need — an adapter often depends on an injected client — but the brief specified
`forRoot`, and adding an async variant now would fix its shape before there is a
consumer to shape it against. Listed as deferred work.

---

## 11. Security Considerations

| Concern                                         | Handling                                                                                                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrary model names reaching client internals | The adapter resolves models against a metadata-derived allowlist before touching the client. Tested at the HTTP level against the real Prisma adapter with `__proto__`, `constructor`, `$connect`, `$queryRaw` and `_engine` — all 404. |
| Prototype pollution via route params            | Same allowlist, plus an explicit forbidden-key check in the adapter.                                                                                                                                                                    |
| Field names reaching a query object unvalidated | Sort and filter field names are validated against metadata before a query is built. No raw SQL exists anywhere; all queries go through Prisma's structured API.                                                                         |
| Internal detail in error responses              | Allowlist mapping (§9). Tested: an adapter throwing `connect ECONNREFUSED … /srv/app/secret/path.ts` produces a generic 500 containing neither the host, the path, nor a stack.                                                         |
| ORM vocabulary leaking through metadata         | Explicit DTO whitelist, asserted against the real Prisma adapter.                                                                                                                                                                       |
| Unknown fields silently accepted on write       | Rejected by the adapter with a 400 rather than dropped.                                                                                                                                                                                 |

Not addressed, and out of scope by instruction: **there is no authentication or
authorization**. Every route is open to anyone who can reach it. Mounting this
on a public application today would expose the entire database. That is the
single most important thing for Phase 4 to fix, and it is stated plainly in
`docs/status.md` rather than buried.

---

## 12. Tests

**146 passing across 7 files**, up from 71.

| Suite                              | Tests | Adapter                  | Covers                                                                                                                                                                                  |
| ---------------------------------- | ----: | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nestjs/test/http.test.ts`         |    50 | in-memory                | module wiring, metadata endpoint, DTO key whitelist, ORM-vocabulary leak checks, CRUD, query parsing and coercion, validation, error mapping, envelope consistency, security boundaries |
| `nestjs/test/e2e.test.ts`          |    12 | **real Prisma + SQLite** | metadata from a real schema, full CRUD round-trip, constraint failure as a safe 500, pagination/sorting/filtering/search, client-internals inaccessible                                 |
| `prisma/test/*` (3 files)          |    71 | real Prisma + SQLite     | unchanged from Phase 2                                                                                                                                                                  |
| `prisma/test/version-gate.test.ts` |     7 | real client              | version reading, unsupported major, fail-open, majors-only comparison                                                                                                                   |
| `tests/boundaries.test.ts`         |     6 | —                        | import boundaries                                                                                                                                                                       |

### The in-memory adapter is the point, not a shortcut

Most HTTP tests run against `InMemoryAdapter` — a second, independent
implementation of Core's `OrmAdapter`, not a Prisma mock. This proves something
the Prisma adapter cannot: **the HTTP layer works against any conforming
adapter**. If an ORM assumption ever leaks into a controller or the parser,
these tests break. That is the property that makes a future TypeORM or Drizzle
adapter a backend-only change, and until now it was only asserted in prose.

The `e2e.test.ts` suite then proves the whole stack is genuinely wired together:
real Nest DI, real routing, real adapter, real database, over real HTTP via
supertest. Nothing is mocked in either suite.

### Boundary tests were verified to actually fail

A test that cannot fail is false comfort. A `@prisma/client` import was
temporarily added to `packages/nestjs/src/admin/service.ts`; the suite failed
and named the offending file and specifier. The import was then removed and the
suite passed again.

The check parses import/export/dynamic-import specifiers rather than grepping,
so a comment mentioning a package no longer counts as a violation — the previous
manual grep could not tell the difference.

---

## 13. Files Changed

### Added

| File                                           | Purpose                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/nestjs/src/module.ts`                | `AdminModule.forRoot`                                                      |
| `packages/nestjs/src/tokens.ts`                | `ADMIN_ADAPTER` symbol                                                     |
| `packages/nestjs/src/admin/controller.ts`      | the single generic controller                                              |
| `packages/nestjs/src/admin/service.ts`         | coordination                                                               |
| `packages/nestjs/src/admin/metadata.dto.ts`    | public metadata shape + mapper                                             |
| `packages/nestjs/src/http/query-parser.ts`     | HTTP strings → `ListQuery`                                                 |
| `packages/nestjs/src/http/response.ts`         | envelope                                                                   |
| `packages/nestjs/src/http/exception.filter.ts` | Core errors → HTTP                                                         |
| `packages/nestjs/vitest.config.ts`             | source aliases, serial e2e                                                 |
| `packages/nestjs/test/*`                       | app bootstrap, in-memory adapter, HTTP + e2e suites, fixture, global setup |
| `packages/prisma/src/client/version-gate.ts`   | Prisma version gate                                                        |
| `packages/prisma/test/version-gate.test.ts`    | its tests                                                                  |
| `tests/boundaries.test.ts`                     | import-boundary assertions                                                 |
| `reports/004-http-api.md`                      | this report                                                                |

### Modified

`packages/nestjs/{package.json,tsconfig.json,tsup.config.ts,src/index.ts,README.md}`,
`packages/prisma/{src/adapter.ts,src/index.ts}` (version gate call and export),
`vitest.config.ts` (architecture project), `pnpm-workspace.yaml`
(`@nestjs/testing` catalog entry), `docs/{README,architecture,status,publishing}.md`.

No Core source changed in this phase.

---

## 14. Dependencies

All additions are **devDependencies of `packages/nestjs`**, used only by tests.
No runtime dependency was added anywhere.

| Package                                    | Why                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `@nestjs/testing`                          | The brief requires NestJS testing utilities. Added to the workspace catalog alongside the other `@nestjs/*` pins. |
| `@nestjs/platform-express`                 | An HTTP platform is needed to boot a real server in tests.                                                        |
| `supertest`, `@types/supertest`            | Drives real HTTP requests against the booted app.                                                                 |
| `prisma`, `@prisma/adapter-better-sqlite3` | Generate the e2e fixture client and database. Same approach as Phase 2: SQLite, no external service, no Docker.   |

`@nestjs/common` and `@nestjs/core` were already peer dependencies and remain
so. Core still has zero dependencies.

---

## 15. Design Decisions

1. **Colon query syntax over brackets** — platform-independent, and consistent
   between `sort` and `filter`. §6.
2. **Coercion at the HTTP boundary, driven by metadata** — the adapter stays
   typed and never learns about HTTP. §6.
3. **Field-name validation left to the adapter** — one rule, one place, same
   400 either way. §6.
4. **A separate metadata DTO with a whitelisting mapper** — decouples the wire
   format from an experimental internal contract. §7.
5. **`data` + `meta` rather than a serialised `Page`** — avoids `data.data`. §4.
6. **`@UseFilters`, never `APP_FILTER`** — a library must not take over the host
   application's error handling. §9.
7. **An allowlist for error messages** — new internal error types cannot start
   leaking by default. §9.
8. **A `Symbol` DI token** — cannot collide with host tokens. §10.
9. **Fixed `/admin` prefix** — a configurable server path is useless while the
   UI's base path is also fixed; both should move together. §5.
10. **Version gate fails open** — a version check that becomes the outage is
    worse than no version check. §16.

---

## 16. Problems Encountered, and What Was Done

### The published `.d.ts` does not resolve — found, not fixed

The brief required inspecting the generated declarations. Doing so surfaced a
real defect that predates this phase:

```text
dist/index.js , dist/index.cjs   0 references to @nest-admin/*   ✔ bundled
dist/index.d.ts                  import { OrmAdapter } from '@nest-admin/core'   ✘
```

`noExternal` bundles the JS correctly, but tsup's declaration build resolves
types separately, so the emitted `.d.ts` still imports from `@nest-admin/core` —
a `private: true` package that is never published. A consumer would install
types that cannot resolve.

Two fixes were attempted and both failed: `dts: { resolve: ['@nest-admin/core'] }`
had no effect, and `dts: { resolve: true }` failed the build with
`TypeScript experimental decorators cannot be used in expression position`.
The config was reverted to the known-good `dts: true` and the issue documented
in `docs/publishing.md`, in the tsup config itself, and here. Nothing is
published yet, so this blocks no one today — but it blocks the first publish.
Untried options: a separate `tsc`-based declaration build, or API Extractor.

### The version gate needed a version that Prisma does not publish

Phase 2 flagged version coupling as load-bearing with no mitigation. The
consumer's Prisma version turned out to be readable from the client instance
itself as `client._clientVersion` (verified: `"7.10.0"`), which avoids resolving
the consumer's `node_modules` from library code.

It is an underscore-prefixed internal, so the gate **fails open**: if the field
is missing or unparseable it does nothing. A version check that itself breaks
every consumer on an otherwise-fine upgrade is worse than no check. It compares
**majors only**, because majors changed the schema language and minors have not.

It lives in `packages/prisma`, never Core.

### Route collision between `/admin/meta` and `/admin/:model`

Resolved by declaration order, with the narrow shadowing case documented rather
than papered over. §5.

### An `APP_FILTER` would have hijacked the host application

Caught during design. Using `@UseFilters` on the controller scopes the filter to
admin routes. §9.

---

## 17. Known Limitations

1. **No authentication or authorization.** Every route is open. §11.
2. **The published `.d.ts` does not resolve.** §16.
3. **Base path fixed at `/admin`.** `NestAdminConfig.path` is not honoured. §5.
4. **No `forRootAsync`.** An adapter built from injected providers cannot be
   supplied. §10.
5. **A model literally named `meta`** is shadowed by the metadata route.
6. **`in` filter values cannot contain commas**, and no filter field name can
   contain a colon.
7. **No `OR` between filters** — multiple filters are always `AND`. Core's
   `FilterRule[]` has no place to express it, by design.
8. **No request body validation beyond the adapter's field check.** Types are
   not checked before reaching the ORM; a string in a number column produces a
   500 rather than a 400.
9. **Everything Phase 2 listed still applies** — composite keys, nested relation
   writes, relation filtering, SQLite-only testing.
10. **The example project still does not wire the admin in.** `AdminModule`
    exists, but there is no UI to show, so wiring it was left for the phase that
    has one.

---

## 18. Deferred Work

Investigated or considered this phase, deliberately not built:

- `forRootAsync`, and a configurable base path (both need a consumer to shape
  them against).
- Fixing the declaration build for publishing.
- Body type validation at the HTTP edge.
- `OR` filter groups, cursor pagination, bulk endpoints.
- Honouring `NestAdminConfig.resources` include/exclude — Core declares it, and
  nothing reads it yet.
- Serving the SPA under `/admin`.

---

## 19. Recommended Phase 4

**Authentication and route protection**, before the admin UI.

The API currently exposes every record in the database to anyone who can reach
it. The UI phase will make that reachable from a browser, so the ordering
matters: shipping the UI first would mean shipping an unauthenticated admin
panel, and retrofitting auth afterwards means revisiting every route, the
metadata endpoint and the error contract.

Suggested scope, kept as narrow as this phase was:

1. A pluggable authentication contract in the NestJS layer — a guard the
   consuming application supplies, not a login system the framework owns.
   Applications already have identity; the framework should not invent a second
   one.
2. Apply it to every admin route including `/admin/meta`, which currently leaks
   the entire schema shape.
3. Two new Core error types (`UnauthorizedError`, `ForbiddenError`) mapping to
   401 and 403 through the existing filter — the mapping table is already the
   right place.
4. Decide, but do not build, where resource-level permissions will live. The
   metadata endpoint is the natural filter point, since a frontend renders from
   it.

Alternative if auth is judged premature: fix the declaration build and wire
`examples/basic` end to end, which would exercise the package as a consumer
actually installs it. That is smaller and lower risk, but leaves the security
gap open longer.

Explicitly not recommended next: the admin UI, a second ORM adapter, or the CLI.

---

## 20. Verification

Run from a clean working tree at the end of the phase:

```text
pnpm build         PASS (exit 0)
pnpm typecheck     PASS (exit 0)  - 7 projects, tests included
pnpm test          PASS (exit 0)  - 146 tests, 7 files
pnpm format:check  PASS (exit 0)
```

```text
 Test Files  7 passed (7)
      Tests  146 passed (146)
```

Boundary assertions (`tests/boundaries.test.ts`), all passing:

```text
packages/core imports no Prisma package
packages/core imports no NestJS package
packages/core declares no runtime dependencies
packages/nestjs/src imports no Prisma package
packages/nestjs/src reaches the adapter only through the published subpath
@prisma/get-dmmf is imported by exactly one module
```

Published type surface, inspected rather than assumed:

```text
declare class AdminModule
interface AdminModuleOptions
type AdminErrorCode / AdminResponse / ErrorResponse / SuccessResponse / PageMeta
type FieldKindDto / FieldDto / ModelDto / RelationDto / MetadataDto
```

No controller, service, query parser, exception filter or Prisma type appears in
the public surface. The unresolved `@nest-admin/core` type import in that same
file is the publishing blocker described in §16.
