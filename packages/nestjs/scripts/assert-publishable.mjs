/**
 * Refuse to publish a tarball that would not work.
 *
 * `dist/` is not in git. So `npm publish` from a fresh clone, or after a
 * `pnpm clean`, or from a machine where only this package was built, produces a
 * tarball with pieces missing - and a published version cannot be replaced,
 * only deprecated. This runs as `prepublishOnly`, which npm runs before it
 * packs.
 *
 * It asserts rather than builds. A `prepublishOnly` that triggers a workspace
 * build hides the mistake instead of reporting it, and would run the whole
 * build again on a machine that had just done it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

const failures = []

/** Every path the export map promises, in both module formats. */
for (const [subpath, conditions] of Object.entries(manifest.exports)) {
  if (typeof conditions !== 'object') continue

  for (const target of [
    conditions.import?.types,
    conditions.import?.default,
    conditions.require?.types,
    conditions.require?.default,
  ]) {
    if (target === undefined) continue
    if (!existsSync(resolve(packageRoot, target))) {
      failures.push(`${subpath} promises ${target}, which is missing`)
    }
  }
}

/** The interface, which is copied in by a separate build step. */
const shell = join(packageRoot, 'dist/admin-ui/index.html')
if (!existsSync(shell)) {
  failures.push('dist/admin-ui/index.html is missing - the admin would answer 404')
} else {
  // A shell with no bundle is worse than no shell: it renders a blank page.
  const html = readFileSync(shell, 'utf8')
  const script = /src="([^"]+\.js)"/.exec(html)?.[1]
  const asset = script?.split('/').pop()
  if (asset === undefined || !existsSync(join(packageRoot, 'dist/admin-ui/assets', asset))) {
    failures.push('the admin UI shell references a bundle that is not in dist')
  }
}

/** Nothing unpublished may be named as a runtime dependency. */
for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
  if (name.startsWith('@nest-admin/') || String(range).startsWith('workspace:')) {
    failures.push(`${name} is a runtime dependency but is never published`)
  }
}

if (failures.length > 0) {
  console.error('\nRefusing to publish @nest-admin/nestjs:\n')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('\nRun `pnpm build` from the repository root, then try again.\n')
  process.exit(1)
}

console.log(`@nest-admin/nestjs ${manifest.version} is publishable.`)
