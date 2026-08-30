# Changelog

Notable changes to `@nest-admin/nestjs`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, the public API may change in any release. Every
breaking change is listed below with what to do about it.

Nothing has been published to npm yet. Versions here are development milestones;
the first publish is planned for `1.0.0`. See [docs/roadmap.md](docs/roadmap.md).

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
