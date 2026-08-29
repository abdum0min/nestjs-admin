# Phase 5 — Resource-Level Authorization

Status: **complete.** No RBAC, no roles, no permission store, no policy DSL, no
field-level permissions, no admin UI, no CLI.

---

## 1. Starting Point

Five commits; working tree clean. Baseline before any change: build, typecheck,
format all exit 0; **183 tests** across 8 files.

Phase 4 left the wiring:

```text
AdminModule.forRoot({ adapter, auth })
  → ADMIN_AUTH → AdminAuthGuard (@UseGuards on the controller)
  → ADMIN_ADAPTER → AdminService → AdminController
  → @UseFilters(AdminExceptionFilter)
```

Answers to the investigation questions, read from source rather than from the
Phase 4 report:

| #   | Question                                         | Answer                                                                 |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | Where is `AdminAuth`?                            | `packages/nestjs/src/auth/contract.ts`                                 |
| 2   | What does `authorize` take/return?               | `ExecutionContext` → `void \| boolean \| Promise<void \| boolean>`     |
| 3   | How does `AdminService` resolve models?          | `requireModel()` → `adapter.getModels()`, find by name                 |
| 4   | Where is `/admin/meta` generated?                | `AdminController.meta()` → `AdminService.getMetadata()`                |
| 5   | Where is the mapper called?                      | `toMetadataDto()`, inside `getMetadata()`                              |
| 6   | Can policy avoid coupling Core to NestJS?        | Yes — it lives entirely in `packages/nestjs`                           |
| 7   | What can be reused?                              | `ExecutionContext`, `ForbiddenError`, `ModelMetadata`, `toMetadataDto` |
| 8   | NestJS-layer concept without changing Core?      | Yes. Core is untouched this phase                                      |
| 9   | CRUD on a denied model?                          | `403 FORBIDDEN`, adapter never called                                  |
| 10  | What should `/admin/meta` return?                | Only visible models; denied ones simply absent                         |
| 11  | Unauthorized model requested directly?           | `403` (per the brief) — see §9 for the trade-off                       |
| 12  | Policy throws unexpectedly?                      | Propagates → generic 500, logged                                       |
| 13  | Policy returns `false`?                          | Denied (403 for CRUD, hidden for metadata)                             |
| 14  | Can `AdminExceptionFilter` already express this? | **Yes** — `ForbiddenError` → 403 `FORBIDDEN` already exists            |

Question 14 mattered most: no new error type, no new HTTP code, no second error
system. Core was not modified at all this phase.

---

## 2. The Problem Phase 4 Identified

A host can already deny per model from `AdminAuth`, because the guard sees
`params.model`. Phase 4 flagged why that is not enough:

> `/admin/meta` has no `:model`, so a host doing per-model checks still leaks
> the full schema through metadata.

Route-level authorization is a yes/no on a request. The metadata endpoint needs
a **filtered document**, which no guard can produce. And the admin UI will
render itself from that endpoint, so a resource the UI should not know about has
to be absent from the response — not hidden client-side.

That is the whole reason this phase exists.

---

## 3. Design

### Where it lives

**Entirely in the NestJS layer.** Core is unchanged.

Phase 4 rejected Core as the home for permission policy, because a permission
decision needs a principal and a principal is a transport concern. Nothing found
this phase argues for reversing that — if anything the opposite: the contract's
input is a NestJS `ExecutionContext`, which is exactly the type Core must never
learn about. Putting it in Core would drag request-shaped ideas into the one
package that has stayed free of them, and every future ORM adapter would inherit
a dependency it has no use for.

### One enforcement boundary

`AdminService`. Not the controller, not the mapper, not the adapter:

| Component          | Role after this phase                                  |
| ------------------ | ------------------------------------------------------ |
| `AdminController`  | Thin. Forwards the execution context; decides nothing. |
| **`AdminService`** | **The only place the policy is consulted.**            |
| `toMetadataDto`    | Still a mapper. Makes no authorization decision (§5).  |
| `OrmAdapter`       | Still authorization-agnostic. Never sees the policy.   |

### How the service reaches the request

The policy needs the request — that is where the host attached its principal —
but a service is not request-aware. Three options existed:

| Option                                   | Verdict                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Request-scoped `AdminService`            | Rejected. Changes the DI semantics of an exported provider and makes the controller request-scoped with it. |
| Guard stashes the context on the request | Rejected. Couples the service to the guard having run.                                                      |
| **Parameter decorator**                  | **Chosen.**                                                                                                 |

`createParamDecorator`'s factory is handed the `ExecutionContext` directly, so
`@AdminContext()` gives the controller the context and it passes it down. No
scope change, no hidden coupling, and the policy receives the same type
`AdminAuth` already receives — one accessor works for both contracts.

---

## 4. Contract and API

```ts
export type AdminOperation = 'metadata' | 'list' | 'read' | 'create' | 'update' | 'delete'

export interface ResourceAuthorization {
  readonly context: ExecutionContext
  readonly model: string
  readonly operation: AdminOperation
}

export interface AdminResourceAuth {
  authorize(resource: ResourceAuthorization): void | boolean | Promise<void | boolean>
}
```

```ts
AdminModule.forRoot({ adapter, auth, resourceAuth })
```

**`resourceAuth` is optional**, defaulting to permitting every model. That is a
different judgement from Phase 4's required `auth`, and deliberately so: `auth`
is the door, and an open door by default is a hole. This is a refinement behind
an already-shut door — omitting it reproduces exactly the behaviour that existed
before the option, and requiring it would break every consumer to express a rule
most applications do not have. A malformed `resourceAuth` (no `authorize`
method) is still rejected at module construction.

**Denial is `false` or `ForbiddenError`, and they mean the same thing.** Unlike
`AdminAuth`, there is no 401/403 ambiguity to resolve here — a request that
reaches this point has already authenticated. So the contract does not force the
caller to choose, and both forms are tested.

Two contracts rather than one, because they answer different questions: _may
this request enter?_ versus _may this principal touch this model?_. A host with
no per-resource rules implements only the first.

---

## 5. Metadata Filtering — and a leak found by a test

The flow is exactly the one the brief specified:

```text
GET /admin/meta
  → adapter.getModels()          all models
  → policy, operation 'metadata' per model
  → filter                       before mapping
  → toMetadataDto(visible)       existing whitelist mapper, unchanged contract
```

Filtering happens **before** mapping, so a denied model never reaches the DTO at
all. The Phase 3 whitelist property is untouched.

### The leak

The first run of the suite failed one test, and it was a real defect rather than
a bad assertion. With `Post` hidden, the response still contained:

```json
{
  "name": "posts",
  "kind": "relation",
  "relation": { "targetModel": "Post", "cardinality": "many" }
}
```

`User.posts` is a relation _pointing at_ the hidden model. Filtering the model
list alone published the hidden model's **name** through `relation.targetModel`,
and the relation field's own name alongside it — precisely the side channel §4
of the brief warned about.

### The fix, and why it is in the mapper

`toMetadataDto` now drops relation fields whose `targetModel` is not among the
models being emitted.

This does not make the mapper a permission engine, and the distinction matters.
The mapper makes no authorization decision and does not know one was made. Its
rule is _document coherence_: do not emit a reference to something this document
does not contain, because a dangling `targetModel` is unrenderable by any
client. It derives the set from the array it was already given — no new
parameter, no policy knowledge. Closing the leak is a consequence of the rule,
not its statement.

Tested in both directions: the relation disappears when its target is hidden,
and survives when both ends are visible — and the visible model keeps all its
other fields, so the fix does not over-filter.

---

## 6. CRUD Enforcement

Authorization runs **first** in every write and read path:

```text
GET /admin/AuditLog
  → assertAllowed(context, 'AuditLog', 'list')   ← denied here
  → 403 FORBIDDEN
  → adapter.list() never called
```

The ordering is asserted, not assumed: with a denying policy the in-memory
adapter records no query, no row is inserted by a denied `POST`, and no row is
removed by a denied `DELETE`. The same is proven against the real Prisma adapter
and SQLite by counting rows before and after a denied write.

| Route                      | Operation                  |
| -------------------------- | -------------------------- |
| `GET /admin/:model`        | `list`                     |
| `GET /admin/:model/:id`    | `read`                     |
| `POST /admin/:model`       | `create`                   |
| `PATCH /admin/:model/:id`  | `update`                   |
| `DELETE /admin/:model/:id` | `delete`                   |
| `GET /admin/meta`          | `metadata`, once per model |

Because `metadata` and the record operations are decided independently, a host
can express read-only resources, and resources hidden from the UI but still
reachable — proven by tests, without either being a special case in our code.

---

## 7. Error Behaviour

No new error type and no new HTTP code. `ForbiddenError` → `403 FORBIDDEN`
already existed from Phase 4 and is reused unchanged.

| Policy outcome           | CRUD                  | Metadata              |
| ------------------------ | --------------------- | --------------------- |
| returns `true` / nothing | allowed               | model visible         |
| returns `false`          | `403 FORBIDDEN`       | model hidden          |
| throws `ForbiddenError`  | `403 FORBIDDEN`       | model hidden          |
| throws anything else     | generic `500`, logged | generic `500`, logged |

The same policy, two consequences. A `ForbiddenError` during metadata filtering
must **hide** rather than fail: a 403 from `GET /admin/meta` would itself confirm
that a model the caller cannot see exists, which is the leak this phase closes.

An _unexpected_ error during filtering does **not** hide the model — it becomes
a 500. Silently reshaping the schema on a bug would look to a client like the
model was deleted; an error says what actually happened.

---

## 8. Fail-Closed Behaviour

- `false` denies.
- `ForbiddenError` denies.
- Any other throw or rejection **denies** and returns a generic 500. A broken
  policy never becomes an accidental allow — tested for a synchronous throw and
  a rejected promise, on both CRUD and metadata paths.
- Internal detail never escapes: a policy error containing a JWT and a source
  path produces a response with neither, and no stack.

---

## 9. Security Considerations

| Concern                                 | Handling                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/admin/meta` exposing hidden models    | Filtered server-side before mapping. Denied model's name, fields, relations, primary key and enum values are all absent. |
| Hidden model leaking via a relation     | Fixed — relation fields pointing at absent models are dropped (§5). Found by a test, not by inspection.                  |
| Denied model signalled through an error | `/admin/meta` returns 200 with a smaller document, never a 403.                                                          |
| Denied resource reaching the ORM        | Policy runs before every adapter call; asserted on both adapters.                                                        |
| A failing policy allowing access        | Never. Any unexpected error is a 500.                                                                                    |
| Credentials in policy-failure responses | Generic 500 only; tested against a JWT-bearing error.                                                                    |
| Duplicate/divergent enforcement         | One boundary, in `AdminService`.                                                                                         |

### The 403-versus-404 trade-off, stated plainly

`GET /admin/AuditLog` returns **403** when denied and **404** when the model does
not exist. That difference is an existence oracle: a caller can distinguish
"exists but forbidden" from "does not exist".

This is what the brief specified (§5: _"Return 403 FORBIDDEN"_), and it is the
conventional REST behaviour, but it is a real disclosure and is recorded here
rather than left implicit. A host that considers model names sensitive would
want 404 for both. Making that configurable is deferred, not overlooked.

Note the asymmetry is deliberate on the metadata side: `/admin/meta` leaks
nothing, because that is the endpoint a UI enumerates from.

---

## 10. Tests

**229 passing across 9 files**, up from 183.

| Suite                               |  Tests | Change                             |
| ----------------------------------- | -----: | ---------------------------------- |
| `nestjs/test/resource-auth.test.ts` | **44** | new                                |
| `nestjs/test/auth.test.ts`          |     36 | unchanged                          |
| `nestjs/test/http.test.ts`          |     50 | unchanged                          |
| `nestjs/test/e2e.test.ts`           |     15 | +2 resource-auth on the real stack |
| `prisma/test/*`                     |     78 | unchanged                          |
| `tests/boundaries.test.ts`          |      6 | unchanged, still passing           |

The new suite covers, over real HTTP:

- **Configuration** — default permits everything; malformed `resourceAuth`
  rejected; two module instances independent.
- **CRUD** — all five model routes allowed when permitted and 403 when denied;
  denying one model does not affect another.
- **Metadata** — all visible; some hidden; all hidden (empty list, still 200);
  denied name absent from the raw payload; no error signal; `ForbiddenError`
  hides rather than fails; DTO whitelist intact; no ORM vocabulary.
- **The relation leak** — dangling relation dropped, other fields retained,
  relation preserved when both ends are visible.
- **Operation-aware policy** — every operation reaches the policy; read-only
  resource; hidden-but-accessible resource; model name and context delivered.
- **Adapter isolation** — no list, no insert, no delete on a denied resource;
  metadata filtering reads no records.
- **Async** — resolved `true`/`false`, rejected `ForbiddenError`, rejected
  unexpected error.
- **Fail-closed** — unexpected throw on CRUD and on metadata; no leakage.
- **Composition** — 401 precedes 403; existing 404/400 mappings unchanged.

Architectural properties preserved: the resource-auth suite runs against
`InMemoryAdapter`, a second independent implementation of `OrmAdapter` — which is
what proves resource authorization is ORM-independent. The two e2e additions
prove the policy is consulted on the real Prisma + SQLite path.

---

## 11. Files Changed

### Added

| File                                            | Purpose                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/nestjs/src/auth/resource.ts`          | `AdminResourceAuth`, `AdminOperation`, `ResourceAuthorization`, `allowAllResources()` |
| `packages/nestjs/src/http/execution-context.ts` | `@AdminContext()` parameter decorator                                                 |
| `packages/nestjs/test/resource-auth.test.ts`    | the 44-test suite                                                                     |
| `reports/006-resource-authorization.md`         | this report                                                                           |

### Modified

| File                                                                | Change                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/nestjs/src/admin/service.ts`                              | the enforcement boundary; every method takes the context |
| `packages/nestjs/src/admin/controller.ts`                           | forwards `@AdminContext()` from all six handlers         |
| `packages/nestjs/src/admin/metadata.dto.ts`                         | drops relations to absent models                         |
| `packages/nestjs/src/module.ts`                                     | optional `resourceAuth`, validation, provider            |
| `packages/nestjs/src/tokens.ts`                                     | `ADMIN_RESOURCE_AUTH`                                    |
| `packages/nestjs/src/index.ts`                                      | export the contract types                                |
| `packages/nestjs/test/app.ts`                                       | optional `resourceAuth`                                  |
| `packages/nestjs/README.md`, `docs/{architecture,status,README}.md` | documentation                                            |

**`packages/core` was not modified.** Neither were the adapter, the query
parser, the exception filter, the response envelope, or `apps/admin-ui`.

---

## 12. Public API Changes

Added:

```text
type AdminResourceAuth
type AdminOperation
type ResourceAuthorization
AdminModuleOptions.resourceAuth   (optional)
```

Not exported, and verified absent from the built `dist/index.d.ts`:
`AdminContext`, `ADMIN_RESOURCE_AUTH`, `allowAllResources`, `AdminService`,
`AdminAuthGuard`, and every other internal.

No breaking change. `AdminModule.forRoot({ adapter, auth })` still compiles and
behaves exactly as before.

---

## 13. Design Decisions

1. **Policy in the NestJS layer, Core untouched** — the contract's input is an
   `ExecutionContext`; Core must never learn that type. §3.
2. **One boundary, in `AdminService`** — the only place both metadata and CRUD
   pass through. §3.
3. **Parameter decorator over request scope or guard-stashing** — no DI change,
   no hidden coupling. §3.
4. **`resourceAuth` optional** — a refinement behind an already-shut door, not
   the door itself. §4.
5. **`false` and `ForbiddenError` equivalent** — no 401/403 ambiguity remains at
   this layer. §4.
6. **Metadata denial hides; CRUD denial errors** — a 403 from `/admin/meta`
   would itself be the leak. §7.
7. **Unexpected errors surface, even during filtering** — silently reshaping a
   schema on a bug is worse than an error. §7.
8. **Relation-dropping in the mapper as coherence, not permission** — the mapper
   still makes no authorization decision. §5.
9. **Separate contract from `AdminAuth`** — different questions; hosts without
   per-resource rules implement only one. §4.

---

## 14. Known Limitations

1. **No field-level permissions.** A visible model is visible in full — every
   field, every value. A model with one sensitive column is all-or-nothing.
2. **403 versus 404 is an existence oracle** for direct model requests. §9.
3. **The policy is consulted once per model per metadata request.** No caching
   or memoisation; a slow policy is called N times for N models.
4. **No row-level authorization.** A permitted model is permitted for all its
   records; `list` cannot be narrowed to "rows this principal owns".
5. **Relations to hidden models are dropped silently.** A client cannot tell a
   removed relation from a schema that never had one — intentional, but it means
   a misconfigured policy quietly changes the shape a UI renders.
6. **`NestAdminConfig.resources` is still unused.** Core declares
   `include`/`exclude` and nothing reads it; the static case was not wired to
   the dynamic one this phase.
7. **Everything Phase 3 and 4 listed still applies** — fixed `/admin` base path,
   no `forRootAsync`, the `.d.ts` publishing blocker, no body type validation.

---

## 15. Deferred Work

Considered this phase, deliberately not built:

- Field-level permissions.
- Row-level / query-scoping authorization.
- Configurable 404-instead-of-403 for denied models.
- Wiring `NestAdminConfig.resources` as the static policy form.
- Memoising the policy across a single metadata request.
- Everything on the Phase 3 and 4 deferred lists: `.d.ts` resolution,
  configurable base path, `forRootAsync`, body validation, `OR` filters, cursor
  pagination, SPA serving, the CLI, a second ORM adapter.

Nothing speculative was added to any API for these.

---

## 16. Verification

Run from a clean working tree at the end of the phase:

```text
pnpm build         PASS (exit 0)
pnpm typecheck     PASS (exit 0)  - 7 projects, tests included
pnpm test          PASS (exit 0)  - 229 tests, 9 files
pnpm format:check  PASS (exit 0)
```

```text
 Test Files  9 passed (9)
      Tests  229 passed (229)
```

Boundary assertions, run explicitly, all passing and unchanged. No new boundary
rule was needed: resource authorization added no cross-package dependency, and
`packages/core` was not touched.

```text
packages/core imports no Prisma package
packages/core imports no NestJS package
packages/core declares no runtime dependencies
packages/nestjs/src imports no Prisma package
packages/nestjs/src reaches the adapter only through the published subpath
@prisma/get-dmmf is imported by exactly one module
```

Published type surface inspected: the four additions are present, and
`AdminContext`, `ADMIN_RESOURCE_AUTH`, `allowAllResources`, `AdminService` and
`AdminAuthGuard` are all absent.

The Phase 3 `.d.ts` publishing issue was **not** touched — not required for this
phase, and still documented in `docs/publishing.md`.
