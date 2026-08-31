# MVP scope (frozen)

> **Historical.** This was the scope for 0.1.0 through 0.7.0, and it was met -
> the acceptance test below passes, against a much larger schema than the one it
> names. Several things listed as out of scope have since been built
> deliberately and in order: authentication and authorization in 0.5.0-0.9.0, a
> dashboard in 0.10.0, a Drizzle adapter in 0.11.0.
>
> It is kept because the reasoning at the bottom is why the seams held. For what
> is planned now, see [roadmap.md](roadmap.md); for what exists, see
> [status.md](status.md).

One goal:

> **Prisma model -> automatic CRUD API -> automatic Admin UI**

## Acceptance test

Given `examples/basic/prisma/schema.prisma` containing `User` and `Product`,
and no hand-written controller, service, table or form anywhere in
`examples/basic/src`:

```bash
pnpm --filter @nest-admin/example-basic start
# open http://localhost:3000/admin
```

must show `Users` and `Products`, and selecting either must allow:

- list records
- create a record
- view a record
- update a record
- delete a record
- basic pagination
- basic search/filtering where practical

## Explicitly out of scope

Do not build these, and do not design corners of the MVP around them beyond
leaving the seams open:

authentication, authorization, RBAC, permissions, file uploads, rich text
editors, charts, analytics dashboards, audit logs, webhooks, custom pages,
plugin system, multi-tenancy, SaaS/cloud functionality, advanced relation
management, advanced validation, advanced filtering, advanced customisation,
SSR, a Next.js admin application, and TypeORM / Drizzle / MikroORM adapters.

## Scope discipline

The temptation in an admin framework is to generalise early: a plugin system
before there are two plugins, a permission model before there is a login. The
MVP is deliberately narrow so that the two seams that actually matter (the ORM
adapter contract and the HTTP contract) get exercised by real code before
anything is built on top of them.
