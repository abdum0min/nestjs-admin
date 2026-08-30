# Phase 7 — Package Runtime & Consumer Integration

Status: **complete.** No new features, no second ORM adapter, no CLI, no
`forRootAsync`, no configurable base path, no validation framework.

---

## 1. Executive Summary

The package now works for someone who installs it.

Before this phase, `/admin` returned a 404 from the API controller, the UI was
built but shipped nowhere, and `examples/basic` was scaffolding. After it, a
consumer imports `AdminModule`, starts their app, opens `/admin`, and gets a
working admin over their own schema.

Delivered:

- **The UI is served by the package** at `/admin`, from a dedicated controller
  ordered ahead of the API so `assets` is never read as a model name.
- **The UI ships inside the tarball** (`dist/admin-ui`), built and copied
  deterministically.
- **`examples/basic` is a real consumer** — public package only, auth, resource
  authorization, working CRUD.
- **Bracket query syntax is rejected** with `400 INVALID_QUERY` instead of being
  silently ignored.
- **`pnpm verify:package`** builds, packs, installs the tarball _outside_ the
  workspace and exercises the whole flow. **19/19 checks pass.**

**304 tests across 13 files**, up from 288.

Two release-blocking bugs surfaced only by running a real consumer, neither
visible from `pnpm build` or `pnpm test` — §8.

---

## 2. Starting State

Six commits; working tree clean; 288 tests. Phase 6 had fixed the declaration
surface and built a metadata-driven UI, but left four things open, all of which
this phase closes:

| Phase 6 finding                              | Now                                                |
| -------------------------------------------- | -------------------------------------------------- |
| SPA not served by the package                | Served at `/admin`                                 |
| Static assets would be swallowed by `:model` | Controller ordering, tested                        |
| Stale `/admin/api` dev proxy                 | Already realigned in Phase 6 — verified, unchanged |
| `examples/basic` not a real consumer         | Wired end to end                                   |
| Bracket syntax silently ignored              | `400 INVALID_QUERY`                                |

The dev proxy is worth a word since the brief asked for it: Phase 6 had already
replaced `/admin/api` with a `/__admin-api` prefix rewritten onto `/admin`. I
re-read it and left it alone. Proxying `/admin` itself is not an option — the
dev server needs that path for the app's own HTML and assets.

---

## 3. Runtime Architecture

```text
Browser
  │  GET /admin                      → AdminUiController  (no guard)
  │  GET /admin/assets/index-*.js    → AdminUiController  (no guard)
  │
  │  GET /admin/meta                 → AdminController    (guarded)
  │  GET /admin/:model[/:id]         → AdminController    (guarded)
  │  POST/PATCH/DELETE               → AdminController    (guarded)
  ▼
AdminService → resource authorization → OrmAdapter → PrismaAdapter → database
```

Nothing about Core, the adapter contract or the HTTP layer changed. The only
structural addition is one controller and the module ordering that makes it
safe.

---

## 4. Static Serving Design

### The collision, and how it is resolved

`@Get(':model')` matches `assets`. `@Get(':model/:id')` matches
`assets/index-B-eGmkuM.js`. Serving the UI naively would have made the browser
receive `{"success":false,"error":{"code":"MODEL_NOT_FOUND"}}` for its own
JavaScript.

The fix is **controller ordering**, not a second prefix and not a wildcard:

```ts
controllers: [AdminUiController, AdminController]
```

`AdminUiController` binds exactly two paths — `/admin` and
`/admin/assets/:file`. Nest matches it first, so those two win; every other path
under `/admin` falls through to the API. There is no catch-all anywhere, so
nothing outside `/admin` is touched.

I considered and rejected two alternatives:

| Alternative                                  | Why not                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `express.static` middleware with fallthrough | Correct behaviour, but pulls Express into a package whose peers are only `@nestjs/common` and `@nestjs/core`, breaking Fastify consumers. |
| `@nestjs/serve-static`                       | A new runtime dependency and its own peer matrix, to do something two routes already do.                                                  |

Responses use `StreamableFile`, which Nest renders on both Express and Fastify,
so no `@Res()` and no platform coupling. Content types come from a small table
covering what a Vite build emits.

### Hash routing stays

The brief said not to replace it without proving a server fallback is correct.
It should stay, and the reason is stronger than inertia: a browser-history
fallback would have to match `/admin/*`, which is precisely the space the API
occupies. It would shadow every model route, or need an exception list that grows
with the API. Hash routing (`/admin#/User/u1`) means every deep link is still a
request for `/admin`, and **no fallback route is needed at all** — which is what
kept static serving to two routes.

### Path traversal

The route binds a single path segment, so a nested path cannot be requested. The
reader adds two more guards: the name must match `^[\w.-]+$`, and the resolved
path must still sit inside the assets directory. Tested with encoded separators
and `..` sequences.

One case returns 200 and is _not_ an escape: `/admin/assets/..` is normalised by
the HTTP layer to `/admin` before routing, so the public shell answers. There is
a test pinning that, because a future reader seeing a 200 there deserves to know
why.

---

## 5. Build Pipeline

```text
apps/admin-ui  ──vite build──▶  apps/admin-ui/dist
                                      │  copy-admin-ui.mjs
                                      ▼
                        packages/nestjs/dist/admin-ui
                                      │  files: ["dist"]
                                      ▼
                          published tarball (372 KB)
```

Ordering is guaranteed by making `@nest-admin/admin-ui` a **devDependency** of
`packages/nestjs`. Nothing imports it; it exists so pnpm's topological build
runs the UI first. Same reasoning as `@nest-admin/core` and
`@nest-admin/prisma`: build inputs, not runtime dependencies.

The copy script **fails the build** if the UI is missing, rather than warning. A
published package without its interface would 404 for every consumer, and the
build is the only place to catch that.

At runtime the bundle locates the UI relative to itself via `import.meta.url`,
with tsup `shims: true` rewriting it for the CJS output. Resolving from the
bundle rather than `process.cwd()` matters — a consumer starts from their own
directory.

A missing UI at runtime is a warning at startup and a 404 with an explanation,
not a crash: the API is perfectly usable without it, and a source checkout that
has not run the UI build lands there legitimately.

---

## 6. Consumer Example

`examples/basic` now configures what an application configures:

```ts
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })

AdminModule.forRoot({
  adapter: new PrismaAdapter({ client: prisma }),
  auth: adminAuth, // reads x-admin-token
  resourceAuth: {/* Product is read-only */},
})
```

It imports `@nest-admin/nest-admin` and `@nest-admin/nest-admin/prisma` only —
never `@nest-admin/core` or `@nest-admin/prisma` — so it exercises the public
surface a consumer actually has.

Verified by running it: `/admin` serves the UI, `/admin/meta` reports `User` and
`Product`, full CRUD works on `User`, `POST /admin/Product` is `403` by policy,
and bracket syntax is `400`.

The auth implementation is deliberately crude — a header comparison. Its purpose
is to show where a host's identity system attaches, not to be one.

---

## 7. Publishing Verification

`pnpm verify:package` does what a workspace test cannot:

```text
build → pack → install the tarball in a temp dir outside the workspace
      → boot a real NestJS app against a schema the package has never seen
      → GET /admin → GET /admin/meta → list/create/read/update/delete
```

Result: **19/19 checks passed.**

```text
PASS  GET /admin returns the SPA                   200
PASS    as HTML                                    true
PASS    shell references a bundled asset           true
PASS  GET the referenced asset                     200
PASS    UI bundled in the package                  true
PASS  GET /admin/meta                              true
PASS    discovers the consumer schema              Widget
PASS  GET /admin/Widget (list)                     200
PASS  POST /admin/Widget (create)                  true
PASS  GET /admin/Widget/:id (read)                 200
PASS  PATCH /admin/Widget/:id (update)             200
PASS    search                                     200
PASS    sort                                       200
PASS    filter                                     200
PASS    paginate                                   200
PASS    bracket syntax rejected                    400
PASS  DELETE /admin/Widget/:id                     200
PASS    record is gone                             404
PASS  no private workspace package required        false
```

The consumer's schema is `Widget` — a model that appears nowhere in this
repository — which is the point: nothing is hard-coded.

It is **not** part of `pnpm test`; it runs a real `npm install` of NestJS and
Prisma, takes about a minute, and needs the network.

### Artefact inspection

| Artefact                           | `@nest-admin/*` | Notes                                         |
| ---------------------------------- | --------------: | --------------------------------------------- |
| `dist/index.js`, `index.cjs`       |               0 |                                               |
| `dist/index.d.ts`, `index.d.cts`   |               0 | Core types inlined                            |
| `dist/prisma.js`, `prisma.cjs`     |               0 | `@prisma/client`, `@prisma/get-dmmf` external |
| `dist/prisma.d.ts`, `prisma.d.cts` |               0 |                                               |

Published manifest: `dependencies` is `{ "@prisma/get-dmmf": "7.10.0" }` — a
public npm package. Peers unchanged. No private workspace package is required at
runtime or by the declarations.

---

## 8. Problems Encountered

Both were release blockers, and both passed every workspace check.

### The wasm that was bundled

The example started and immediately died:

```text
Error: ENOENT ... packages/nestjs/dist/prisma_schema_build_bg.wasm
```

`@prisma/get-dmmf` loads a wasm file through a `require()` resolved relative to
its own package. tsup had inlined the package, so the `require` looked next to
_our_ bundle and found nothing. The build was green, the declarations were clean,
the types resolved — and the package was unusable.

Phase 3 predicted exactly this ("`@prisma/get-dmmf` ships wasm; keep it
external") and Phase 6 never hit it because nothing ran the package. It is now
`external` and a declared `dependencies` entry.

### Types that resolved only under modern module resolution

`examples/basic` failed to typecheck:

```text
Cannot find module '@nest-admin/nest-admin/prisma' or its corresponding type
declarations. There are types at '.../dist/prisma.d.ts', but this result could
not be resolved under your current 'moduleResolution' setting.
```

The Nest CLI still ships `"moduleResolution": "node"`, which ignores `exports`.
Node resolves the subpath at runtime regardless, so the import _works_ while its
types do not — a red squiggle on correct code, which is a miserable first
impression. Fixed with a `typesVersions` entry rather than by telling consumers
to change their tsconfig.

### The bracket fix did not work the way I expected

My first attempt rejected _structured_ values, on the assumption that Express
parses `filter[age][gte]=18` into a nested object. Measured instead of assumed —
and on Express 5 under Nest 12, which uses the **simple** query parser, it
arrives as a literal key:

```json
{ "filter[age][gte]": "18", "sort": "a:asc" }
```

So nothing lands on `filter` and the structured guard never fires. The working
fix is an **allowlist of known parameters**. Both guards are kept, because which
shape arrives depends on the platform's parser — that is what keeps the
behaviour identical on either, which the brief required.

### A test that skipped instead of running

The static-serving tests initially skipped: they run from `src`, so the module
looked for `src/ui/admin-ui` and found nothing. A skipped security test is
worthless. The UI root is now injected through an internal token, so the tests
point at the real built artefact and actually run.

---

## 9. Query Parser Fix

Rejected, both with `400 INVALID_QUERY`:

| Input                  | Before              | After                    |
| ---------------------- | ------------------- | ------------------------ |
| `?filter[age][gte]=18` | 200, filter dropped | 400, naming colon syntax |
| `?sortBy=email`        | 200, ignored        | 400                      |
| `?filter=age:gte:18`   | 200                 | 200 (unchanged)          |

The public syntax did not change. The guarantee added is narrow and worth
stating plainly: **a 200 now means every rule in the query was applied.** Before,
a caller could believe it had filtered and receive the whole table.

The strictness extends past brackets to any unrecognised parameter, because an
unknown parameter is always a bug — a typo, a stale client, a half-migrated
integration — and ignoring it is what let this go unnoticed. That is a
behavioural tightening for third-party callers and is listed as such in §12.

The UI is unaffected: it only ever emits the five known parameters, and its own
tests assert no bracket syntax is generated.

---

## 10. Security Considerations

### `GET /admin` is unauthenticated, deliberately

The shell and its bundle contain no records, no schema and no configuration. The
bundle is byte-identical for every visitor and learns what exists only by calling
`/admin/meta`, which is guarded.

Guarding the shell too would render a JSON 401 in a browser instead of a page
that can explain itself, and would prevent a host putting its own login redirect
in front of the admin. Serving it publicly is the ordinary SPA arrangement.

**The UI is not a way around the API.** Tested: with a denying `AdminAuth`, the
shell returns 200 while `/admin/meta`, `/admin/:model` and `/admin/:model/:id`
all return 401. Every route that can return data stays behind the guard.

If a host disagrees, it can put its own middleware in front of `/admin` — which
is exactly the flexibility guarding the shell would have removed.

### Unchanged

Authentication and resource authorization are untouched. Metadata filtering,
error mapping and the message allowlist all behave as before, and their tests
still pass. Adding two static routes did not weaken any of it — the guard is
still on `AdminController`, and the new controller cannot reach the adapter.

---

## 11. Tests

**304 passing across 13 files**, up from 288.

| Suite                               |  Tests | Change                           |
| ----------------------------------- | -----: | -------------------------------- |
| `nestjs/test/static-ui.test.ts`     | **14** | new                              |
| `nestjs/test/e2e.test.ts`           |     26 | +3 query-parser cases, 1 removed |
| `nestjs/test/auth.test.ts`          |     36 | unchanged                        |
| `nestjs/test/http.test.ts`          |     50 | unchanged                        |
| `nestjs/test/resource-auth.test.ts` |     44 | unchanged                        |
| `prisma/test/*`                     |     78 | unchanged                        |
| `admin-ui/test/*`                   |     50 | unchanged                        |
| `tests/boundaries.test.ts`          |      6 | unchanged                        |

New coverage:

- **Route collision** — `/admin/meta`, `/admin/:model`, `/admin/:model/:id` all
  still reach the API; `assets` is never read as a model name; nothing outside
  `/admin` is touched.
- **Static serving** — shell at `/admin` with the right type and `no-cache`; the
  referenced JS and CSS served with correct types and immutable caching; the UI
  physically present in the package.
- **Traversal** — encoded separators and `..` sequences refused; the normalised
  `..` case pinned with its explanation.
- **Auth boundary** — shell public while every data route is 401.
- **Query parser** — bracket syntax 400, unknown parameter 400, and an assertion
  that an accepted filter is never dropped.

Plus the 19-check packed-consumer run in §7, which is the only thing that would
have caught either bug in §8.

---

## 12. Known Limitations

1. **Unknown query parameters are now rejected.** A third-party caller appending
   a cache-buster or tracking parameter will get a 400 where it previously got a 200. Deliberate — see §9 — but it is a behaviour change for non-UI callers.
2. **Base path is still `/admin`.** See §14.
3. **Invalid primitive types still produce a 500**, not a 400. Confirmed
   unchanged in the consumer flow: posting a string into a `Float` column
   surfaces as an adapter error. Not a release blocker — the UI sends typed
   values — and expanding validation was explicitly out of scope.
4. **The UI shell is public.** A host wanting it behind a login must add its own
   middleware (§10).
5. **Fastify is untested.** `StreamableFile` is platform-agnostic and nothing
   here imports Express, but only `@nestjs/platform-express` is exercised.
6. **`pnpm verify:package` is not in CI** and needs the network.
7. **Everything Phases 2–6 listed still applies** — composite keys, nested
   relation writes, relation filtering, field/row-level permissions, `OR`
   filters, cursor pagination, SQLite-only coverage.

---

## 13. Deferred, and Why

**`forRootAsync` — still deferred.** The brief said to implement it only if
consumer integration exposed a concrete need. It did not: `examples/basic` and
the packed consumer both construct the client and adapter at module scope, which
is what the Prisma 7 driver-adapter model encourages anyway. Building it now
would fix its shape before a real consumer has pushed on it.

**Configurable base path — still deferred.** The architecture _now_ has enough
information: the UI and server could move together. But it is not free. Vite's
`base` is a build-time constant, so a configurable server path needs the client
to learn its own base at runtime — a `<base href>` injected into the shell, or a
runtime config endpoint — plus asset URL rewriting. That is a phase, not a flag,
and nothing yet needs it. `/admin` stays.

**Body type validation — still deferred.** §12 item 3.

Also carried forward: the `bin` entry and a `prepublishOnly` guard from
`docs/publishing.md`, field/row-level permissions, and browser E2E.

---

## 14. Files Changed

### Added

| File                                        | Purpose                               |
| ------------------------------------------- | ------------------------------------- |
| `packages/nestjs/src/ui/assets.ts`          | locating, reading and typing UI files |
| `packages/nestjs/src/ui/controller.ts`      | the two static routes                 |
| `packages/nestjs/scripts/copy-admin-ui.mjs` | build-time copy into `dist`           |
| `packages/nestjs/test/static-ui.test.ts`    | 14 tests                              |
| `scripts/verify-packed-consumer.mjs`        | packed-package verification           |
| `reports/008-package-runtime.md`            | this report                           |

### Modified

| File                                                                    | Change                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/nestjs/src/module.ts`                                         | UI controller ordering, `uiRoot` option, startup warning                       |
| `packages/nestjs/src/tokens.ts`                                         | `ADMIN_UI_ROOT`                                                                |
| `packages/nestjs/src/http/query-parser.ts`                              | unknown-parameter and structured-value rejection                               |
| `packages/nestjs/package.json`                                          | build script, `typesVersions`, `@prisma/get-dmmf` dependency, UI devDependency |
| `packages/nestjs/tsup.config.ts`                                        | `shims`, `@prisma/get-dmmf` external                                           |
| `packages/nestjs/test/{app,e2e}.ts`                                     | UI root wiring, rewritten bracket tests                                        |
| `examples/basic/src/app.module.ts`                                      | a real consumer                                                                |
| `examples/basic/{README.md,.env.example}`                               | how to run it                                                                  |
| `package.json`                                                          | `verify:package` script                                                        |
| `docs/{publishing,status,architecture}.md`, `packages/nestjs/README.md` | documentation                                                                  |

`packages/core` was not modified. `apps/admin-ui` source was not modified.

---

## 15. Recommended Next Phase

**A release: version, changelog, `prepublishOnly` guard, and CI.**

The package now installs and runs. What stands between it and a first publish is
process, not architecture: it still carries a placeholder name and `0.0.0`, has
no changelog, no publish guard, and `pnpm verify:package` runs only when someone
remembers. That last one matters most — two release blockers this phase were
invisible to every other check.

Smaller items worth folding in: the `bin` entry once a CLI exists, and running
the packed verification in CI.

If a feature phase is preferred instead, **field-level permissions** is the
strongest candidate — the UI now shows every column of every visible model, so
"this model but not that column" is the next real constraint. It should be
designed against the UI that now exists rather than in the abstract.

---

## 16. Verification Results

```text
pnpm build          PASS (exit 0)
pnpm typecheck      PASS (exit 0)  - 8 projects, tests included
pnpm test           PASS (exit 0)  - 304 tests, 13 files
pnpm format:check   PASS (exit 0)
pnpm verify:package PASS           - 19/19 checks
```

```text
 Test Files  13 passed (13)
      Tests  304 passed (304)
```

UI-specific:

```text
pnpm --filter @nest-admin/admin-ui build      PASS
pnpm --filter @nest-admin/admin-ui typecheck  PASS
pnpm --filter @nest-admin/admin-ui test       PASS (50)
```

Consumer (`examples/basic`, run manually):

```text
GET /admin                    200 text/html
GET /admin/assets/index-*.js  200 text/javascript
GET /admin/meta               200  → User, Product
CRUD on User                  201 / 200 / 200 / 200
POST /admin/Product           403  (read-only by policy)
?filter[age][gte]=18          400  INVALID_QUERY
```

Boundary assertions unchanged and passing:

```text
packages/core imports no Prisma package
packages/core imports no NestJS package
packages/core declares no runtime dependencies
packages/nestjs/src imports no Prisma package
packages/nestjs/src reaches the adapter only through the published subpath
@prisma/get-dmmf is imported by exactly one module
```
