# @nest-admin/admin-ui

The admin single-page application: React + TypeScript + Vite.

Every screen is generic. There is no `UserPage`, no `PostTable`, and no schema
constant anywhere in `src/` — the UI renders whatever `GET /admin/meta`
describes, so a model added to the Prisma schema appears without a code change,
and a model hidden by resource authorization disappears without one.

## Architecture

```text
GET /admin/meta
      │  models, fields, kinds, enums, relations, primary keys
      ▼
metadata/       what a field means: editable? sortable? which operators?
      ▼
components/     shell · list · record · form   (one set, all models)
      ▲
api/            the only place fetch, the envelope and error codes exist
```

The UI depends on the **public HTTP contract only**. `src/api/types.ts` restates
the wire shapes by hand; nothing here imports `@nest-admin/core`,
`@nest-admin/prisma` or any ORM type. That is what keeps the app working if the
server swaps its adapter.

## Routing

Hash-based: `#/User`, `#/User/u1`, `#/User/new`, `#/User/u1/edit`.

Deliberate. The API owns the same path space the app is mounted in —
`GET /admin/User` is a real endpoint — so a browser route at `/admin/User` would
be answered by the record controller with JSON. A hash cannot collide, and needs
no SPA fallback on the server.

## Development

```bash
pnpm --filter @nest-admin/admin-ui dev
```

Serves `http://localhost:5173/admin/` and proxies API calls to a NestJS app on
port 3000. The client reads its base URL from `VITE_ADMIN_API_BASE`
(`.env.development` points it at the dev proxy); in production the default
`/admin` is same-origin.

## Authentication

None here, by design. Phase 4 put authentication in the host application, so the
UI sends `credentials: 'include'` and carries whatever the browser already has.
It never builds, stores or refreshes a credential. A `401` renders a signed-out
state and a `403` renders a no-access state; neither is retried.

## Error handling

Screens branch on `error.code` — `UNAUTHORIZED`, `FORBIDDEN`, `MODEL_NOT_FOUND`,
`RECORD_NOT_FOUND`, `FIELD_NOT_FOUND`, `INVALID_QUERY`, `INTERNAL_ERROR` — never
on message text. The server's exception filter already guarantees that only the
4xx codes carry a real message and everything internal is replaced by a generic
string, so nothing internal can reach the screen.

## Known limitations

- **One filter at a time.** The server combines filters with `AND` only, so a
  multi-row builder would imply expressiveness the contract does not have.
- **Relations are read-only.** The API rejects relation writes, so the form does
  not offer them and the detail view shows a summary rather than a link.
- **Six columns.** Wide models are truncated in the table; the detail view shows
  every field.
- **No optimistic updates and no client cache.** Every screen refetches.
- **Base path is fixed at `/admin`**, matching the server.

## Tests

```bash
pnpm --filter @nest-admin/admin-ui test
```

Vitest with jsdom and Testing Library. `fetch` is mocked; nothing else is. The
query strings this app generates are additionally replayed against the real
backend in `packages/nestjs/test/e2e.test.ts`, so a drift between the two
surfaces there.
