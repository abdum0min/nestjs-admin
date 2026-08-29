# examples/basic

The reference NestJS + Prisma application. Its job is to be an honest stand-in
for a real consumer project, so that project detection, module wiring and the
served admin UI can be tested against something realistic.

**Nest Admin is installed but not wired in** — `AdminModule` does not exist yet.

## The flow this example will eventually demonstrate

```text
prisma/schema.prisma  →  nest-admin  →  /admin  →  automatic CRUD
```

## Setup

```bash
cp .env.example .env
pnpm --filter @nest-admin/example-basic prisma:generate
pnpm --filter @nest-admin/example-basic prisma:push
pnpm --filter @nest-admin/example-basic start:dev
```

SQLite is used so the example runs with no external service.

## Schema

`User` and `Product`, exactly as specified in the MVP definition. When the MVP
is complete both must appear at `http://localhost:3000/admin` with list,
create, read, update, delete, pagination and basic search — with no
hand-written controller, service, table or form anywhere in this directory.
That is the acceptance test for the MVP.
