# examples/basic

A real consumer of the published package, not documentation scaffolding. It
imports `@nest-admin/nest-admin` and its `./prisma` subpath — nothing from
`@nest-admin/core` or `@nest-admin/prisma` directly — exactly as an application
that ran `npm install` would.

It proves the whole chain:

```text
consumer app → public package → AdminModule → auth → resource authorization
             → metadata → Prisma adapter → SQLite → Admin UI at /admin
```

## Run it

```bash
cp .env.example .env
pnpm --filter @nest-admin/example-basic prisma:generate
pnpm --filter @nest-admin/example-basic prisma:push
pnpm --filter @nest-admin/example-basic start
```

Then open **http://localhost:3000/admin**.

The admin discovers `User` and `Product` from `prisma/schema.prisma`. Neither
appears anywhere in this project's TypeScript — adding a model to the schema and
re-running `prisma generate` makes it appear in the UI with no code change.

## What it configures

| Concern                | How                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Database client        | The app builds it, with a driver adapter. The framework never does.                                                      |
| Authentication         | An `AdminAuth` reading `x-admin-token`, enabled by setting `ADMIN_TOKEN`. Unset means open — fine locally, nowhere else. |
| Resource authorization | `Product` is read-only; `User` is fully editable.                                                                        |

The auth implementation is deliberately crude. Its point is to show where your
identity system plugs in, not to be one — the framework never inspects a
credential itself.

## Try the API directly

```bash
curl localhost:3000/admin/meta
curl localhost:3000/admin/User
curl -X POST localhost:3000/admin/User \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada"}'

# read-only by policy
curl -X POST localhost:3000/admin/Product -d '{}'   # 403

# unsupported syntax is refused rather than ignored
curl 'localhost:3000/admin/User?filter[age][gte]=18'   # 400
```

With `ADMIN_TOKEN` set, add `-H 'x-admin-token: <value>'`; without it you get
`401`, and with a wrong value `403`.
