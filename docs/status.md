# Status: what exists and what does not

Kept honest on purpose. If you are looking for working functionality, this page
is the answer.

**0.11.0.** 936 tests across 52 files, run against real SQLite, a real NestJS
HTTP server and the built interface in jsdom. 56 packed-package checks. Nothing
published to npm.

---

## Implemented

### The engine

| Thing                                                                                     | Where                        |
| ----------------------------------------------------------------------------------------- | ---------------------------- |
| Core contracts: `ModelMetadata`, `OrmAdapter`, `ListQuery`, `Page`, the error vocabulary  | `packages/core/src`          |
| Import-boundary checks, mechanically enforced                                             | `tests/boundaries.test.ts`   |
| **Prisma adapter**: metadata from DMMF, CRUD, relations, constraint mapping               | `packages/prisma/src`        |
| **Drizzle adapter**: metadata from the schema module, CRUD, relations, constraint mapping | `packages/drizzle/src`       |
| Prisma version gate, failing open when undetectable                                       | `packages/prisma/src/client` |
| Pagination, sorting, filtering and search with schema-directed coercion                   | each adapter's `query/`      |

### The HTTP layer

| Thing                                                                                    | Where                           |
| ---------------------------------------------------------------------------------------- | ------------------------------- |
| `AdminModule.forRoot` and `forRootAsync`, with structural options refused in the factory | `packages/nestjs/src/module.ts` |
| Generic admin API: `GET /admin/meta` + REST CRUD under `/admin/:model`                   | `packages/nestjs/src/admin`     |
| Nested relation routes: list, attach, detach                                             | `packages/nestjs/src/admin`     |
| Bulk delete, with both halves of a partial result reported                               | `packages/nestjs/src/admin`     |
| Query parsing into `ListQuery`, with type-directed coercion and validation               | `packages/nestjs/src/http`      |
| Response envelope and centralised error mapping; no ORM message escapes                  | `packages/nestjs/src/http`      |
| A configurable mount path, with the built bundle rewritten to match                      | `packages/nestjs/src/ui`        |
| `GET /admin/dashboard`, generated or declared, authorized before it queries              | `packages/nestjs/src/dashboard` |

### Authentication and authorization

| Thing                                                                              | Where                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `AdminAuth`: required, host-supplied, protects every route including `/admin/meta` | `packages/nestjs/src/auth`                           |
| 401 and 403 as distinct outcomes, rendered differently                             | `packages/core/src/errors`                           |
| `AdminResourceAuth`: per model, per operation, enforced in one place               | `packages/nestjs/src/auth/resource.ts`               |
| Metadata filtering: `/admin/meta` describes only what this principal may see       | `packages/nestjs/src/admin/service.ts`               |
| `builtInAuth()`: login page, scrypt, signed session cookie, rate limiting          | `packages/nestjs/src/auth`                           |
| `AdminAccountStore`, and a Prisma implementation of it                             | `packages/core/src/auth`, `packages/prisma/src/auth` |

### Configuration and extension

| Thing                                                              | Where                             |
| ------------------------------------------------------------------ | --------------------------------- |
| Resource include/exclude                                           | `packages/core/src/config`        |
| Per-model: label, display field, icon, order                       | `packages/core/src/config`        |
| Per-field: hidden, read-only, write-only, label, widget, order     | `packages/core/src/config`        |
| Hooks around every write                                           | `packages/nestjs/src/hooks`       |
| Actions declared on the server and drawn from metadata             | `packages/nestjs/src/actions`     |
| Theming from one brand colour, with contrast corrected per palette | `packages/nestjs/src/ui/theme.ts` |

### The interface

| Thing                                                                            | Where                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| Metadata-driven: shell, navigation, list, search, sort, filter, pagination, CRUD | `packages/admin-ui/src`                         |
| Relation pickers, related lists, attach and detach                               | `packages/admin-ui/src`                         |
| Design system on Tailwind v4 with vendored shadcn, light and dark                | `packages/admin-ui/src/index.css`               |
| Contrast measured programmatically against WCAG floors                           | `packages/admin-ui/test/contrast.test.ts`       |
| Dashboard, with a chart drawn in SVG rather than by a library                    | `packages/admin-ui/src/components`              |
| Login page, user menu, sign-out                                                  | `packages/admin-ui/src/components`              |
| Rows-per-page, remembered per browser                                            | `packages/admin-ui/src/hooks`                   |
| Keyboard reachable throughout, with a skip link and focus restoration            | `packages/admin-ui/test/accessibility.test.tsx` |

### Packaging

| Thing                                                      | Where                                |
| ---------------------------------------------------------- | ------------------------------------ |
| One published package, everything else bundled into it     | `docs/publishing.md`                 |
| Two adapter subpaths, `./prisma` and `./drizzle`           | `packages/nestjs/package.json`       |
| The interface served by the package, inside the tarball    | `packages/nestjs/src/ui`             |
| Packed-package verification against a throwaway consumer   | `scripts/verify-packed-consumer.mjs` |
| A reference consumer wired through the public package only | `examples/basic`                     |

---

## Not implemented

Grouped by whether it is planned.

### Planned before 1.0

- **Row-level authorization.** You can refuse `Order`; you cannot yet refuse
  _someone else's_ orders. This is API-shaped, and 1.0 freezes APIs.
- **Composite primary keys.** Represented in metadata, listed correctly,
  refused by `findOne` — `RecordId` is a single value.
- **Navigation grouping, saved views, per-model list presentation** — the 0.11
  customisation set, still to come.
- **`nest-admin init`** and every other CLI command. No `bin` is declared
  anywhere until one works.
- **A documentation site and a live demo.**
- **Publishing.** The npm scope is not yet claimed and the manifest has no
  `repository` field.

### Deliberately absent

- **Field-level permissions.** Per-model and per-field visibility exist;
  per-principal field rules do not.
- **RBAC, roles, a permission store or a policy DSL.** The host owns that
  decision; `AdminResourceAuth` is where it plugs in.
- **Your own React components, custom pages, a plugin system.** All three would
  mean the consuming application runs a front-end build, which is the thing this
  package exists to avoid.
- **Uploads, rich text, audit logs, webhooks, multi-tenancy, SaaS features.**
- **SSR, or a Next.js admin application.**
- **Nested relation writes** — creating a parent and its children in one form.
- **MySQL through Drizzle.** Refused at startup with a reason: no `RETURNING`,
  so a write could not report the stored row. Prisma's MySQL support is
  unaffected.
- **TypeORM and MikroORM adapters.** The contract now has two implementations
  and [adapters.md](adapters.md) describes writing a third; nobody has.

---

## Metadata strategy

Prisma: `@prisma/get-dmmf`, confined to one module, with a custom generator as
the long-term successor. Decided in [prisma-metadata.md](prisma-metadata.md).
Multi-file schemas are supported natively.

Drizzle: the schema module object itself, read the way Drizzle Kit reads it.
There is no generated artefact and nothing to keep in step.
