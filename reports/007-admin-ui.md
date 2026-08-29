# Phase 6 — Publishing Readiness + Metadata-Driven Admin UI

Status: **complete.** No CLI, no second ORM adapter, no field-level permissions,
no SPA server integration, no authentication.

---

## 1. Summary

Two things, both of which the previous phases had deferred.

**Part A — the published declarations now resolve.** The `.d.ts` emitted for the
public package used to import from `@nest-admin/core`, a `private: true` package
that is never published. Fixed, and verified from a clean build. A second
publishing bug fell out with it: the manifest declared `workspace:*`
dependencies on those same unpublished packages.

**Part B — a real admin UI.** Every screen is generic. There is no `UserPage`,
no `PostTable`, and no schema constant anywhere in the app: navigation, columns,
sort options, filter operators and form inputs are all derived from
`GET /admin/meta`. A model added to the Prisma schema appears without a code
change; a model hidden by Phase 5's resource authorization disappears without
one, because it is simply absent from the document.

**288 tests across 12 files**, up from 229.

Two findings worth carrying forward, both in §7.

---

## 2. Publishing Fix

### Root cause

The symptom was known since Phase 3; the cause was not. tsup **automatically
externalises everything listed in `dependencies` and `peerDependencies`**.
`noExternal` overrides that for the JS bundle — which is why `index.js` was
always clean — but the declaration build computes its own externals and left the
imports in place.

This also explains why Phase 3's attempts failed. `dts: { resolve: [...] }`
appeared to "have no effect" because the packages were being externalised
_before_ `resolve` was consulted, and `dts: { resolve: true }` failed the build
on decorator syntax.

### Solution — two changes, neither sufficient alone

1. **`@nest-admin/core` and `@nest-admin/prisma` moved from `dependencies` to
   `devDependencies`.** They are bundled at build time, so they are build
   inputs, not runtime dependencies. This is what they should have been from
   Phase 0, and it is what stops tsup externalising them.
2. **`dts: { resolve: [/^@nest-admin\//] }`** in the tsup config, telling the
   declaration build to follow them rather than leave the imports standing.

I verified this ordering rather than assuming it: applying only (1) on a clean
build still emitted the imports, and applying only (2) — Phase 3's attempt — did
nothing. Both are required, and the config says so.

No build system was replaced, no separate `tsc` declaration pass was added, no
runtime dependency was introduced, and Core was not published.

### Verification, from `rm -rf dist && pnpm build`

| Artefact                      | `@nest-admin/*` |                                      `@prisma/*` |
| ----------------------------- | --------------: | -----------------------------------------------: |
| `index.js`, `index.cjs`       |               0 |                                                0 |
| `index.d.ts`, `index.d.cts`   |           **0** |                                                0 |
| `prisma.js`, `prisma.cjs`     |               0 | 7 — `@prisma/client`, the declared optional peer |
| `prisma.d.ts`, `prisma.d.cts` |           **0** |                            0 (doc comments only) |

`OrmAdapter`, `ModelMetadata`, `ListQuery` and the rest of the Core surface are
now inlined into the declarations. The only external type import remaining
anywhere is `@nestjs/common`, a declared peer.

The public surface is unchanged in shape and still small — no controller,
service, guard, parser or token leaked.

### The second bug

`packages/nestjs/package.json` previously carried:

```json
"dependencies": { "@nest-admin/core": "workspace:*", "@nest-admin/prisma": "workspace:*" }
```

A published tarball would have declared a dependency on two packages that do not
exist on npm, so `npm install` would have failed regardless of the types. There
is now **no `dependencies` field at all** — only peers, which is correct for a
package that bundles everything it owns.

---

## 3. UI Architecture

```text
GET /admin/meta
      │  models, fields, kinds, enums, relations, primary keys
      ▼
src/metadata/     what a field means: editable? sortable? which operators?
      ▼
src/components/   shell · list · record · form   (one set, every model)
      ▲
src/api/          the only place fetch, the envelope and error codes exist
```

### Metadata drives rendering

Nothing in `src/` branches on a model or field _name_. Every decision reads the
descriptor the server sent:

| Decision                  | Derived from                                                |
| ------------------------- | ----------------------------------------------------------- |
| Which resources exist     | `metadata.models`                                           |
| Table columns             | non-relation, non-list fields; primary key first            |
| Which fields are editable | `!isGenerated && kind !== 'relation' && !isList`            |
| Which input to render     | `kind` → text / number / checkbox / select / datetime-local |
| Select options            | `enumValues`                                                |
| Create pre-fill           | `defaultValue`                                              |
| Sortable fields           | everything the server will sort — not relations or lists    |
| Filter operators          | narrowed per `kind` to what the server accepts              |
| Record links              | `primaryKey`                                                |

The narrowing matters: offering `contains` on a number would build a query the
server rejects with `INVALID_QUERY`, and the user could do nothing about it. The
UI is not allowed to compose a request it knows will fail.

### API client

`src/api/` holds every HTTP concern — base URL, credentials, envelope
unwrapping, error translation. Components call typed functions and never see
`fetch`, a status code or an envelope. `AdminApiError` carries the server's
`code`, and screens branch on that, never on message text.

`src/api/types.ts` restates the wire shapes **by hand**. Nothing in the UI
imports `@nest-admin/core`, `@nest-admin/prisma` or any ORM type, so the
dependency runs `UI → HTTP → NestJS → Core`, never `UI → Core`. That is what
keeps the app working against a server that swapped its adapter.

### State management

None added. The repository has no state library and this app's server state is a
handful of independent reads with no cross-screen sharing — a cache layer would
be more machinery than the problem has. A ~40-line `useAsync` hook covers
loading/data/error and discards superseded responses so a slow first request
cannot overwrite a fast second one when a search term is retyped.

### Routing

Hash-based: `#/User`, `#/User/u1`, `#/User/new`, `#/User/u1/edit`.

Deliberate, and a finding in its own right — see §7.

---

## 4. Implemented UI

| Area           | Behaviour                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| **Shell**      | Fixed sidebar of resources, content pane. Plain CSS, no component library, no animation.                     |
| **Navigation** | One entry per `metadata.models` entry. Active item marked with `aria-current`.                               |
| **List**       | Metadata-derived columns (capped at six), formatted cells, row link to the record.                           |
| **Search**     | `?search=` against the current model, debounced 300 ms.                                                      |
| **Sort**       | Single rule, `?sort=field:asc`. Options built from sortable fields.                                          |
| **Filter**     | Single rule, `?filter=field:op:value`. Field, operator and — for enums — value are all chosen from metadata. |
| **Pagination** | `page`/`perPage`, driven by `meta.total`; Previous/Next disabled at the ends.                                |
| **Create**     | `POST`. Inputs for editable fields only; literal defaults pre-filled.                                        |
| **Read**       | Every field in schema order, with kind, generated and relation target shown.                                 |
| **Update**     | `PATCH`. Same field rules; generated fields never editable.                                                  |
| **Delete**     | `DELETE` behind a confirmation. No bulk delete.                                                              |
| **Loading**    | Every API-driven screen.                                                                                     |
| **Empty**      | Distinct copy for "no resources" and "no records".                                                           |
| **Errors**     | Per-code headings and hints; retry only where retrying can help.                                             |

### Value rendering

Generic tables meet values the developer never anticipated. `null` renders as
`—`, booleans as Yes/No, dates through `toLocaleString`, arrays as a count,
objects as `{…}` in a cell and pretty-printed JSON in the detail view. A test
asserts `[object Object]` never appears.

### Deliberate omissions

- **One filter at a time.** The server combines filters with `AND` only; a
  multi-row builder would imply expressiveness the contract does not have.
- **Relations are read-only.** The API rejects relation writes with
  `FIELD_NOT_FOUND`, so the form does not offer them and the detail view shows a
  summary rather than a link — a link would promise navigation the list endpoint
  cannot serve (there is no relation filter).

Both are contract limits. Neither was worked around by changing the backend.

---

## 5. Tests

**288 passing across 12 files**, up from 229.

### New — UI (50, 3 files)

| File                  | Tests | Covers                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/query.test.ts`  |    13 | pagination, search, encoding, repeated `sort`, `filter` triples, `in` lists, colons inside values, blank-filter suppression, and an explicit assertion that **no bracket syntax is ever emitted**                                                                                                                                        |
| `test/client.test.ts` |    18 | envelope unwrapping, URL/verb/body per operation, model-name encoding, `credentials: 'include'` with no `Authorization` header, all seven error codes, non-envelope responses, network failure                                                                                                                                           |
| `test/app.test.tsx`   |    19 | loading state; nav built from metadata; hidden model absent; empty-metadata state; 401/403/500 states and retry policy; columns from metadata; records; boolean/enum/null rendering; empty list; request shape; sort options; filter fields excluding relations; unknown model; detail view; create form field selection and input types |

Component tests use jsdom + Testing Library, driven through the real `App` with
only `fetch` mocked.

### New — backend contract (10, in the existing e2e file)

The UI is tested against mocks, so a drift between its query builder and the
server would not surface. `packages/nestjs/test/e2e.test.ts` now replays the
**exact strings the UI generates** against the real Nest app and Prisma/SQLite:

```text
?page=1&perPage=25
?page=1&perPage=25&search=ada
?page=1&perPage=25&sort=email:asc
?sort=email:asc&sort=createdAt:desc
?filter=age:gte:18
?filter=role:in:ADMIN,USER
?page=1&perPage=25&search=ada&sort=email:asc&filter=age:gte:18
```

All accepted. Plus: metadata carries exactly the keys the UI reads, and the
bracket-syntax behaviour recorded in §7.

### Unchanged

`packages/prisma` 78, `tests/boundaries.test.ts` 6, and the rest of the NestJS
suites — all still passing, none weakened.

### New dependencies for testing

`jsdom`, `@testing-library/react`, `@testing-library/dom` — devDependencies of
`apps/admin-ui` only. Vitest was already the repository's runner; these are the
minimal standard way to render React under it. `@testing-library/jest-dom` was
**not** added: two assertions initially used `toHaveTextContent`, and rather
than pull in a fourth package they were rewritten against `textContent`.

---

## 6. Security

| Concern                                | Handling                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client-side auth bypass**            | Impossible — the UI holds no credential and makes no authorization decision. It sends `credentials: 'include'` and renders whatever the server answers. A 401 or 403 renders a state and is never retried.                                                                                                                        |
| **ORM knowledge**                      | None. The UI restates the wire types by hand; no import of Core, Prisma or any ORM type exists in `apps/admin-ui`.                                                                                                                                                                                                                |
| **Hidden-model leakage**               | The UI renders `metadata.models` verbatim and does no filtering of its own, so a model the server omits cannot appear. Phase 5 also strips relation fields pointing at hidden models, so a hidden name cannot arrive through `relation.targetModel` either. Asserted: with one model hidden, its name appears nowhere in the DOM. |
| **Arbitrary model names from the URL** | A hash naming a model that metadata does not contain renders "not one of the resources you can access" and **issues no request**. The UI cannot be pointed at a resource the server did not describe.                                                                                                                             |
| **Backend internals in the UI**        | Only `error.message` is shown, and the server's filter already guarantees it is generic for anything internal. No stack, path or ORM detail can reach a screen. A non-envelope response (proxy error page, HTML login redirect) is replaced with a generic message rather than rendered.                                          |
| **Existence disclosure**               | The UI cannot distinguish "does not exist" from "hidden from you", and does not try — both produce the same message.                                                                                                                                                                                                              |

---

## 7. Findings

### The API and the SPA share a path space

`GET /admin/User` is a real endpoint. So a browser route at `/admin/User` would
be answered by the record controller with JSON, and `/admin/assets/index.js`
would match `@Get(':model/:id')` as model `assets`.

Two consequences:

1. **Routing is hash-based.** `#/User/u1` cannot collide with anything the
   server routes, and needs no SPA fallback — which matters because serving the
   SPA is not implemented.
2. **Serving the SPA under `/admin` will require resolving this collision**, not
   just copying files. Static assets must be matched before `:model`, or the
   admin must move to a different prefix. Recorded for whoever does §8's first
   item; it is a real obstacle, not a wiring detail.

### Bracket filter syntax is silently ignored, not rejected

`?filter[age][gte]=18` returns **200 with the filter dropped**. Express's `qs`
parser turns it into an object, and the Phase 3 query parser accepts only
strings, so the rule disappears and the caller receives _unfiltered_ results.

Our client never emits brackets, so the admin UI is unaffected. But a
third-party API consumer would silently get more records than it asked for,
which is worse than a 400. Changing the Phase 3 parser is outside this phase's
scope, so it is recorded and asserted as observed behaviour in the e2e suite
rather than quietly left undiscovered.

### The dev proxy pointed at a path the API never served

`vite.config.ts` proxied `/admin/api` — a prefix that has not existed since
Phase 3 defined the routes. Fixed to a distinct dev-only prefix rewritten onto
`/admin`, because proxying `/admin` itself would swallow the app's own HTML and
assets.

---

## 8. Known Limitations

1. **The SPA is still not served by the backend.** It builds to
   `apps/admin-ui/dist` and is developed against the dev proxy. Wiring it needs
   the route collision above resolved first.
2. **One filter and one sort rule at a time**, matching the contract's `AND`-only
   composition.
3. **Relations are read-only** — no relation editing, no navigation by relation.
4. **Six columns** in the table; the detail view shows everything.
5. **No client cache and no optimistic updates.** Every screen refetches.
6. **No column selection, no saved views, no bulk actions.**
7. **Base path fixed at `/admin`** on both sides.
8. **No browser E2E.** The repository has no browser-automation tooling, and the
   brief said not to introduce one for this phase. The gap is covered from both
   sides instead: jsdom component tests above, and the UI's exact query strings
   replayed against the real backend below.
9. **`packages/ui` is still empty.** Components live in the app; extracting them
   is a decision better made when a second consumer exists.

---

## 9. Deferred Work

Carried forward, still unresolved:

- **From Phase 3:** configurable `/admin` base path, `forRootAsync`, body type
  validation at the HTTP edge, `OR` filter groups, cursor pagination.
- **From Phase 4:** nothing outstanding.
- **From Phase 5:** field-level and row-level permissions, configurable
  404-instead-of-403 for denied models, wiring `NestAdminConfig.resources`.
- **From Phase 2:** composite primary keys, nested relation writes, relation
  filtering, non-SQLite test coverage.
- **New in Phase 6:** serving the SPA (and the route collision it requires
  solving), the bracket-syntax silent-ignore, and browser E2E.
- **Publishing:** the remaining items in `docs/publishing.md` — piping the built
  UI into the package, the `bin` entry, a `prepublishOnly` guard, and release
  tooling. The declaration and manifest blockers are now closed.

---

## 10. Verification

```text
pnpm build         PASS (exit 0)
pnpm typecheck     PASS (exit 0)  - 8 projects, tests included
pnpm test          PASS (exit 0)  - 288 tests, 12 files
pnpm format:check  PASS (exit 0)
```

```text
 Test Files  12 passed (12)
      Tests  288 passed (288)
```

Per project: `admin-ui` 50, `nest-admin` 154, `prisma` 78, `architecture` 6 —
288 in total.

UI-specific checks:

```text
pnpm --filter @nest-admin/admin-ui build       PASS  (vite build)
pnpm --filter @nest-admin/admin-ui typecheck   PASS  (tsc --noEmit)
pnpm --filter @nest-admin/admin-ui test        PASS  (50 tests)
```

Boundary assertions, unchanged and still passing:

```text
packages/core imports no Prisma package
packages/core imports no NestJS package
packages/core declares no runtime dependencies
packages/nestjs/src imports no Prisma package
packages/nestjs/src reaches the adapter only through the published subpath
@prisma/get-dmmf is imported by exactly one module
```

Package artefacts verified from a clean build — see §2 for the table.
