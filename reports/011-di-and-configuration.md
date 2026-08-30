# 0.2.0 — DI and Configuration

Status: **complete.** No relations, no field overrides, no hooks, no demo, no
documentation site, nothing published.

---

## 1. Executive Summary

The release that makes the admin fit an application it was not built around.

Before it, the package could only be configured with values that existed at
module-declaration time. That is not how a NestJS application is shaped: the
database client is a provider, and its configuration arrives through DI. The
practical consequence was that adopting the package meant constructing a Prisma
client at import time — before configuration, and outside the application's own
lifecycle.

Delivered:

- **`forRootAsync`** with `useFactory`, `useClass` and `useExisting`.
- **`path`** — the admin mounts anywhere, API and UI together, with the served
  page rewritten to match.
- **`resources`** — `include` / `exclude`, structural, 404 rather than 403.
- **Core is shared in ESM** instead of duplicated per entrypoint.

**366 tests** (was 317), **40/40** packed-consumer checks (was 35).

Two things worth naming up front. The `path` work began with a spike, and both
candidate approaches turned out to work — the choice was made on which one
relies on documented behaviour rather than on inheritance metadata. And the
bundle-duplication investigation found that **a claim in `reports/009` was
wrong**: ESM was duplicating Core too. That report now carries a correction.

---

## 2. The `path` Spike

`@Controller('admin')` is evaluated when the class is defined, long before
`forRoot` sees any options, so the mount path cannot simply be passed to it. Two
candidates were measured rather than argued about.

|                                                                        | Result                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **A. `RouterModule.register()`** imported by the dynamic module itself | Works. Mounts on the configured path, handles a nested path, and does not also answer on the un-prefixed one. |
| **B. Subclasses decorated inside `forRoot`**                           | Also works — Nest does discover routes declared on a base class.                                              |

Since both worked, the deciding question was which one depends on documented
behaviour. **A** was chosen: it is Nest's own mechanism, where **B** relies on
route metadata being inherited, and would additionally have had to carry
constructor parameter metadata through the subclass for `@Inject` to resolve —
which the spike did not exercise, because its controller had no dependencies.

One property of the current design had to survive prefixing, and was measured
separately: the route collision between `assets/:file` and `:model` is resolved
by controller order, and **`RouterModule` preserves it**. `/panel/assets/x.js`
still matches the UI controller, not the API's `:model`.

The spike was deleted; its assertions live on against the real implementation in
`test/mount-path.test.ts`.

---

## 3. What Changed

### 3.1 `path`

One value reaches three places that must agree, so it is normalised once and
each destination is asserted separately:

| Destination             | What it needs                         |
| ----------------------- | ------------------------------------- |
| The router              | The prefix for every controller route |
| The served `index.html` | Asset URLs, which Vite emits absolute |
| The browser             | A base to build API URLs from         |

`normaliseMountPath` accepts `admin`, `/admin`, `admin/` and `/admin/` alike and
answers `/admin`. It rejects two things outright:

- **Empty or `/`.** The routes end in `:model`; at the root they would answer
  every unmatched request in the host application, and the host's own later
  routes would fail somewhere far from this option.
- **Anything that is not a plain path segment.** Restricting segments to
  unreserved URL characters rules out route patterns, and also means the value
  can be written into the served HTML without escaping — there is no character
  left in it that could close a tag.

The SPA problem was that Vite emits absolute asset URLs, and the mount point is
not known at build time. `apps/admin-ui` now builds against a placeholder base,
`/__nest-admin-base__/`, which the UI controller rewrites when it serves the
shell. A placeholder rather than a plausible default such as `/admin/`: a string
that appears in the output for exactly one reason cannot be confused with
something that merely resembles it.

The browser needs the base too, and **cannot work it out for itself** — the SPA
uses hash routing, so `/panel/User` and `/panel#/User` are indistinguishable
from inside the page. It is injected as `window.__NEST_ADMIN_BASE__`.

The rendered shell is memoised on the controller instance rather than in a
module-level cache, for the reason in §3.4.

### 3.2 `resources`

`include` / `exclude`, applied in that order, preserving the adapter's own model
order — so adding a name to the list does not silently reshuffle the admin.

The distinction that shapes the whole feature is **structural versus
per-principal**:

|                        | `resources`                      | `resourceAuth`             |
| ---------------------- | -------------------------------- | -------------------------- |
| Question               | Is this model part of the admin? | May this caller act on it? |
| Same for everyone      | Yes                              | No                         |
| Answer when it says no | **404**                          | **403**                    |

Collapsing the two would either leak that a hidden table exists or make a
missing one look like a permissions problem.

That required changing the order of two checks. Model existence is now resolved
**before** the policy on every operation, so an excluded model answers 404
identically for every principal. It also fixed a gap: `create`, `update` and
`delete` did not validate the model name at all, so an unknown model reached the
adapter on those routes.

A selection naming a model the schema does not have **fails at startup**. It
cannot be checked in `forRoot` — the model list comes from the adapter and
asking for it is asynchronous — so the check runs in `onModuleInit`, which is
the first moment it can be known and still before the first request. A typo in
`exclude` would otherwise leave the model exposed: the opposite of what was
asked for, and silent.

### 3.3 `forRootAsync`

```ts
AdminModule.forRootAsync({
  imports: [DatabaseModule],
  inject: [PrismaService],
  useFactory: (prisma: PrismaService) => ({
    adapter: new PrismaAdapter({ client: prisma }),
    auth: myAdminAuth,
  }),
})
```

`useClass` and `useExisting` are supported alongside `useFactory`.

**`path` stays on the options object, not in the factory.** Routes are
registered when the module is defined, which is before any provider has been
instantiated, so the mount path cannot wait for an injection. Offering it in the
factory and silently ignoring it would be worse than not offering it.

Every option provider derives from a single resolved object, so **the factory
runs once** however many of its values are injected — a factory that opens a
connection must not be called four times. There is a test for exactly that.

Validation is shared with `forRoot` and names the method the reader called, so
an async factory returning no `auth` fails with the same message and the same
reasoning: the admin exposes the whole database, so it is never public by
default, and an async factory must not become a way around that.

`examples/basic` now uses `forRootAsync` with a `PrismaService` provider, which
is the arrangement a real application has.

### 3.4 Bundle duplication

The published package ships two entrypoints. Each was carrying its own copy of
Core, so an error thrown in one was not an `instanceof` the class held by the
other — the defect that produced 500s instead of 400s in 0.0.0.

**The root cause was not where `reports/009` said it was.** `packages/prisma`
inlined Core into its own `dist`. The final build therefore saw two physically
different sources — Core, and a copy of Core buried inside the Prisma bundle —
and no bundler can share those. `splitting: true` made no difference, because
there was nothing to share.

Core is now external in the Prisma package's build, so the final build resolves
it once:

|                   | Before                        | After            |
| ----------------- | ----------------------------- | ---------------- |
| `dist/index.js`   | 1 copy                        | **0**            |
| `dist/prisma.js`  | 1 copy                        | **0**            |
| shared ESM chunk  | 193 bytes, one esbuild helper | **3.8 KB, Core** |
| `dist/index.cjs`  | 1 copy                        | 1 copy           |
| `dist/prisma.cjs` | 1 copy                        | 1 copy           |

**CommonJS still duplicates, and that is a limitation, not an oversight.**
esbuild does not code-split CommonJS output, so each CJS entry inlines what it
needs. The mitigation stays what it already is: framework errors carry a
`Symbol.for` brand rather than relying on class identity. `verify:package` now
asserts the whole arrangement — one Core in the ESM chunk, none in either ESM
entry, one in each CJS entry — so a change in any direction is noticed.

### 3.5 Two more `instanceof` checks removed

The same defect class as the 0.0.0 bug, found while working on §3.4 and not yet
causing a failure:

- `AdminService.isVisible` caught `error instanceof ForbiddenError`, where the
  error comes from the **host application's** policy;
- the Prisma adapter and the DMMF reader both re-threw on
  `cause instanceof NestAdminError`.

All three now use the brand check.

---

## 4. Correction to `reports/009`

That report states:

> ESM is unaffected — both ESM entrypoints share `chunk-7QVYU63E.js`

This is wrong. The chunk was 193 bytes and contained a single esbuild helper;
both ESM entrypoints carried their own copy of Core, exactly as the CommonJS
files did. **ESM was affected too, and the claim was never checked** — the file
name was read as evidence of sharing without looking inside it.

Nothing behavioural follows: the fix in that report identifies errors by brand
rather than by class, which covers both formats. But the diagnosis was
incomplete, and a reader would have drawn the wrong conclusion about which
consumers were at risk. A correction note has been added to `reports/009` in
place, and the cause is fixed in §3.4.

---

## 5. Verification

| Check                 | Result                   |
| --------------------- | ------------------------ |
| `pnpm build`          | 0                        |
| `pnpm typecheck`      | 0                        |
| `pnpm format:check`   | 0                        |
| `pnpm test`           | **366 passed**, 17 files |
| `pnpm verify:package` | **40/40**                |

New tests: 49 across three files.

| File                                   | Covers                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/mount-path.test.ts` (17)         | Normalisation, the API and UI moving together, nothing left behind on the old path, the collision rule surviving a prefix, the rendered shell            |
| `test/resource-selection.test.ts` (19) | `selectModels` and `unknownSelectionNames` as pure functions, 404-not-403, every verb, startup failure on an unknown name, selection and policy together |
| `test/for-root-async.test.ts` (13)     | All three provider forms, the factory running once, the path staying structural, every validation path                                                   |

`examples/basic` was also run: `/admin` serves the UI, `/admin/meta` reports
`User, Product`, `User` lists 6 seeded rows, and a write to the read-only
`Product` is refused with 403.

---

## 6. Known Limitations

- **CommonJS still carries one copy of Core per entrypoint.** esbuild does not
  code-split CJS. The brand pattern is the mitigation, and `verify:package`
  asserts the arrangement so it cannot drift unnoticed. Removing it entirely
  would mean publishing Core as a separate package, which contradicts the
  single-tarball decision from 0.0.0.
- **`path` is not verified against a packed consumer.** `verify:package` mounts
  at the default. The behaviour is covered by 17 tests against a real HTTP
  server, but not through an installed tarball.
- **A second `AdminModule` in one application is untested.** Nothing obviously
  prevents it now that the path is configurable, but `RouterModule` registering
  the same module class twice has not been tried, and the module is still
  declared as `AdminModule` in both registrations.
- **`resources` does not affect ordering or grouping** in the sidebar. Deciding
  how models are presented is 0.5.0's job.

---

## 7. Result

```
forRootAsync (useFactory/useClass/useExisting): PASS
path, API and UI together:                     PASS
path rejected at the root:                     PASS
resources include/exclude:                     PASS
excluded model answers 404, denied 403:        PASS
unknown selection name fails at startup:       PASS
ESM shares one copy of Core:                   PASS
CJS duplication removed:                       NO — limitation, §6
examples/basic on forRootAsync:                PASS
```

|               | Before | After     |
| ------------- | ------ | --------- |
| Tests         | 317    | **366**   |
| Packed checks | 35/35  | **40/40** |
| Version       | 0.1.0  | 0.2.0     |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.3.0 — Relations I, to-one.** It needs a schema with several relation
shapes, which will require `prisma db push` against the throwaway playground
database.
