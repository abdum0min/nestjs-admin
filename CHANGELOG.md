# Changelog

Notable changes to `@nest-admin/nestjs`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, the public API may change in any release. Every
breaking change is listed below with what to do about it.

Nothing has been published to npm yet. Versions here are development milestones;
the first publish is planned for `1.0.0`. See [docs/roadmap.md](docs/roadmap.md).

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
