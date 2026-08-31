# Project State

An assessment of Nest Admin as it stands after **0.11.0**: what exists, what it
cost, what is at risk, and what should happen next. Written to be read by
someone deciding whether to depend on this, or whether to keep building it.

Where a claim here is a measurement, it was measured. Where it is a judgement,
it says so.

- [1. At a glance](#1-at-a-glance)
- [2. Position against the roadmap](#2-position-against-the-roadmap)
- [3. The architecture, and whether it holds](#3-the-architecture-and-whether-it-holds)
- [4. What a consumer actually touches](#4-what-a-consumer-actually-touches)
- [5. What the process has caught](#5-what-the-process-has-caught)
- [6. Risks, ranked](#6-risks-ranked)
- [7. Known limitations](#7-known-limitations)
- [8. How it compares, honestly](#8-how-it-compares-honestly)
- [9. What should happen next](#9-what-should-happen-next)
- [10. Summary judgement](#10-summary-judgement)

---

## 1. At a glance

|                                          |                                                              |
| ---------------------------------------- | ------------------------------------------------------------ |
| **Version**                              | 0.11.0 — twelve releases, none published                     |
| **Commits**                              | 108                                                          |
| **Tests**                                | 936, across 52 files                                         |
| **Packed-package checks**                | 56                                                           |
| **Published packages**                   | 1 (`@nest-admin/nestjs`); everything else is bundled into it |
| **Runtime dependencies of that package** | 1 (`@prisma/get-dmmf`)                                       |
| **Interface bundle**                     | 137.8 KB gzipped, served by the package itself               |
| **ORMs supported**                       | 2 (Prisma, Drizzle)                                          |
| **Consuming-project build step**         | none                                                         |

### Where the code is

| Package             | Source | Tests | What it is                                        |
| ------------------- | -----: | ----: | ------------------------------------------------- |
| `packages/core`     |  1,416 |   445 | Contracts, metadata, errors. No ORM, no framework |
| `packages/prisma`   |  1,781 | 1,480 | The Prisma adapter                                |
| `packages/drizzle`  |  1,421 |   712 | The Drizzle adapter                               |
| `packages/nestjs`   |  5,291 | 5,911 | The integration, and the one published package    |
| `packages/admin-ui` |  6,713 | 4,219 | The interface, bundled into that package          |
| `packages/cli`      |     20 |     0 | **Empty stub**                                    |

Lines of test are roughly equal to lines of source. That ratio is not a target;
it is what happens when every release is verified against a real consumer.

---

## 2. Position against the roadmap

| Release     | Status   | What it delivered                                                                       |
| ----------- | -------- | --------------------------------------------------------------------------------------- |
| 0.1.0–0.4.0 | done     | Foundation, DI, mount path, resource selection, relations both ways                     |
| 0.5.0–0.7.0 | done     | Field overrides, hooks, actions, theming, constraint errors, bulk delete, accessibility |
| 0.8.0–0.8.2 | done     | Design system on Tailwind and shadcn; two rounds of interface repair                    |
| 0.9.0       | done     | `builtInAuth()`: login page, sessions, scrypt, without moving the auth boundary         |
| 0.10.0      | done     | Dashboard, and a rows-per-page control                                                  |
| **0.11.0**  | **done** | **Drizzle adapter, workspace restructure, documentation rebuilt**                       |
| 0.11.5      | next     | Customisation: navigation, list presentation, saved views, row-level auth               |
| 0.12.0      | planned  | Docs site, demo, publishing preparation                                                 |
| 1.0.0       | planned  | API freeze, first publish                                                               |

The project is ahead of where the original plan put it, and the two releases
that were _moved forward_ — the second adapter and the documentation — were
moved because both get harder after a freeze, not easier.

---

## 3. The architecture, and whether it holds

Four rules were set early. Each is now checked by a test rather than by
discipline, and 0.11.0 was the first release that could genuinely test the
first two.

### The interface never learns the schema

Everything the admin draws comes from `GET /admin/meta`. No model name, no field
name and no ORM type appears anywhere in `packages/admin-ui`.

**Evidence, not assertion:** adding a second ORM changed **zero lines** of the
interface. A boundary test fails the build if `packages/admin-ui` ever imports
Core, an adapter or an ORM.

### Core knows no ORM and no framework

`packages/core` imports nothing at runtime — the manifest's `dependencies` is
asserted to be empty — and imports neither Prisma, nor Drizzle, nor NestJS.

**What 0.11.0 changed here:** until then, "ORM-independent" had only ever been
checked against the one ORM that existed, which is not much of a check. It is
now checked against two, and the two adapters are asserted not to import each
other's ORM or package.

### Authentication belongs to the host

`AdminAuth` is required, has one method, and receives the raw `ExecutionContext`.
0.9.0 added `builtInAuth()` — an _implementation_ of that contract, not a
replacement for it. An application with its own identity system is entirely
unaffected by its existence, and the contract did not change to accommodate it.

### One published package

Core, both adapters and the interface are `private: true` and bundled into
`@nest-admin/nestjs` at build time. A consumer installs one thing.

The cost is precise and is asserted every release: ESM shares one copy of Core
through a chunk, CJS cannot code-split, so each entrypoint inlines its own copy.
That is why framework errors are identified by a `Symbol.for` brand and a `kind`
rather than by `instanceof`. With three entrypoints now (`.`, `./prisma`,
`./drizzle`), the counts are still asserted individually.

---

## 4. What a consumer actually touches

```ts
AdminModule.forRootAsync({
  imports: [DatabaseModule],
  inject: [PrismaService],
  path: '/admin',
  theme: { title: 'Acme', brandColor: '#3f6212' },
  useFactory: (prisma) => ({
    adapter: new PrismaAdapter({ client: prisma }),
    auth: builtInAuth({ store: prismaAccountStore({ client: prisma }), session: { secret } }),
    resources: { exclude: ['AdminAccount'] },
    models: {/* labels, widgets, visibility */},
    hooks: {/* rules the schema cannot express */},
    actions: {/* buttons the interface draws */},
    dashboard: [/* four widget kinds */],
  }),
})
```

That is the whole surface. Everything else is read from the schema.

The reference consumer in `examples/basic` uses all of it against an
eleven-model schema with three self-relations, two many-to-many relations and a
join table carrying payload. It is not a toy, and every release is verified
against it **installed from a packed tarball**, not from the workspace.

---

## 5. What the process has caught

Every release found defects before it shipped, and each is recorded in that
release's report — including the unflattering ones. They are worth grouping by
_how_ they were found, because that is the argument for the process rather than
for the code.

| Found by                                                | Examples                                                                                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Installing the packed tarball into a fresh consumer** | Emitted declarations referencing an unpublished package; a `.wasm` resolved relative to the wrong bundle; `instanceof` failing across CJS entrypoints                |
| **Driving the real interface in a real DOM**            | Dialog focus returning to `<body>`; a pager window that hid page 5 of 5; a session gate that hung for every externally-authenticated application                     |
| **Measuring rather than eyeballing**                    | Two WCAG contrast failures, one an input border at 1.41:1 against a 3:1 floor                                                                                        |
| **A test that asked the obvious question**              | A rate limiter that counted nothing because it deleted its own counter; a widget filter parsed two different ways in two places                                      |
| **Writing the second adapter**                          | A dashboard route shadowed by `:model`; `RecordId` cannot address a composite key; constraint columns reported in the database's vocabulary rather than the schema's |

The first row is the important one. At the 0.7.0 review, eight of the nineteen
defects recorded to that point were in it — findable **only** by installing the
tarball. Not one would have been caught by a unit test, by CI running
`pnpm test`, or by a careful reading.

### What this bought

- Errors are identified by brand, not `instanceof`, because a real consumer
  proved `instanceof` fails across CJS entrypoints.
- `theme` returned from a factory is a startup error, because it was silently
  dropped and TypeScript cannot catch it.
- An unknown `theme` key is a startup error, because `accent` instead of
  `brandColor` did nothing, silently.
- The interface's contrast is measured against WCAG floors by a test that reads
  the stylesheet, because two pairings failed when measured.
- A declared dashboard filter goes through the same parser a URL filter does,
  because two parsers had already drifted.

---

## 6. Risks, ranked

### 1. Row-level permissions do not exist

`AdminResourceAuth` answers per model and per operation. It cannot express
"only their own orders", which is what most real deployments need the moment
more than one person uses the admin.

This is the largest _functional_ gap, and it is API-shaped: 1.0 freezes APIs, so
adding it afterwards is either a breaking change or a bolt-on beside the
existing mechanism. **It should land before 1.0.** It is now scheduled for
0.11.5.

_Severity: high. Mitigation: scheduled._

### 2. The npm scope is not claimed

`@nest-admin/nestjs` is available. The unscoped `nest-admin` and `nestjs-admin`
are both taken — by packages last published in 2022 and abandoned — which is
itself the argument for using the scope.

This is free, takes minutes, and is irreversible if someone else takes it first.
It is on the roadmap for 0.12.0, which is too late.

_Severity: medium. Cost to fix: near zero. Do it now._

### 3. The published manifest is not ready to publish

No `repository`, `homepage` or `bugs` field, and no git remote to derive them
from. An npm page with no link to its source reads as abandoned before anyone
has tried it.

_Severity: low. Cost to fix: minutes, once the repository has a home._

### 4. The `OrmAdapter` contract has two implementations, not three

**Improved in 0.11.0, and no longer the top risk.** Writing the Drizzle adapter
against a deliberately different ORM — a query builder with no generated client,
no schema artefact and no normalised errors — required no change to Core and no
change to anything above the adapter.

What remains: both implementations are SQL. A document store would ask different
questions of `ListQuery` and of `RecordId`, and nobody has asked them.

_Severity: medium, down from high. Mitigation: the contract has been exercised
by a genuinely different implementation and the two edges it exposed are
recorded below._

### 5. Two contract edges found by the second adapter, unsettled

- **`RecordId` is a single value.** A model with a composite primary key can be
  listed but not opened. Prisma had the same limitation; it had simply never
  been hit, because a Prisma schema tends to have an `@id`.
- **Constraint field names are best-effort.** The contract assumed an adapter
  could always report which column a violation was about. Prisma can. A raw
  driver can only sometimes, by parsing a message. `ConstraintError` already
  allowed an empty list and the interface already degrades to a banner — so it
  held, but by luck rather than by design.

Both should be decided deliberately before the freeze rather than inherited.

_Severity: medium. Cost to fix: a decision, then a small change._

### 6. One empty package is versioned and built

`packages/cli` is twenty lines of comment. It is versioned every release and
built every build. It should either gain content or go.

`packages/ui` had the same problem and was removed in 0.11.0 — its contents were
only ever going to be the components the interface already has, with no second
consumer to extract them for.

_Severity: low. Judgement: keep the CLI (`nest-admin init` is real value),
but it should be built or dropped by 1.0._

### 7. Documentation drift

**Fixed in 0.11.0, and worth recording because it recurred.** The README claimed
0.8.0 three releases after 0.8.0; `status.md` claimed 304 tests when there were
900; this document analysed 0.7.0.

Reports do not drift, because each is written once about one release and never
revised. Living documents drift, because nothing fails when they do. The
mitigation now is a shorter set of living documents, each with an obvious owner
section, and a habit of updating them in the release commit rather than
afterwards.

_Severity: low, but self-repeating. Watch it._

---

## 7. Known limitations

Consolidated, so nobody has to discover these one at a time.

**Data**

- Composite primary keys: listed, not addressable.
- The non-owning half of a one-to-one is invisible (`User.profile` is absent
  from the record, and its nested route answers 400).
- No nested writes — a parent and its children cannot be created in one form.
- `json` fields are edited as text.
- No file uploads, and no rich text.

**Authorization**

- Nothing row-level.
- Nothing field-level _per principal_; `hidden` and `readOnly` are global.

**Interface**

- No user-arranged dashboard, no global time range, no auto-refresh.
- No saved views.
- No column selection or density control per model.
- Navigation is a flat list; no groups or headings.

**Adapters**

- Prisma and Drizzle only.
- Drizzle: MySQL refused at startup (no `RETURNING`); PostgreSQL written for but
  not yet tested; many-to-many is a join table resource rather than a relation.

**Packaging**

- Nothing published.
- No CLI.
- No documentation site, no demo.

---

## 8. How it compares, honestly

The comparison people will make is with Django Admin, AdminJS and React Admin.

**Against Django Admin** — the model this is aiming at. Django's admin has
row-level hooks, inlines, per-field permissions, an action framework and twenty
years of edge cases. This has a better default interface and a much better
authorization _boundary_, and is missing inlines, row-level rules and per-field
permissions. It is not close on breadth, and pretending otherwise would waste
whoever believed it.

**Against AdminJS** — the closest Node equivalent. AdminJS supports more ORMs
and has a component API. This has no component API by choice: shipping one means
every consumer runs a front-end build, which is the specific pain this exists to
remove. Whether that trade is right depends entirely on whether you wanted to
write React.

**Against React Admin** — a different product. React Admin is a front-end
framework you build an admin _with_. This is an admin you _get_. Someone who
wants to control every screen should use React Admin and will be happier.

**Where this is genuinely ahead**: the security boundary. A hidden field is
absent from responses, an unauthorized model is absent from the metadata
document, a dashboard widget over a forbidden resource is never queried, and
none of it depends on the client behaving. That is unusual, and it is the part
most worth keeping as features accumulate.

---

## 9. What should happen next

In order, with reasoning.

1. **Claim the npm scope.** Minutes, free, irreversible if lost. It is the only
   item here with an external actor who can take the option away.
2. **Row-level authorization (0.11.5).** The largest functional gap and the one
   that must not wait for after the freeze.
3. **The rest of customisation (0.11.5).** Navigation groups, list presentation,
   saved views. These are the things people will hit on day two.
4. **Settle the two contract edges.** Composite keys and best-effort constraint
   fields. A decision each, then a small change.
5. **Docs site and demo (0.12.0).** The written documentation now exists and is
   current; a site and a live demo are what turn it into adoption.
6. **Decide the CLI.** Build `nest-admin init` or delete the package.
7. **Freeze and publish (1.0.0).** Audit every export, write the semver
   guarantee, publish.

What should **not** happen next: more features. The gap between this and being
usable by a stranger is documentation, publishing and row-level permissions —
not capability.

---

## 10. Summary judgement

The foundation is sound and has now been tested rather than merely asserted.
The four architectural rules hold, and 0.11.0 was the first release able to
prove the two most load-bearing of them: a second ORM changed nothing in Core,
nothing in the HTTP layer and nothing in the interface.

The process is the real asset. Every release has found defects before shipping,
a substantial share of them findable only by installing the packed tarball into
a real consumer, and every one is recorded in a report whether or not it was
flattering. That habit is why the surprises have been small and early.

What is left before 1.0 is well understood and mostly not code: claim a name,
close one functional gap that is API-shaped, settle two contract edges, and
publish. The risk is no longer "is this built correctly" — it is "is it frozen
at the right time", and that question now has evidence behind it rather than
optimism.
