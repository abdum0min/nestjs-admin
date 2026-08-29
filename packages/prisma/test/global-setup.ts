import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const config = resolve(here, 'fixtures/prisma.config.ts')

const require = createRequire(import.meta.url)

/**
 * Generate the fixture client and ensure the fixture database matches the
 * schema, before the suite runs.
 *
 * Done here rather than in a `pretest` script so the tests are reproducible
 * however they are invoked - `pnpm test` from the workspace root runs Vitest
 * directly and would never see a package-level lifecycle script.
 *
 * The database is a throwaway SQLite file under `test/.generated/`, so this
 * needs no external service and nothing developer-specific. `db push` is
 * non-destructive and a no-op once the file is in sync; per-test isolation is
 * handled by deleting rows in `resetDatabase()`, not by dropping the schema.
 */
export default function setup(): void {
  // Invoke Prisma's entrypoint with the current Node binary rather than the
  // `.bin` shim: no shell, and identical behaviour on POSIX and Windows.
  const prismaEntry = require.resolve('prisma/build/index.js')

  const run = (args: string[]) =>
    execFileSync(process.execPath, [prismaEntry, ...args, '--config', config], {
      cwd: packageRoot,
      stdio: 'pipe',
    })

  run(['generate'])
  run(['db', 'push'])
}
