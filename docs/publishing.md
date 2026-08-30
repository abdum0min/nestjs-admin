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

## Resolved in Phase 6: the published types now resolve

The declarations used to open with

```ts
import { OrmAdapter } from '@nest-admin/core'
```

which a consumer could not resolve, because `@nest-admin/core` is
`private: true` and never published. The JS bundle was always correct.

**Root cause.** tsup automatically treats everything listed in `dependencies`
and `peerDependencies` as external. `noExternal` overrides that for the **JS**
bundle, but the declaration build computes its own externals and kept the
imports in place. `dts.resolve` alone did not help either, because the packages
were still being externalised before it was consulted.

**Fix — two changes, neither sufficient alone:**

1. `@nest-admin/core` and `@nest-admin/prisma` moved from `dependencies` to
   `devDependencies` in `packages/nestjs/package.json`. They are bundled at
   build time, so they are build inputs, not runtime dependencies - this is
   what they should always have been.
2. `dts: { resolve: [/^@nest-admin//] }` in `packages/nestjs/tsup.config.ts`,
   telling the declaration build to follow them rather than leave the imports.

**Verified from a clean build** (`rm -rf dist && pnpm build`):

| Artefact                       | `@nest-admin/*` |                            `@prisma/*` |
| ------------------------------ | --------------: | -------------------------------------: |
| `index.js` / `index.cjs`       |               0 |                                      0 |
| `index.d.ts` / `index.d.cts`   |           **0** |                                      0 |
| `prisma.js` / `prisma.cjs`     |               0 | 7 (`@prisma/client`, an optional peer) |
| `prisma.d.ts` / `prisma.d.cts` |           **0** |                  0 (doc comments only) |

`OrmAdapter` and the rest of the Core surface are now inlined into the
declarations. The only external type import left is `@nestjs/common`, a declared
peer dependency.

A second bug fell out with it: the published `dependencies` previously declared
`workspace:*` ranges on those private packages, so an install would have tried
to resolve packages that do not exist on npm. There is now no `dependencies`
field at all - only peers.

## Phase 7: the package now runs in a real consumer

Two further blockers only appeared once the tarball was installed outside the
workspace and started. Neither was visible from `pnpm build` or `pnpm test`.

### The wasm that was bundled

`@prisma/get-dmmf` loads `prisma_schema_build_bg.wasm` through a `require()`
resolved relative to its own package. tsup inlined the package, so the built
bundle looked fine, imported fine, and then died on the first request:

```text
Error: ENOENT ... packages/nestjs/dist/prisma_schema_build_bg.wasm
```

It is now `external` and declared as a real `dependencies` entry. That is the
correct shape: it is a published third-party package, not a private workspace
one, so declaring it keeps the "no unpublished dependency" property intact.

### Types that resolved only under modern module resolution

The Nest CLI still ships `"moduleResolution": "node"`, which ignores
`exports`. Node resolves the `./prisma` subpath at runtime regardless, so the
import worked while its types did not - the failure mode a consumer sees is a
red squiggle on working code. A `typesVersions` entry maps the subpath for
legacy resolution.

### Verified by installing the tarball

`pnpm verify:package` builds, packs, installs the tarball into a temporary
project **outside** this workspace, boots a real NestJS app against a schema the
package has never seen, and exercises `/admin`, `/admin/meta` and full CRUD. It
is not part of `pnpm test` because it runs a real `npm install`.

The bundled admin UI ships inside the tarball at `dist/admin-ui`, so a consumer
gets the interface without cloning this repository.

## What still has to be built before a first publish

1. ~~**Admin UI assets.**~~ Done in Phase 7: `packages/nestjs` builds the UI
   first (via a devDependency for ordering) and copies it into
   `dist/admin-ui`, which `files: ["dist"]` already ships.
2. **The `bin` entry.** Once the CLI works, `packages/nestjs/package.json`
   gains `"bin": { "nest-admin": "./dist/bin/nest-admin.cjs" }` plus a tsup
   entry that wraps the CLI. Declared only when it does something.
3. ~~**Workspace protocol.**~~ Done in Phase 6: the bundled workspace packages
   are `devDependencies`, so the published manifest declares no dependency on
   an unpublished package.
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
