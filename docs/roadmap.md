# Roadmap — to 1.0.0

The plan for turning Nest Admin into the admin package a NestJS + Prisma
application reaches for by default.

Prisma is the only adapter until 1.0. A second ORM before the first one is
finished would mean two half-products, and would freeze the `OrmAdapter`
contract before relations have tested it.

**Product first.** Documentation, a live demo and the first npm publish are
deliberately last. Nothing is published while the interface is still changing
shape, because the first impression is the one that sticks — and because
nothing installed means the API, and even the package name, stay free to
change.

---

## Delivered

0.1.0 through 0.7.0 are complete. Detail is in [`reports/`](../reports/); the
one-line version:

| Release | What it settled                                                             |
| ------- | --------------------------------------------------------------------------- |
| 0.1.0   | A fresh clone builds. CI exists. The package is `@nest-admin/nestjs`        |
| 0.2.0   | `forRootAsync`, a configurable mount path, resource selection               |
| 0.3.0   | To-one relations: a record shows a name, not a cuid                         |
| 0.4.0   | To-many relations, with one-to-many and many-to-many told apart             |
| 0.5.0   | `hidden` and `readOnly` enforced server-side; permissions in the metadata   |
| 0.6.0   | Hooks, actions, `ValidationError`, theming without a rebuild                |
| 0.7.0   | Constraint errors that name the field, bulk delete, accessibility, 50k rows |

**627 tests, 48/48 packed-consumer checks, nothing published.**

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

| Release | Name                               | Why in this position                                                                     |
| ------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| 0.8.0   | Design system                      | Everything after it is drawn with it. Doing it later means building the dashboard twice  |
| 0.9.0   | Authentication                     | The single largest adoption barrier, and it needs the design system for its login screen |
| 0.10.0  | Dashboard                          | The landing page. Needs the design system; independent of auth                           |
| 0.11.0  | Customisation                      | You cannot design a customisation API before you know what needs customising             |
| 0.12.0  | Docs, demo, publishing preparation | Once there is something worth showing                                                    |
| 1.0.0   | API freeze and first publish       | Only after all of the above is stable                                                    |

---

### 0.8.0 — Design system

A visual rebuild on Tailwind and shadcn/ui. No new capability: every screen that
works today works the same way afterwards, and looks like a different product.

- **Tailwind CSS**, compiled at _our_ build time into the CSS we already ship.
  The consumer installs nothing and runs no build step; that constraint does not
  move.
- **shadcn/ui components, vendored** into `apps/admin-ui/src/components/ui/`.
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

**As shipped** (see [reports/020-dashboard.md](../reports/020-dashboard.md)),
with two deviations from the plan above:

- The kinds are `count`, `list`, `chart`, `stat` — `table` was dropped. A table
  on a dashboard is a list screen with fewer features and a worse place to put
  it; `list` covers the case that was actually wanted.
- `range` is `buckets`, because it is a count of buckets rather than a span of
  days, and the two only coincide when `bucket` is `'day'`.

The plan's stronger reading of authorization is what was built: a denied
widget's model is never queried, not merely omitted from the response.

---

### 0.11.0 — Customisation

Everything that turns "the admin" into "our admin", now that there is enough
built to know what needs bending.

- **Navigation**: groups with headings, ordering, icons, custom links, dividers.
- **List presentation** per model: which columns, default sort, page size,
  density.
- **Detail layout** hints: field groups and sections, rather than one flat list.
- **Saved views** — a named filter and sort a person returns to.
- **Theming to the full token set**: fonts, radius, density, a complete palette
  rather than one accent.
- **Carried debt, closed here**: the non-owning half of a one-to-one is
  currently invisible (`User.profile` is absent from the record and its nested
  route answers 400), and `packages/ui` and `packages/cli` are empty packages
  that are versioned every release and should either gain content or go.

**Out of scope:** custom pages, plugins, a component API.

**Acceptance:** the example application looks like a product built for its own
domain, using configuration only — no forked component, no build step.

---

### 0.12.0 — Docs, demo, publishing preparation

- A documentation site covering every configuration key, hook, widget, action
  and relation scenario. Tooling still undecided — see below.
- A live demo with seeded data, reset daily. The example's schema and seed are
  already the right size for it.
- README rewrite: a recording, a three-line install, and an honest list of what
  is still missing.
- Changesets and the publishing pipeline; a final review of `npm pack` contents.
- **Claim the `@nest-admin` npm scope.** This is free and irreversible if
  someone else does it first, so it should happen before this release rather
  than in it.

**Acceptance:** a stranger installs the admin from the documentation alone.

---

### 1.0.0 — API freeze and first publish

- Audit the public API: every export deliberate, documented and used.
- A semver guarantee and a support policy.
- Final review of the `OrmAdapter` contract, which the second adapter will build
  on.
- The first npm publish.

**Before the freeze**, a thin second adapter — Drizzle or TypeORM — even if it
is never shipped. The contract has exactly one real implementation, and the
in-memory test double is written against the same assumptions, so it is weaker
evidence of generality than it looks. Freezing an interface with one
implementation is the standard way to discover at 1.1 that it needed a breaking
change.

**Out of scope:** new features. Any at all.

---

## Rules that hold across every phase

- **The rhythm does not change.** Brief, implementation, `reports/NNN`, commit
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
