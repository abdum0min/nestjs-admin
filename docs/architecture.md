# Architecture

## The one rule

```text
                        +--------------+
                        |     Core     |
                        +------^-------+
                               |
              +----------------+----------------+
              |                |                |
      Prisma adapter    Drizzle adapter    NestJS integration
              |                |                |
              +----------------+--------+-------+
                                        |
                                   Admin UI
```

Dependencies point **inward**. Core knows nothing about any ORM, about NestJS,
about HTTP or about React. Everything else knows about Core.

The seam was real from day one with one ORM behind it, because retrofitting an
abstraction after Prisma types have leaked into controllers and UI code is the
expensive kind of mistake. Since 0.11.0 there are two, and the seam has been
measured rather than assumed: adding Drizzle changed nothing in Core, in the
HTTP layer or in the interface. See [adapters.md](adapters.md).

Every one of those arrows is asserted by
[`tests/boundaries.test.ts`](../tests/boundaries.test.ts), which reads the
imports of every source file and fails the build when one crosses a line.

## Components

### packages/core

The ORM-agnostic engine. Currently contracts only:

- `ModelMetadata` / `FieldMetadata` - the normalised schema description every
  adapter must produce
- `OrmAdapter` - the single seam between Nest Admin and any ORM
- `ListQuery` / `Page` - the query and pagination vocabulary
- `NestAdminConfig` - type direction for `nest-admin.config.ts`
- `NestAdminError` - base error type

Zero runtime dependencies. Must never import Prisma or NestJS.

Later it will also hold the resource registry and the generic CRUD engine: the
code that turns "list model X with query Q" into adapter calls, applies
resource include/exclude, and normalises errors.

### packages/prisma

One job: implement `OrmAdapter`. Read the generated client DMMF, map Prisma
models to `ModelMetadata`, resolve model names to client delegates, translate
`ListQuery` into `findMany` arguments, run CRUD.

`@prisma/client` is a peer dependency. The consuming application owns the
generated client; a bundled copy would have no schema attached to it.

### packages/nestjs

The NestJS integration and the single package published to npm (see
publishing.md).

Implemented: `AdminModule.forRoot({ adapter, auth })`, one generic admin
controller serving every model under `/admin`, HTTP query parsing into Core's
`ListQuery`, a public metadata DTO, a shared response envelope, a centralised
exception filter mapping Core errors to status codes, and a host-supplied
authentication boundary protecting every route. The full contract is in the
package README.

Not implemented: serving the SPA, resource-level permissions, runtime
configuration.

#### The authentication boundary

```text
Host application  ──supplies AdminAuth──▶  AdminAuthGuard  (@UseGuards, controller-scoped)
                                                │  allow / UnauthorizedError / ForbiddenError
                                                ▼
                                        AdminController  →  AdminService  →  OrmAdapter
```

Nest Admin never authenticates anyone. The consuming application already owns
identity; the framework owns only the decision point. `auth` is a **required**
module option, so an admin API is never public by accident - the explicit
`unsafeAllowAllRequests()` escape hatch exists for local development and warns
at startup.

#### The resource authorization boundary

```text
Host application  ──supplies AdminResourceAuth──▶  AdminService  (the single enforcement point)
                                                        │
                            ┌───────────────────────────┴───────────────────────────┐
                            │                                                       │
                    operation 'metadata'                                   any other operation
                    denied ⇒ model omitted from                          denied ⇒ 403 FORBIDDEN,
                    GET /admin/meta                                      adapter never called
```

Two separate questions, two separate contracts: `AdminAuth` answers _may this
request enter the admin?_, `AdminResourceAuth` answers _may this principal touch
this model, for this operation?_. Resource authorization lives in
`AdminService` rather than in a guard because `/admin/meta` has no `:model`
segment - route-level checks cannot filter a document. `resourceAuth` is
optional and defaults to permitting every model, which is not a hole: `auth` is
still required, so the door is already shut.

Its `src/` imports Core only. The Prisma adapter is reachable through the
`./prisma` subpath, so an application that never uses Prisma never loads Prisma
code, and a future `./typeorm` subpath slots in without touching the root
export.

### packages/drizzle

The same job, against a genuinely different ORM: a query builder with no
generated client, no schema file to read and no normalised errors. Metadata
comes from the schema module object itself, relations from `relations()` or
from foreign keys, and constraint violations from whatever the driver threw.

`drizzle-orm` is a peer dependency, for the reason `@prisma/client` is: the
consuming application owns the instance, and a bundled second copy would produce
table objects that fail every identity check.

It exists to keep the contract honest. Details, and the full comparison with the
Prisma adapter, are in [adapters.md](adapters.md).

### packages/cli

`nest-admin init` and friends. Detects the consuming project, writes
configuration, prints the module wiring snippet. Depends on the public APIs it
needs and nothing more.

Not implemented, and no `bin` is declared anywhere until it is.

### packages/admin-ui

The SPA. React + TypeScript + Vite, built to static assets, served by the
developer's own NestJS process under `/admin`. No separate deployment, no
Next.js server.

It talks to the admin HTTP API and receives model metadata plus records. It
must never learn which ORM is behind that API. That is what makes adding a
second adapter a backend-only change.

Entirely generic: navigation, list, search, sort,
filter, pagination, create, read, update and delete are one set of components
driven by `GET /admin/meta`. No model or field name appears in the source, so a
schema change needs no UI change, and a model hidden by resource authorization
disappears because it is absent from metadata - the UI does no filtering of its
own. It restates the wire types by hand rather than importing Core, so the
dependency runs UI -> HTTP -> NestJS -> Core, never UI -> Core.

Routing is hash-based (`#/User/u1`). The API owns the same path space the app is
mounted in, so a path route would be answered by the record controller - and it
is what makes serving the SPA need no fallback route at all.

Phase 7 made the package serve it. `AdminUiController` binds exactly two paths,
`/admin` and `/admin/assets/:file`, and is listed **before** `AdminController`,
so `assets` can never be read as a model name while everything else falls
through to the API. The UI is copied into `packages/nestjs/dist/admin-ui` at
build time and ships inside the published tarball.

The UI controller carries **no** auth guard, deliberately: it returns a static
shell and bundle that contain no records, no schema and no configuration. Every
route that can return data stays guarded, so an unauthenticated visitor loads
the shell, its first API call is refused, and the UI shows a signed-out state.

A component package was removed in 0.11.0 rather than filled in. Its contents
were only ever going to be the components this SPA already has - vendored from
shadcn, bundled into one artefact, with no second consumer to extract them for.

### examples/basic

The reference consumer: a real NestJS + Prisma application with an eleven-model
schema, three self-relations, two many-to-many relations and a join table with
payload. Every release is verified against it, installed from a packed tarball
rather than from the workspace.

## How they communicate

```text
schema.prisma                     schema.ts
     |                                 |
     |  prisma generate                |  (nothing - it is already TypeScript)
     v                                 v
generated client --DMMF-->  PrismaAdapter    DrizzleAdapter  <--table objects
                                   |               |
                                   +-------+-------+
                                           |  both implement OrmAdapter
                                           v
                                         Core
                                           |
                                    AdminModule (NestJS)
                                           |  HTTP: metadata + records
                                           v
                                    Admin UI (React SPA)
```

The HTTP layer is the second seam, and it carries three endpoint families:

- **metadata** - `GET /admin/meta`: the resources and their fields, so the
  interface renders tables and forms generically
- **records** - list / read / create / update / delete per resource, plus the
  nested relation routes
- **dashboard** - `GET /admin/dashboard`: a document of widgets, each already
  resolved to data

All three speak Core vocabulary (`ModelMetadata`, `ListQuery`, `Page`). None
exposes an ORM concept, and the interface could not tell you which ORM answered.

## Open decisions

Deliberately unresolved, and worth settling early in the implementation phase.

### SPA base path is fixed at build time - RESOLVED

The mount path is a runtime option and the bundle is built once, so the two
could not agree. Settled in 0.2.0: Vite builds against the placeholder
`/__nest-admin-base__/`, and the controller rewrites it to the configured mount
path as it serves `index.html`, alongside a `window.__NEST_ADMIN_BASE__` the
client reads. A developer who configures `path: '/backoffice'` gets working
asset URLs without a second build.

### Reading model metadata from Prisma - RESOLVED

Was the largest technical risk. Settled by the Phase 1 spike: metadata comes
from `@prisma/get-dmmf`, confined to one module in `packages/prisma`, with a
custom Prisma generator as the long-term successor. Summary in
[prisma-metadata.md](prisma-metadata.md).

Related: Prisma 7 builds clients from driver adapters, so the Nest Admin
Prisma adapter must accept an already-constructed `PrismaClient` and never
construct one itself.

### Static serving without a new dependency - RESOLVED

No dependency. `AdminUiController` binds exactly two paths and is declared
before `AdminController`, so `assets` can never be read as a model name. The
published package still has one runtime dependency in total.

### Row-level authorization does not exist

`AdminResourceAuth` answers per model and per operation. It cannot yet express
"only their own orders", which is the shape most real deployments need. This is
API-shaped work and 1.0 freezes APIs, so it belongs before the freeze rather
than after it.

### Composite primary keys can be listed but not addressed

`RecordId` is a single value, so a model whose key is two columns appears in
the admin and refuses `findOne`. It surfaced while writing the second adapter;
Prisma had the same limitation and it had simply never been hit.

### Facade and integration share a directory

`packages/nestjs` is both the NestJS integration layer and the published
package. If that coupling starts to hurt, for example when a non-Nest host is
added, extract a dedicated facade package. The export map is already shaped
for it.
