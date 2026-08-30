/**
 * Prepares every generated Prisma artefact the repository needs.
 *
 * Two test suites run against real generated Prisma clients and real SQLite
 * files. Both live under `test/.generated/`, which is git-ignored - so a fresh
 * clone has neither, and `pnpm typecheck` and `pnpm test` both fail on it.
 * Nothing in the repository produced them; they were a manual step that only
 * existed in one developer's working copy. This script is that step, written
 * down.
 *
 * The database is created from the schema with `migrate diff` + `db execute`
 * rather than `db push`. Both are ordinary, non-destructive commands: the first
 * only prints SQL, the second runs a script against the fixture's own
 * throwaway file. `db push` would do the same job, but it is a migration
 * command with a destructive reputation, and reaching for it here would mean
 * running it routinely on every clone and every CI job.
 *
 * Safe to re-run. The fixture databases are disposable by design and are
 * rebuilt from scratch each time, so a schema change can never leave a stale
 * table behind.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * `pnpm test` and `pnpm typecheck` both call this, so the common case - nothing
 * changed since last time - must cost nothing. A target is stale only if it is
 * missing or older than the schema it was built from.
 */
const stale = (target, schema) => {
  if (process.env['FORCE_FIXTURES'] === '1') return true
  if (!existsSync(target)) return true
  return statSync(target).mtimeMs < statSync(schema).mtimeMs
}

/** Last path segment, for messages - targets name their files relatively. */
const name = (path) => path.split('/').pop()

/**
 * Every generated Prisma artefact in the repository.
 *
 * `dir` is where the `prisma.config.ts` lives - Prisma resolves both the config
 * and the schema's relative `output` from the working directory, so each entry
 * names the directory its commands must run in. Paths are relative to it.
 */
const TARGETS = [
  {
    label: 'packages/prisma',
    dir: 'packages/prisma/test/fixtures',
    schema: 'schema.prisma',
    client: '../.generated/client/client.ts',
    database: '../.generated/test.db',
    sql: '../.generated/schema.sql',
  },
  {
    label: 'packages/nestjs',
    dir: 'packages/nestjs/test/fixtures',
    schema: 'schema.prisma',
    client: '../.generated/client/client.ts',
    database: '../.generated/e2e.db',
    sql: '../.generated/schema.sql',
  },
  {
    // Not a test fixture, but it fails the same way: `pnpm typecheck` covers
    // the example, and the example imports its own generated client.
    label: 'examples/basic',
    dir: 'examples/basic',
    schema: 'prisma/schema.prisma',
    client: 'src/generated/prisma/client.ts',
    database: 'dev.db',
    sql: 'prisma/.schema.sql',
  },
]

/**
 * Prisma resolves `prisma.config.ts` and the schema's relative `output` from
 * the working directory, so every command runs inside the fixture directory.
 */
const run = (args, cwd) =>
  execFileSync('npx', ['prisma', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })

let failed = false

for (const target of TARGETS) {
  const cwd = join(repoRoot, target.dir)
  const label = target.label
  const say = (message) => console.log(`  ${label.padEnd(16)} ${message}`)

  if (!existsSync(cwd)) {
    console.error(`FAIL  ${label}: ${target.dir} does not exist`)
    failed = true
    continue
  }

  try {
    const schema = join(cwd, target.schema)
    const client = join(cwd, target.client)
    const database = join(cwd, target.database)
    const script = join(cwd, target.sql)

    if (stale(client, schema)) {
      mkdirSync(dirname(client), { recursive: true })
      run(['generate'], cwd)
      say('client generated')
    } else {
      say('client up to date')
    }

    if (stale(database, schema)) {
      // `--from-empty` means the script always describes the whole schema, so
      // the database is built in one step rather than migrated.
      const sql = run(
        ['migrate', 'diff', '--from-empty', '--to-schema', target.schema, '--script'],
        cwd,
      )

      mkdirSync(dirname(script), { recursive: true })
      writeFileSync(script, sql)

      // Recreated, not migrated: `db execute` only runs the script it is given,
      // and against an existing file the CREATE TABLEs would collide.
      //
      // A running application holds the file open, and on Windows that makes it
      // undeletable. That is not a setup failure - the database is simply in
      // use - so say so and move on rather than failing the whole run.
      try {
        rmSync(database, { force: true })
      } catch {
        say(`${name(target.database)} is in use - left as it is`)
        continue
      }

      run(['db', 'execute', '--file', script], cwd)
      say(`${name(target.database)} created`)
    } else {
      say(`${name(target.database)} up to date`)
    }
  } catch (error) {
    const detail = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n').trim()
    console.error(`FAIL  ${label}\n${detail}`)
    failed = true
  }
}

if (failed) {
  console.error('\nPrisma artefacts are not ready. `pnpm test` will fail.')
  process.exit(1)
}

console.log('\nPrisma artefacts ready.')
