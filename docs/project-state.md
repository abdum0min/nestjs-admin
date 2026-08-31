# Project State

An analysis of Nest Admin as it stands after 0.7.0: what exists, what it cost,
what the process has actually caught, and what stands between here and being
the admin package a NestJS + Prisma application reaches for by default.

Written to be read by someone deciding whether to depend on this, contribute to
it, or fund the remaining work. It is deliberately unflattering where the
evidence is unflattering; a status document that only lists wins is worth
nothing to any of those three readers.

Per-release detail lives in [`reports/`](../reports/). This is the view across
all of them.

---

## 1. At a Glance

|                            |                                                                              |
| -------------------------- | ---------------------------------------------------------------------------- |
| **Version**                | 0.7.0 — seven of nine planned releases done                                  |
| **Published**              | Nothing. Deliberate; first publish is 1.0.0                                  |
| **Commits**                | 62                                                                           |
| **Tests**                  | 627 across 34 files                                                          |
| **Packed-consumer checks** | 48/48                                                                        |
| **Source**                 | ~9,000 lines across 58 files                                                 |
| **Test code**              | ~7,900 lines                                                                 |
| **Reports**                | 15 documents, ~7,000 lines                                                   |
| **Published tarball**      | 543 KB, 21 files, **one** runtime dependency                                 |
| **Public API**             | 2 import paths, 5 peer dependencies                                          |
| **CI**                     | Node 20.11 / 22 / 24 on Linux, Node 24 on Windows, plus a packed-install job |

The ratio worth noticing is **0.88 lines of test per line of source**, and
separately that the test code is not concentrated where the source is: the
NestJS package carries 3,737 lines of tests against 3,359 of source, because
that package is where every authorization decision lives.

### Where the code is

| Package           | Source | Tests | Role                                                            |
| ----------------- | -----: | ----: | --------------------------------------------------------------- |
| `packages/core`   |  1,072 |   445 | Contracts and errors. Knows no ORM and no HTTP framework        |
| `packages/prisma` |  1,616 | 1,381 | The one real `OrmAdapter` implementation                        |
| `packages/nestjs` |  3,359 | 3,737 | HTTP, DI, auth, hooks, actions — **the only published package** |
| `apps/admin-ui`   |  2,915 | 2,189 | The SPA, bundled into that package                              |
| `packages/ui`     |     12 |     0 | **Empty stub**                                                  |
| `packages/cli`    |     20 |     0 | **Empty stub**                                                  |
| `tests/`          |      — |   132 | Import-boundary assertions, mechanically enforced               |

---

## 2. Position Against the Roadmap

| Release                          | Status   | What it settled                                                              |
| -------------------------------- | -------- | ---------------------------------------------------------------------------- |
| 0.1.0 Foundation cleanup         | done     | A fresh clone can build. The name is `@nest-admin/nestjs`. CI exists         |
| 0.2.0 DI and configuration       | done     | `forRootAsync`, a configurable mount path, resource selection                |
| 0.3.0 Relations I — to-one       | done     | A relation renders as a name, not a cuid                                     |
| 0.4.0 Relations II — to-many     | done     | Children are reachable; one-to-many and many-to-many are told apart          |
| 0.5.0 Field overrides            | done     | `hidden` and `readOnly` are enforced server-side; the UI stops offering 403s |
| 0.6.0 Extension points           | done     | Hooks, actions, `ValidationError`, theming without a rebuild                 |
| 0.7.0 UX and hardening           | done     | Constraint errors, bulk delete, accessibility, 50k-row profile               |
| **0.8.0 Docs, demo, publishing** | **next** | —                                                                            |
| 1.0.0 API freeze and publish     | —        | —                                                                            |

Two of 0.7.0's stated acceptance criteria were met and one was not:

- "The whole CRUD flow works without a mouse" — **met**, walked through the real
  bundle in a real DOM with keyboard events only.
- "A 50k-row list renders in under 500ms" — **met by a wide margin**; the
  slowest measured query was 13 ms.
- "Lighthouse accessibility ≥ 95" — **not run.** The accessibility work was done
  and hand-verified, but no automated audit exists. This is recorded as debt in
  §7 rather than quietly dropped.

---

## 3. The Architecture, and Whether It Holds

Four boundaries define the design. Each is worth stating as a claim, because
each is the kind of claim that decays silently.

```
Admin UI  ──HTTP JSON──▶  NestJS  ──▶  Core  ──▶  OrmAdapter  ──▶  Prisma
```

### The UI never learns the schema

There is no `UserPage`, no `PostTable`, no model name anywhere in the interface.
Navigation, columns, sort options, filter operators, form inputs, relation
pickers, action buttons and permissions all come from `GET /admin/meta`.

**Holds.** It is also load-bearing rather than aesthetic: every capability added
since 0.3.0 — relations, widgets, permissions, actions, theming — reached the
interface as a metadata field and needed no UI branch. A model added to the
Prisma schema appears without a code change; a model a policy hides disappears
the same way.

### Core does not know Prisma exists

`packages/core` declares `ModelMetadata`, `OrmAdapter`, `ListQuery`, and the
error vocabulary. It imports no ORM and no framework.

**Holds, and is mechanically enforced.** `tests/boundaries.test.ts` asserts it
rather than trusting review: Core imports no Prisma package, imports no NestJS,
declares no runtime dependencies, and `@prisma/get-dmmf` is imported by exactly
one module in the repository.

**But it is only tested against one real adapter.** See §6 — this is the largest
architectural risk carried into 1.0.

### Authentication belongs to the host

Nest Admin never reads a header, a cookie or a token. It asks one question
through `AdminAuth`, and a second through `AdminResourceAuth`. There is no login
form, no session, no JWT, no user table.

**Holds, and has survived pressure.** Four releases have added capability
(relations, actions, bulk delete) and each one routed its authorization through
the same two contracts rather than inventing a third. `auth` is a required
option, so there is no configuration in which the admin is accidentally public;
the escape hatch is named `unsafeAllowAllRequests()` and warns at startup.

### One published package

`@nest-admin/nestjs` is the only public package. Core, prisma, ui and cli are
`private: true` and inlined at build time.

**Holds.** The packed-consumer check asserts that the installed manifest has no
`@nest-admin/*` dependency, and separately counts the copies of Core in each
bundle — because that count is exactly what caused the worst defect in the
project's history (§5).

---

## 4. What a Consumer Actually Touches

The whole public surface, from `examples/basic`:

```ts
AdminModule.forRootAsync({
  imports: [DatabaseModule],
  inject: [PrismaService],
  path: '/admin',
  useFactory: (prisma: PrismaService) => ({
    adapter: new PrismaAdapter({ client: prisma }),
    auth: adminAuth,
    resourceAuth: { authorize: ({ model, operation }) => ... },
    models: { User: { fields: { passwordHash: { hidden: true } } } },
    hooks: { User: { beforeCreate: ... } },
    actions: { Post: [{ name: 'publish', scope: 'record', run: ... }] },
    theme: { title: 'Admin', accent: '#0b6e6e' },
  }),
})
```

Two import paths (`@nest-admin/nestjs` and `@nest-admin/nestjs/prisma`), ten
options, five peer dependencies, one runtime dependency. That is a small surface
for what it does, and keeping it small has been an explicit constraint rather
than an outcome.

**The options divide on a line that is the design**: `hidden`, `readOnly`,
`displayField`, `resources`, `resourceAuth` and `hooks` are _enforced by the
server_; `label`, `widget`, `order` and `theme` are _sent to a client that may
ignore them_. Anything in the first group implemented as the second would be a
security hole with a reassuring name.

---

## 5. What the Process Has Actually Caught

This is the most useful section for anyone deciding how much to trust the code,
because it is the only one grounded in defects rather than intentions.

Nineteen real defects were found and fixed across the fifteen reports. Sorted by
**how they were found**, not by what they were:

| Found by                                       | Count | Examples                                                                                                           |
| ---------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------ |
| Installing the packed tarball outside the repo |     8 | Cross-bundle `instanceof`; CJS `.d.ts`; driver-adapter metadata shape; a required hidden field 500ing every create |
| The repository's own tests                     |     4 | `isGenerated` rule wrong; free-text search matching cuids; a wrapping `<label>` renaming its field                 |
| Deliberate measurement                         |     3 | Two WCAG contrast failures; a flaky exit code, found by running the check twice                                    |
| A fresh `git clone`                            |     3 | The repository could not be built by anyone who cloned it                                                          |
| Reading the build output                       |     1 | `.d.ts` importing a package that is never published                                                                |

**The pattern is the finding.** Eight of the nineteen — including every one that
would have shipped broken to a first user — were invisible to `pnpm build`,
`pnpm typecheck` and every test in the repository. They live in the gap between
a workspace and an installed package, and nothing inside the workspace reaches
them.

Three are worth naming individually, because each changed a rule rather than a
line:

**Cross-bundle `instanceof` (0.7.5 / reports 009).** The package ships two
CommonJS entrypoints and each inlines its own copy of Core. An error thrown in
the Prisma adapter was an instance of a _different_ `FieldNotFoundError` class
than the one the exception filter held, so `instanceof` answered `false` and
every adapter-raised error became a generic 500 — a mistyped sort field returned
"an internal error occurred". Errors are now identified by a `Symbol.for` brand
and a `kind` string, neither of which depends on which copy created the object.
The follow-up is sharper still: a claim in that same report — that ESM was
unaffected — **was wrong**, found in 0.2.0 and corrected in place with a dated
note rather than quietly edited.

**A fresh clone was unbuildable (0.1.0).** `typecheck`, `test` and, on Windows,
`format:check` had all been green for months — on one machine, whose working
copy held artefacts nothing in the repository knew how to produce. Three
separate causes: a gitignored `.generated/` directory with nothing to produce
it, CRLF line endings that broke formatting on Windows while CI on Linux stayed
green, and an example needing a gitignored `.env`. Fixed with `prisma:setup`,
`.gitattributes`, and a defaulted config.

**Hiding a required field broke every create (0.5.0).** `hidden` correctly
removed the column from responses, and correctly refused to accept it on write —
which meant a required column could be configured into a state where no record
could ever be created. Found by a real consumer run that was hard to diagnose,
and closed by a startup check rather than a runtime error, because a
configuration mistake should fail at boot.

### What this bought

The verification stack now has four independent layers, and each exists because
a layer above it missed something:

1. **627 tests** — real SQLite, a real Nest HTTP server, jsdom with the real
   bundle. Nothing is mocked at the database or HTTP boundary.
2. **Import-boundary tests** — the architecture asserted, not reviewed.
3. **`pnpm verify:package`** — builds, packs, installs the tarball _outside_ the
   workspace, boots a real NestJS app against a schema the package has never
   seen, and runs 48 checks including bundle-copy counts.
4. **A throwaway playground** in the OS temp directory, driven over HTTP and
   through the real UI bundle in a real DOM.

---

## 6. Risks, Ranked

Ordered by what would cost most to discover late.

### 1. The `OrmAdapter` contract has exactly one real implementation

Core's generality is asserted, not proven. The second adapter is what will find
out whether `ListQuery`, `Page`, `RecordId` and the relation metadata describe
_databases_ or describe _Prisma_. The HTTP layer is tested against a second,
non-Prisma adapter — but that adapter is an in-memory test double written by the
same author against the same assumptions, which is weaker evidence than it looks.

1.0.0 freezes this contract. Freezing an interface with one implementation is
the classic way to discover, at 1.1, that it needed a breaking change.

**Mitigation worth considering:** build a thin second adapter (Drizzle or
TypeORM) _before_ the freeze, even if it is not shipped. It does not have to be
complete to falsify the contract.

### 2. The peer range and the runtime gate disagree

```
peerDependencies:  "@prisma/client": ">=6.0.0 <9"
version-gate.ts:   SUPPORTED_PRISMA_MAJORS = [7]
```

A consumer on Prisma 6 or 8 installs with no peer warning and gets a hard
`PrismaVersionUnsupportedError` at startup. The manifest advertises support the
code refuses. Whichever is right, they must agree before the first publish —
and the manifest is the one a package manager reads.

Related: `@prisma/get-dmmf` is pinned to exactly `7.10.0` while the peer range
spans three majors. The schema-parsing rules and the consumer's client can
therefore be different Prisma versions, which is precisely what the gate exists
to prevent.

### 3. The npm scope is not claimed

`@nest-admin` is unclaimed as far as this repository knows, and the roadmap
defers claiming it to 0.8.0. This is the only risk on this list that costs
nothing to close and cannot be undone if someone else closes it first.
**Recommend doing it now**, ahead of the release that schedules it.

### 4. The published manifest is not ready to be published

`packages/nestjs/package.json` declares no `engines`, and the CI matrix
describes itself as testing "the floor declared in `engines`" — a floor that
exists only in the unpublished root manifest. It also carries no `repository`,
`homepage`, `bugs`, `keywords` or `author`. For a project whose stated goal is
to be found and chosen by default, the discoverability fields are not cosmetic.

### 5. Row-level permissions do not exist

Per-model and per-field authorization exist and are enforced. "This user sees
only their own orders" does not, and it is the most common real requirement an
internal admin meets after the first week. The shape it would need — a
`beforeList` hook that injects a filter — is explicitly listed as absent since
0.6.0. This is the largest _functional_ gap against the alternatives.

### 6. Two empty packages are versioned and built

`packages/ui` and `packages/cli` are twelve and twenty lines of comments. They
are version-bumped every release, appear in the build graph, and imply a surface
that does not exist. Either give them content or take them out before 1.0;
carrying them is a promise the repository has not decided to keep.

### 7. Documentation has begun to drift from the code

**`docs/status.md` is stale.** It reports 304 tests (there are 627), says the
package does not serve the UI yet (it has since Phase 7), and lists as
unimplemented several things that shipped in 0.2.0–0.6.0. It predates the
0.1.0–0.7.0 sequence entirely and has not been touched since.

Not dangerous, but it is the kind of thing that makes a reader stop trusting
the rest of the documentation — and in a project whose differentiator is that
its documentation is honest, that is a real cost. It should either be rewritten
against this document or replaced by a pointer to it; two overlapping status
pages will drift again.

**`README.md`'s banner said "no MVP functionality is implemented yet"** and
offered a placeholder install name, at 0.7.0. Corrected in 0.8.0 - the full
rewrite is 0.12.0. An earlier version of this document asserted the README was
current; it was not, and the claim was made without reading past its first
section.

`CHANGELOG.md`, `docs/roadmap.md`, `docs/architecture.md` and
`docs/publishing.md` do match the code, and `examples/basic` is a working
consumer that imports only the public package.

---

## 7. Known Limitations, Consolidated

Gathered from all fifteen reports, so they are in one place rather than
distributed across a release history nobody reads backwards.

**Data model**

- Composite primary keys are represented in metadata and **rejected** by the
  adapter.
- **Half of every one-to-one is invisible.** The `@unique` foreign key lives on
  one side, so the other has no column to resolve — `Profile.user` loads and
  links, `User.profile` is absent from the record and its nested route answers 400. Deliberate in the loader, which skips any to-one without a `from`; the
  user-visible consequence had not been written down until `examples/basic`
  gained a one-to-one.
- No nested writes: creating a record and its children in one request.
- No sorting by a related field.
- Deep pagination is an `OFFSET`. Flat at 50k rows; it will not stay flat.

**Authorization**

- No row-level permissions (§6.5).
- No conditional field visibility — `hidden` is static.
- No RBAC, roles, permission store or policy DSL. By design: the host decides.

**Writes**

- Hooks are **not transactional**. An `after` hook that throws leaves the write
  done.
- Bulk delete is not transactional either, and costs one round trip per record
  — about 7 ms each, so a full 200-record selection takes roughly 1.4 s.
- Actions receive no input. A "change owner" action cannot ask for the new owner.

**Search**

- On SQLite, case-insensitivity is ASCII-only. `LIKE` is defined that way and
  Prisma offers no option to change it there.
- CockroachDB is treated as case-sensitive because Prisma documents `mode` for
  PostgreSQL and MongoDB only. Conservative rather than verified.

**Interface**

- Dark mode follows the operating system; there is no toggle.
- No column sorting from the table header — sorting is a toolbar control.
- No automated accessibility audit. The 0.7.0 checks are hand-written
  assertions about specific properties; nothing runs axe or Lighthouse over the
  rendered page.
- Theming reaches an accent colour, a title and a logo. Not fonts, spacing or a
  full palette.

**Reserved names**

- A model called `actions` or `assets` is unreachable, because those segments
  are matched literally ahead of `:model`. Documented rather than guarded.

**Not built at all**

- The CLI (`nest-admin init` / `doctor` / `generate`).
- Any component in `packages/ui`.
- Uploads, rich text, charts, audit logs, webhooks, custom pages, plugins,
  multi-tenancy.
- TypeORM, Drizzle and MikroORM adapters.

---

## 8. How It Compares, Honestly

Against the alternatives a NestJS + Prisma team actually evaluates:

**Where this is already stronger.** Configuration without a custom React build —
theming, labels, widgets, hidden fields, actions and hooks are all server-side
declarations, and the interface draws them from metadata. That is where most
competitors are weakest: they hand you a component to fork, and the fork is
where the maintenance cost lives. The authorization model is also unusually
clean — one boundary, host-owned, enforced in a single service, with the
interface refusing to offer what the policy will deny.

**Where it is behind.** Row-level permissions (§6.5) and nested writes are table
stakes for a mature admin, and neither exists. There is no CLI, so "install and
run one command" is not yet true. And nothing is published, which means the
honest comparison today is not "worse in two respects" but "not available".

**What decides adoption, and is not built yet.** A stranger cannot currently
evaluate this project: there is no demo to look at, no documentation site to
read, and no `npm install` that works. All three are 0.8.0, which is why 0.8.0
is next and why it matters more than its position on a roadmap suggests.

---

## 9. Process

Worth recording because it is the reason §5 reads the way it does.

Every release follows the same rhythm: **brief → implementation → a report in
`reports/NNN` → commits with explicit paths**. Seven releases, 62 commits, and
fifteen reports averaging 470 lines. The reports are not summaries written
afterwards; several of them changed the implementation, and two recorded that a
previous report had been wrong.

Three rules have earned their place:

- **No feature ships without being run against a real consumer.** Eight of
  nineteen defects justify this on their own.
- **The test count does not go down.** 71 → 146 → 183 → 288 → 304 → 317 → 366 →
  405 → 458 → 525 → 562 → **627**.
- **Limitations are written down in the same document as the achievements.**
  Every report has a `Known Limitations` section, and this document exists
  because those sections were becoming hard to read in aggregate.

One rule has been tested and held: **the implementation is not changed unless a
real consumer test proves something is broken.** It stopped at least one
speculative refactor and forced the diagnosis that found the driver-adapter
metadata shape.

---

## 10. Recommended Next Moves

In the order they should happen, with reasons rather than assertions.

1. **Claim the `@nest-admin` npm scope.** Free, five minutes, irreversible if
   someone else does it. It is scheduled for 0.8.0 and should not wait.
2. **Reconcile the peer range with the version gate** (§6.2), and add `engines`,
   `repository` and `keywords` to the published manifest. All of it is
   publishing-blocking and none of it is interesting, which is exactly why it
   gets skipped.
3. **Retire or rewrite `docs/status.md`** (§6.7). Two status pages will drift
   again; one of them should be a pointer to the other.
4. **0.8.0 as planned** — documentation site, demo, README. This is the release
   that turns a good package into an evaluable one, and until it ships the
   quality of everything before it is invisible.
5. **Write a second adapter before the 1.0 freeze** (§6.1), even a partial one.
   It is the only way to find out whether the contract describes databases or
   describes Prisma, and the cost of finding out after the freeze is a major
   version.
6. **Then row-level permissions** (§6.5), as the first post-1.0 feature. It is
   the largest functional gap and the most common real requirement.

---

## 11. Summary Judgement

Seven releases in, the foundations are sound and unusually well evidenced. The
architecture's four boundaries hold and three of them are mechanically enforced.
The verification stack is stronger than the project's size warrants, and it
earned that strength the hard way — by repeatedly catching things that every
in-repo check had already declared green.

The honest weaknesses are three, and none of them is the code:

- The `OrmAdapter` contract is about to be frozen with one implementation.
- Nothing is published, so nothing can be evaluated by anyone outside this
  repository.
- One documentation page has drifted out of date, in a project whose main
  differentiator is that its documentation does not.

All three are addressable before 1.0, and two of them are the next release.
