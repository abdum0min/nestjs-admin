# Changelog

Notable changes to `@nest-admin/nestjs`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, the public API may change in any release. Every
breaking change is listed below with what to do about it.

Nothing has been published to npm yet. Versions here are development milestones;
the first publish is planned for `1.0.0`. See [docs/roadmap.md](docs/roadmap.md).

---

## 0.2.0

Configuration and dependency injection. The admin now fits an application it
did not have to be built around.

### Added

- **`AdminModule.forRootAsync`** — the adapter and the auth policy resolved
  through DI, with `useFactory`, `useClass` or `useExisting`.

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

  `forRoot` is unchanged. Previously the client had to exist where the module
  was declared, which meant constructing it at import time — before
  configuration was available and outside the application's own lifecycle.

- **`path`** mounts the admin somewhere other than `/admin`, including nested
  (`/internal/admin`). The API and the UI move together, and the served page is
  rewritten to match: asset URLs point at the new path, and the base is handed
  to the browser. It is rejected if empty or `/` — the routes end in `:model`,
  so at the root they would capture every unmatched request in the application.

  It sits on the options object rather than in the async factory, because routes
  are registered before any provider exists.

- **`resources`** with `include` / `exclude` chooses which models the admin
  exposes at all. Structural rather than per-principal, so an excluded model
  answers 404, not 403 — it is not part of the admin. A name matching no model
  fails at startup: a typo in `exclude` would otherwise leave the model exposed.

### Changed

- **Model existence is checked before the resource policy** on every operation.
  An unknown or excluded model now answers 404 where a denying policy would
  previously have answered 403 first. A model that is not part of the admin
  should not look like one the caller merely lacks access to.
- `create`, `update` and `delete` validate the model name. Previously only
  `list` did, so an unknown model reached the adapter on those routes.
- ESM consumers get **one copy of the framework core** instead of one per
  entrypoint. The Prisma package no longer inlines Core, so the published build
  can share it. CommonJS still carries a copy per entrypoint — esbuild does not
  code-split CJS — which is why framework errors are identified by a brand
  rather than by `instanceof`.

### Fixed

- Two remaining `instanceof` checks on framework errors, in the Prisma adapter
  and the resource-policy path, replaced with the brand check. Same defect class
  as the 500-instead-of-400 bug found in 0.0.0; these had not yet caused one.

---

## 0.1.0

The first tagged milestone. Everything before it is recorded in `reports/`.

### Changed

- **The package is now `@nest-admin/nestjs`**, renamed from
  `@nest-admin/nest-admin`. The Prisma adapter moves with it, to
  `@nest-admin/nestjs/prisma`.

  ```diff
  -import { AdminModule } from '@nest-admin/nest-admin'
  -import { PrismaAdapter } from '@nest-admin/nest-admin/prisma'
  +import { AdminModule } from '@nest-admin/nestjs'
  +import { PrismaAdapter } from '@nest-admin/nestjs/prisma'
  ```

  The old name repeated itself and left no room for adapter packages alongside
  it. Nothing is installed from npm yet, so this costs nobody a migration.

- `pnpm typecheck` and `pnpm test` now run `pnpm prisma:setup` first. It is a
  no-op when nothing has changed.

### Added

- **`pnpm prisma:setup`** generates every Prisma client and fixture database the
  repository needs. These are git-ignored, and nothing produced them, so a fresh
  clone could not typecheck or test — the step existed only in one working copy.
- **Continuous integration** — format, build, typecheck and test on Node 20.11,
  22 and 24 on Linux and on Node 24 on Windows, plus the packed-consumer
  verification. The suite and the packaging check both existed already; nothing
  ran them automatically.
- `isNestAdminError` and the `AdminErrorKind` type are exported from the package.
  Errors cross bundle boundaries, where `instanceof` is unreliable, so consumers
  need the same guard the framework uses.
- `pnpm --filter @nest-admin/example-basic seed` fills the example with sample
  rows, so a first run shows a populated admin rather than empty tables.

### Removed

- **`NestAdminConfig` and `ResourceSelection` are no longer exported.** They
  described a `path` and a `resources` option, and neither did anything: the
  admin's route was hard-coded and the model list was never filtered. They
  return in `0.2.0` with implementations behind them.

  Nothing to migrate — passing either type had no effect.

### Fixed

- `examples/basic` no longer requires a `.env` file. Prisma 7 stopped loading
  `.env` implicitly when a config file is present, so `prisma generate` failed
  on a fresh clone; the config now defaults to the same SQLite file the
  application already defaults to.
