# 0.1.0 — Foundation Cleanup

Status: **complete.** No new features, no demo, no documentation site, nothing
published to npm.

---

## 1. Executive Summary

The smallest release on the roadmap, and the one every later phase leans on.

The headline change was meant to be a rename. What the phase actually found is
that **the repository could not be built by anyone who cloned it**: `pnpm
typecheck` failed, `pnpm test` failed, and on Windows `pnpm format:check` failed
on every file. All three had been green for months — on one machine, whose
working copy held artefacts nothing in the repository knew how to produce.

Delivered:

- **`@nest-admin/nestjs`** replaces `@nest-admin/nest-admin`, with the adapter
  at `@nest-admin/nestjs/prisma`.
- **`pnpm prisma:setup`** generates every Prisma client and fixture database, so
  a fresh clone can typecheck and test. It costs 0.08s when nothing changed.
- **CI** on Node 20.11 / 22 / 24 on Linux and Node 24 on Windows, plus the
  packed-consumer job.
- **`.gitattributes`** pins line endings, so a Windows clone and CI agree.
- **The dead configuration API is gone.** `NestAdminConfig` and
  `ResourceSelection` promised a `path` and a `resources` option; neither did
  anything.
- **`CHANGELOG.md`** and **`docs/roadmap.md`**.

**Verified on a genuinely fresh clone**: install, format, build, typecheck, 317
tests and 35/35 packed-consumer checks all pass.

---

## 2. Starting State

Five commits since Phase 7.5; 317 tests; clean tree; version `0.0.0`; no CI, no
remote, no changelog.

---

## 3. What Changed

### 3.1 The package is `@nest-admin/nestjs`

`@nest-admin/nest-admin` repeated itself and left no room for adapter packages
beside it. The subpath moves with it:

```diff
-import { AdminModule } from '@nest-admin/nest-admin'
-import { PrismaAdapter } from '@nest-admin/nest-admin/prisma'
+import { AdminModule } from '@nest-admin/nestjs'
+import { PrismaAdapter } from '@nest-admin/nestjs/prisma'
```

`@nest-admin/nestjs` is unclaimed on npm, as is the `@nest-admin` scope. Nothing
has been published, so this cost nobody a migration — which is exactly why it
was done now rather than later.

Nine files changed. `reports/008` and `reports/009` were deliberately left
alone: they record what was true when they were written, and editing them would
falsify the record.

### 3.2 The dead configuration API is gone

`NestAdminConfig` exported a `path` option and a `resources` selection. Neither
was wired to anything — the route is hard-coded in `@Controller('admin')`, and
the model list was never filtered. A consumer could set `path: '/panel'`, get
`/admin`, and reasonably conclude the package was broken.

The module is deleted rather than merely unexported, so nothing suggests the
feature is half-present. Both types return in 0.2.0 with implementations.

### 3.3 `isNestAdminError` is reachable

Core exported it; the published package did not. Since errors cross bundle
boundaries — the reason the brand exists at all (`reports/009` §13.1) — a
consumer that needs to recognise a framework error has no correct alternative.
It and the `AdminErrorKind` type are now exported.

### 3.4 `pnpm prisma:setup`

Two suites run against generated Prisma clients and real SQLite files under
`test/.generated/`, and the example imports its own generated client. All are
git-ignored, and **nothing in the repository produced any of them.**

The script generates each client and builds each database from its schema.
`typecheck` and `test` both run it first, and it is effectively free when
nothing has changed — a target is rebuilt only if it is missing or older than
its schema.

Databases are created with `migrate diff` piped into `db execute`, not
`db push`:

```
prisma migrate diff --from-empty --to-schema schema.prisma --script  →  schema.sql
prisma db execute --file schema.sql                                  →  fixture.db
```

`db push` would do the same job, but it is a migration command with a
destructive reputation, and adopting it here would mean running it on every
clone and every CI job. `migrate diff` only prints SQL; `db execute` runs a
script against the fixture's own throwaway file. The result is also stricter:
the database is rebuilt from scratch, so a schema change cannot leave a stale
table behind.

It tolerates a locked database. A running example holds `dev.db` open, and
Windows will not delete it — that is not a setup failure, so it says so and
carries on.

### 3.5 CI

Format, build, typecheck and test on **Node 20.11** — the floor declared in
`engines`, so the claim is tested rather than assumed — plus 22 and 24, and
Windows on 24, where development happens and where path and process handling
differ.

`verify:package` is a separate job. It is the only check that can see a
packaging fault, and two release-blocking bugs reached a working consumer past a
green build, a green typecheck and the entire suite.

### 3.6 Line endings

See §4.2.

### 3.7 `CHANGELOG.md` and `docs/roadmap.md`

The changelog states plainly that nothing is published and that these versions
are milestones. Changesets are deferred to 0.8.0 — tooling for a publish that is
not happening yet is overhead.

---

## 4. Problems Found

All four were found by cloning the repository and running the pipeline, which is
the only way any of them could have surfaced.

### 4.1 A fresh clone could not typecheck or test — _blocking_

```
packages/prisma typecheck: test/client.ts(7,30): error TS2307:
  Cannot find module './.generated/client/client.js'
```

The generated clients and fixture databases existed in one working copy and
nowhere else. Fixed by §3.4.

### 4.2 A fresh clone on Windows failed `format:check` on every file — _blocking_

`core.autocrlf=true` is the common Windows setting and rewrites the working tree
to CRLF on checkout. Prettier expects LF and rejected all 60-odd files.

The split is the real damage: CI on Linux never does that conversion, so it
would have stayed green while every Windows contributor saw red. That reads as
"the repository is broken", and the natural response — running `pnpm format` —
would rewrite every file in the repository.

`* text=auto eol=lf` in `.gitattributes` keeps the working tree LF regardless of
the local setting. `git add --renormalize .` changed nothing, confirming the
stored blobs were already LF and only checkout differed.

### 4.3 The example needed a `.env` that is git-ignored — _blocking_

```
PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL
```

Prisma 7 stopped loading `.env` implicitly when a config file is present, and
`.env` is git-ignored, so `prisma generate` failed on a clean clone before the
developer had done anything wrong. `prisma.config.ts` now defaults to the same
SQLite file `src/app.module.ts` already defaults to. An environment variable
still wins where one is set.

### 4.4 `pnpm setup` is a pnpm command — _caught before commit_

The script was briefly named `setup`, which pnpm's own `setup` subcommand
shadows: `pnpm setup` configured `PNPM_HOME` instead of preparing fixtures. It
is `prisma:setup`. Nothing was harmed — pnpm's command only rewrites a PATH
entry and is idempotent — but as a `pretest` step it would have run pnpm's
installer on every test run.

---

## 5. Verification

Every result below is from a **fresh `git clone` into a temporary directory**,
not from the development working copy.

| Check                            | Result                   |
| -------------------------------- | ------------------------ |
| `pnpm install --frozen-lockfile` | 0                        |
| `pnpm format:check`              | 0                        |
| `pnpm build`                     | 0                        |
| `pnpm typecheck`                 | 0                        |
| `pnpm test`                      | **317 passed**, 14 files |
| `pnpm verify:package`            | **35/35**                |

Before this phase, three of those six failed on a fresh clone.

`pnpm prisma:setup` was also tested from a fully deleted state (all three
generated directories and both fixture databases removed) and on a re-run:

```
first run   → clients generated, databases created
second run  → everything up to date, 0.08s
```

---

## 6. Known Limitations

- **The CI workflow has never run on GitHub.** There is no remote, so no run
  exists. What is verified is stronger than a lint of the YAML but weaker than a
  green run: every command the workflow invokes was executed on a fresh clone
  and passed. The parts that remain genuinely untested are GitHub-specific — the
  action versions, the pnpm cache, and whether `better-sqlite3` resolves a
  prebuild for Node 20.11 and 22 on Linux. Expect the first push to need a
  small correction.
- **Windows is the only platform actually exercised.** Linux and macOS are in
  the CI matrix but have not been run.
- **The rename is not verified against a real npm install**, only against a
  packed tarball installed from disk — which is what `verify:package` does, and
  is the closest available equivalent.

---

## 7. Result

```
Rename:                        PASS
Dead public API removed:       PASS
Fresh clone typecheck:         PASS  (failed before)
Fresh clone test:              PASS  (failed before)
Fresh clone format:            PASS  (failed before)
Packed consumer:               PASS  35/35
CI workflow authored:          PASS  (never executed — §6)
CHANGELOG + roadmap:           PASS
```

| Metric        | Before | After |
| ------------- | ------ | ----- |
| Tests         | 317    | 317   |
| Packed checks | 35/35  | 35/35 |
| Version       | 0.0.0  | 0.1.0 |
| Fresh clone   | broken | green |

Five commits, explicit paths, no AI co-author trailer anywhere in the history.
Working tree clean.

**Next: 0.2.0 — DI and configuration.** It begins with a spike on `path`, which
is the least certain item on the roadmap.
