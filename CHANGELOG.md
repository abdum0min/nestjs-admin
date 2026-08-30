# Changelog

Notable changes to `@nest-admin/nestjs`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, the public API may change in any release. Every
breaking change is listed below with what to do about it.

Nothing has been published to npm yet. Versions here are development milestones;
the first publish is planned for `1.0.0`. See [docs/roadmap.md](docs/roadmap.md).

---

## 0.4.0

To-many relations. A record's children are visible from it, and can be linked
and unlinked.

### Added

- **`GET /admin/:model/:id/:relation`** — a paginated page of the records on the
  far side of a to-many relation. It is an ordinary list of the target model
  with one extra condition, so pagination, sorting, filtering and relation
  loading all behave exactly as they do on a top-level list.

  Authorized against **both** models. The route returns records of the target,
  so a principal who may read a `User` but not list `Post` does not receive
  posts through it.

- **`POST /admin/:model/:id/:relation`** with `{ "id": "..." }` to link an
  existing record, and **`DELETE /admin/:model/:id/:relation/:targetId`** to
  unlink one without deleting either. Both require `update` on both models:
  across a one-to-many it is the _child's_ foreign key that changes.

- **`relation.shape`** in the metadata — `to-one`, `one-to-many` or
  `many-to-many`. Computed on the server, because working it out means pairing
  the two halves of the relation and a rule implemented twice will eventually
  disagree with itself.

- **`relation.detachBlocked`** explains why records cannot be detached, when
  they cannot: a child whose foreign key is required cannot exist without a
  parent, so there is nothing to detach it to. The interface does not offer the
  button, and the API refuses the request before the database does.

- **`relation.targetForeignKey`** — the column on the target that points back.
  It is what "all the posts by this author" is expressed as.

- **`OrmAdapter` gains `listRelated`, `attachRelated` and `detachRelated`.**
  A custom adapter must implement them.

- **The detail page shows each to-many relation** as its own paginated section,
  with a link into the child list filtered to that parent, and controls to
  attach and detach where those are possible.

- **A filtered list can be linked to.** `#/Post?filter=authorId:eq:u1` opens the
  list already filtered, and survives a reload.

### Changed

- `RelationMetadata` gained `name`, shared by both halves of a relation. It is
  the only reliable way to pair them: two relations between the same models
  (`author` and `reviewer`, both to `User`) are otherwise indistinguishable.

---

## 0.3.0

To-one relations. The admin shows people's names where it used to show cuids.

### Added

- **Relations resolve to something readable.** A record that references another
  now arrives with the related record alongside its key:

  ```json
  { "id": "p1", "title": "…", "authorId": "u1", "author": { "id": "u1", "name": "Ada" } }
  ```

  **Exactly two columns of the related record are selected** — its primary key
  and its display field. That is a boundary, not an optimisation: attaching the
  whole related row would publish a `User.passwordHash` through the act of
  listing `Post`.

- **`displayField`** on every model in `/admin/meta` — the field that names a
  record in one line. Detected from the schema (`name`, `title`, `label`,
  `displayName`, `username`, `email`, `slug`, then any unique string, then any
  string, then the primary key).

- **`relation.from` / `relation.to`** in the metadata, naming the column a
  to-one relation is stored in. The UI needs it to know what a form submits.

- **Filtering by a relation name.** `?filter=author:eq:<id>` means the same as
  `?filter=authorId:eq:<id>`; use whichever reads better.

- **A picker instead of a text box.** A foreign key used to render as the plain
  string input its kind implies, which asked people to paste an id. The form now
  searches the target model by name and submits the key. It searches rather than
  listing everything, so a large table costs the same as a small one.

- **Relations are links.** In the list and on the detail page, a to-one relation
  is the related record's name, linking to it. The column is headed by the
  relation (`author`), not by the key (`authorId`).

### Fixed

- **Free-text search no longer matches foreign keys.** `?search=e` matched
  nearly every row of any model that references another, because a cuid is a
  string column that is not generated — so the existing exclusion for generated
  ids missed it.

### Changed

- **Sorting by a relation is refused**, with an error that says why. It would
  have run: `authorId` holds a cuid, so the result looks sorted and means
  nothing, and what the caller wanted was the author's name. Sorting by a field
  on another model is a later release.

- `ModelMetadata` and `ModelDto` gained `displayField`; `RelationMetadata` and
  `RelationDto` gained `from` and `to`. Additive for consumers reading the
  metadata; an adapter implementing `OrmAdapter` should populate `from`/`to` for
  to-one relations it owns.

### Not in this release

To-many relations are not loaded. They have no column on this side, they can be
unbounded, and one query per row would make a list page cost an unpredictable
amount. They arrive in 0.4.0, paginated and asked for explicitly.

---

## 0.2.0

Configuration and dependency injection. The admin now fits an application it
did not have to be built around.

### Added

- **`AdminModule.forRootAsync`** — the adapter and the auth policy resolved
  through DI, with `useFactory`, `useClass` or `useExisting`.

  ```ts
  AdminModule.forRootAsync({
    imports: [DatabaseModule],
    inject: [PrismaService],
    useFactory: (prisma: PrismaService) => ({
      adapter: new PrismaAdapter({ client: prisma }),
      auth: myAdminAuth,
    }),
  })
  ```

  `forRoot` is unchanged. Previously the client had to exist where the module
  was declared, which meant constructing it at import time — before
  configuration was available and outside the application's own lifecycle.

- **`path`** mounts the admin somewhere other than `/admin`, including nested
  (`/internal/admin`). The API and the UI move together, and the served page is
  rewritten to match: asset URLs point at the new path, and the base is handed
  to the browser. It is rejected if empty or `/` — the routes end in `:model`,
  so at the root they would capture every unmatched request in the application.

  It sits on the options object rather than in the async factory, because routes
  are registered before any provider exists.

- **`resources`** with `include` / `exclude` chooses which models the admin
  exposes at all. Structural rather than per-principal, so an excluded model
  answers 404, not 403 — it is not part of the admin. A name matching no model
  fails at startup: a typo in `exclude` would otherwise leave the model exposed.

### Changed

- **Model existence is checked before the resource policy** on every operation.
  An unknown or excluded model now answers 404 where a denying policy would
  previously have answered 403 first. A model that is not part of the admin
  should not look like one the caller merely lacks access to.
- `create`, `update` and `delete` validate the model name. Previously only
  `list` did, so an unknown model reached the adapter on those routes.
- ESM consumers get **one copy of the framework core** instead of one per
  entrypoint. The Prisma package no longer inlines Core, so the published build
  can share it. CommonJS still carries a copy per entrypoint — esbuild does not
  code-split CJS — which is why framework errors are identified by a brand
  rather than by `instanceof`.

### Fixed

- Two remaining `instanceof` checks on framework errors, in the Prisma adapter
  and the resource-policy path, replaced with the brand check. Same defect class
  as the 500-instead-of-400 bug found in 0.0.0; these had not yet caused one.

---

## 0.1.0

The first tagged milestone. Everything before it is recorded in `reports/`.

### Changed

- **The package is now `@nest-admin/nestjs`**, renamed from
  `@nest-admin/nest-admin`. The Prisma adapter moves with it, to
  `@nest-admin/nestjs/prisma`.

  ```diff
  -import { AdminModule } from '@nest-admin/nest-admin'
  -import { PrismaAdapter } from '@nest-admin/nest-admin/prisma'
  +import { AdminModule } from '@nest-admin/nestjs'
  +import { PrismaAdapter } from '@nest-admin/nestjs/prisma'
  ```

  The old name repeated itself and left no room for adapter packages alongside
  it. Nothing is installed from npm yet, so this costs nobody a migration.

- `pnpm typecheck` and `pnpm test` now run `pnpm prisma:setup` first. It is a
  no-op when nothing has changed.

### Added

- **`pnpm prisma:setup`** generates every Prisma client and fixture database the
  repository needs. These are git-ignored, and nothing produced them, so a fresh
  clone could not typecheck or test — the step existed only in one working copy.
- **Continuous integration** — format, build, typecheck and test on Node 20.11,
  22 and 24 on Linux and on Node 24 on Windows, plus the packed-consumer
  verification. The suite and the packaging check both existed already; nothing
  ran them automatically.
- `isNestAdminError` and the `AdminErrorKind` type are exported from the package.
  Errors cross bundle boundaries, where `instanceof` is unreliable, so consumers
  need the same guard the framework uses.
- `pnpm --filter @nest-admin/example-basic seed` fills the example with sample
  rows, so a first run shows a populated admin rather than empty tables.

### Removed

- **`NestAdminConfig` and `ResourceSelection` are no longer exported.** They
  described a `path` and a `resources` option, and neither did anything: the
  admin's route was hard-coded and the model list was never filtered. They
  return in `0.2.0` with implementations behind them.

  Nothing to migrate — passing either type had no effect.

### Fixed

- `examples/basic` no longer requires a `.env` file. Prisma 7 stopped loading
  `.env` implicitly when a config file is present, so `prisma generate` failed
  on a fresh clone; the config now defaults to the same SQLite file the
  application already defaults to.
