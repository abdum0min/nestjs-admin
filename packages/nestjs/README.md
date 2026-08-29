# @nest-admin/nest-admin

The NestJS integration — and **the single package published to npm**.

The name is a placeholder. The final brand/package name is not decided.

**Nothing is implemented yet.**

## Why this package is the publish target

The repository is split into five packages for development, but developers
should install one thing. `packages/core`, `packages/prisma`, `packages/cli`
and `packages/ui` are all `private: true` and are bundled into this package's
`dist/` by tsup (`noExternal`). See [../../docs/publishing.md](../../docs/publishing.md).

This does mean the "distribution package" and the "NestJS integration layer"
are currently the same directory. The integration _source_ under `src/` imports
`@nest-admin/core` only; the Prisma adapter is reached through the `./prisma`
subpath. If that coupling becomes uncomfortable, extract a dedicated facade
package — the export map is already shaped for it.

## Planned exports

| Entry      | Contents                                                  |
| ---------- | --------------------------------------------------------- |
| `.`        | `AdminModule`, controllers, static UI handler, Core types |
| `./prisma` | `PrismaAdapter`                                           |
| `bin`      | `nest-admin` CLI (added once the CLI is implemented)      |

## Peer dependencies

`@nestjs/common`, `@nestjs/core`, `reflect-metadata` and `rxjs` are peers — the
consuming application already provides them, and a second copy of `@nestjs/core`
breaks dependency injection and decorator metadata.

`@prisma/client` is an **optional** peer: it is only needed when the Prisma
adapter is actually used.
