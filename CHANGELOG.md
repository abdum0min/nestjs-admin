# Changelog

Notable changes to `@nest-admin/nestjs`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, the public API may change in any release. Every
breaking change is listed below with what to do about it.

Published to npm as [`@nest-admin/nestjs`](https://www.npmjs.com/package/@nest-admin/nestjs)
since `0.11.0`. See [docs/roadmap.md](docs/roadmap.md).

---

## 0.14.1

Diagnosis: what the admin had to guess about your schema.

### Added

- **The schema report**, at the top of the developer tools. This package
  renders schemas it has never seen, which means guessing - which column names
  a record, how the halves of a relation pair up, whether a date is a creation
  date - and every wrong guess degrades **silently**. Seven checks, each one
  something that happens today with nothing to say why:

  | Finding                       | What it costs                                                  |
  | ----------------------------- | -------------------------------------------------------------- |
  | Display field fell back to id | Every relation picker and link shows a cuid                    |
  | Composite or missing key      | The list works; opening, editing and deleting all fail         |
  | Unpaired relation             | Attach and Detach are not offered, and no link to the children |
  | No creation date              | The dashboard offers a count and no chart                      |
  | No version column             | `concurrency: 'optimistic'` is silently not running on it      |
  | Decimal, BigInt or Bytes      | A required one makes every create fail                         |
  | File field, no storage        | The widget is drawn and every upload fails                     |

  Every finding a configuration option can fix **carries that option, ready to
  copy**, because the reason these problems persist is that nobody knows the
  option exists. Where no option can fix one - a composite key needs a schema
  change - it says so rather than inventing one.

  Two severities. `broken` does not work; `guessed` works with less than it
  could. A third level would only start an argument about which findings belong
  in the middle.

  It **never touches the database**: no data quality, no missing rows, and
  deliberately no index advice, because indexes are invisible from here and
  guessing would be advice that is confidently wrong. Its inputs are the schema
  and the configuration, which are the same on a laptop as in production -
  which is why living behind the developer tools costs nothing.

  The navigation carries a count for the broken ones only. Most schemas leave
  the admin guessing something, and a badge that never goes out is a warning
  people stop seeing.

  Run against the example application's ten-model schema it reports twelve
  findings, all of them true: eight models with no `updatedAt` while optimistic
  concurrency is switched on, and four with no creation date.

---

## 0.14.0

Developer tools: an empty admin becomes something you can click through.

### Added

- **`@nest-admin/nestjs/dev-tools`**, a new entrypoint:

  ```ts
  import { devTools } from '@nest-admin/nestjs/dev-tools'

  AdminModule.forRoot({ adapter, auth, devTools: devTools() })
  ```

  A **Developer tools** entry appears at the bottom of the navigation, marked
  and separated from the resources - a tool that can empty a table must not
  look like a table.

- **One screen, one press.** Every model is a row with its own count, so
  "twenty users, fifty products, no order lines" is a single generate rather
  than three visits. They are written in an order the relations allow, so a post
  always has an author. The problem this release exists for is the first thirty
  seconds of using the package: empty tables, a flat dashboard chart, and
  relation pickers with nothing in them.

  Deliberately not a four-step wizard. That reads well the first time and costs
  four clicks on every one after it, which is the wrong trade for a tool
  somebody opens twenty times in an afternoon.

- **A header that says where you are**: which **database engine** it is pointed at - PostgreSQL, SQLite, MySQL - with the adapter underneath it, how many
  records exist, how many relations each model will wire up, and **what the
  deployment check actually saw** - not `NODE_ENV` alone, because the gate reads
  a dozen signals and a screen naming one would teach the wrong rule.

- **The last ten runs**, so "did that actually do anything" has an answer.
  Only the newest can be undone, which is what the Undo card offers.

- **Empty every model**, children first, refused without an explicit
  acknowledgement in the body. The typed confirmation in the interface is the
  real guard; the server's is so a request that arrives by accident cannot
  empty a database.

  It empties every model **this admin manages**, which is not every table, and
  it says so: the result names what it skipped and why. A model `resources`
  excluded stays out of reach here as everywhere else - that boundary is the
  whole of this package's security model, and the excluded table is usually the
  one holding the login of the person pressing the button.

  It deletes rows, not tables. The screen names the command that truly resets a
  database - `npx prisma db push --force-reset` under Prisma - rather than
  leaving somebody to find out that counters kept counting.

- **A mock data engine that reads only metadata.** Values come from a column's
  name first (`email`, `slug`, `price`, `city`) and its kind second. Nothing
  branches on a model name - the admin renders schemas it has never seen, and a
  generator that knew about `User` would work on one application. Unique
  columns stay unique, enums stay inside their values, and relations point at
  rows that exist, including one-to-ones, where each parent is handed out once.
  Dates are spread backwards over ninety days so the dashboard chart has a
  shape.

- **Seeds.** The same seed gives the same records, which turns generated data
  from a novelty into something a demo can be built on: screenshottable,
  describable, and reproducible after a truncate.

- **Undo.** Deletes what the last run created and nothing else, so generating
  into a database that also holds your own hand-made rows is not frightening.

- **Pictures, computed rather than downloaded.** Identicon avatars and gradient
  covers drawn from the record itself, deterministic, and written through the
  same storage a real upload uses. Nothing is fetched from a placeholder
  service and nothing is added to the tarball.

- **`@faker-js/faker` as an optional peer.** Installed, it is used
  automatically and the words get more varied; absent, the built-in lists do
  the job. "Install ten megabytes before you can see any data" is not a first
  step this package asks for.

- **`generators`**, the escape hatch: `{ 'Product.sku': (i) => … }`. One column
  with a format nothing could infer should not make the feature useless for
  that model.

- **Preview** before generating, which writes nothing and runs the same code
  path, and **Empty a model**, one model at a time and named explicitly.

### Security

Four layers keep this away from a real database, and the first is the strongest:

1. **A separate entrypoint.** `AdminModule` has no reference to any of this
   code, so a build that does not import the subpath does not contain the
   generator, the word lists or the routes. Absent, not disabled - which no
   configuration mistake can undo, and which the packed-consumer checks now
   assert.
2. The option has to be passed.
3. **It refuses to start where the process looks deployed** - `NODE_ENV`, and
   any of `VERCEL`, `RENDER`, `FLY_APP_NAME`, `RAILWAY_*`, `DYNO`, `K_SERVICE`,
   `KUBERNETES_SERVICE_HOST` and friends. `NODE_ENV` alone is not the check:
   staging runs as production and plenty of deployments never set it.
4. The `useDevTools` capability, granted like `manageTeam`.

Records are written through the adapter rather than through the admin - so
generated timestamps can be set, and **hooks do not run**: two hundred fake
users should not send two hundred welcome emails. Authorization is not skipped;
every model goes through the same `resourceAuth` boundary the HTTP routes use.

### Fixed

- **Injection tokens are now `Symbol.for`, all of them.** The CJS build has no
  code splitting, so each entrypoint inlines its own copy of every internal
  module - and a plain `Symbol('X')` in `dev-tools.cjs` is a _different symbol_
  than the one `index.cjs` registered. The same is true of classes used as
  tokens, so `AdminService` is now reachable by token as well. Both would have
  been a start-up failure in CommonJS only, naming a token that looks identical
  to the one that was registered.

- **`typesVersions` was missing `./drizzle`.** A consumer on TypeScript's
  `moduleResolution: "node"` - which is what the NestJS CLI's own tsconfig uses
  - could not see the types for the Drizzle adapter shipped in 0.11.0. Runtime
    resolution was never affected.

- **`mode: 'insensitive'` never reached PostgreSQL.** The Prisma adapter reads
  its datasource provider with a regular expression whose backslashes had gone
  missing - `datasources+w+s*{…providers*=s*"…"`, literal letters where
  character classes were meant - so it matched no schema ever written and
  always answered `undefined`. Silently, because the provider is optional
  everywhere it is used. What it cost is the option that makes `contains` and
  `search` ignore capitalisation on PostgreSQL, which is decided from exactly
  that value: every case-insensitive search there had quietly been
  case-sensitive since the option was added.

  Found by putting the provider on a screen, where `undefined` was visible for
  the first time. Four tests now call it with real schemas, single-file and
  multi-file, which the broken pattern could not have survived.

### Four defects found by running it, not by reading it

- **Dependency injection across entrypoints.** The example application would
  not start: the dev-tools controller asked for an `AdminService` class object
  its own bundle had a separate copy of. This is what the token change above
  is for.
- **A one-to-one handed the same parent to every row.** Five profiles were
  asked for and two arrived, because each picked a user at random from the same
  pool. A `@unique` foreign key is a one-to-one, which the metadata says
  plainly and the generator was not reading.
- **And then it only counted the rows it had just made.** With that fixed, a
  second press still failed: the parents already taken by rows _in the table_
  were not excluded. Both are read now, and filling the example's ten-model
  schema twice in a row creates 50 records each time with nothing refused.
- **The provider regex above**, which had been wrong for three releases and was
  only visible once something displayed its answer.

---

## 0.13.2

Deleting a record by marking it.

### Added

- **`softDelete`** on a model, naming the column that marks a record deleted:

  ```ts
  models: {
    Post: {
      softDelete: 'deletedAt'
    }
  }
  ```

  Closer to a defect being fixed than to a feature. A schema with a `deletedAt`
  column has already decided its rows are kept; until now the admin listed
  marked rows as live and its Delete button destroyed what the schema had
  arranged to preserve.

  With it, Delete writes the current time into the column, every list hides
  marked records - including a related list under its parent, which is the
  least obvious place for one to survive - the toolbar gains Live / Deleted /
  All, and a marked record offers Restore and a Delete forever that means it.
  The confirmation stops promising that deleting cannot be undone, because on
  such a model it can, and a warning that is not true is one people learn to
  skip.

  `beforeDelete` and `afterDelete` still run: from everywhere except the
  database this is a delete, and a hook that refuses to release a record with
  unpaid invoices has the same reason to refuse when the row is only marked.
  Restoring is authorized as `delete` rather than `update` - it undoes a
  delete, and somebody who may only edit records should not be able to
  resurrect what somebody else removed.

  The column is refused in writes, so no form can delete a record with a date
  picker. It must be an optional `DateTime` the database does not generate;
  anything else fails at startup, naming the column and what is wrong with it.

### Fixed

- **The Drizzle adapter answered `field eq null` with no rows at all.** SQL has
  no equality with null - `col = NULL` is unknown rather than false - so the
  condition matched nothing, while Prisma's `equals: null` meant IS NULL and
  matched correctly. Two adapters, one filter, opposite answers. Soft delete
  asks exactly this question of every list, which is how it surfaced; it is
  fixed for every filter, and proved against a real SQLite database.

---

## 0.13.1

A picture where a picture belongs.

### Fixed

- **A file column is now drawn wherever it is read**, not only in the form. A
  `widget: 'image'` field printed its storage key in the table, on the detail
  page and in every related table - `2026/09/abc123-ada.png`, which is true,
  unreadable, and the opposite of the one job an avatar column has. It shows
  the picture. A `widget: 'file'` field shows what the file is called and links
  to it, and shows the picture anyway when the name says it is one.

  Reported against 0.13.0 by the first application to use an image field.

### Added

- **`placeholder`** on a file field: the picture to draw when the column is
  empty, or when its value will not load.

  ```ts
  avatarUrl: { widget: 'image', placeholder: '/img/default-avatar.png' }
  ```

  Those two are different facts about a record and are no longer drawn the
  same: with no `placeholder` an empty column gets a plain outline and a value
  that failed to load gets a struck-through one that says so on hover. Never
  the browser's own broken-image glyph, which is unstyled, differs per browser,
  and reports a missing file as a fault in the page. A `placeholder` that is
  itself wrong falls through to the same icons rather than turning every row
  into a broken glyph.

  It must be an absolute URL, a path starting with `/`, or a `data:image/` URI.
  A relative path is **refused at startup**: the admin is one hash-routed page,
  so `img/avatar.png` resolves against whichever screen is open and would load
  on the list and 404 on a detail page - a default avatar that appears and
  disappears as you navigate, which reads as a caching fault and is not one.

---

## 0.13.0

File uploads, and they work with nothing configured.

### Added

- **`widget: 'file'` and `widget: 'image'`**, on an ordinary string column:

  ```ts
  fields: {
    avatarUrl: { widget: 'image', accept: ['image/*'], maxSize: '2mb' },
  }
  ```

  Nothing in the schema changes - most projects already have an unused
  `avatarUrl String?`. With no `files` option the bytes go to the local disk and
  are served behind the same guard as every other route, so an image field is
  one line and no decisions.

  The interface takes a file three ways: click, drag and drop, or **paste**.
  It previews pictures, shows progress, and replaces or removes in place.

- **`AdminStorage`** - `put`, `url`, `remove`. `url()` may be asynchronous,
  which is what makes a private S3 or R2 bucket work: it mints a signed link
  per request. No cloud adapter ships in the package -
  `@aws-sdk/client-s3` is ten megabytes and this package has one runtime
  dependency - so the documentation carries a complete implementation to copy,
  about twenty lines, and R2 differs from S3 by one of them.

- **`files`**: `storage`, `directory`, `maxSize`. `files: false` turns the routes
  off entirely.

### Security

This is most of the release. Serving an uploaded file inline from the admin’s
own origin is a session-stealing XSS in waiting, so nothing here believes the
uploader about anything.

- The content type is **sniffed from the bytes**, never taken from the
  extension or the header. An HTML file called `avatar.png` and announced as a
  PNG is refused at upload, and would download rather than execute even if it
  got in.
- Only PNG, JPEG, GIF and WebP are ever served inline. **SVG deliberately is
  not** - it is an image that can contain script.
- Size is refused on the announced length before a byte is read, and counted
  again as the stream arrives.
- Keys are generated here, and one that resolves outside the upload directory
  is refused.

### Three defects found by running it rather than by reading it

- **A character class with a stray range.** `[/\\:*?"<>| -]` had turned into a
  control-character range, so the space it was meant to replace survived and
  `ada avatar.png` became a key with a space in it. Rewritten as an
  allowlist: a denylist fails open for everything it forgets, and forgets
  silently.
- **An ASCII allowlist.** The first fix collapsed every non-Latin filename to a
  dash. Unicode letters and digits are letters and digits.
- **A header cannot carry a non-Latin name.** The interface percent-encodes it;
  the server was not decoding, so those names arrived as escapes and sanitised
  into dashes anyway. Thirteen tests now cover this function, because it had
  shipped broken twice in one afternoon.

Also fixed: refusing an upload answered while the client was still sending, and
the half-finished connection went back into its pool looking reusable - so a
later, unrelated request failed with ECONNRESET. The refusal now closes its own
connection, which moves the failure onto the request that caused it.

### Notes

- **The body is raw bytes, not multipart.** No parser on either side, a stream
  from the first byte, and no dependency. A browser form post would need one;
  the admin has never used one.
- **A replaced file is not deleted.** Another record may hold the same key and
  nothing here can count references. Finding orphans belongs with the dev tools
  in 0.14, where scanning makes sense.
- **One file per field.** A gallery needs a different column shape and a
  different interface; this is the shape that needs no migration.
- The interface bundle went from 137.8 KB to 141.1 KB gzipped.

---

## 0.12.1

The other half of what roles started: more than one administrator means two of
them can edit the same record.

### Added

- **`concurrency: 'optimistic'`** — refuse a write built on a version of the
  record that has since changed, instead of letting it silently overwrite.

  The failure it prevents produces no error today. Anna changes a title and
  saves; Bora, who opened the same record earlier, changes only the summary —
  but the form sends every field, so Anna’s change is gone and neither of them
  is told. A test reproduces exactly that with the option off, so what the rest
  of the file prevents is on the record rather than described.

  The version is the model’s updated-at value, carried in an `x-admin-version`
  header. A stale write answers **409 `CONFLICT`** and applies nothing — not even
  the field the person meant to change — so reloading and saving again is a
  complete recovery. Nothing is locked and nobody waits.

  The interface sends it without being asked. The metadata document names the
  field (`versionField`), so the interface never works the rule out for itself:
  a second implementation would drift from the one that enforces it.

- **A startup warning naming every model it cannot protect.** A column called
  `updatedAt` that nothing updates would produce a version that never changes,
  and metadata cannot tell that apart from one the schema maintains. Rather than
  pretend, the admin says which models are unguarded:

```text
  WARN [NestAdmin] concurrency: 'optimistic' cannot protect Profile, Category,
  Product, Tag, Order, OrderItem, Comment, Review - no column recording when a
  row last changed.
```

The lesson is the one 0.12.0 paid for: a guard nobody can see is not a guard.

### Notes

- **Off by default**, and the default stays wrong on purpose until 1.0. Turning
  it on can refuse a write that succeeds today, and "zero configuration behaves
  exactly as before" is worth more than a better default in a 0.x release.

- **A caller that sends no version is allowed through.** A script patching one
  field is not the collision this exists for, and refusing it would break every
  non-browser caller the moment the option is turned on.

---

## 0.12.0

Permissions, roles and row-level scoping. All three are optional, and an admin
that configures none of them behaves exactly as 0.11 did.

### Added

- **Row-level scoping.** `AdminResourceAuth.authorize` may return
  `{ filters }` instead of `true`, and those filters are merged into the query
  the adapter runs:

  ```ts
  authorize({ model, context }) {
    const user = context.switchToHttp().getRequest().user
    if (user.isAdmin || model !== 'Order') return true
    return { filters: [{ field: 'tenantId', operator: 'eq', value: user.tenantId }] }
  }
  ```

  Filtering after the query would have been simpler and wrong four ways at once:
  `total` would count rows nobody may know about, a page of 25 would show 3,
  "next page" would sometimes be empty, and a large table would be read in full
  to return a handful. So the constraint reaches the database.

  Applied at every place a row can be reached — list, single record, update,
  delete, bulk delete, both sides of a related list, dashboard widgets and
  record actions. A scope that held in seven of eight would not be a scope.

  Addressing a row outside the scope answers **404, not 403**: a 403 would
  confirm the record exists, which is what the scope conceals.

  Widening the return type is backward compatible — an implementation returning
  a boolean still satisfies it, and a truthy object already meant "allow".

- **Named roles**, as a shorthand for that policy:

  ```ts
  roles: {
    admin: '*',
    editor: { models: { Post: ['metadata', 'list', 'read', 'create', 'update'] } },
    support: {
      models: { Order: ['metadata', 'list', 'read'] },
      scope: ({ context }) => [{ field: 'tenantId', operator: 'eq', value: tenantOf(context) }],
    },
  },
  roleOf: builtInRoleOf(),
  ```

  Roles compile into an `AdminResourceAuth` and then stop existing, so a rule
  written as a role and one written as a function are checked by identical
  code — one enforcement path, not two. An application that outgrows roles
  writes the function and loses nothing.

  A model a role never mentions is **invisible**, not read-only: it fails the
  `metadata` check, so the interface never learns it exists. An `action` is
  never implied by `update` — an action runs application code, and permission to
  edit a post is not permission to publish it.

  `roles` beside your own `resourceAuth` means both must agree. Fail closed:
  adding a rule can only remove access, never grant it.

- **`builtInRoleOf()`**, so an admin using the built-in login wires roles in one
  line. The role is read off the signed-in account and cannot be supplied by a
  client.

- **`AdminAccount.role`**, read by `prismaAccountStore` from a `role` column and
  shown in the user menu.

- **[SECURITY.md](SECURITY.md)** — what the admin guarantees, what it does not,
  and the four things a deployment has to get right.

- **A team screen**, reached from the user menu when the login is `builtInAuth`
  and its store can list accounts.

  It is deliberately _not_ the account table exposed as a resource — that stays
  excluded, because anyone with `update` on it could write another account's
  password hash, which is a complete takeover from a form with no password ever
  typed. This is the opposite arrangement: a hash is never accepted, only a
  password it derives one from; it sits behind the `manageTeam` capability; and
  it refuses to let you delete, disable or demote your own account.
  `AdminAccountStore` gains four **optional** write methods, so a store without
  them keeps working - the screen is then read-only, or absent.

### Notes

- **A fourth invariant was written and then deleted.** "Refuse to remove the
  last account that can manage the team" reads well and can never fire: the
  account making the request is signed in, so it is enabled and holds the
  capability, and the three self-rules mean it is never the target - it always
  survives its own check. Dead safety code is worse than none, because it
  advertises a protection that is not there. A test records why.

- **One role per request.** Combining two roles' scopes needs OR, and
  `ListQuery.filters` are ANDed. Doing it properly means changing the adapter
  contract, so it is deferred rather than half-built.

- **The edit-conflict guard moved to 0.12.1.** It is write safety rather than
  authorization, it needs its own error code and its own dialog, and bundling it
  would have delayed this.

- `roles` without `roleOf` refuses to start, naming the missing option. Denying
  every request instead would be a locked-out admin with no explanation.

---

## 0.11.1

Fixes the first defect reported from a published release.

### Fixed

- **Relation routes failed on a model with a numeric primary key.** Every
  `GET /admin/:model/:id/:relation`, attach and detach against an `Int @id`
  model answered 500:

  ```
  Argument `id`: Invalid value provided. Expected IntFilter or Int, provided String.
  ```

  Ids reach the adapter from a URL, so they are always strings, and Prisma
  refuses a string for an `Int @id` rather than converting it. The adapter knew
  that and converted in `#whereById` - but two _other_ places turn an id into a
  Prisma argument and neither did: the parent id inside a related-list filter
  (`{ post: { is: { id } } }`), and the target id inside a connect or disconnect.

  The conversion is now a module of its own, applied at each of the three points
  where an id becomes a Prisma argument rather than once at an entrance - that
  is where the mistake was made, so that is where the guard belongs. A
  non-numeric id for a numeric key is now refused with a message about the id,
  instead of one about Prisma's argument types.

  String-keyed models were never affected, which is why it survived to a
  release: the fixture schema's only integer-keyed model had no relations, so
  the whole class was untested. It now has three - a to-one inverse, a
  many-to-many and a self-relation - and the same questions are asked of the
  Drizzle adapter, which resolves a related list from the parent record's own
  key value and was never reachable.

  Reported by a consumer running the admin against a Medium-style schema.
  Thank you. If you wrote a subclass to work around this, it is safe to keep
  during the upgrade - converting an id twice does nothing - and can then be
  deleted.

### Notes

- No API changed. `AdminModule`, `OrmAdapter` and both adapters have the same
  surface as 0.11.0; the HTTP layer is untouched, because passing the id through
  unconverted is what it is supposed to do.

---

## 0.11.0

A second ORM, one `packages` tree, and documentation that matches the code.

### Added

- **A Drizzle adapter**, published as `@nest-admin/nestjs/drizzle` beside the
  Prisma subpath:

  ```ts
  import { DrizzleAdapter } from '@nest-admin/nestjs/drizzle'
  import * as schema from './schema'

  AdminModule.forRoot({ adapter: new DrizzleAdapter({ db, schema }), auth })
  ```

  Models are named by their export key and fields by their property key —
  the names your own queries use. Relations come from `relations()` where you
  declared them and from foreign keys where you did not, so an admin works
  against a schema that has never heard of Drizzle's relational API.

  SQLite and PostgreSQL. MySQL is refused at startup with a reason: it has no
  `RETURNING`, so a write could not report the stored row, and an adapter that
  returned the submitted data instead would hide every default.

- **Documentation that did not exist**: a
  [getting-started guide](docs/getting-started.md), a
  [configuration reference](docs/configuration.md) covering every option, and
  an [adapter guide](docs/adapters.md) describing the contract and what writing
  a second implementation actually cost.

- **Boundary checks for a two-ORM world.** Neither adapter may import the
  other's ORM or package; neither may import NestJS; the interface may import
  no ORM, no adapter and no Core. Previously "ORM-independent" was only ever
  checked against the one ORM that existed.

### Changed

- **`apps/admin-ui` is now `packages/admin-ui`, and `apps/` is gone.** The
  package name `@nest-admin/admin-ui` is unchanged, so every import is
  unchanged. The workspace now has two kinds of directory instead of three:
  packages that build, and examples that consume them.

- **A declared filter is coerced against the schema in the Prisma adapter too.**
  `parseFilters` is exported as `parseFilterExpression` and both the URL path
  and the dashboard path go through it.

### Removed

- **`packages/ui`.** It was twelve lines of comment, versioned and built every
  release. Its contents were only ever going to be the components the interface
  already has — vendored from shadcn, bundled into one artefact, with no second
  consumer to extract them for.

### Notes

- **Core did not change, and neither did anything above the adapter.** The
  module, the controller, the query parser, the metadata DTO, the exception
  filter, the dashboard and the interface are the same code both adapters run
  under. `packages/nestjs/test/drizzle-e2e.test.ts` drives the whole admin over
  Drizzle to prove it.

- **Two contract edges surfaced**, both recorded rather than patched over:
  `RecordId` is a single value, so a composite primary key can be listed but
  not addressed; and the contract assumed every adapter could name the columns
  in a constraint violation, which is true of Prisma and only mostly true of a
  raw driver. Both should be settled deliberately before 1.0.

- The packed-package checks grew from 48 to 56, covering the third entrypoint.

---

## 0.10.0

A landing page that answers a question, and a table that shows as many rows as
you want it to.

### Added

- **A dashboard.** `GET /admin/dashboard` returns a document of widgets and the
  interface draws four shapes from it. An admin that declares nothing still
  gets one, built from the schema:

  ```ts
  AdminModule.forRoot({
    adapter,
    auth,
    dashboard: [
      { kind: 'count', title: 'Customers', model: 'User', compareDays: 30 },
      { kind: 'count', title: 'Awaiting payment', model: 'Order', filter: 'status:eq:PENDING' },
      { kind: 'chart', title: 'New customers', model: 'User', bucket: 'day', buckets: 30 },
      { kind: 'list', title: 'Latest orders', model: 'Order', limit: 6 },
      { kind: 'stat', title: 'Revenue', load: async () => ({ value: '$12,400' }) },
    ],
  })
  ```

  `count`, `list` and `chart` name a model and a filter, and the server does the
  work — which is also what makes them _authorizable_: a widget over a resource
  the reader cannot list is absent from the document, never merely hidden by the
  interface, and its model is never queried. `stat` is the escape hatch; it runs
  application code, so the application's own rules apply to it.

  A widget that fails is one widget that says it could not load. The rest of the
  page still answers.

- **`AdminDashboard`, `DashboardWidget`** and the four widget types are exported
  from `@nest-admin/nestjs`.

- **A rows-per-page control.** Every table now offers 10, 25, 50 or 100 rows.
  The choice is remembered per browser and applies across the admin — 25 was a
  guess about a screen and a schema whoever picked it had never seen.

- **A dashboard entry in the sidebar**, above the resources, so the landing page
  is reachable from anywhere rather than only by clearing the URL.

### Changed

- **The landing page is the dashboard.** It used to say "Select a resource to
  begin", which is an instruction rather than an answer.

- **A declared filter is parsed by the same code a URL filter is.** `filter:
'active:eq:true'` on a widget means the boolean `true`, exactly as
  `?filter=active:eq:true` on the list screen does. A second parser would have
  drifted, and its drift would have been silent: a filter that coerces wrongly
  returns no rows rather than an error.

- **Numbers are formatted in the viewer's locale**, read from
  `navigator.language` rather than from whatever locale the runtime defaults to.

### Notes

- A dashboard has no `OrmAdapter` changes behind it. Counts read the page total
  the adapter already returns, and a chart is one count per bucket run
  concurrently — thirty parallel counts against an indexed column, rather than a
  `groupBy` on a contract that is about to be frozen at 1.0.

- The generated dashboard needs to know when a record was created, and no
  metadata says so: Prisma reports `@default(now())` and `@updatedAt`
  identically. It reads field names, and refuses to guess where the convention
  is not followed — a model with no recognisable creation timestamp gets a count
  and nothing else, rather than a chart of the wrong column.

---

## 0.9.0

A login, shipped in the box — without moving the boundary that kept
authentication with the host application.

### Added

- **`builtInAuth()`** — an `AdminAuth` implementation the package provides,
  with a login screen, sessions and a user menu. `AdminAuth` itself is
  unchanged; there are now three answers to "who may open this?" rather than
  one:

  ```ts
  auth: unsafeAllowAllRequests()   // development only, warns at startup
  auth: myOwnAuth                  // an application that already has identity
  auth: builtInAuth({ ... })       // a login page, sessions and a store
  ```

  An application using its own `AdminAuth` sees an admin with **no login
  routes at all** — not a sign-in form it cannot use.

- **`AdminAccountStore`** in Core, with `prismaAccountStore()` in
  `@nest-admin/nestjs/prisma`. A contract rather than a table, for the same
  reason `OrmAdapter` is one.

  The accounts are **separate from the application’s users** by construction —
  a model of its own, `AdminAccount` by default. The admin never reads the
  application’s `User` table to decide who may sign in, so adding a customer
  never adds an administrator. The store is read-only: seeding an account is
  the application’s job.

- **`hashAdminPassword()`** and **`generateSessionSecret()`**, for seeding.
  scrypt from `node:crypto` — no native module, so the package still installs
  identically everywhere. Cost parameters travel with each hash, so they can
  be raised later without a migration nobody can run.

- **`adminAccountOf(context)`** — who is signed in, for a `resourceAuth`
  policy or a hook.

### Security

Each of these has a test.

- An unknown address, a wrong password, a disabled account and a locked-out
  one answer **identically** — including in timing: the password is verified
  against a dummy hash when the account does not exist.
- Session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` everywhere but
  localhost, HMAC-SHA256 compared with `timingSafeEqual`.
- A new token on every sign-in, so a planted cookie cannot survive one.
- An `Origin` check on writes, when the header is present.
- Ten attempts per address, then fifteen minutes.
- A session secret under 32 characters is refused at construction.
- The account is loaded on **every** request, so disabling or deleting one
  ends its session immediately rather than when the cookie expires.

### Fixed

- **The rate limiter counted nothing.** `lockedOut` cleared the failure count
  whenever there was no active lockout — which is every call before the tenth —
  so the lockout never triggered. Found by the test that tries the right
  password after ten wrong ones.

### Known limitations

- **A session cannot be revoked before it expires.** Disabling the account is
  the revocation that works.
- The lockout counter is per process, so behind several instances an attacker
  gets the allowance once per instance. Not a substitute for a rate limiter at
  the edge.
- No roles, no password reset, no email, no OAuth, no 2FA.
- The admin cannot manage its own accounts — deliberate, and it does mean the
  second administrator is created by a script rather than a screen.
- A model named `auth` is unreachable, as one named `actions` or `assets`
  already was.

---

## 0.8.2

Three things found by working in 0.8.1's interface.

### Added

- **`writeOnly`** on a field override — accepted on a write, never returned on
  a read. The mirror of `readOnly`, and a password is what it is for:

  ```ts
  models: {
    User: { fields: { passwordHash: { label: 'Password', widget: 'password', writeOnly: true } } },
  }
  ```

  `hidden` cannot express this. It refuses the field in both directions, so a
  hidden password column leaves no way to set one — which is exactly the hole
  this repository's own example had. Enforced twice: the column is left out of
  the query the adapter is asked to make, and out of the projection applied to
  the result.

- **A reveal toggle on password inputs.** Masked by default, never remembered
  as revealed, and never offered to a password manager as the visitor's own
  credential — it belongs to somebody else's record.

- **`--link`**, a token for brand-coloured text, separate from `--primary`
  which fills a button. `theme.brandColor` now drives both, each held to its
  own contrast floor.

### Changed

- **A row shows its actions on a wide screen** — view, edit and delete as three
  buttons — and collapses them into one menu on a phone. The set is identical
  either way; a control that exists on a desktop and not on a phone is a
  feature people cannot find on the device they are holding.
- **Dark-mode fills take light labels.** The buttons had near-black text: it is
  legible and measurable and looks washed out, which is what it was reported
  as. Fixed by splitting the token above rather than by lowering the floor —
  every pairing still passes AA, asserted by the palette test.
- **A blank write-only field is omitted from a write**, so saving a record
  without retyping the password leaves the stored one alone. The ordinary rule
  would send `null` and clear it.

---

## 0.8.1

Fifteen things found by using 0.8.0's interface for an afternoon rather than
looking at it.

### Added

- **`models[Model].icon`** — an icon beside a resource in the navigation, from
  a closed set of 33 names. A model without one is drawn without one; the same
  symbol on every entry is decoration.

  ```ts
  models: { User: { label: 'People', icon: 'users' } }
  ```

- **Numbered pagination**, with a window that keeps a steady width so the
  buttons do not move under the cursor as you page.
- **Breadcrumbs** on every screen — Home / Resource / Record.
- **Row actions**: View and Edit as icon links named after the record, with
  Delete and any declared actions behind an overflow menu.
- **A calendar** for date fields, in a popover, keyboard-operable, in the
  viewer's locale and starting the week where their locale starts it. The text
  box beside it still accepts a typed date.
- **Table and form skeletons**, shaped like the content that is coming.

### Changed

- **Every select is now a Radix listbox.** A native `<select>` cannot be
  styled: its popup is drawn by the operating system, in the system font and
  the system's light palette even when the admin is dark. 0.8.0 chose the
  native element on bundle grounds and that was the wrong trade.
- **The theme control is one button** rather than three. It still follows the
  operating system until pressed — nothing is stored before that.
- **The sidebar is sticky**, has its own scrollbar, and collapses to an icon
  rail rather than disappearing. Its links stay reachable and named when
  collapsed, and the change is an eased width transition.
- **Forms use the full page**, in two columns where the fields are short.
- **Search, sort and filter share one wrapping row** instead of the filter
  always dropping to its own line.
- **Every interactive element gets `cursor: pointer`** and a hover that moves.
  A `<button>` inherits the arrow cursor from the user agent.
- Dialogs, menus and the mobile drawer animate in and out.

### Fixed

- **The pager elided pages it had room to show.** `pageSlots(1, 5)` returned
  `1 … 5`, hiding two pages behind an ellipsis no shorter than they were — and
  changing the number of buttons as you moved, which is what makes a click land
  on the wrong number. Found by its own test.

### Known limitations

- The interface bundle grew from **104 KB to 134 KB gzipped** — including the
  20 KB not spent by writing the calendar instead of installing one.
- No column sorting from table headers.
- The calendar changes the day; a datetime's time is edited in the text box.

---

## 0.8.0

A visual rebuild on Tailwind and shadcn/ui. No new capability: every screen that
worked before works the same way and looks like a different product.

### Added

- **A dark mode toggle**, with three states rather than two — light, dark, and
  follow the system. Remembered per browser. Closes a limitation carried since
  0.6.0.
- **A command palette** on `Ctrl+K` / `Cmd+K`, listing every resource the
  policy allows and offering to create one.
- **A collapsible sidebar**, remembered, and a drawer below 768px.
- **Real confirmation dialogs** replacing `window.confirm` — focus-trapped,
  announced as `alertdialog`, dismissable by escape, and returning focus to
  the button that opened them.
- **`theme.appearance`** — which appearance the admin starts from, before a
  viewer chooses. `'system'` by default.

### Changed

- **`theme.brandColor` now sets `--primary`, and is adjusted per palette.**
  The server measures the colour and emits a readable text colour for it, plus
  a variant lifted or lowered until it clears 4.5:1 against the page it sits
  on. A dark navy is unchanged on white and lightened for dark mode; a bright
  yellow is the other way round. The hue is preserved.

  Previously the value was written into `--brand` and `--accent` unchanged. If
  you relied on either variable name in custom CSS, it is now `--primary`.

- **The whole palette is token-based** (`--background`, `--foreground`,
  `--primary`, `--muted`, …), defined for light and dark. Anything that
  overrode the old hand-written class names will need rewriting.
- **The sidebar calls a resource by its configured label**, not its model name.

### Fixed

- **A structural option returned from `useFactory` was silently dropped.**
  `path`, `uiRoot` and `theme` are read when the module is defined, before any
  provider exists, so they belong beside `imports` in `forRootAsync` — not in
  the factory. TypeScript cannot catch this (excess property checks do not run
  through a function's return type), so it is now a startup error naming the
  option and where it goes.
- **An unknown `theme` key did nothing and said nothing.** Now a startup error,
  as unknown `resources` and `models` names already were.
- **Two contrast failures**, found by measuring the new palette: the warning
  colour against its own text (4.05:1), and the border of a text field against
  the page (1.41:1, where WCAG 1.4.11 asks 3:1 for a control boundary). Both
  are now held by a test that reads the stylesheet.
- **The `@prisma/client` peer range** said `>=6.0.0 <9` while the version gate
  accepts major 7 only — a consumer on Prisma 6 installed with no warning and
  failed at startup. Narrowed to `^7.0.0`.
- **`engines` and `keywords`** are declared in the published manifest. CI
  described itself as testing a Node floor that only the unpublished root
  manifest declared.

### Known limitations

- The interface bundle grew from **68 KB to 104 KB gzipped**.
- No per-model icons in the sidebar, and no sortable table headers.
- The command palette finds resources, not records.
- `repository`, `homepage` and `bugs` are still absent from the manifest:
  there is no git remote to read them from.

---

## 0.7.0

Everything an ordinary mistake does. Before this release a duplicate email, a
missing required field and a reference to a deleted record all answered
`500 INTERNAL_ERROR` with the message withheld — correct treatment for a broken
database, and the wrong treatment for someone who typed the same address twice.

### Added

- **Constraint violations are readable, and name the field.** A duplicate value
  is `409 CONSTRAINT_VIOLATION`, a missing required value is `400`, and both
  carry `details.fields`:

  ```json
  {
    "success": false,
    "error": {
      "code": "CONSTRAINT_VIOLATION",
      "message": "Another User already has this email.",
      "details": { "constraint": "unique", "fields": ["email"] }
    }
  }
  ```

  The message is written from the field names, never taken from the ORM — an
  ORM's own text carries file paths, generated query fragments and the values
  that collided, which is why the generic 500 existed in the first place.

- **Refusals appear under the input they are about**, rather than in a banner
  above the form. A banner is kept for a failure that names nothing, or names a
  field the form does not show.

- **`ValidationError` can name fields**, so an application's own refusal lands
  in the same place:

  ```ts
  throw new ValidationError('That address is already in use.', ['email'])
  ```

- **Multi-select and bulk delete.** `DELETE /admin/:model` with
  `{ "ids": [...] }`. Per-record hooks still run, so an application that refuses
  to delete a pinned record still refuses it when the record is one of forty
  checkboxes. A partial result is a 200 carrying both lists; at most 200 ids
  per request.

- **Case-insensitive search and text filters**, correct per provider —
  `mode: 'insensitive'` where Prisma accepts it, nothing where the collation
  already ignores case and Prisma would throw.

- **Deliberate empty states.** "No records yet" offers to create the first one;
  "nothing matches this search" offers to clear the search. They look the same
  and have opposite remedies.

- **Accessibility**: a skip link past the resource list, a visible focus ring,
  named checkboxes and tables, `aria-invalid` and `aria-describedby` on refused
  inputs, `aria-busy` while rows are being replaced, and a contrast pass — the
  muted text colour and the active navigation item both failed WCAG AA and now
  measure 5.0:1 and 7.3:1.

### Changed

- A page change or a new search term **keeps the previous rows on screen**,
  dimmed, instead of replacing the table with a line of text and putting it
  back — a flash that reads as a bug.
- Form labels associate by `for`/`id` rather than by wrapping the control. A
  wrapping label takes its whole text content as the field's accessible name,
  so adding a message inside one renamed the field to include the error.
- The resource list becomes a scrolling row below 700px.

### Fixed

- Prisma 7 with a driver adapter nests constraint metadata at
  `meta.driverAdapterError.cause.constraint.fields` rather than `meta.target`,
  so field names were missing from unique violations. Both shapes are read.
- A handful of visible strings used the raw model name where the rest of the
  interface uses the configured label — the search box announced "Search User"
  on a resource called "People".
- A missing required value arrives as `PrismaClientValidationError`, which
  carries no error code and so matched nothing. It is now recognised by name,
  and only the ``Argument `x` is missing`` phrase is read from its message —
  the rest renders the call site and the submitted data.

### Known limitations

- Bulk delete is **not transactional** and runs one statement per record —
  about 7 ms each, so a full selection of 200 takes roughly 1.4 s.
- Free-text search on SQLite ignores case for ASCII only; `LIKE` is defined
  that way and Prisma offers no option to change it there.
- Dark mode still follows the operating system; there is no toggle.

---

## 0.6.0

The seams an application writes into. People adopt an admin for what it does on
the first day and leave it for what it will not let them do in the third month.

### Added

- **`hooks`** — application code around every write, per model:

  ```ts
  hooks: {
    User: {
      beforeCreate: async ({ data, context }) => ({ ...data, slug: slugify(data.name) }),
      afterCreate: async ({ record, context }) => audit(record, context),
      beforeDelete: async ({ id }) => {
        if (await hasInvoices(id)) throw new ValidationError('This account has unsettled invoices.')
      },
    },
  }
  ```

  They run after authorization and after validation, so a hook is never reached
  by a request that would have been refused. What a `before` hook returns is
  validated again, so it cannot write a hidden or read-only field by accident.

  Nothing is transactional: an `after` hook that throws leaves the write done.

- **`actions`** — buttons CRUD does not imply. Declared on the server, drawn by
  the interface from metadata, so adding one needs no rebuild:

  ```ts
  actions: {
    Post: [
      { name: 'publish', label: 'Publish', scope: 'record',
        confirm: 'Publish this post?', run: async ({ id }) => ({ message: 'Published.' }) },
    ],
  }
  ```

  A `'record'` action appears on the detail page and receives the id; a
  `'list'` action appears above the list and does not. Actions the principal
  may not run are absent from the metadata, so the button is never drawn.

- **`'action'` is a distinct authorization operation**, not folded into
  `update`. An action can do anything, so a policy should decide about it
  separately — and a policy written before actions existed denies the value it
  does not recognise, which is the safe direction.

- **`ValidationError`** — the way application code refuses an input and has the
  reason reach the person who typed it. Maps to `400 VALIDATION_ERROR` with the
  message forwarded. Anything else a hook or action throws is still a 500 with
  the message withheld: that is the right treatment for code that broke rather
  than objected.

- **`theme`** — an accent colour, a title and a logo, applied to the served page
  without a rebuild. Values are validated at startup to shapes that cannot
  carry markup; a `title` containing a tag, or a `logoUrl` with a `javascript:`
  scheme, is a boot failure rather than a broken page.

- **Dark mode**, following the viewer's system preference. Only the design
  tokens are redefined, so every component follows without knowing a second
  palette exists, and a configured brand colour still wins in both.

### Fixed

- `verify:package` could exit non-zero after reporting every check as passed,
  when a killed child server emitted on its way out. The verdict is now the
  checks and nothing else — a flaky check is worse than a slow one, because
  people learn to re-run it rather than read it.

---

## 0.5.0

Per-field configuration, and an end to the interface offering buttons that
always fail.

### Added

- **`models`** — per-model and per-field configuration:

  ```ts
  models: {
    User: {
      label: 'People',
      displayField: 'email',
      fields: {
        passwordHash: { hidden: true },
        bio: { widget: 'textarea' },
        createdAt: { readOnly: true },
        role: { order: 1 },
      },
    },
  }
  ```

  `label`, `widget` and `order` are presentation, passed to the client. `hidden`
  and `readOnly` are **enforced**.

- **`hidden` removes a field from the admin entirely.** It is absent from the
  metadata, rejected in filters and sorts, refused in writes, excluded from
  free-text search, omitted from the database query, and stripped from every
  response — including related records and the record a write returns.

  Removing it from the metadata rather than flagging it is what makes that
  complete: every layer decides what it may do by reading the metadata, so a
  field that is not there is unreachable without any of them knowing the option
  exists.

- **`readOnly` fields are shown and refused.** Generated columns already were;
  this extends it to anything the application marks. A write naming one is a
  400, so a client that ignores the flag gets an error rather than a surprise.

- **Widgets**: `textarea`, `password`, `email`, `url`, `color`, `json`. A
  `string` column may be a sentence, a password or a colour and the schema
  cannot tell them apart.

- **`/admin/meta` reports what the principal may do**, per model, as
  `can: { list, read, create, update, delete }`. The interface withholds `New`,
  `Edit`, `Delete` and the relation controls accordingly — closing a gap a consumer
  walkthrough found, where a read-only principal was shown three buttons that
  all returned 403. It is a description, not the enforcement: every request
  is still checked when it arrives.

- **`ListQuery.fields`** tells an adapter which fields a query may touch and
  return. Without it, an adapter reading a schema would still search, sort,
  filter and fetch a column the application had hidden.

- **Startup refuses a configuration that cannot work.** A name matching no model
  or field is an error rather than a warning: a typo in `hidden` leaves the real
  column exposed while the configuration looks protective. Hiding a required
  field with no default is refused for a different reason — no record could ever
  be created, and the failure would surface as a database constraint violation
  far from its cause.

### Changed

- `FieldDto` gained `readOnly`, `label` and `widget`; `ModelDto` gained `label`
  and `can`. `ModelMetadata` gained an optional `displayField`, so a declared
  choice travels with the model.
- Fields and models are ordered by a declared `order` first, then by schema
  position. Anything unconfigured keeps its relative order.

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

The first tagged milestone: the workspace, the build, and the package name.

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
