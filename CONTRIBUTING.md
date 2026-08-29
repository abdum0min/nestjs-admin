# Contributing

Thanks for considering a contribution. The project is at the **foundation**
stage — structure and tooling are in place, the MVP is not implemented.

## Getting started

```bash
git clone <repo>
cd nest-admin
pnpm install
pnpm build
```

Node >= 20.11, pnpm >= 10 (`corepack enable` will install the pinned version
from the `packageManager` field).

## Workspace commands

| Command          | What it does                                 |
| ---------------- | -------------------------------------------- |
| `pnpm build`     | Builds every package in topological order    |
| `pnpm dev`       | Runs every package's watch build in parallel |
| `pnpm typecheck` | `tsc --noEmit` across the workspace          |
| `pnpm test`      | Vitest across all projects                   |
| `pnpm format`    | Prettier write                               |

## Architectural rules

These are not style preferences. A change that breaks one of them will be
rejected:

1. **`packages/core` must not import Prisma.** Not the client, not the types,
   not `@prisma/*` in any form.
2. **`packages/core` must not import NestJS.** Core is a plain TypeScript
   library and must stay usable outside Nest.
3. **`packages/prisma` depends on Core contracts only** — it implements the
   adapter interface, it does not extend Core's responsibilities.
4. **The Admin UI never learns about Prisma.** It talks to the HTTP contract
   exposed by `packages/nestjs`, nothing else.
5. **Framework dependencies of a consumed library are `peerDependencies`** —
   `@nestjs/*`, `@prisma/client`, `react`. Never plain dependencies.
6. **Shared versions live in the `catalog:` block** of `pnpm-workspace.yaml`,
   not hard-coded per package.

If you believe one of these rules is wrong, open an issue and argue the case
before writing code — don't work around it quietly.

## Dependency policy

Every new dependency needs a justification in the pull request that answers:
_is this actually required for the current architecture?_ Popularity is not a
reason. Prefer the standard library, prefer one small package over one large
one, and prefer no package at all.

## Commits and pull requests

- Keep pull requests scoped to one concern.
- Run `pnpm typecheck && pnpm test && pnpm format:check` before opening.
- Describe _why_, not only _what_.
