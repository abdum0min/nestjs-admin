# Roadmap — to 1.0.0

The plan for turning Nest Admin into the admin package a NestJS + Prisma
application reaches for by default.

Prisma is the only adapter until 1.0. A second ORM before the first one is
finished would mean two half-products, and would freeze the `OrmAdapter`
contract before relations have tested it.

**Product first.** That held until 0.11.0, when the package was published: the
interface had stopped changing shape, and a second adapter had proved the
`OrmAdapter` contract. A live demo and the documentation site are still last.

---

## Delivered

0.1.0 through 0.14.0 are complete and published. Detail is in
[CHANGELOG.md](../CHANGELOG.md); the one-line version:

| Release | What it settled                                                             |
| ------- | --------------------------------------------------------------------------- |
| 0.1.0   | A fresh clone builds. CI exists. The package is `@nest-admin/nestjs`        |
| 0.2.0   | `forRootAsync`, a configurable mount path, resource selection               |
| 0.3.0   | To-one relations: a record shows a name, not a cuid                         |
| 0.4.0   | To-many relations, with one-to-many and many-to-many told apart             |
| 0.5.0   | `hidden` and `readOnly` enforced server-side; permissions in the metadata   |
| 0.6.0   | Hooks, actions, `ValidationError`, theming without a rebuild                |
| 0.7.0   | Constraint errors that name the field, bulk delete, accessibility, 50k rows |
| 0.8.0   | Design system: Tailwind, vendored shadcn, dark mode, command palette        |
| 0.9.0   | A login screen in the box, without moving the `AdminAuth` boundary          |
| 0.10.0  | Dashboard, and rows per page                                                |
| 0.11.0  | Drizzle adapter, documentation rewritten, **first npm publish**             |
| 0.11.1  | Numeric ids on relation routes — the first consumer-reported bug            |
| 0.12.0  | Roles, capabilities and row-level scoping; the team screen                  |
| 0.12.1  | Optimistic concurrency: the second save no longer overwrites the first      |
| 0.13.0  | File uploads, working with nothing configured                               |
| 0.13.1  | A file column drawn wherever it is read, not printed as a key               |
| 0.13.2  | Soft delete, and `eq null` fixed in the Drizzle adapter                     |
| 0.14.0  | Developer tools: mock data, pictures, undo, four-layer production gating    |
| 0.14.1  | Schema report, metadata viewer, fill this form, duplicate a record          |
| 0.14.2  | Schema map, and a report grouped by problem rather than by model            |
| 0.14.3  | Rich text on a string column, as its own chunk                              |
| 0.15.0  | Import and export, with a dry run that cannot be skipped                    |

**1300+ tests, 67/67 packed-consumer checks, published as
[`@nest-admin/nestjs`](https://www.npmjs.com/package/@nest-admin/nestjs).**

Three of the versions above never reached npm - `0.12.0`, `0.13.0` and `0.14.1`
were folded into the patch that followed. See the note at the top of the
changelog.

Where the project stands in full, including risks and carried debt:
[`project-state.md`](project-state.md).

---

## What changed about this plan

The original roadmap went 0.7.0 → documentation → publish. Two things found by
using the product moved the finish line, and both are worth stating plainly
because they cost four releases.

**The interface is competent and plain.** It is hand-written CSS, and it looks
it. Every capability is there — relations, permissions, actions, theming,
accessibility — and none of it reads as a product someone would choose on
sight. For a package whose whole pitch is "you do not build an admin", the
admin has to look like one you would have paid for.

**An application without its own auth cannot use this.** `AdminAuth` is
required and host-owned, which is right for a team that already has sessions
and wrong for everyone else: they must write a login, a password hash and a
cookie before they can put the admin behind anything. Django ships a login
page. So must this.

That second point deserves care, because it looks like a reversal of a rule
this project has held since 0.4.0 — _authentication stays with the host_. It is
not one. **The `AdminAuth` contract does not change.** What 0.9.0 adds is an
optional implementation of it that ships in the box, so a consumer picks one of
three:

```ts
auth: unsafeAllowAllRequests()   // development only, warns at startup
auth: myOwnAuth                  // an application that already has identity
auth: builtInAuth({ ... })       // a login page, sessions and a user store
```

The boundary stays exactly where it is. What changes is that standing on the
far side of it is no longer the consumer's problem to solve from scratch.

---

## Releases

| Release | Name                               | Why in this position                                                                           |
| ------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0.8.0   | Design system                      | Everything after it is drawn with it. Doing it later means building the dashboard twice        |
| 0.9.0   | Authentication                     | The single largest adoption barrier, and it needs the design system for its login screen       |
| 0.10.0  | Dashboard                          | The landing page. Needs the design system; independent of auth                                 |
| 0.11.0  | Second adapter, and the docs       | The contract had one implementation and 1.0 freezes it; docs had drifted three releases behind |
| 0.12.0  | Permissions, roles and scoping     | Scoping touches every read path, so it is cheapest before more read paths exist                |
| 0.13.0  | Files                              | The most-asked-for gap, and mock images and import both sit on top of it                       |
| 0.14.0  | Developer tools                    | Mock data, and the empty-admin problem. Needs 0.13 for avatars and covers                      |
| 0.14.1  | Diagnosis, and filling a form      | Reads the same metadata the tools do; no generation of its own                                 |
| 0.14.2  | Rich text                          | A widget with a bundle cost, so it ships where that cost is visible                            |
| 0.16.0  | Customisation                      | Deliberately after the functional set: you cannot design it before knowing what needs bending  |
| 0.17.0  | Docs site, demo, publishing polish | Once there is something worth showing                                                          |
| 1.0.0   | API freeze                         | Only after all of the above is stable                                                          |

---

### 0.8.0 — Design system

A visual rebuild on Tailwind and shadcn/ui. No new capability: every screen that
works today works the same way afterwards, and looks like a different product.

- **Tailwind CSS**, compiled at _our_ build time into the CSS we already ship.
  The consumer installs nothing and runs no build step; that constraint does not
  move.
- **shadcn/ui components, vendored** into `packages/admin-ui/src/components/ui/`.
  Copied rather than depended on, which is the point of shadcn: we own the code
  and are not tied to a component library's release cycle. It brings Radix
  primitives as real dependencies — bundled into the SPA, never into the
  consumer's `node_modules`.
- **The token system is rebuilt on shadcn's convention** (`--background`,
  `--foreground`, `--primary`, `--radius`, …), which is far richer than the
  three variables the server injects today. The `theme` option grows to match.
  Its validation does not relax: values are still checked to shapes that cannot
  carry markup, and a bad one is still a boot failure, not a broken page.
- **A dark mode toggle**, persisted per viewer. Closes a limitation carried
  since 0.6.0 — following the operating system only leaves a viewer who
  disagrees with theirs no recourse.
- **The shell and sidebar** rebuilt: collapsible navigation, a command palette
  for jumping between resources, a proper responsive layout rather than a
  breakpoint that stacks.
- **Housekeeping that blocks publishing**, folded in because it is an hour and
  it is the kind of thing that gets skipped: reconcile the `@prisma/client`
  peer range with the version gate (the manifest currently advertises support
  the code refuses), and add `engines`, `repository` and `keywords` to the
  published manifest.

**Out of scope:** new screens, the dashboard, any change to the HTTP API.

**Risks, named now rather than discovered later.** Radix uses portals,
`ResizeObserver` and pointer events, none of which jsdom implements fully — the
2,189 lines of existing UI tests will need polyfills, and some will need
rewriting. That is acceptable, and there is a hard line: a test may be rewritten
to match a new DOM, never to match a new behaviour. Bundle size is the other
one: the SPA is 220 KB of JavaScript today and Radix plus icons could double it.
Measured before and after, stated in the report, and only spent where it buys
something.

**Acceptance:** every existing UI test passes or is rewritten only for markup;
the packed tarball still installs and runs; the bundle's growth is measured and
justified; contrast and keyboard behaviour are no worse than 0.7.0 left them.

---

### 0.9.0 — Authentication

An optional login, shipped in the box. The `AdminAuth` contract is untouched.

- **`builtInAuth()`** — an `AdminAuth` implementation the package provides.
- **A user store contract**, with a Prisma implementation, so the accounts can
  live in the consumer's own database without this package deciding the schema.
  Contract first, exactly as `OrmAdapter` was: an admin whose accounts can only
  live in Prisma is an admin that has learned about Prisma.
- **Password hashing with `node:crypto`'s scrypt.** No bcrypt, no argon2: both
  are native modules, and this package has exactly one runtime dependency. That
  is a constraint worth keeping, and scrypt is a legitimate choice rather than a
  compromise.
- **Sessions** in a signed, `httpOnly`, `sameSite` cookie. Stateless by default
  — no session table — with the trade written down: a session cannot be revoked
  before it expires, so expiry is short and rotation is automatic. A stored
  variant goes through the same user store for consumers who need revocation.
- **A login screen**, inside the SPA. The UI controller is already unguarded, so
  the bundle is reachable before sign-in and no separate HTML page is needed.
- **First run**: an exported helper for creating the first account, and a loud
  startup message when the store is empty. Not a setup screen reachable in
  production, which is a hole with a friendly name.

The security work is the release, not a section of it: timing-safe comparison,
no user enumeration, rate limiting and lockout, CSRF on the login post, session
fixation on privilege change, and a refusal to boot without a real secret — the
same "fail at startup" pattern the three existing configuration checks use.

**Out of scope:** RBAC, roles, permission storage, password reset by email,
OAuth, SSO, 2FA. `resourceAuth` already decides what a principal may do; this
release only decides who they are.

**Acceptance:** an application with no identity system of its own can put the
admin behind a login by adding one option; every item on the security list has
a test; and an application that already has auth is entirely unaffected.

---

### 0.10.0 — Dashboard

A landing page that is useful before anything is configured, and configurable
without a build step.

- **Useful with zero configuration**: record counts per model, recent records,
  and — for models the metadata shows to have a creation timestamp — activity
  over the last thirty days. All of it derived from metadata, none of it from a
  model name.
- **Declared widgets**, server-side, the way actions are declared:

  ```ts
  dashboard: [
    { kind: 'stat', title: 'Revenue this month', load: async () => ({ value, delta }) },
    { kind: 'chart', title: 'Orders', model: 'Order', bucket: 'day', range: 30 },
    { kind: 'list', title: 'Awaiting review', model: 'Comment', filter: 'approved:eq:false' },
  ]
  ```

- **A closed set of widget kinds** — `stat`, `chart`, `list`, `table`. Closed on
  purpose: the interface has to know how to draw each one, and an open string
  would mean silently rendering nothing. This is the same reasoning that made
  `FieldWidget` a closed list in 0.5.0.
- **Authorized like everything else.** A widget over a model the principal
  cannot see is absent from the document, so the interface has nothing to draw.
- **Layout** declared with the widget: a grid position and span.

**Out of scope:** arbitrary React widgets. They would require the consumer to
build and bundle a component, which is precisely the thing this package exists
not to make people do — refused since 0.6.0 and still refused.

**Acceptance:** a new install shows a dashboard worth looking at with no
configuration; a declared widget appears without a UI change; a widget the
policy denies is absent from the document, not merely hidden.

**As shipped**, with two deviations from the plan above:

- The kinds are `count`, `list`, `chart`, `stat` — `table` was dropped. A table
  on a dashboard is a list screen with fewer features and a worse place to put
  it; `list` covers the case that was actually wanted.
- `range` is `buckets`, because it is a count of buckets rather than a span of
  days, and the two only coincide when `bucket` is `'day'`.

The plan's stronger reading of authorization is what was built: a denied
widget's model is never queried, not merely omitted from the response.

---

### 0.11.0 — A second adapter, and the documentation

Two pieces of work that were both scheduled later and both moved forward, for
the same reason: 1.0 freezes things, and neither of these gets easier by
waiting.

- **A Drizzle adapter.** `OrmAdapter` had exactly one implementation, which made
  "contract" and "description of Prisma" indistinguishable. Drizzle is the
  useful opposite of Prisma: a query builder with no generated client, no
  schema artefact and no normalised errors. Published as
  `@nest-admin/nestjs/drizzle`, beside the Prisma subpath.
- **The documentation, rebuilt.** The README claimed 0.8.0, `status.md` claimed
  304 tests, and `project-state.md` analysed 0.7.0. Replaced with a
  getting-started guide, a configuration reference, an adapter guide, and an
  honest state document.
- **One `packages` tree.** `packages/ui` was twelve lines of comment and was
  removed; `apps/admin-ui` moved to `packages/admin-ui`, so `apps/` is gone.

**Result:** Core needed no changes, and nothing above the adapter did either.
What that did and did not prove is recorded in
[adapters.md](adapters.md#what-the-second-adapter-proved).

---

### The rule every release below is checked against

**Zero configuration must keep behaving exactly as it does today.** Everything
added from here is opt-in. A single-admin project should still be able to write
no configuration at all after 0.15.0 and get the same admin it gets now.

That is the whole reason roles, scoping, files, dev tools and import are four
separate releases with four separate switches rather than one "enterprise mode".

---

### 0.12.0 — Permissions, roles and scoping

Three separate things, usually confused, each opt-in on its own:

|             | What it decides                  | Needed by           |
| ----------- | -------------------------------- | ------------------- |
| Roles       | what a principal _is_            | more than one admin |
| Permissions | what that role may do, per model | more than one admin |
| Scoping     | which **rows** it may see        | multi-tenant        |

**Scoping is a filter, never a post-filter.** `AdminResourceAuth.authorize` may
return a scope instead of a boolean, and it is merged into `ListQuery.filters`:

```ts
authorize({ model, operation, context }) {
  const user = context.switchToHttp().getRequest().user
  if (user.isAdmin) return true
  if (model !== 'Order') return true
  return { filters: [{ field: 'ownerId', operator: 'eq', value: user.id }] }
}
```

Filtering after the query would break `total`, so a page of 25 would show 3 and
"next page" would be empty - and on a large table it would read every row.
Widening the return type is backward compatible: an existing implementation
returns a boolean, which still satisfies it, and a truthy object already meant
"allow" so nothing changes meaning.

**Three places scoping is easy to forget**, and each gets a test:

1. the dashboard - an unscoped `count` leaks the number
2. `listRelated` - the child model needs the scope too
3. writes - a row you cannot see must not be one you can update

**Roles are sugar over the same contract**, so an application with its own
policy function is unaffected:

```ts
roles: {
  admin: '*',
  editor: { Post: ['list', 'read', 'create', 'update'] },
  support: { Order: ['list', 'read'] },
},
roleOf: (context) => context.switchToHttp().getRequest().user.role,
```

For `builtInAuth`, `AdminAccount` gains a role and the admin gets a **Team**
screen. That screen is a privilege-escalation surface and is designed as one:
only a role holding `manageTeam` may open it, nobody may grant a role above
their own, and nobody may change their own. Three rules, three tests.

**Also here:** an edit-conflict guard. Two admins on one record is not a problem
today because most installs have one admin - this release is what changes that.
The record's `updatedAt` travels with the patch and is compared server-side.

**Out of scope:** field-level permissions per principal. Wanted, but it changes
the metadata document's shape and belongs with the customisation work that also
touches it.

**Acceptance:** an application with no `roles` and no scope behaves exactly as
0.11 did; one with both can express "support sees only their own tenant's
orders, and cannot delete".

---

### 0.13.0 — Files

The most-asked-for missing feature, and the layer two later releases sit on.

- **`AdminStorage`**: `put`, `url`, `remove`. **Local disk is the default**, so
  uploads work with nothing configured; S3 or anything else is an
  implementation of three methods. A startup warning if local disk is still in
  use where the deployment looks like production.
- **What the schema needs: nothing.** The value is a string column - the
  `avatarUrl String?` most schemas already have. `widget: 'file'` or
  `'image'` declares the intent.
- **Upload security is the substance of this release**, not an afterthought.
  Serving user uploads from the admin's own origin is a session-stealing XSS in
  waiting. So: content type sniffed from the bytes rather than trusted from the
  extension or the filename; inline display only for an allowlist of image
  types; `Content-Disposition: attachment` for everything else; size limits;
  filename sanitised; path traversal refused.
- **Soft delete**, folded in here because it is closer to a defect than a
  feature: schemas with `deletedAt` currently show deleted rows as live and
  `delete` destroys instead of marking. One override fixes both.

**Acceptance:** an image field uploads, previews, replaces and clears with no
storage configuration; a `.html` disguised as a `.png` is refused.

---

### 0.14.0 — Developer tools

Enabled in configuration, and a page appears in the admin. This is the release
most likely to be the reason someone chooses this admin over another.

- **Mock data engine.** Believable rows from metadata alone: an `email` field
  gets an email, a `slug` gets a slug, an enum gets its own values, a unique
  column stays unique, a relation links to a row that exists, and `createdAt`
  is spread backwards through time so the dashboard chart looks alive.
- **`@faker-js/faker` is an optional peer.** Install it if you want mock data;
  the base package stays at one runtime dependency and one megabyte. The
  dev-tools module says so plainly when it is missing.
- **Default images, generated rather than shipped.** Identicon-style avatars and
  gradient covers drawn as SVG from the record itself: nothing added to the
  tarball, no network call, deterministic, and they look deliberate. When
  storage is configured they are written as real files - so mock data exercises
  the upload path from 0.13 rather than working around it.
- **Reset, truncate, seed snapshot.**
- **Schema doctor**: what the admin had to guess or could not resolve - models
  with no display field, relations whose other half could not be paired,
  composite keys it cannot address, models with no creation timestamp. All of
  that degrades silently today; this turns it into a list.

**Keeping it out of production is a security feature, not a convenience**, and
it does not rest on `NODE_ENV` - staging runs as production, and some hosts do
not set it at all. Four layers:

1. a separate subpath, `@nest-admin/nestjs/dev-tools` - not imported, not bundled
2. explicitly enabled in configuration, off by default
3. **refuses to start** where the deployment looks like production, without a
   second explicit acknowledgement
4. every destructive tool behind `resourceAuth`, a confirmation, and a startup
   warning - the same treatment `unsafeAllowAllRequests()` gets

**Acceptance:** a fresh database becomes a convincing demo in one click; the
same build refuses to do it in production.

**Delivered**, with two things that were planned here moved out. The schema
doctor is 0.14.1, because it is diagnosis rather than generation and shares no
code with it. Rich text is 0.14.2, for the reason below.

---

### 0.14.1 — Diagnosis, and filling a form

- **Schema doctor**: what the admin had to guess or could not resolve - models
  with no display field, relations whose other half could not be paired,
  composite keys it cannot address, models with no creation timestamp. All of it
  degrades silently today. Each finding carries the configuration that fixes it,
  ready to copy: a diagnosis nobody can act on is a list of complaints.
- **Metadata viewer**: `/admin/meta`, searchable. It sounds trivial and it is
  the product's own debugger - every screen is drawn from that document, so
  "why does this column look like that" is always answered there.
- **Fill this form**: one button on a create form, filled with believable
  values. The generator already exists; this is a dry run of one record.
- **Duplicate a record**: pre-fill a create form from an existing row, minus its
  id and unique columns. Shares the pre-fill machinery with the button above,
  which is why the two travel together.

---

### 0.14.2 — Rich text

`widget: 'richtext'` on a string column. **TipTap, loaded as its own chunk**, so
only a form with such a field pays the two hundred kilobytes.

Its own release rather than part of 0.14.1, because it shares no code with a
diagnosis screen, carries a bundle cost worth seeing on its own, and brings a
class of defect - paste, undo, selection - that is easier to find when nothing
else shipped beside it.

**Not CKEditor**, though that is the name people use for this. CKEditor 5 is
GPL-2.0-or-later or a commercial licence; bundling it into an MIT package would
push GPL onto every application that installs this one. TipTap's core is MIT and
gives the same editing experience.

**The stored value is HTML**, which is portable and is what an application wants
to render on its own site. Displaying it back is the security question: HTML
from the database rendered on the admin's own origin is a session-stealing XSS
if anything less trusted than an administrator can write that column. So the
detail page renders it **through TipTap in read-only mode** - the editor parses
HTML into its own schema and drops everything the schema does not contain,
`<script>` included, which makes the editor its own sanitiser and adds no
dependency. List cells show the text with the tags stripped, and link `href`s
that are not http, https or mailto are refused.

**Acceptance:** a paragraph with a heading, a list and a link round-trips
through the form; `<script>` in a stored value renders as nothing on every
screen that shows it.

---

### 0.15.0 — Import and export — **delivered**

Both directions reuse the admin rather than reaching past it. An export pages
through the list service, so the caller's filters, the policy's row scope, the
field projection and the deleted view are the ones already in force. An import
calls create and update, so hooks run and every permission is checked.

- **Export**: CSV or JSON, streamed, from whatever the list is showing. Refused
  above 50,000 rows, _before_ any bytes are sent - a stream cannot change its
  mind about a status code.
- **The CSV is written to be opened**: byte-order mark, a choice of separator,
  RFC 4180 quoting, and cells beginning `=` `+` `-` `@` defused, because those
  are formulas to Excel and the reader takes the apostrophe back off.
- **Import**: map, dry-run, confirm. Up to 1,000 rows, because it runs inside
  the request and every row goes through the application's hooks.
- **Updates as well as creates**, by any unique column. Relations resolve by
  key or by name, and an ambiguous name refuses the row rather than guessing.
- **`exportData`**, a new capability: taking the whole table away is not the
  same act as reading a page of it.
- No `.xlsx`. It needs a library or three hundred lines of ZIP and XML, and the
  CSV above opens in Excel. Deferred rather than refused.

**Acceptance:** met - a thousand-row file reports its bad rows by line number
and reason, and nothing is written until it is confirmed.

---

### 0.16.0 — Customisation

Deliberately after the functional set. Everything that turns "the admin" into
"our admin", now that there is enough built to know what needs bending.

- **Navigation**: groups with headings, ordering, icons, custom links, dividers.
- **List presentation** per model: which columns, default sort, page size,
  density.
- **Detail layout** hints: field groups and sections, rather than one flat list.
- **Saved views** — a named filter and sort a person returns to.
- **Theming to the full token set**: fonts, radius, density, a complete palette
  rather than one accent.
- **Field-level permissions per principal**, which shares the metadata-shape
  change the items above need.
- **More dashboard widgets, and the beginnings of custom pages** - server
  declared, drawn from the same closed vocabulary, so still no build step in the
  consuming project.
- **Carried debt, closed here**: the non-owning half of a one-to-one is
  currently invisible (`User.profile` is absent from the record and its nested
  route answers 400); composite primary keys can be listed but not addressed,
  because `RecordId` is a single value; and `packages/cli` is still an empty
  package that is versioned every release and should either gain content or go.

**Out of scope:** custom pages, plugins, a component API.

**Acceptance:** the example application looks like a product built for its own
domain, using configuration only — no forked component, no build step.

---

### 0.17.0 — Docs site, demo, publishing polish

- A documentation site covering every configuration key, hook, widget, action
  and relation scenario. Tooling still undecided — see below.
- A live demo with seeded data, reset daily. The example's schema and seed are
  already the right size for it.
- README rewrite: a recording, a three-line install, and an honest list of what
  is still missing.
- Changesets and a release pipeline. `prepublishOnly` already refuses a
  tarball with pieces missing; what is absent is anything that runs the tests
  before a publish rather than trusting whoever typed the command.

**Already done, ahead of this release:** the `@nest-admin` scope is claimed,
0.11.0 and 0.11.1 are published, and the manifest carries `repository`,
`homepage`, `bugs` and `author` — without the first of those, every
documentation link on the npm page would have been broken.

**Acceptance:** a stranger installs the admin from the documentation alone.

---

### 1.0.0 — API freeze

The first publish happened in 0.11.0, which is why this is a freeze rather than
a launch. 0.x has been saying "this may still change"; 1.0 stops saying it.

- Audit the public API: every export deliberate, documented and used.
- A semver guarantee and a support policy.
- Final review of the `OrmAdapter` contract, which a second adapter now builds on.
- Settle `RecordId` and best-effort constraint fields, below.

**Done in 0.11.0**: the second adapter this section asked for. It is not thin
and it is shipped — Drizzle, with its own suite and an end-to-end HTTP suite
that drives the whole admin over it. Core needed no changes, and neither did
anything above the adapter, which is the evidence this freeze needed and did not
previously have.

What it left for the freeze to settle is small and specific: `RecordId` is a
single value, so composite keys cannot be addressed; and the contract assumed
every adapter could name the columns in a constraint violation, which is true of
Prisma and only mostly true of a raw driver.

**Out of scope:** new features. Any at all.

---

## Rules that hold across every phase

- **The rhythm does not change.** Brief, implementation, changelog entry, commit
  with explicit paths. No AI co-author trailer. No `git add -A`.
- **Metadata-driven stays metadata-driven.** The UI never learns the schema.
  Any new capability is expressed in metadata, never as a model name in UI
  code. The dashboard is the first real test of this rule and does not get an
  exemption from it.
- **The ORM boundary holds.** `@nest-admin/core` does not see Prisma. Every new
  capability is expressed in a contract first, then implemented — including the
  user store in 0.9.0.
- **Authentication stays with the host.** The `AdminAuth` contract is the
  boundary and does not move. 0.9.0 ships an implementation of it; it does not
  replace it, and an application with its own auth keeps working untouched.
- **No consumer build step.** Configuration is server-side declaration drawn by
  the interface. Anything that would make a consumer bundle a React component
  is out of scope, whatever it is called.
- **Every phase ends green.** `build`, `typecheck`, `test`, `format:check` and
  `verify:package` all pass. The test count does not go down.
- **A test may be rewritten to match new markup, never to match new
  behaviour.** 0.8.0 will put real pressure on this one.
- **Breaking changes are written down.** Allowed while on `0.x`, but never
  silently — each one gets a CHANGELOG entry saying what to do about it.

---

## Deferred decisions

Left open on purpose; the context will be clearer when they are reached.

- **Documentation tooling.** Starlight is lighter and enough for a
  single-package library; Docusaurus is more familiar and brings versioning and
  a blog. Either is reversible. Decide at 0.12.0.
- **Demo hosting.** Fly.io offers a persistent disk and suits SQLite, but costs
  money. Free alternatives: Render (sleeps, fine for a demo), Railway, or
  Vercel with Neon's free tier. Decide at 0.12.0.
- **Icon set.** shadcn assumes `lucide-react`. It is a real bundle cost for a
  set we use perhaps thirty icons from; a subset import or a hand-picked SVG
  sprite may be the better trade. Measure at 0.8.0.
- **Session storage.** Stateless by default in 0.9.0. Whether the stored
  variant ships in the same release depends on how much the user store contract
  has to grow to carry it.
