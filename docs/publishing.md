# Publishing strategy

**Nothing has been published. No npm account exists. Do not publish yet.**
This document records the intended mechanism so the repository stays shaped
for it.

## One public package, five internal ones

Developers should install one thing:

```bash
npm install @our-org/nest-admin
```

But the repository is split for development. The two are reconciled by
bundling rather than by publishing five packages:

| Package                                      | Published?           | Fate                              |
| -------------------------------------------- | -------------------- | --------------------------------- |
| `packages/nestjs` (`@nest-admin/nest-admin`) | **yes**              | the tarball                       |
| `packages/core`                              | no (`private: true`) | bundled into it                   |
| `packages/prisma`                            | no (`private: true`) | bundled into it                   |
| `packages/cli`                               | no (`private: true`) | bundled into it                   |
| `packages/ui`                                | no (`private: true`) | bundled into `apps/admin-ui`      |
| `apps/admin-ui`                              | no (`private: true`) | built to static assets, copied in |

The mechanism is tsup `noExternal`: see
`packages/nestjs/tsup.config.ts`, which bundles `@nest-admin/core` and
`@nest-admin/prisma` into `dist/` while leaving `@nestjs/*`, `@prisma/client`,
`reflect-metadata` and `rxjs` external.

The package name is a placeholder. The final brand name is undecided.

## What still has to be built before a first publish

1. **Admin UI assets.** `apps/admin-ui` builds to `apps/admin-ui/dist`. The
   publish pipeline must copy that into `packages/nestjs/dist/admin-ui` and add
   it to `files`. Not wired yet.
2. **The `bin` entry.** Once the CLI works, `packages/nestjs/package.json`
   gains `"bin": { "nest-admin": "./dist/bin/nest-admin.cjs" }` plus a tsup
   entry that wraps the CLI. Declared only when it does something.
3. **Workspace protocol.** `dependencies` currently use `workspace:*` pointing
   at private packages. Because those packages are bundled, they must be
   removed from the published `dependencies` (via a prepack step or by moving
   them to `devDependencies`) or install will fail for consumers.
4. **A publish guard.** `prepublishOnly` that refuses to run while the name is
   a placeholder.
5. **Provenance and a changelog.** Decide on release tooling before the first
   tag, not after.

## What ships in the tarball

Only `dist/` plus package metadata (`files: ["dist"]`). Source, tests,
examples, docs and configuration stay on GitHub. Build artefacts
(`dist/`, `build/`, `coverage/`) stay out of git.

## Leaving room for multiple public packages

If publishing `@our-org/core` separately later becomes necessary, the change is
small: flip `private: true`, stop bundling it in `noExternal`, and add it to
`dependencies`. The export maps and package boundaries already assume it.
