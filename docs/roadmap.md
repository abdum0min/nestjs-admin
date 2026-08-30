# Roadmap — 0.1.0 to 1.0.0

The plan for turning Nest Admin into the admin package a NestJS + Prisma
application reaches for by default.

Prisma is the only adapter until 1.0. A second ORM before the first one is
finished would mean two half-products, and would freeze the `OrmAdapter`
contract before relations have tested it.

**Product first.** Documentation, a live demo and the first npm publish are
deliberately last. Nothing is published while the UI has no relations, because
the first impression is the one that sticks — and because nothing installed
means the API, and even the package name, stay free to change.

---

## Starting point

Verified in the code and against a running consumer, not assumed.

| Finding                                | Why it matters                                                                                                                     | Release       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| No `forRootAsync`                      | The client must be built at module-eval time. A real app has `PrismaService` and `ConfigService`; the package cannot reach either. | 0.2.0         |
| Relations are closed off               | Metadata sees them, but writing, filtering and sorting are all rejected on purpose, and the UI renders a placeholder.              | 0.3.0         |
| Dead public API                        | `NestAdminConfig` and `ResourceSelection` were exported; `path` and `resources` did nothing. The route was hard-coded.             | 0.1.0 → 0.2.0 |
| Free-text search covers foreign keys   | `search=e` matches almost every row, because `authorId` is an ordinary string column and is not generated.                         | 0.3.0         |
| No way to hide a field from a response | The adapter uses neither `select` nor `omit`, so whole records are returned. `passwordHash` cannot be withheld.                    | 0.5.0         |
| `/admin/meta` carries no permissions   | Byte-identical for every principal, so the UI offers buttons that always return 403.                                               | 0.5.0         |
| Bundle duplication                     | `index.cjs` and `prisma.cjs` each inline Core. Branded errors work around it; any module-level state would break the same way.     | 0.2.0         |
| Filtering by foreign key already works | `authorId` is exposed as a plain scalar, so `filter=authorId:eq:<id>` works today. Relations are a UX layer, not new capability.   | —             |

---

## Releases

Each is a phase in the established rhythm: brief → implementation →
`reports/NNN` → commit with explicit paths.

| Release | Name                               | Why in this position                                     |
| ------- | ---------------------------------- | -------------------------------------------------------- |
| 0.1.0   | Foundation cleanup                 | A safety net and a clean name for the seven phases after |
| 0.2.0   | DI and configuration               | A feature nobody can install is worth nothing            |
| 0.3.0   | Relations I — to-one               | The minimum bar for working against a real schema        |
| 0.4.0   | Relations II — to-many             | Once the to-one contract has settled                     |
| 0.5.0   | Field overrides and permissions    | Customisation once every field kind exists               |
| 0.6.0   | Extension points                   | Hooks and actions make sense once the model is complete  |
| 0.7.0   | UX and hardening                   | Polish last, so later work cannot undo it                |
| 0.8.0   | Docs, demo, publishing preparation | Once there is something worth showing                    |
| 1.0.0   | API freeze and first publish       | Only after all of the above is stable                    |

### 0.1.0 — Foundation cleanup

Small, but every later phase depends on it.

- CI: format, build, typecheck, test and `verify:package` on every push and PR.
- Rename `@nest-admin/nest-admin` to `@nest-admin/nestjs`.
- Remove the dead `NestAdminConfig` / `ResourceSelection` exports.
- `pnpm prisma:setup`, so a fresh clone can typecheck and test.
- Version `0.1.0` and a hand-written `CHANGELOG.md`.

**Out of scope:** demo, docs site, npm publish, any new feature.

### 0.2.0 — DI and configuration

Fits the package to the shape of a real NestJS application.

- `forRootAsync` with `imports` / `inject` / `useFactory` / `useClass` /
  `useExisting`.
- `path`, replacing the hard-coded `/admin`. **Starts with a spike:**
  `@Controller('admin')` is evaluated when the class is defined, so this needs
  `RouterModule` or a dynamically built controller. The SPA is a second problem
  — its `index.html` references assets absolutely (`/admin/assets/…`), so the
  base has to be built relative or rewritten when served.
- `resources` include/exclude. Nobody wants `_prisma_migrations` in their admin.
- Bundle duplication: one shared CJS chunk, or Core as a real dependency.
  Settled before the number of adapters grows.

**Acceptance:** `examples/basic` moves to `forRootAsync` with `ConfigService`;
`path: '/panel'` serves SPA, API and assets; an excluded model 404s rather than
403s; `verify:package` asserts one copy of Core.

### 0.3.0 — Relations I: to-one

Human-readable names instead of raw ids.

- `displayField`, auto-detected (`name` → `title` → `label` → `email` → `slug` →
  first unique string → primary key) and overridable.
- Metadata gains the owning foreign key and the target's display field.
- Adapter loads to-one relations with `include`, one query, no N+1.
- UI: a searchable select backed by `/admin/<Model>?search=`, so large tables
  work without loading everything.
- `filter=author:eq:<id>` by relation name, translated to the foreign key.
- Fix: foreign keys excluded from free-text search.

**Out of scope:** to-many editing, many-to-many, nested creation.

**Acceptance:** `Post` → `User` renders the author's name, edits through a
picker, and a 100-row list costs one extra query, not a hundred. Self-relations
do not recurse.

### 0.4.0 — Relations II: to-many

- Paginated inline table of related records on the parent's detail page.
- "All Posts where author is this user" — navigation into a pre-filtered list.
- Many-to-many attach/detach.
- Creating a child from the parent's context, with the foreign key filled in.
- A readable error when a foreign-key constraint blocks a delete, not a raw ORM
  failure.

**Out of scope:** multi-level nested editing, sorting by a related field.

### 0.5.0 — Field overrides and permissions

Customisation without writing React.

```ts
resources: {
  User: {
    label: 'Users',
    displayField: 'email',
    fields: {
      passwordHash: { hidden: true },
      bio: { widget: 'textarea' },
      createdAt: { readOnly: true },
    },
  },
}
```

- **`hidden` is enforced on the server** — the field leaves the response
  entirely, via `select`/`omit`. Hiding it only in the UI would still ship
  `passwordHash` over the wire. This is a security requirement.
- Widgets: `textarea`, `password`, `email`, `url`, `color`, `json`.
- `/admin/meta` returns the operations the current principal may perform, so the
  UI stops offering buttons that 403.
- Model ordering and grouping in the sidebar.

**Out of scope:** row-level permissions, conditional visibility.

**Acceptance:** a hidden field is absent from the HTTP response, asserted by
test; a read-only principal sees no write controls; an unknown model or field
name in the config fails at startup rather than being ignored.

### 0.6.0 — Extension points

People adopt for features and leave for the missing escape hatch.

- Hooks: `beforeCreate` / `afterCreate` / `beforeUpdate` / `afterUpdate` /
  `beforeDelete` / `afterDelete`, receiving the principal and context.
- Custom actions — a button on a row or a list, handled on the server, drawn by
  the UI from metadata, with confirmation and a result message.
- Theming through CSS variables: brand colour, logo, application name, **with no
  custom React build**. This is where the competition is weakest.
- Full dark mode.

**Out of scope:** custom React pages and components, a plugin system.

### 0.7.0 — UX and hardening

- Validation errors under the field they belong to, not in a banner.
- Multi-select and bulk delete.
- Deliberate empty, loading, error and forbidden states.
- Accessibility: keyboard navigation, focus order, ARIA, contrast.
- Responsive layout.
- Large tables: profiled at 50k rows, with index guidance.
- Case-insensitive search, correct per provider. Currently a documented
  limitation.

**Acceptance:** the whole CRUD flow works without a mouse; Lighthouse
accessibility ≥ 95; a 50k-row list renders in under 500ms.

### 0.8.0 — Docs, demo, publishing preparation

- Documentation site covering every configuration key, hook, widget and relation
  scenario.
- Live demo with seeded data, reset daily.
- README rewrite: a recording, a three-line install, an honest list of what is
  still missing.
- Changesets and the publishing pipeline; a final review of `npm pack` contents.
- Claim the `@nest-admin` scope on npm.

**Acceptance:** a stranger installs the admin from the documentation alone.

### 1.0.0 — API freeze and first publish

- Audit the public API: every export deliberate, documented and used.
- A semver guarantee and a support policy.
- Final review of the `OrmAdapter` contract, which the second adapter will
  build on.
- The first npm publish.

**Out of scope:** new features. Any at all.

---

## Rules that hold across every phase

- **The rhythm does not change.** Brief, implementation, `reports/NNN`, commit
  with explicit paths. No AI co-author trailer. No `git add -A`.
- **Metadata-driven stays metadata-driven.** The UI never learns the schema. Any
  new capability is expressed in metadata, never as a model name in UI code.
- **The ORM boundary holds.** `@nest-admin/core` does not see Prisma. Every new
  capability is expressed in the `OrmAdapter` contract first, then implemented.
- **Authentication stays with the host.** No login form, no JWT, no sessions.
- **Every phase ends green.** `build`, `typecheck`, `test`, `format:check` and
  `verify:package` all pass. The test count does not go down.
- **Breaking changes are written down.** Allowed while on `0.x`, but never
  silently — each one gets a CHANGELOG entry saying what to do about it.

---

## Deferred decisions

Left open on purpose; the context will be clearer at 0.8.0.

- **Demo hosting.** Fly.io offers a persistent disk and suits SQLite, but costs
  money. Free alternatives: Render (sleeps, fine for a demo), Railway, or
  Vercel with Neon's free tier.
- **Documentation tooling.** Starlight is lighter and enough for a
  single-package library; Docusaurus is more familiar and brings versioning and
  a blog. Either is reversible.
