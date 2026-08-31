# Nest Admin

> **Status: 0.8.0, not published.** Generic CRUD, relations, per-field
> configuration, hooks, actions and a metadata-driven interface all work
> against a real Prisma schema. Nothing is on npm yet; the first publish is
> 1.0.0. See [docs/project-state.md](docs/project-state.md) for what exists,
> what does not, and the open risks.

An open-source admin framework for NestJS applications.

## The idea

A developer installs one package, runs one command, and gets an admin panel
generated automatically from their ORM schema — no hand-written CRUD
controllers, services, tables or forms.

```bash
npm install @nest-admin/nestjs   # not published yet
```

Start the NestJS app, open `http://localhost:3000/admin`, and the models
declared in `schema.prisma` are there with list / create / read / update /
delete, pagination and basic search.

**None of the above works yet.** It is the target the foundation was built for.

## MVP scope (frozen)

One goal: **Prisma model → automatic CRUD API → automatic Admin UI.**

Explicitly _not_ in the MVP: authentication, authorization, RBAC, permissions,
file uploads, rich text, charts, analytics, audit logs, webhooks, custom pages,
plugins, multi-tenancy, SaaS features, advanced relations/validation/filtering,
SSR, a Next.js admin app, and any ORM adapter other than Prisma.

## Architecture

```text
                    ┌──────────────┐
                    │     Core     │   ORM-agnostic. Never imports Prisma.
                    └──────▲───────┘   Never imports NestJS.
                           │
                 ┌─────────┴─────────┐
                 │                   │
          Prisma Adapter       NestJS Adapter
                 │                   │
                 └─────────┬─────────┘
                           │
                          CLI
```

The Admin UI is a React/Vite SPA that talks to the NestJS integration over an
HTTP contract. It has no knowledge of Prisma.

Full reasoning: [docs/architecture.md](docs/architecture.md).

## Repository layout

| Path              | Responsibility                                               |
| ----------------- | ------------------------------------------------------------ |
| `packages/core`   | ORM-agnostic engine: adapter contract, metadata, query types |
| `packages/prisma` | Prisma adapter implementing the Core contract                |
| `packages/nestjs` | NestJS integration + **the single published package**        |
| `packages/cli`    | `nest-admin init` and future commands                        |
| `packages/ui`     | Reusable React components for the admin                      |
| `apps/admin-ui`   | The admin SPA (React + TypeScript + Vite)                    |
| `examples/basic`  | Reference NestJS + Prisma consumer project                   |
| `docs/`           | Architecture, scope and publishing decisions                 |

## Development

```bash
pnpm install
pnpm build       # topological build of every package + the admin UI
pnpm typecheck
pnpm test
pnpm format
```

Requires Node >= 20.11 and pnpm >= 10.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
