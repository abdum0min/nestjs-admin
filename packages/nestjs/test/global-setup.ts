import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const config = resolve(here, 'fixtures/prisma.config.ts')

const require = createRequire(import.meta.url)

/**
 * Generate the end-to-end fixture client and database before the suite.
 *
 * In Vitest's global setup rather than a `pretest` script so it runs however
 * the tests are invoked - `pnpm test` from the workspace root calls Vitest
 * directly and would never see a package-level lifecycle script.
 *
 * Prisma's entrypoint is invoked with the current Node binary: no shell, and
 * identical behaviour on POSIX and Windows.
 */
export default function setup(): void {
  const prismaEntry = require.resolve('prisma/build/index.js')

  const run = (args: string[]) =>
    execFileSync(process.execPath, [prismaEntry, ...args, '--config', config], {
      cwd: packageRoot,
      stdio: 'pipe',
    })

  run(['generate'])
  run(['db', 'push'])
}
