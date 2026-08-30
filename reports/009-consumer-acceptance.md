# Phase 7.5 — Real Consumer Playground

Status: **complete.** Acceptance testing only. No features added, no release
preparation started, no version bumped, no CHANGELOG, no tags.

---

## 1. Executive Summary

The package was installed from a tarball into a NestJS application outside the
repository, pointed at a schema the package had never seen, and driven through
its whole surface — HTTP API and the shipped UI bundle.

**It worked, but two real bugs surfaced, both invisible to `pnpm build`,
`pnpm typecheck` and all 304 existing tests.** Both were reproduced, fixed, and
covered by regression tests:

1. **Every adapter-raised error returned `500`.** Mistyping a sort field gave
   "an internal error occurred" instead of "unknown field". Caused by
   `instanceof` across two bundles that each inline their own copy of Core.
2. **CJS consumers could not typecheck the package.** Under
   `moduleResolution: node16`, TypeScript rejected both entrypoints (TS1479),
   because the `exports` map pointed CJS at the ESM declarations.

Both are exactly the class of defect this phase existed to find: they live in
the gap between the workspace and an installed package, and no amount of
in-repo testing reaches them.

After the fixes: **317 tests** (up from 304), **35/35** packed-consumer checks
(up from 19), and every acceptance item below passes.

**Recommendation: yes, the package is safe to proceed to release preparation.**
Qualified in §16.

---

## 2. Consumer Environment

A throwaway NestJS application in the OS temp directory — deliberately outside
the repository, so pnpm workspace resolution cannot mask a packaging mistake.
This is the "preferred final test" of the brief's §15, chosen over
`examples/consumer-playground/` because a consumer inside the monorepo is a
weaker test. `examples/basic` already covers the in-repo case (Phase 7).

```
C:\Users\black\AppData\Local\Temp\na-playground        (the application)
C:\Users\black\AppData\Local\Temp\na-tgz2\*.tgz        (the installed tarball)
```

Nothing in this phase's playground is committed; it is a temporary acceptance
harness and leaves no trace in the repository.

| Component        | Version                                 |
| ---------------- | --------------------------------------- |
| Node             | 24.13.0                                 |
| OS               | Windows 11 (26200)                      |
| NestJS           | 12.0.1 (common, core, platform-express) |
| Prisma           | 7.10.0 (`prisma`, `@prisma/client`)     |
| Driver adapter   | `@prisma/adapter-better-sqlite3` 7.10.0 |
| TypeScript       | 5.9.3                                   |
| rxjs             | 7.8.2                                   |
| reflect-metadata | 0.2.2                                   |

```
src/main.ts          bootstrap on :4000
src/app.module.ts    the only file that touches the package
src/seed.ts          6 users, 6 products
prisma/schema.prisma consumer-owned schema
prisma.config.ts     Prisma 7 config
```

---

## 3. Installation Method

```
repository ──pnpm build──> packages/nestjs/dist
           ──pnpm pack───> nest-admin-nest-admin-0.0.0.tgz
                        ──> C:\...\Temp\na-tgz2\
                             │
                             └─ npm install <tarball>  (in the playground)
```

The dependency is recorded as a file specifier, never `workspace:*`:

```json
"@nest-admin/nest-admin": "file:../na-tgz2/nest-admin-nest-admin-0.0.0.tgz"
```

`node_modules/@nest-admin` contains exactly one directory — `nest-admin`. No
private workspace package leaked into the install.

### Deviation from the brief

The brief's §4 describes installing two tarballs, `@nest-admin/nestjs` and
`@nest-admin/prisma`. That is not the architecture the repository settled on.
Phase 6 adopted a **single published package**: `core`, `prisma`, `ui`,
`cli` and `admin-ui` are all `private: true` and bundled into
`@nest-admin/nest-admin`, with Prisma reached through the `./prisma` subpath.
Per the brief's own instruction to prefer the repository's actual contract, one
tarball was installed and both entrypoints were exercised.

---

## 4. Package Tarballs Used

`nest-admin-nest-admin-0.0.0.tgz` — 388,746 bytes, 21 entries.

```
package.json  LICENSE  README.md
dist/index.js   dist/index.cjs   dist/index.d.ts   dist/index.d.cts
dist/prisma.js  dist/prisma.cjs  dist/prisma.d.ts  dist/prisma.d.cts
dist/chunk-7QVYU63E.js                       (shared ESM chunk)
dist/admin-ui/index.html
dist/admin-ui/assets/index-B-eGmkuM.js
dist/admin-ui/assets/index-CrnJo5yp.css
+ source maps
```

Verified present, per the brief's §3: compiled JavaScript (both formats),
declarations (both flavours), the Admin UI assets, package metadata, and public
dependencies only.

```json
"dependencies":     { "@prisma/get-dmmf": "7.10.0" }
"peerDependencies": { "@nestjs/common": ">=10.0.0 <13", "@nestjs/core": ">=10.0.0 <13",
                      "@prisma/client": ">=6.0.0 <9",
                      "reflect-metadata": "^0.1.13 || ^0.2.0", "rxjs": "^7.0.0" }
```

No `@nest-admin/*` dependency — the private packages are inlined, not required.

---

## 5. Database Setup

SQLite via the better-sqlite3 driver adapter, with a consumer-owned schema
written for this test rather than copied from the repository's fixtures:

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  age       Int?
  active    Boolean  @default(true)
  role      Role     @default(MEMBER)
  createdAt DateTime @default(now())
}

model Product {
  id        String   @id @default(cuid())
  name      String
  price     Float
  stock     Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
}

enum Role { MEMBER  EDITOR  ADMIN }
```

Seeded with 6 users (ages 29–61, mixed roles, one inactive) and 6 products. The
age spread makes sort assertions falsifiable rather than decorative.

---

## 6. Authentication Setup

Host-supplied, as designed — no Passport, JWT, sessions or OAuth. The playground
reads a header and the package never learns it exists:

```ts
const auth: AdminAuth = {
  authorize(context) {
    const header = context.request.headers['x-playground-user']
    if (!header) throw new UnauthorizedError()
    const user = USERS[String(header)]
    if (!user) throw new ForbiddenError()
    return { id: user.id, roles: user.roles }
  },
}
```

| Request    | Result             |
| ---------- | ------------------ |
| no header  | `401 UNAUTHORIZED` |
| `ghost`    | `403 FORBIDDEN`    |
| `readonly` | `200`, restricted  |
| `admin`    | `200`, full access |

The 401/403 split behaves correctly: absent credential and rejected credential
are distinguishable by the client without either message revealing why.

---

## 7. Resource Authorization Setup

```ts
const resourceAuth: AdminResourceAuth = {
  can({ principal, action }) {
    if (principal.roles.includes('admin')) return true
    return action === 'metadata' || action === 'list' || action === 'read'
  },
}
```

**The adapter is not reached when a request is denied.** Demonstrated rather
than asserted: `PATCH /admin/User/x` and `DELETE /admin/User/x` as `readonly`
return `403`, not `404`, for an id that does not exist. Had authorization run
after the lookup, a missing record would have produced `404` first.

---

## 8. Manual Browser Tests

### What was actually done — stated plainly

**No real browser was opened. I cannot open one in this environment.** The brief
asks for a visual check, and that part is genuinely untested: I have verified no
CSS, no layout, no paint, no responsive behaviour, and nothing about how the
admin _looks_. A human should spend five minutes in Chrome before release.

What I did instead is the strongest available substitute, and it is stronger
than an HTTP-only test: **the real, shipped UI bundle was fetched over HTTP from
the running consumer and executed in jsdom against the live server.** Not the
repository's source, not a Vite dev server — the exact
`dist/admin-ui/assets/index-B-eGmkuM.js` the tarball contains, served by the
package. Every fetch below is a genuine request the bundle chose to make.

The bundle is self-contained (no imports, no exports, no `import.meta`), so it
runs as a classic script; the shell's `<script type="module">` was re-injected
after parse. The browser would carry a session cookie, so the fetch shim
supplies the playground's header instead.

This covers behaviour, routing, data binding and error handling. It does not
cover appearance.

### Boot and metadata

| Check                         | Result                     |
| ----------------------------- | -------------------------- |
| SPA shell loads at `/admin`   | `200 text/html`            |
| bundle executes, React mounts | mounted, `#root` populated |
| **console errors/warnings**   | **none**                   |
| first request the UI makes    | `GET /admin/meta`          |
| nav rendered from metadata    | `#/` `#/User` `#/Product`  |
| ORM vocabulary in the UI      | none                       |

The nav is built from `/admin/meta`; no schema information is hard-coded in the
playground.

### Unauthenticated

`GET /admin/meta → 401`, and the UI renders a dedicated screen:

> **Not signed in** — Sign in to the application, then reload this page.

It does not crash, does not retry, and does not attempt to load lists. Correct
behaviour for host-supplied auth: it tells the user to authenticate with the
host rather than inventing a login form.

### User — full CRUD through the UI

| Item                           | Evidence                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| list renders                   | 6 rows                                                                                                                |
| **columns come from metadata** | `id, email, name, age, active, role`                                                                                  |
| sort control                   | built from fields — 14 options, asc/desc per field                                                                    |
| filter control                 | built from fields                                                                                                     |
| pagination                     | `Previous` / `Next`; `GET /admin/User?page=1&perPage=25`                                                              |
| read                           | row click → `#/User/<id>` → `GET /admin/User/<id> → 200`                                                              |
| field kinds rendered           | `string · generated`, `number`, `boolean → Yes`, `enum`, `datetime · generated`                                       |
| create                         | `New User` → form → `POST /admin/User → 201` → navigates to the new record                                            |
| create form                    | required markers on `email`/`name`, enum `<select>` with `MEMBER/EDITOR/ADMIN`, **generated fields correctly absent** |
| update                         | `Edit` → prefilled → `PATCH → 200` → detail shows `UI Edited`                                                         |
| delete                         | `Delete` → `DELETE → 200` → returns to the list                                                                       |

Observed call sequence for the edit/delete lifecycle:

```
GET    /admin/meta                 200
GET    /admin/User?page=1&perPage=25  200
GET    /admin/User/<id>            200
PATCH  /admin/User/<id>            200
GET    /admin/User/<id>            200
DELETE /admin/User/<id>            200
GET    /admin/User?page=1&perPage=25  200
```

### Product — same behaviour, different shape

Columns `id, name, price, stock, active, createdAt`; create, edit
(`PATCH → 200`) and delete (`DELETE → 200`) all work. The second resource
confirms the UI is genuinely metadata-driven and not accidentally shaped around
`User`.

Incidental: typing a non-numeric value into `price` prevented submission — the
form respects the field's declared kind.

### Readonly principal in the UI

Writes are correctly refused by the server and the UI degrades gracefully:

```
POST /admin/User → 403
```

> **No access** — Your account does not have access to this resource.

The form stays open with the user's input preserved. No crash, no console
error, no data loss.

**But the buttons are offered in the first place** — see §13.

---

## 9. API Tests

All against the packed install, on a freshly seeded database.

**Authentication**

| Case         | Result             |
| ------------ | ------------------ |
| no header    | `401 UNAUTHORIZED` |
| unknown user | `403 FORBIDDEN`    |
| valid user   | `200`              |

**Metadata**

```
models        User, Product
User fields   id, email, name, age, active, role, createdAt
role enum     MEMBER | EDITOR | ADMIN
field keys    name, kind, isId, isRequired, isUnique, isList,
              isGenerated, defaultValue, enumValues
```

No `prisma`, `dmmf`, `@db.` or `scalar` anywhere in the payload — the metadata
contract is ORM-neutral in practice, not just by intent.

**Query semantics** — assertions on returned data, not just status codes:

| Query                    | Result                     |
| ------------------------ | -------------------------- |
| `GET /admin/User`        | 6 of 6                     |
| `?sort=age:desc`         | first = Barbara Liskov, 61 |
| `?sort=age:asc`          | first = Linus Torvalds, 29 |
| `?filter=active:eq:true` | 5                          |
| `?filter=role:eq:ADMIN`  | 2                          |
| `?filter=age:gte:40`     | 4                          |
| `?filter=age:lt:30`      | 1                          |
| `?search=Ada`            | 1                          |
| `?page=2&perPage=2`      | 2 rows, page 2, total 6    |

Enum filtering, boolean filtering, numeric comparison and null-tolerant sorting
all behave over a schema the package has never seen.

**Error mapping** — the regression surface from §13.1:

| Case                             | Result                 |
| -------------------------------- | ---------------------- |
| unknown model                    | `404 MODEL_NOT_FOUND`  |
| unknown record                   | `404 RECORD_NOT_FOUND` |
| unknown sort field               | `400 FIELD_NOT_FOUND`  |
| unknown filter field             | `400 FIELD_NOT_FOUND`  |
| unknown field in a write body    | `400 FIELD_NOT_FOUND`  |
| `?filter[a][eq]=1`               | `400 INVALID_QUERY`    |
| unknown query parameter          | `400 INVALID_QUERY`    |
| `?page=abc`                      | `400 INVALID_QUERY`    |
| `?perPage=0`                     | `400 INVALID_QUERY`    |
| 404 body leaks a filesystem path | no                     |

The unknown-parameter contract was confirmed, not changed: rejection, per
Phase 7.

**Authorization**

| Case                              | Result            |
| --------------------------------- | ----------------- |
| readonly list / read              | `200`             |
| readonly create / update / delete | `403 FORBIDDEN`   |
| admin create                      | `201`             |
| admin update                      | `200`             |
| admin delete                      | `200`, then `404` |

---

## 10. Route Collision Tests

| Request                                | Result                 |
| -------------------------------------- | ---------------------- |
| `GET /admin`                           | `200 text/html`        |
| `GET /admin/assets/index-B-eGmkuM.js`  | `200 text/javascript`  |
| `GET /admin/assets/index-CrnJo5yp.css` | `200 text/css`         |
| `GET /admin/meta`                      | `200 application/json` |
| `GET /admin/User`                      | `200 application/json` |
| `GET /admin/User/<id>`                 | `200 application/json` |

And the three failures the brief names, none of which occur:

| Must not happen                               | Observed                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/admin/assets/...` treated as model `assets` | no — a missing asset yields the UI controller's own 404 (`No admin UI asset named "nope.js"`), never `MODEL_NOT_FOUND` |
| `/admin/meta` treated as model `meta`         | no — returns the metadata document                                                                                     |
| `/admin/User` returns SPA HTML                | no — returns JSON; `/admin` returns HTML                                                                               |

The UI controller is ordered ahead of the API controller and claims only
`/admin` and `/admin/assets/*`, so the two coexist without a catch-all.

---

## 11. Package-Boundary Tests

Every module specifier the playground imports:

```
'./app.module'
'@nest-admin/nest-admin'
'@nest-admin/nest-admin/prisma'
'@nestjs/common'
'@nestjs/core'
'@prisma/adapter-better-sqlite3'
'@prisma/client'
'node:path'
```

| Check                                               | Result                                   |
| --------------------------------------------------- | ---------------------------------------- |
| imports from `@nest-admin/{core,prisma,nestjs}/src` | 0                                        |
| relative imports into the repository (`../../`)     | 0                                        |
| TypeScript `paths` aliases                          | none (`compilerOptions.paths` is absent) |
| `workspace:` dependencies                           | 0                                        |
| `@nest-admin/*` in `node_modules`                   | `nest-admin` only                        |

The playground consumes the public API exclusively.

### Declaration resolution

`tsc --noEmit` against the installed package, all four resolution modes, after
the §13.2 fix:

| `moduleResolution` | `module`   | Result |
| ------------------ | ---------- | ------ |
| `node`             | `commonjs` | OK     |
| `node16`           | `node16`   | OK     |
| `nodenext`         | `nodenext` | OK     |
| `bundler`          | `esnext`   | OK     |

The playground application itself (`moduleResolution: node`) typechecks with 0
errors.

---

## 12. Fresh-Install Simulation

Done, and it is what every result above was measured against — the playground
_is_ the external temp-directory test of the brief's §15. The automated
equivalent, `pnpm verify:package`, performs the same flow unattended:

```
pnpm build → pnpm pack → mkdtemp outside the repo → npm install <tgz>
          → boot NestJS → exercise the API → assert
```

**35/35 checks pass**, up from 19 — the 16 new checks guard the two bugs found
here (§13).

---

## 13. Problems Found

### 13.1 Every adapter-raised error returned `500` — _release-blocking_

**Symptom.** A consumer mistyping a sort field:

```
GET /admin/User?sort=nosuchfield:asc
→ 500  {"success":false,"error":{"code":"INTERNAL_ERROR",
         "message":"An internal error occurred while handling the request."}}
```

Expected `400 FIELD_NOT_FOUND` with the field named. The same applied to
`MODEL_NOT_FOUND`, `RECORD_NOT_FOUND` and `INVALID_QUERY` whenever the error
originated in the adapter — a large share of the API's error surface reduced to
an opaque 500, with the real reason visible only in the server's logs.

**Diagnosis.** The server log named the thrower:

```
FieldNotFoundError ... at findQueryableField (.../dist/prisma.cjs:371:11)
```

The package ships two CommonJS entrypoints. `dist/index.cjs` and
`dist/prisma.cjs` **each inline their own copy of Core** — both contain
`FieldNotFoundError = class`, and `prisma.cjs` requires nothing from
`index.cjs`. The exception filter lives in `index.cjs`, so

```ts
error instanceof FieldNotFoundError
```

compared an object from one class object against a _different_ class object and
answered `false`. Every branch fell through to the generic 500.

ESM is unaffected — both ESM entrypoints share `chunk-7QVYU63E.js` — but NestJS
consumers default to CJS, so the shipped default was the broken one.

**Why nothing caught it.** Every in-repo test resolves `@nest-admin/core` to a
single source module, so class identity always matches. The bug exists only
after bundling. `pnpm build`, `pnpm typecheck` and 304 tests were all green.

**Fix.** Identify errors by _value_ instead of identity. Errors carry a
`Symbol.for` brand — which duplicate copies agree on by definition — plus a
stable `kind` discriminator (a declared string, so it also survives
minification, which `name` would not):

```ts
const BRAND = Symbol.for('nest-admin.error')

export class NestAdminError extends Error {
  readonly kind: AdminErrorKind = 'unknown'
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
    // Non-enumerable, so it can never reach a serialised response body.
    Object.defineProperty(this, BRAND, { value: true, enumerable: false })
  }
}

export function isNestAdminError(value: unknown): value is NestAdminError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[BRAND] === true
  )
}
```

`mapError` switches on `error.kind` behind `isNestAdminError`. The default case
still returns the generic 500, so the message allowlist is preserved — an
`AdapterError` wrapping a raw ORM failure still must not reach the client. No
constructor signature changed, so subclasses such as
`PrismaSchemaNotFoundError` are unaffected; lacking a `kind` of their own they
inherit `'unknown'` and are treated as internal, which is correct.

**Regression test.** `packages/nestjs/test/error-identity.test.ts`, 13 tests.
It builds a genuinely separate instance of Core's error module:

```ts
const secondCopy = await import(`${errorsModule}?duplicate-core-copy`)
```

then asserts the fixture is real (distinct class objects, `instanceof` fails,
the brand still matches) and that all six kinds map to the right status when
thrown from the foreign copy — plus that `AdapterError` and unbranded errors
still yield safe 500s that leak neither paths nor ORM detail, and that the
brand is non-enumerable.

Guarded at the packaged level too, which is the only level where the bug can
occur: `verify:package` now asserts the error _code_, not just the status, for
unknown sort field, unknown filter field, unknown model and missing record.

### 13.2 CJS consumers could not typecheck the package — _release-blocking_

**Symptom.** A consumer with `moduleResolution: node16`, `module: node16`:

```
error TS1479: The current file is a CommonJS module whose imports will produce
'require' calls; however, the referenced file is an ECMAScript module and
cannot be imported with 'require'.
```

Both entrypoints, at compile time. Runtime was fine — `index.cjs` exists and
loads — so this is purely a declaration-mapping defect, and it would have hit a
common, modern NestJS configuration.

**Diagnosis.** The package is `"type": "module"`, which makes `.d.ts` an _ESM_
declaration file. The `exports` map offered a single `types` for both
conditions:

```json
".": {
  "types":   "./dist/index.d.ts",   ← ESM declarations, handed to CJS too
  "import":  "./dist/index.js",
  "require": "./dist/index.cjs"
}
```

Correct `.d.cts` declarations were already being built and shipped — they were
simply never referenced.

**Fix.** Nest `types` inside each condition so resolution matches the format:

```json
".": {
  "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
  "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
}
```

Same for `./prisma`. No build change — the files already existed. Legacy
`moduleResolution: node` consumers are unaffected: they ignore `exports` and
continue through `typesVersions`, which still resolves the `./prisma` subpath.

**Regression test.** `verify:package` now asserts, against the _installed_
package, that every subpath's `require` condition resolves to `.d.cts`, its
`import` condition to `.d.ts`, and that all four referenced files exist on
disk — 12 checks.

### 13.3 Not bugs — ruled out

Two failures during testing were mine, not the package's: a harness that looked
up form inputs by `name`/`id` (these fields carry neither) and one that wrote a
string into a numeric input. Both were harness defects; the package behaved
correctly in each case, and the second demonstrated correct client-side type
enforcement. Recorded here because the brief asks that failures be classified
rather than silently fixed.

---

## 14. Bugs Fixed

| #   | Bug                                 | Severity         | Files                                                                                                              |
| --- | ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Adapter-raised errors mapped to 500 | release-blocking | `packages/core/src/errors/errors.ts`, `packages/core/src/index.ts`, `packages/nestjs/src/http/exception.filter.ts` |
| 2   | CJS declaration resolution (TS1479) | release-blocking | `packages/nestjs/package.json`                                                                                     |

Both were reproduced in a real consumer before any source was touched, both
have regression tests at the level where they actually manifest, and both were
re-verified against a freshly built and repacked tarball. No speculative
changes were made.

---

## 15. Known Limitations

**Not tested at all**

- **Visual appearance.** No browser was opened; see §8. CSS, layout, contrast,
  responsive behaviour and print are unverified. A human should look.
- **Keyboard navigation, focus order, screen readers.** jsdom does not model
  focus or the accessibility tree usefully.
- **Concurrency, load, large datasets.** The largest table held 7 rows.
- **Databases other than SQLite.** PostgreSQL and MySQL are untested by a real
  consumer; only the driver-adapter path is exercised.
- **Relations.** The playground schema is deliberately flat, so relation
  rendering and relation filtering are unexercised here.

**Found, working as designed, but worth naming**

- **`/admin/meta` is identical for every principal.** Byte-for-byte identical
  for `admin` and `readonly`. The metadata document carries no permission
  information at all — model entries expose only `name`, `primaryKey` and
  `fields` — so the UI cannot know that `readonly` may not write, and offers
  `New User`, `Edit` and `Delete` to a principal who will always be refused.

  This is **not a security hole**: the server enforces correctly (§9), the
  adapter is never reached (§7), and the UI handles the 403 gracefully with a
  clear message and preserved input (§8). It is a UX gap, and it is a gap in
  the _metadata contract_, not a UI bug — the UI is rendering everything it is
  given.

  Closing it means adding permission data to the metadata response and honouring
  it in the UI. That is feature work, explicitly out of scope for this phase
  (the brief's §17 rules out field- and row-level permissions), so it is
  reported rather than implemented. It belongs in the phase that takes up
  metadata filtering by principal.

- **Bundle duplication remains.** §13.1 fixed the _consequence_, not the cause:
  `index.cjs` and `prisma.cjs` still each inline a copy of Core. Any future
  cross-entrypoint identity comparison — `instanceof`, a module-level `Map`, a
  `Symbol()` registry, a singleton counter — will break the same way. The
  branded-error pattern is the guard; a shared CJS chunk would be the cure.
  Worth a deliberate decision before the surface grows.

---

## 16. Final Acceptance Result

```
Consumer package install:      PASS
Packed package runtime:        PASS
NestJS startup:                PASS
/admin SPA:                    PASS
/admin/meta:                   PASS
Authentication:                PASS
Resource authorization:        PASS
User CRUD:                     PASS
Product CRUD:                  PASS
Search:                        PASS
Sort:                          PASS
Filter:                        PASS
Pagination:                    PASS
Bracket syntax rejection:      PASS
Route collision:               PASS
Package boundary:              PASS
External temp-directory test:  PASS
```

Every line above passes against the _fixed_ build, installed from a tarball
outside the repository. Two lines would have failed against the build this
phase started with.

**Validation**

|                       |                                   |
| --------------------- | --------------------------------- |
| Tests before          | 304 across 13 files               |
| Tests after           | **317 across 14 files** (+13)     |
| `pnpm build`          | 0                                 |
| `pnpm typecheck`      | 0                                 |
| `pnpm format:check`   | 0                                 |
| `pnpm verify:package` | **35/35** (was 19/19)             |
| `pnpm lint`           | no such script in this repository |

**Files changed**

```
packages/core/src/errors/errors.ts          branded errors + kind discriminator
packages/core/src/index.ts                  export isNestAdminError, AdminErrorKind
packages/nestjs/src/http/exception.filter.ts  switch on kind, not instanceof
packages/nestjs/package.json                condition-nested types in exports
packages/nestjs/test/error-identity.test.ts new — 13 regression tests
scripts/verify-packed-consumer.mjs          +16 checks
reports/009-consumer-acceptance.md          this report
```

No playground files are committed. The working tree is clean after the commit,
and no commit in this repository carries a `Co-authored-by:` trailer or any
other AI attribution.

---

## 17. Is the package safe to proceed to release preparation?

**Yes — based on actual consumer usage, not on a green workspace build.**

The evidence: the package installs from a tarball into a clean external NestJS
application, discovers a schema it has never seen, serves its own UI, and
performs correct authenticated, authorized CRUD with correct query semantics
and correct error codes. Its declarations resolve under every TypeScript
resolution mode. It pulls in no private workspace package. The UI is genuinely
metadata-driven — proven by two differently-shaped resources — and it degrades
gracefully when the server refuses it.

That confidence is worth more than it was a day ago precisely because this
phase found two release-blocking bugs. Both lived exactly where the workspace
cannot see: in the shape of the built artifact. Shipping 0.1.0 without this
exercise would have shipped an admin API that answered `500` to ordinary user
mistakes, and a package a large class of TypeScript consumers could not compile
against.

Two qualifications, neither blocking:

1. **Have a human open a browser.** Behaviour is well covered; appearance is not
   covered at all. It is a five-minute check and I cannot do it.
2. **Decide on the metadata-permission gap (§15) before or during 0.1.0.** It is
   a UX wart, not a vulnerability — but "the admin shows me buttons that always
   fail" is the kind of thing an early adopter files on day one. Either close it
   or document it as known.

Recommended next step: Phase 8 / release preparation, beginning with the human
browser pass.

Stopping here, per the brief.
