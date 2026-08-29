# Phase 4 — Authentication & Route Protection

Status: **complete.** No login, no JWT, no sessions, no user storage, no RBAC,
no resource-level permissions, no admin UI.

---

## 1. Executive Summary

Phase 3 left every admin route open. Phase 4 closes them behind a boundary the
consuming application controls, without Nest Admin acquiring an identity system
of its own.

Delivered:

- **`AdminAuth`** — a one-method contract the host implements. Nest Admin never
  reads a header, a cookie or a token.
- **`AdminAuthGuard`** — attached with `@UseGuards` at controller scope, so
  every admin route including `/admin/meta` is protected and the host's own
  routes are untouched.
- **`UnauthorizedError` and `ForbiddenError`** in Core, mapping to **401** and
  **403** through the existing filter. The two are genuinely distinct.
- **`auth` is a required module option.** There is no configuration in which
  the admin is accidentally public.
- **`unsafeAllowAllRequests()`** — an explicit, loudly-named escape hatch that
  warns at startup.
- **183 tests**, up from 146. The new 36-test auth suite asserts the full
  route × outcome matrix over real HTTP.

Two things worth carrying forward:

1. **Host-side per-model authorization already works**, with no new API. The
   guard receives the `ExecutionContext`, so the `model` route parameter is
   readable — verified by a test. But `/admin/meta` has no `:model`, so a host
   doing per-model checks still leaks the full schema through metadata. That
   asymmetry is precisely what Phase 5's resource policy has to fix (§10).
2. **A bug in the host's auth code fails closed.** Anything `authorize` throws
   other than the two documented errors becomes a generic 500 — never an allow,
   and never an echoed message.

---

## 2. Starting Point

Four commits; working tree clean. Baseline before any change: build, typecheck,
format all exit 0; **146 tests** pass across 7 files.

Phase 3's wiring, read from source rather than from the report:

```text
AdminModule.forRoot({ adapter })
  → ADMIN_ADAPTER (Symbol) → AdminService → AdminController
  → @UseFilters(AdminExceptionFilter)
```

`AdminController` is `@Controller('admin')` with six handlers and no guards.
`AdminExceptionFilter` is `@Catch()`, rethrows `HttpException`, maps four Core
errors by class, and defaults everything else to a generic 500.

The existing structure was not redesigned. Phase 4 adds one provider, one
guard, one decorator on the controller, and two branches in the filter.

---

## 3. Authentication Architecture

```text
Host application
      │  already has identity: session, JWT, gateway, mTLS - not our concern
      │  supplies AdminAuth
      ▼
AdminAuthGuard                    @UseGuards on AdminController
      │  calls auth.authorize(context)
      │
      ├── returns / resolves ──────────────▶ request proceeds
      ├── throws UnauthorizedError ────────▶ 401 UNAUTHORIZED
      ├── throws ForbiddenError ───────────▶ 403 FORBIDDEN
      ├── returns false ───────────────────▶ 403 FORBIDDEN  (fail closed)
      └── throws anything else ────────────▶ 500 INTERNAL_ERROR, logged
      │
      ▼
AdminController → AdminService → OrmAdapter → Prisma
```

New files, both in `packages/nestjs/src/auth/`:

| File          | Contents                                                 |
| ------------- | -------------------------------------------------------- |
| `contract.ts` | `AdminAuth`, `unsafeAllowAllRequests()`, startup warning |
| `guard.ts`    | `AdminAuthGuard` — delegation only, no auth logic        |

Core gained two error classes and nothing else. It still imports no NestJS, no
Prisma, and declares no dependencies — asserted by the boundary tests.

---

## 4. Module API

```ts
AdminModule.forRoot({ adapter, auth })
```

`adapter` is unchanged. `auth` is new and **required**.

### Why required rather than optional

This is the one deliberately breaking change in the phase, and the reasoning is
the whole point of it.

An optional `auth` needs a default. `allow-all` means a forgotten line in a
config file silently publishes every record and the entire schema shape, and
nothing about the running system looks wrong — the failure is invisible until
someone else finds it. `deny-all` is safe but produces an admin that returns
401 to everything with no indication why, which people debug by reaching for
the escape hatch anyway.

Requiring it makes the decision visible at the call site and impossible to
skip. The prompt's own guidance — _"security takes priority over silently
maintaining an unsafe default"_ — points the same way, and there are no
published consumers to break: nothing has been released.

Validation happens in `forRoot`, at module construction, not through DI. A
missing provider would surface as an injection error on the first request, long
after the mistake and nowhere near it. Both the missing-`adapter` and
missing-`auth` messages name the fix.

### The escape hatch

`unsafeAllowAllRequests()` exists because a required option with no legitimate
opt-out pushes people to write their own `{ authorize() {} }` — the same hole,
but invisible in a diff. This one is hard to mistake:

- the name contains `unsafe`,
- it must be imported and called explicitly,
- and it logs a warning on every application start.

Instances are tracked in a module-private `WeakSet` rather than by a marker
property, so nothing is added to the public shape of `AdminAuth` and a consumer
cannot set the flag themselves.

---

## 5. Auth Contract

```ts
export interface AdminAuth {
  authorize(context: ExecutionContext): void | boolean | Promise<void | boolean>
}
```

One method, one decision. Design notes:

**The parameter is Nest's `ExecutionContext`, not a bespoke type.** The host has
already attached its principal to the request; a `NestAdminPrincipal`
abstraction would be a second representation of something that already exists,
and the framework would then have to guess how to populate it. `ExecutionContext`
gives the host exactly what it already knows how to read.

**Denial is by throwing, not by returning.** A boolean cannot express the
401/403 distinction, and inventing a default for `false` is exactly the
collapse this phase exists to avoid. Throwing forces the caller to say which
denial it is.

**`false` is still accepted, and means 403.** A guard written in the reflexive
NestJS style (`return false`) must not accidentally allow the request. 403 is
the safer of the two guesses — it does not tell an anonymous prober that
authentication would have helped. The contract documents that throwing is
preferred.

**Sync and async both work.** `authorize` may return `void`, a boolean, or a
promise of either; the guard awaits unconditionally.

**Nothing in the library inspects credentials.** No header parsing, no cookie
reading, no token validation, no `Authorization` handling. All of it belongs to
the host.

---

## 6. 401 / 403 Semantics

| Situation                                | Host throws         | HTTP | `error.code`   |
| ---------------------------------------- | ------------------- | ---: | -------------- |
| No authenticated identity on the request | `UnauthorizedError` |  401 | `UNAUTHORIZED` |
| Identity established, not permitted here | `ForbiddenError`    |  403 | `FORBIDDEN`    |

The distinction is the host's to make, because only the host knows whether a
principal exists. Nest Admin does not infer it — it does not look at the
request, does not pattern-match on error messages, and does not guess from the
absence of a header.

Default messages are deliberately uninformative:

```text
401  "Authentication is required to access the admin API."
403  "You do not have permission to access the admin API."
```

Neither says whether a credential was absent, malformed, expired or simply
wrong; that distinction is useful to an attacker and to nobody else. A host may
pass its own message when it has something safe to say — tested.

---

## 7. Error Mapping

`AdminExceptionFilter` gained two branches, placed **first** because they are
the most security-sensitive part of the table:

| Core error            | Status | Code               | Message forwarded? | `details`?   |
| --------------------- | -----: | ------------------ | ------------------ | ------------ |
| `UnauthorizedError`   |    401 | `UNAUTHORIZED`     | yes                | **no**       |
| `ForbiddenError`      |    403 | `FORBIDDEN`        | yes                | **no**       |
| `ModelNotFoundError`  |    404 | `MODEL_NOT_FOUND`  | yes                | model        |
| `RecordNotFoundError` |    404 | `RECORD_NOT_FOUND` | yes                | model, id    |
| `FieldNotFoundError`  |    400 | `FIELD_NOT_FOUND`  | yes                | model, field |
| `InvalidQueryError`   |    400 | `INVALID_QUERY`    | yes                | no           |
| everything else       |    500 | `INTERNAL_ERROR`   | **no**             | no           |

Neither auth branch attaches `details`. The other branches echo a model or field
name, which is information the caller supplied; an auth failure has nothing
comparable to return, and anything added there would be information a rejected
caller did not previously have.

Every Phase 3 mapping is preserved, including the allowlist rule: `AdapterError`
and any other `NestAdminError` subclass still becomes a generic 500 with the
real error logged. The two new errors were added to the allowlist explicitly
rather than by widening it to the base class.

### A behaviour that had to be verified, not assumed

Guards run before the route handler, so whether a **controller-scoped**
`@UseFilters` catches an exception thrown from a guard determines whether the
mapping works at all. If it did not, `UnauthorizedError` would surface as an
unmapped 500 and the phase would silently be broken.

It does. Proven by the 12 route-matrix tests asserting real 401 and 403 status
codes over HTTP, not by reading documentation.

---

## 8. Route Protection

`@UseGuards(AdminAuthGuard)` sits on the controller class, so it applies to
every handler — there is no per-route opt-in to forget when a seventh route is
added later.

**Not an `APP_GUARD`.** The same reasoning that kept the filter off `APP_FILTER`
in Phase 3: a library that registers a global guard starts authenticating the
host application's own routes. Nest Admin protects its own surface and leaves
everything else alone.

Every route is covered, verified individually:

```text
GET    /admin/meta          401 ✓  403 ✓  200 ✓
GET    /admin/:model        401 ✓  403 ✓  200 ✓
GET    /admin/:model/:id    401 ✓  403 ✓  200 ✓
POST   /admin/:model        401 ✓  403 ✓  201 ✓
PATCH  /admin/:model/:id    401 ✓  403 ✓  200 ✓
DELETE /admin/:model/:id    401 ✓  403 ✓  200 ✓
```

`/admin/meta` is protected. It is the route that most needs it — it returns
every model, every field, every enum and every relation, which is a complete map
of the database for anyone deciding what to attack.

A test also asserts the guard runs **before the adapter is touched**: with a
denying auth, the in-memory adapter records no query at all. Rejection is not
"fetch then hide".

---

## 9. Principal Handling

**No principal abstraction was added**, deliberately.

The host has already established identity by the time the guard runs, and has
already attached it wherever its own middleware puts it. `ExecutionContext`
reaches that. Introducing `AdminPrincipal` would mean either asking the host to
populate a second representation, or guessing at a mapping — both worse than
letting the host read its own request.

A test confirms `authorize` can read the request path, and the `model` route
parameter, from the context.

---

## 10. Resource-Level Permission Decision

**Decided, not implemented**, as instructed.

### Options considered

| Option                                                                 | Placement                                          | Verdict                          |
| ---------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------- |
| **A** — host auth layer decides per model                              | `authorize` reads `params.model`                   | **Already works.** Zero new API. |
| **B** — admin layer takes a resource policy that also filters metadata | new option on `forRoot`, applied in `AdminService` | **Chosen for Phase 5.**          |
| **C** — Core owns a permission contract                                | `packages/core`                                    | **Rejected.**                    |

### Why C is rejected

Core is ORM-agnostic _and_ framework-agnostic. A permission contract needs a
principal, and a principal is a transport and identity concept. Putting it in
Core would drag request-shaped ideas into the one package that has stayed free
of them, and every future adapter would inherit a dependency it has no use for.
The two new errors are the correct amount of Core involvement: they are
vocabulary, not policy.

### Why B, and what A already gives us

Option A works today and is worth knowing about: a host can refuse
`params.model === 'AuditLog'` inside `authorize` with no help from us.

But it is not sufficient, and the reason is specific. `/admin/meta` carries no
`:model` parameter. A host that blocks `AuditLog` per-request still returns
`AuditLog`'s full field list, enums and relations from the metadata endpoint —
and the future UI renders from metadata, so it would display a resource that
every click then rejects. Filtering has to happen where metadata is produced,
which is inside the admin layer.

So Phase 5's shape should be a policy consulted in `AdminService`, applied in
two places: filtering the model list in `getMetadata()`, and rejecting
operations on filtered-out models. `NestAdminConfig.resources`
(`include`/`exclude`) already exists in Core, unused — that is the natural
static form, with a principal-aware dynamic form layered on top.

### What Phase 5 / the UI should expect

- The metadata endpoint is the filtering point; a UI should render exactly what
  metadata returns and never hard-code a resource list.
- A resource hidden by policy should be absent from metadata _and_ rejected on
  direct request. Hiding it in only one place is a hole.
- Field-level policy will need the same treatment one level down; nothing in the
  current DTO prevents it.

Nothing speculative was added to any API for this. No policy parameter, no
placeholder option, no unused type.

---

## 11. Security Considerations

| Concern                              | Handling                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Accidentally public admin            | `auth` is required; construction fails without it. Tested.                                                                          |
| `/admin/meta` leaking the schema     | Protected by the same controller-scoped guard. Tested for 401 and 403, and asserted that the rejected body contains no model names. |
| Route ordering bypass                | Tested across `/admin/meta`, `/admin/meta/`, unknown models, `__proto__`, nested ids and query strings.                             |
| A bug in host auth becoming an allow | The guard does not catch. Anything unexpected reaches the filter as a generic 500. Tested for both a throw and a rejected promise.  |
| Credentials in error responses       | Tested: a host error containing a JWT and a source path produces a response with neither, and no stack.                             |
| Enumeration through auth errors      | A denied request returns an identical body for a known and an unknown model. Tested.                                                |
| Auth failure reason disclosure       | Default messages avoid "expired", "malformed", "missing header", "token", "cookie". Tested.                                         |
| Work performed before rejection      | The adapter is never called on a denied request. Tested.                                                                            |
| ORM leaking into the auth layer      | `packages/nestjs/src` imports no Prisma — boundary test, which scans the new `auth/` directory.                                     |

Still not addressed, by instruction: resource-level and field-level
authorization. An authenticated, permitted principal can read and write **every**
model. That is the correct next constraint, not a Phase 4 gap.

---

## 12. Tests

**183 passing across 8 files**, up from 146.

| Suite                      |  Tests | Change                   |
| -------------------------- | -----: | ------------------------ |
| `nestjs/test/auth.test.ts` | **36** | new                      |
| `nestjs/test/http.test.ts` |     50 | unchanged behaviour      |
| `nestjs/test/e2e.test.ts`  |     13 | +1 auth-on-real-stack    |
| `prisma/test/*`            |     78 | unchanged                |
| `tests/boundaries.test.ts` |      6 | unchanged, still passing |

The auth suite covers:

- **Configuration** — auth accepted; construction refused without it; refused
  with an object lacking `authorize`; adapter validation still works; two module
  instances stay independent (one denying does not affect the other).
- **401 × all six routes** and **403 × all six routes**, generated from a single
  route table so a new route cannot be added without a matching assertion.
- **Distinctness** — the same request under two auth implementations produces
  different statuses and different codes.
- **Success** — every operation still works once permitted; sync, async, and
  context access.
- **Failing closed** — `false` denies, `true` allows, a thrown host error does
  not allow, a rejected promise does not allow.
- **Bypass attempts** — meta, trailing slash, unknown models, `__proto__`,
  query strings; and that the adapter is never reached.
- **Leakage** — no JWT, no path, no stack, no reason disclosure; envelope shape
  preserved.
- **Regression** — Core error mapping and prototype-key rejection unchanged
  after authentication succeeds.

The e2e addition proves the guard is attached when the **real Prisma adapter** is
wired in, and that a well-formed `POST` under a denying auth writes nothing to
the database.

Existing Phase 3 suites were changed in exactly two ways: the test app helper
now takes an optional `auth` (defaulting to the open implementation, so those
suites stay about what they were about), and one assertion was updated for the
now-required option.

---

## 13. Files Changed

### Added

| File                                   | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `packages/nestjs/src/auth/contract.ts` | `AdminAuth`, escape hatch, startup warning |
| `packages/nestjs/src/auth/guard.ts`    | `AdminAuthGuard`                           |
| `packages/nestjs/test/auth.test.ts`    | the 36-test auth suite                     |
| `reports/005-authentication.md`        | this report                                |

### Modified

| File                                                         | Change                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `packages/core/src/errors/errors.ts`                         | `UnauthorizedError`, `ForbiddenError`                        |
| `packages/core/src/index.ts`                                 | export them                                                  |
| `packages/nestjs/src/tokens.ts`                              | `ADMIN_AUTH` symbol                                          |
| `packages/nestjs/src/module.ts`                              | required `auth`, validation, providers                       |
| `packages/nestjs/src/admin/controller.ts`                    | `@UseGuards(AdminAuthGuard)`                                 |
| `packages/nestjs/src/http/exception.filter.ts`               | 401/403 branches                                             |
| `packages/nestjs/src/http/response.ts`                       | two new error codes                                          |
| `packages/nestjs/src/index.ts`                               | export `AdminAuth`, `unsafeAllowAllRequests`, the two errors |
| `packages/nestjs/test/{app,http,e2e}.ts`                     | auth-aware helper, updated assertions                        |
| `packages/nestjs/README.md`, `docs/{architecture,status}.md` | documentation                                                |

No change to `OrmAdapter`, `ModelMetadata`, `ListQuery`, `Page`, the query
parser, the metadata DTO, the Prisma adapter, or the response envelope shape.

### Public API

```text
AdminModule, AdminModuleOptions
AdminAuth, unsafeAllowAllRequests            ← new
UnauthorizedError, ForbiddenError            ← new
AdminErrorCode, AdminResponse, SuccessResponse, ErrorResponse, PageMeta
FieldDto, FieldKindDto, ModelDto, RelationDto, MetadataDto
```

`AdminAuthGuard`, `ADMIN_AUTH`, `warnIfUnsafe` and the internal `WeakSet` are
**not** exported. A consumer supplies the decision; the wiring is ours.

---

## 14. Dependencies

**None added.** No JWT library, no Passport, no session store, no identity
vendor. That is the direct consequence of the contract: if the framework never
authenticates anyone, it needs nothing to authenticate with.

Core still declares zero dependencies — asserted by a boundary test.

---

## 15. Design Decisions

1. **`auth` required, not optional** — no configuration yields an accidentally
   public admin. §4.
2. **A loud escape hatch** — `unsafeAllowAllRequests()`, named to be obvious in
   review and warning at runtime, because the alternative is people writing an
   invisible one. §4.
3. **`ExecutionContext`, not a bespoke principal** — the host's identity already
   exists; a second representation would be pure overhead. §9.
4. **Deny by throwing** — the only way to express 401 vs 403 without the
   framework guessing. §5.
5. **`false` accepted, mapped to 403** — fail closed for guards written in the
   reflexive style. §5.
6. **`@UseGuards` at controller scope, never `APP_GUARD`** — protects our routes
   without touching the host's. §8.
7. **No `details` on auth errors** — nothing to say that a rejected caller
   should learn. §7.
8. **Errors in Core, policy nowhere yet** — vocabulary is Core's job; permission
   policy is not. §10.
9. **`WeakSet` marker rather than a property** — keeps the public shape of
   `AdminAuth` to one method. §4.

---

## 16. Problems Encountered

### Whether a controller-scoped filter catches guard exceptions

The entire 401/403 mapping depends on it, and getting it wrong would have
produced 500s in place of 401s. Rather than assume, the route matrix was written
first and run: it does catch, and the statuses are correct. §7.

### The unsafe marker did not typecheck

The first implementation attached a `Symbol`-keyed property to the returned
object and cast to reach it, which TypeScript rejected (`TS2352`) — correctly,
since `AdminAuth` has no index signature. Replaced with a module-private
`WeakSet`, which is cleaner than the thing that failed: no cast, no addition to
the public shape, and a consumer cannot forge the marker.

### A dynamically dispatched supertest helper did not typecheck

The route-matrix helper indexed the supertest agent by method name, which is not
type-safe. Replaced with an explicit branch. Slightly longer, entirely checked.

### One Phase 3 assertion needed updating

`AdminModule.forRoot({ adapter: undefined })` now also needs `auth` to reach the
adapter check. Updated rather than weakened — both validations are still
asserted separately.

---

## 17. Known Limitations

1. **No resource-level or field-level permissions.** A permitted principal can
   read and write every model. §10.
2. **`/admin/meta` is all-or-nothing.** It returns the full schema to anyone
   authorized at all — the gap that makes Option B necessary. §10.
3. **The host must make the 401/403 call correctly.** Nest Admin cannot detect a
   host that throws `ForbiddenError` for anonymous requests.
4. **`unsafeAllowAllRequests()` really is unsafe.** It warns; it does not
   refuse. Nothing prevents deploying it.
5. **No rate limiting, no audit logging, no CSRF handling.** All belong to the
   host application or to later phases; none is implied by this one.
6. **Everything Phase 3 listed still applies** — fixed `/admin` base path, no
   `forRootAsync`, the `.d.ts` publishing blocker, no body type validation.

---

## 18. Deferred Work

Considered this phase, deliberately not built:

- Resource-level and field-level permissions (§10 records the decision).
- A `principal` abstraction — only if a future feature proves `ExecutionContext`
  insufficient.
- Wiring `examples/basic`, which now needs an `auth` implementation to compile a
  realistic example.
- Everything on the Phase 3 deferred list, untouched: `.d.ts` resolution,
  configurable base path, `forRootAsync`, body validation, `OR` filters, cursor
  pagination, SPA serving.

---

## 19. Recommended Phase 5

**Resource-level permissions**, applied at the metadata boundary — the direct
continuation of §10, and the last thing standing between the backend and a UI
that can be trusted with real data.

Suggested scope:

1. A policy consulted in `AdminService`, receiving the principal-bearing context
   and the model name.
2. `getMetadata()` filters the model list through it, so the UI renders only
   what the caller may see.
3. Record operations reject filtered-out models with `ForbiddenError` — hiding a
   resource in metadata without enforcing it on the route is not protection.
4. Honour the existing `NestAdminConfig.resources` include/exclude as the static
   case; layer the dynamic case on top.
5. Do **not** build roles, a permission store, or a policy DSL.

The alternative, if the schema-shape leak is judged acceptable for now, is the
admin UI — the backend contract is otherwise complete and stable. That ordering
is defensible only because the auth boundary now exists; before this phase it
was not.

Not recommended next: a second ORM adapter, the CLI, or the Prisma generator.

---

## 20. Verification

Run from a clean working tree at the end of the phase:

```text
pnpm build         PASS (exit 0)
pnpm typecheck     PASS (exit 0)  - 7 projects, tests included
pnpm test          PASS (exit 0)  - 183 tests, 8 files
pnpm format:check  PASS (exit 0)
```

```text
 Test Files  8 passed (8)
      Tests  183 passed (183)
```

Boundary assertions, run explicitly, all passing and unchanged:

```text
packages/core imports no Prisma package
packages/core imports no NestJS package
packages/core declares no runtime dependencies
packages/nestjs/src imports no Prisma package          ← now also scans src/auth/
packages/nestjs/src reaches the adapter only through the published subpath
@prisma/get-dmmf is imported by exactly one module
```

The Phase 3 `.d.ts` publishing issue was **not** touched — it was not required
for this phase and remains documented in `docs/publishing.md`.
