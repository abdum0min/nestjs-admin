# @nest-admin/admin-ui

The admin single-page application: React + TypeScript + Vite.

**Nothing is implemented yet** beyond the app shell.

## How it is delivered

`vite build` emits static assets into `dist/`. The NestJS integration package
copies them into its own `dist/` at publish time and serves them under the
configured base path (`/admin` by default) from the developer's own server.

There is deliberately **no separate admin deployment and no Next.js server**.
The admin lives inside the API the developer already runs.

## Contract

The SPA talks to the admin HTTP API only. It receives model metadata and
records; it has no knowledge of Prisma or any other ORM. That boundary is what
makes a second ORM adapter a backend-only change.

## Development

```bash
pnpm --filter @nest-admin/admin-ui dev
```

Runs on `http://localhost:5173/admin/`, proxying `/admin/api` to a NestJS app
on port 3000.

## Styling

Plain CSS for now. Tailwind/shadcn was deliberately not added at the foundation
stage — it is a decision worth making against real screens, not against an
empty shell.
