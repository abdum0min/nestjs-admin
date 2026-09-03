# Nest Admin

An admin panel for NestJS applications, generated from your ORM schema.

> **Status: 0.14.0, published.** Everything described below works and is
> tested against a real database, a real NestJS HTTP server and the built
> interface. The API is not frozen — 0.x means it may still change, and 1.0.0
> is planned once row-level authorization lands. See
> [docs/project-state.md](docs/project-state.md) for what exists, what does
> not, and the open risks.

Add one module to an existing application and get list, create, read, update
and delete screens for every model in your schema — with search, filters,
sorting, pagination, relation pickers, a dashboard and a login page. No
generated files, no scaffolding to maintain, no build step in your project.

```ts
import { AdminModule } from '@nest-admin/nestjs'
import { PrismaAdapter } from '@nest-admin/nestjs/prisma'

@Module({
  imports: [
    AdminModule.forRoot({
      adapter: new PrismaAdapter({ client: prisma }),
      auth: builtInAuth({ store, session: { secret } }),
    }),
  ],
})
export class AppModule {}
```

Open `/admin`.

**[Getting started →](docs/getting-started.md)** ·
**[Configuration reference →](docs/configuration.md)** ·
**[Architecture →](docs/architecture.md)**

---

## What you get

|                           |                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **CRUD, from the schema** | Every model, every field, with types read from the schema — no column lists to maintain                             |
| **Relations**             | To-one pickers, to-many lists with their own pagination, attach and detach, join tables                             |
| **Search, filter, sort**  | `field:operator:value` in the URL, coerced against the schema, ten operators                                        |
| **A dashboard**           | Counts, lists, charts, and statistics your own code computes — or a generated one if you declare nothing            |
| **A login**               | Optional, with its own account table so admin credentials never touch your users                                    |
| **Authorization**         | Roles, per-model permissions and row-level scoping, enforced on the server; invisible resources absent from the API |
| **Per-field control**     | Labels, widgets, ordering, hidden, read-only, write-only                                                            |
| **Your own rules**        | Hooks around every write, and buttons the interface draws from configuration                                        |
| **Two ORMs**              | Prisma and Drizzle, behind one contract                                                                             |

## Installing

```bash
npm install @nest-admin/nestjs        # not published yet
```

One package. The adapter you use is a subpath of it:

```ts
import { PrismaAdapter } from '@nest-admin/nestjs/prisma'
import { DrizzleAdapter } from '@nest-admin/nestjs/drizzle'
```

An application that never imports one never loads its code. Requires Node
≥ 20.11, NestJS 10–12.

## What it is not

Stated plainly, because the alternative is finding out later:

- **Not a CMS.** It administers the schema you have; it does not define one.
- **Not a page builder.** Widgets and actions are declared in configuration and
  drawn by the interface. There is no way to ship your own React component into
  it, and there deliberately never has been — that would mean every consumer
  runs a front-end build.
- **Not a permission store.** Roles and row-level scoping exist, but who holds
  which role is your application's to decide — the admin reads a role and never
  grants one.
- **Not published.** See the status note above.

## How it fits together

```text
                        ┌──────────────┐
                        │     Core     │   Contracts, metadata, errors.
                        └──────▲───────┘   Imports no ORM and no framework.
                               │
              ┌────────────────┼────────────────┐
              │                │                │
      Prisma adapter    Drizzle adapter    NestJS integration
              │                │                │
              └────────────────┴────────┬───────┘
                                        │
                                   Admin UI (React)
                          renders from /admin/meta alone
```

The interface has no knowledge of any ORM, and neither does the HTTP layer.
Both facts are asserted by tests rather than left to discipline —
[`tests/boundaries.test.ts`](tests/boundaries.test.ts) fails the build if an
import ever crosses one of those lines.

Adding an ORM means writing one implementation of `OrmAdapter` and nothing
else. That claim was checked by doing it: see
[docs/adapters.md](docs/adapters.md).

## Repository layout

| Path                | Responsibility                                                |
| ------------------- | ------------------------------------------------------------- |
| `packages/core`     | ORM-agnostic contracts: adapter, metadata, query, errors      |
| `packages/prisma`   | Prisma adapter                                                |
| `packages/drizzle`  | Drizzle adapter                                               |
| `packages/nestjs`   | NestJS integration — **the single published package**         |
| `packages/admin-ui` | The admin interface (React + Vite), bundled into that package |
| `packages/cli`      | `nest-admin init` and future commands — not implemented yet   |
| `examples/basic`    | A reference consumer, eleven models, used to verify releases  |
| `docs/`             | Guides, reference, and the decisions behind the design        |

Everything except `packages/nestjs` is `private: true` and bundled into it at
build time, so a consumer installs one package and gets one copy of everything.
The reasoning is in [docs/publishing.md](docs/publishing.md).

## Development

```bash
pnpm install
pnpm build          # topological: every package, then the interface, then the bundle
pnpm typecheck
pnpm test
pnpm verify:package # packs the tarball and installs it into a throwaway consumer
pnpm format
```

Requires Node ≥ 20.11 and pnpm ≥ 10.

The example application is the fastest way to see a change:

```bash
cd examples/basic
pnpm prisma:generate && pnpm prisma:push && pnpm seed
pnpm create-admin you@example.com your-password
pnpm start          # http://localhost:5000/admin
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
