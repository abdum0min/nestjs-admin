/**
 * Regression: Core errors must be recognised across duplicate copies of Core.
 *
 * The published package ships two CommonJS entrypoints, and each inlines its
 * own copy of Core. An error thrown inside the Prisma adapter (`prisma.cjs`) is
 * therefore an instance of a *different* class object than the one the
 * exception filter holds (`index.cjs`). While the filter used `instanceof`,
 * every adapter-raised error fell through to a generic 500 — a caller who
 * mistyped a sort field got "internal error" instead of "unknown field".
 *
 * The repository's other tests cannot see this: they resolve `@nest-admin/core`
 * to a single source module, so class identity always matches. It was found by
 * installing the built tarball and running it (Phase 7.5).
 *
 * These tests simulate the second copy by rebuilding the error classes from
 * fresh source — real objects from a real second module instance, not stubs —
 * and assert the HTTP layer still maps them correctly.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAdminApp } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

/**
 * A genuinely separate instance of Core's error module.
 *
 * Importing the same specifier twice returns the cached module, so the query
 * string forces the loader to evaluate the file again. The classes it exports
 * are distinct objects from the ones the application under test uses — exactly
 * the situation the two published bundles create.
 */
const errorsModule = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../core/src/errors/errors.ts',
)
const secondCopy = (await import(
  `${errorsModule}?duplicate-core-copy`
)) as typeof import('@nest-admin/core')
const firstCopy = await import('@nest-admin/core')

describe('the test fixture really does produce a second copy', () => {
  it('has distinct class objects', () => {
    // If this ever fails the rest of the file proves nothing, so assert it.
    expect(secondCopy.FieldNotFoundError).not.toBe(firstCopy.FieldNotFoundError)
  })

  it('whose instances fail an instanceof check against the first copy', () => {
    const foreign = new secondCopy.FieldNotFoundError('User', 'nope')

    expect(foreign instanceof firstCopy.FieldNotFoundError).toBe(false)
    // ...which is precisely why the filter must not use instanceof.
  })

  it('but which the brand check still recognises', () => {
    const foreign = new secondCopy.FieldNotFoundError('User', 'nope')

    expect(firstCopy.isNestAdminError(foreign)).toBe(true)
    expect(foreign.kind).toBe('field-not-found')
  })

  it('and does not recognise ordinary errors', () => {
    expect(firstCopy.isNestAdminError(new Error('nope'))).toBe(false)
    expect(firstCopy.isNestAdminError({ kind: 'field-not-found' })).toBe(false)
    expect(firstCopy.isNestAdminError(null)).toBe(false)
  })
})

describe('errors from a second copy of Core map correctly over HTTP', () => {
  let app: INestApplication

  /** Each case throws a foreign-copy error from inside the adapter. */
  const cases = [
    [
      'field-not-found',
      () => new secondCopy.FieldNotFoundError('User', 'nope'),
      400,
      'FIELD_NOT_FOUND',
    ],
    [
      'model-not-found',
      () => new secondCopy.ModelNotFoundError('Nope', ['User']),
      404,
      'MODEL_NOT_FOUND',
    ],
    [
      'record-not-found',
      () => new secondCopy.RecordNotFoundError('User', 'u9'),
      404,
      'RECORD_NOT_FOUND',
    ],
    ['invalid-query', () => new secondCopy.InvalidQueryError('bad page'), 400, 'INVALID_QUERY'],
    ['unauthorized', () => new secondCopy.UnauthorizedError(), 401, 'UNAUTHORIZED'],
    ['forbidden', () => new secondCopy.ForbiddenError(), 403, 'FORBIDDEN'],
  ] as const

  afterAll(async () => {
    await app?.close()
  })

  for (const [kind, make, status, code] of cases) {
    it(`${kind} → ${status} ${code}`, async () => {
      const adapter = new InMemoryAdapter({ User: [], Post: [] })
      adapter.list = async () => {
        throw make()
      }
      app = await createAdminApp(adapter)

      const response = await request(app.getHttpServer()).get('/admin/User').expect(status)
      expect(response.body.error.code).toBe(code)

      await app.close()
    })
  }

  it('still maps a foreign AdapterError to a safe 500', async () => {
    // The allowlist must survive the change: adapter failures carry ORM detail
    // and filesystem paths, so their message must not be forwarded.
    const adapter = new InMemoryAdapter({ User: [], Post: [] })
    adapter.list = async () => {
      throw new secondCopy.AdapterError('Prisma failed at D:/app/src/adapter.ts:120')
    }
    app = await createAdminApp(adapter)

    const response = await request(app.getHttpServer()).get('/admin/User').expect(500)

    expect(response.body.error.code).toBe('INTERNAL_ERROR')
    expect(response.text).not.toContain('D:/app')
    expect(response.text).not.toContain('Prisma')

    await app.close()
  })

  it('still maps an unbranded error to a safe 500', async () => {
    const adapter = new InMemoryAdapter({ User: [], Post: [] })
    adapter.list = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432')
    }
    app = await createAdminApp(adapter)

    const response = await request(app.getHttpServer()).get('/admin/User').expect(500)

    expect(response.body.error.code).toBe('INTERNAL_ERROR')
    expect(response.text).not.toContain('ECONNREFUSED')

    await app.close()
  })
})

describe('the brand does not leak into responses', () => {
  it('is non-enumerable, so it cannot be serialised', () => {
    const error = new firstCopy.FieldNotFoundError('User', 'nope')

    expect(Object.keys(error)).not.toContain('Symbol(nest-admin.error)')
    expect(JSON.stringify({ ...error })).not.toContain('nest-admin.error')
  })
})
