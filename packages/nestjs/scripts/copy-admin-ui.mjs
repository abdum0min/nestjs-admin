/**
 * Copy the built admin UI into this package's `dist`.
 *
 * Runs after tsup, so `dist` exists and has just been cleaned. The result is
 * `dist/admin-ui/{index.html,assets/*}`, which `files: ["dist"]` already ships -
 * a consumer installing the published package gets the interface without
 * cloning this repository or running Vite.
 *
 * `@nest-admin/admin-ui` is a devDependency of this package purely so pnpm
 * builds it first; nothing imports it.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(packageRoot, '../../apps/admin-ui/dist')
const destination = join(packageRoot, 'dist', 'admin-ui')

if (!existsSync(join(source, 'index.html'))) {
  // Loud, and a failure: a published package without its UI would 404 at
  // /admin for every consumer, and the build is the only place to catch it.
  console.error(
    `[nest-admin] Admin UI build not found at ${source}.\n` +
      '            Run `pnpm --filter @nest-admin/admin-ui build` first, or ' +
      '`pnpm build` from the workspace root.',
  )
  process.exit(1)
}

mkdirSync(destination, { recursive: true })
cpSync(source, destination, { recursive: true })

console.log(`[nest-admin] Bundled admin UI into ${destination}`)
