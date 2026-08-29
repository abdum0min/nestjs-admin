# Architecture

## The one rule

```text
                    +--------------+
                    |     Core     |
                    +------^-------+
                           |
                 +---------+---------+
                 |                   |
          Prisma Adapter       NestJS Adapter
                 |                   |
                 +---------+---------+
                           |
                          CLI
```

Dependencies point **inward**. Core knows nothing about Prisma, NestJS, HTTP or
React. Everything else knows about Core.

The MVP supports one ORM, but the seam is real from day one, because
retrofitting an abstraction after Prisma types have leaked into controllers and
UI code is the expensive kind of mistake.

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

The NestJS integration: `AdminModule`, the admin controllers, the static
handler for the SPA, runtime configuration. It also happens to be the single
package published to npm (see publishing.md).

Its `src/` imports Core only. The Prisma adapter is reachable through the
`./prisma` subpath, so an application that never uses Prisma never loads Prisma
code, and a future `./typeorm` subpath slots in without touching the root
export.

### packages/cli

`nest-admin init` and friends. Detects the consuming project, writes
configuration, prints the module wiring snippet. Depends on the public APIs it
needs and nothing more.

Not implemented, and no `bin` is declared anywhere until it is.

### packages/ui

Reusable React components, added when a real screen needs one. React is a peer
dependency; two React copies break hooks.

### apps/admin-ui

The SPA. React + TypeScript + Vite, built to static assets, served by the
developer's own NestJS process under `/admin`. No separate deployment, no
Next.js server.

It talks to the admin HTTP API and receives model metadata plus records. It
must never learn which ORM is behind that API. That is what makes adding a
second adapter a backend-only change.

### examples/basic

The reference consumer: a real NestJS + Prisma project with the `User` and
`Product` schema. It is the acceptance test for the MVP.

## How they will communicate

```text
schema.prisma
    |  (build time) prisma generate
    v
generated Prisma Client --DMMF--> PrismaAdapter
                                       |  implements OrmAdapter
                                       v
                                     Core
                                       |  generic CRUD engine
                                       v
                               AdminModule (NestJS)
                                       |  HTTP: metadata + records
                                       v
                                Admin UI (React SPA)
```

The HTTP layer is the second seam. Two endpoint families are anticipated:

- **metadata** - the resources and their fields, so the UI can render tables
  and forms generically
- **records** - list / read / create / update / delete per resource

Both speak Core vocabulary (`ModelMetadata`, `ListQuery`, `Page`). Neither
exposes an ORM concept.

## Open decisions

Deliberately unresolved, and worth settling early in the implementation phase.

### SPA base path is fixed at build time

`vite.config.ts` sets `base: '/admin/'`. A developer who configures
`path: '/backoffice'` gets broken asset URLs. Options: inject a `<base href>`
into the served `index.html` from the NestJS static handler and drive the
router basename from it; or emit relative asset URLs. The first is more robust
with client-side routing under nested paths.

### Reading model metadata from Prisma

The largest technical risk in the MVP, investigated against a real generated
client during setup. Prisma 7 does not expose the metadata the admin needs
through any public API: the embedded `runtimeDataModel` is private and too
lossy to even identify a primary key, and `DMMF` is type-only in the new
generator. Options and a recommendation are in
[prisma-metadata.md](prisma-metadata.md). Settle this first.

Related: Prisma 7 builds clients from driver adapters, so the Nest Admin
Prisma adapter must accept an already-constructed `PrismaClient` and never
construct one itself.

### Static serving without a new dependency

`@nestjs/serve-static` is the obvious choice but adds a dependency and a peer
matrix. A small controller or middleware over the bundled asset directory is
likely enough and keeps the published package lean. Decide before wiring.

### Facade and integration share a directory

`packages/nestjs` is both the NestJS integration layer and the published
package. If that coupling starts to hurt, for example when a non-Nest host is
added, extract a dedicated facade package. The export map is already shaped
for it.
