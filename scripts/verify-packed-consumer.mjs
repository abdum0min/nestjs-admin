/**
 * Prove the published package works, not just the workspace.
 *
 *   build -> pack -> install the tarball outside the workspace -> boot a real
 *   NestJS app -> GET /admin -> GET /admin/meta -> full CRUD
 *
 * This exists because the workspace build has twice been green while the
 * package was broken. Phase 6's declarations resolved only inside the monorepo;
 * Phase 7 found `@prisma/get-dmmf`'s wasm bundled into our output, so the
 * package imported fine and died on the first request. Neither is visible from
 * `pnpm test` - only from installing the tarball somewhere else and running it.
 *
 * Not part of `pnpm test`: it runs a real `npm install` of NestJS and Prisma,
 * which takes about a minute and needs the network. Run it before publishing.
 *
 *   node scripts/verify-packed-consumer.mjs
 */
import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3199
const BASE = `http://localhost:${PORT}/admin`

const workspace = mkdtempSync(join(tmpdir(), 'nest-admin-packed-'))
const consumer = join(workspace, 'consumer')
let server

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'pipe', shell: process.platform === 'win32', ...options })

const checks = []
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  checks.push({ label, actual, expected, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} ${actual}`)
}

async function errorCode(path, init) {
  const response = await fetch(`${BASE}${path}`, init)
  return (await response.json())?.error?.code
}

async function status(path, init) {
  const response = await fetch(`${BASE}${path}`, init)
  return response.status
}

try {
  console.log('1/5  building the workspace')
  run('pnpm', ['build'], { cwd: repoRoot })

  console.log('2/5  packing @nest-admin/nestjs')
  run('pnpm', ['pack', '--pack-destination', workspace], {
    cwd: join(repoRoot, 'packages/nestjs'),
  })
  const packed = readdirSync(workspace).find((entry) => entry.endsWith('.tgz'))
  if (!packed) throw new Error(`pnpm pack produced no tarball in ${workspace}`)
  const tarball = join(workspace, packed)

  console.log('3/5  installing the tarball into a clean consumer')
  mkdirSync(join(consumer, 'prisma'), { recursive: true })
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'packed-consumer', private: true, version: '0.0.0' }, null, 2),
  )
  // A schema this package has never seen, to prove nothing is hard-coded.
  writeFileSync(
    join(consumer, 'prisma/schema.prisma'),
    [
      'generator client {\n  provider = "prisma-client-js"\n}\n',
      'datasource db {\n  provider = "sqlite"\n}\n',
      'model Widget {\n  id    String @id @default(cuid())\n  name  String\n  price Float  @default(0)\n}\n',
    ].join('\n'),
  )
  writeFileSync(
    join(consumer, 'prisma.config.ts'),
    "import { defineConfig } from 'prisma/config'\n" +
      "export default defineConfig({ schema: 'prisma/schema.prisma', datasource: { url: 'file:./c.db' } })\n",
  )

  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--silent',
      tarball,
      '@nestjs/common@12.0.1',
      '@nestjs/core@12.0.1',
      '@nestjs/platform-express@12.0.1',
      'reflect-metadata@0.2.2',
      'rxjs@7.8.2',
      'prisma@7.10.0',
      '@prisma/client@7.10.0',
      '@prisma/adapter-better-sqlite3@7.10.0',
    ],
    { cwd: consumer },
  )
  run('npx', ['prisma', 'generate', '--config', 'prisma.config.ts'], { cwd: consumer })
  run('npx', ['prisma', 'db', 'push', '--config', 'prisma.config.ts'], { cwd: consumer })

  console.log('4/5  starting the consumer application')
  writeFileSync(
    join(consumer, 'main.js'),
    `require('reflect-metadata')
const path = require('node:path')
const { Module } = require('@nestjs/common')
const { NestFactory } = require('@nestjs/core')
const { AdminModule, unsafeAllowAllRequests } = require('@nest-admin/nestjs')
const { PrismaAdapter } = require('@nest-admin/nestjs/prisma')
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: 'file:' + path.join(__dirname, 'c.db') }),
})

class AppModule {}
Module({
  imports: [
    AdminModule.forRoot({
      adapter: new PrismaAdapter({
        client: prisma,
        schemaPath: path.join(__dirname, 'prisma', 'schema.prisma'),
      }),
      auth: unsafeAllowAllRequests(),
    }),
  ],
})(AppModule)

NestFactory.create(AppModule).then((app) => app.listen(${PORT}))
`,
  )

  server = spawn(process.execPath, ['main.js'], { cwd: consumer, stdio: 'pipe' })
  let bootLog = ''
  server.stdout.on('data', (chunk) => (bootLog += chunk))
  server.stderr.on('data', (chunk) => (bootLog += chunk))

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(BASE)
      break
    } catch {
      await new Promise((done) => setTimeout(done, 500))
    }
  }

  console.log('5/5  exercising the consumer\n')

  const shell = await fetch(BASE)
  check('GET /admin returns the SPA', shell.status, 200)
  check('  as HTML', /text\/html/.test(shell.headers.get('content-type') ?? ''), true)

  const html = await shell.text()
  const asset = /\/admin\/assets\/[^"]+\.js/.exec(html)?.[0]
  check('  shell references a bundled asset', Boolean(asset), true)
  if (asset) {
    check('GET the referenced asset', (await fetch(`http://localhost:${PORT}${asset}`)).status, 200)
  }
  check('  UI bundled in the package', !bootLog.includes('admin UI was not found'), true)

  const meta = await (await fetch(`${BASE}/meta`)).json()
  check('GET /admin/meta', meta.success, true)
  check('  discovers the consumer schema', meta.data.models.map((m) => m.name).join(','), 'Widget')

  check('GET /admin/Widget (list)', await status('/Widget'), 200)

  const created = await (
    await fetch(`${BASE}/Widget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Packed Widget', price: 9.5 }),
    })
  ).json()
  check('POST /admin/Widget (create)', created.success, true)
  const id = created.data?.id

  check('GET /admin/Widget/:id (read)', await status(`/Widget/${id}`), 200)
  check(
    'PATCH /admin/Widget/:id (update)',
    await status(`/Widget/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    }),
    200,
  )
  check('  search', await status('/Widget?search=Renamed'), 200)
  check('  sort', await status('/Widget?sort=name:asc'), 200)
  check('  filter', await status('/Widget?filter=price:gte:5'), 200)
  check('  paginate', await status('/Widget?page=1&perPage=10'), 200)
  check('  bracket syntax rejected', await status('/Widget?filter[a][gte]=1'), 400)
  // Adapter-raised errors must keep their identity across the package's two
  // CommonJS bundles. Each inlines its own copy of Core, so `instanceof` in the
  // exception filter answered `false` and mapped all of these to 500. Only a
  // packed install can catch it -- in-repo tests share one copy of Core.
  check('  unknown sort field', await errorCode('/Widget?sort=nope:asc'), 'FIELD_NOT_FOUND')
  check('  unknown filter field', await errorCode('/Widget?filter=nope:eq:1'), 'FIELD_NOT_FOUND')
  check('  unknown model', await errorCode('/Nope'), 'MODEL_NOT_FOUND')
  check('  missing record', await errorCode('/Widget/nope'), 'RECORD_NOT_FOUND')
  check('DELETE /admin/Widget/:id', await status(`/Widget/${id}`, { method: 'DELETE' }), 200)
  check('  record is gone', await status(`/Widget/${id}`), 404)

  const manifest = JSON.parse(
    readFileSync(join(consumer, 'node_modules/@nest-admin/nestjs/package.json'), 'utf8'),
  )
  check(
    'no private workspace package required',
    Object.keys(manifest.dependencies ?? {}).some((name) => name.startsWith('@nest-admin/')),
    false,
  )

  // A CJS consumer under `moduleResolution: node16` reads the `require`
  // condition's `types`. Pointing it at the ESM `.d.ts` of a `"type": "module"`
  // package makes TypeScript reject the import (TS1479) even though `require`
  // works at runtime. The `.d.cts` files ship; they must actually be referenced.
  const pkgDir = join(consumer, 'node_modules/@nest-admin/nestjs')
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    if (subpath === './package.json') continue
    check(`  ${subpath} require types`, entry.require.types.endsWith('.d.cts'), true)
    check(`  ${subpath} import types`, entry.import.types.endsWith('.d.ts'), true)
    for (const condition of ['require', 'import']) {
      for (const field of ['types', 'default']) {
        const target = entry[condition][field]
        check(`    ${subpath} ${condition}.${field} exists`, existsSync(join(pkgDir, target)), true)
      }
    }
  }

  // Core must exist once per module format in the installed package.
  //
  // ESM shares it through a chunk both entrypoints import. CJS cannot: esbuild
  // does not code-split CommonJS, so each entry inlines its own copy, and an
  // error thrown in one is not an `instanceof` the class held by the other.
  // That is why framework errors carry a brand instead - see errors.ts in Core.
  // These assert the arrangement rather than hope for it: if CJS ever gains a
  // shared chunk the count changes here first.
  const coreCopies = (file) => {
    const source = readFileSync(join(pkgDir, file), 'utf8')
    return (source.match(/class FieldNotFoundError|FieldNotFoundError = class/g) ?? []).length
  }
  const chunk = readdirSync(join(pkgDir, 'dist')).find(
    (entry) => entry.startsWith('chunk-') && entry.endsWith('.js'),
  )

  check('ESM: Core lives in a shared chunk', chunk ? coreCopies(`dist/${chunk}`) : 0, 1)
  check('  not in dist/index.js', coreCopies('dist/index.js'), 0)
  check('  not in dist/prisma.js', coreCopies('dist/prisma.js'), 0)
  check('CJS: one copy per entrypoint (known)', coreCopies('dist/index.cjs'), 1)
  check('  and one in prisma.cjs', coreCopies('dist/prisma.cjs'), 1)

  const failed = checks.filter((entry) => !entry.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length > 0) {
    console.error('\nFAILED:')
    for (const entry of failed) console.error(`  ${entry.label}: got ${entry.actual}`)
    process.exitCode = 1
  }
} finally {
  server?.kill()
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // A Windows file lock on a just-killed process is not worth failing over.
  }

  // The verdict is the checks, and nothing else. A killed child server can
  // still emit on its way out, and an exit code that sometimes reflects
  // teardown noise makes this a flaky step - which is worse than a slow one,
  // because a flaky check is one people learn to re-run rather than read.
  process.exit(process.exitCode === undefined ? 0 : Number(process.exitCode))
}
