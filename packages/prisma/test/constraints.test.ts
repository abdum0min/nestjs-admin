/**
 * Unit tests for the Prisma error -> ConstraintError mapping.
 *
 * `crud.test.ts` already drives this through a real database, but only ever
 * sees the shapes *one* connector produces. Prisma reports the same violation
 * differently per connector and per client build - a driver adapter nests the
 * column names two levels deeper than a client without one, and some connectors
 * report an index name where others report columns. Those shapes cannot be
 * produced from the fixture database, so they are asserted directly.
 *
 * The shapes below were taken from real errors, not invented.
 */
import { ConstraintError } from '@nest-admin/core'
import { describe, expect, it } from 'vitest'

import { toConstraintError } from '../src/errors/constraints.js'

const known = (code: string, meta?: Record<string, unknown>) => ({ code, meta })

describe('unique violations', () => {
  it('reads the columns a driver adapter nests inside its own report', () => {
    // Prisma 7 + @prisma/adapter-better-sqlite3. `meta.target` is absent here.
    const failure = toConstraintError(
      known('P2002', {
        driverAdapterError: {
          cause: { kind: 'UniqueConstraintViolation', constraint: { fields: ['email'] } },
        },
      }),
      'User',
    )

    expect(failure).toBeInstanceOf(ConstraintError)
    expect(failure).toMatchObject({ constraint: 'unique', fields: ['email'] })
    expect(failure?.message).toBe('Another User already has this email.')
  })

  it('reads the flat target a client without a driver adapter reports', () => {
    expect(toConstraintError(known('P2002', { target: ['email'] }), 'User')).toMatchObject({
      fields: ['email'],
    })
  })

  it('recovers the column from an index name', () => {
    // Some connectors name the index rather than its columns.
    expect(toConstraintError(known('P2002', { target: 'User_email_key' }), 'User')).toMatchObject({
      fields: ['email'],
    })
  })

  it('recovers every column of a composite index', () => {
    expect(
      toConstraintError(known('P2002', { target: 'Post_authorId_slug_key' }), 'Post'),
    ).toMatchObject({ fields: ['authorId', 'slug'] })
  })

  it('names no field rather than guessing at one', () => {
    const failure = toConstraintError(known('P2002', { target: 'sqlite_autoindex_1' }), 'User')

    // A message that blames the wrong field is worse than one that blames none.
    expect(failure?.fields).toEqual(['sqlite_autoindex_1'])
    expect(toConstraintError(known('P2002'), 'User')?.message).toBe(
      'Another User already has one of these values.',
    )
  })
})

describe('foreign keys', () => {
  it('maps a reference to a missing record', () => {
    expect(toConstraintError(known('P2003', { field_name: 'authorId' }), 'Post')).toMatchObject({
      constraint: 'foreign-key',
      fields: ['authorId'],
    })
  })

  it('maps a delete that would orphan a required relation', () => {
    // P2014 is the same problem arriving from the opposite direction.
    expect(toConstraintError(known('P2014'), 'User')).toMatchObject({ constraint: 'foreign-key' })
  })
})

describe('missing required values', () => {
  class PrismaClientValidationError extends Error {}

  const validation = (message: string) => new PrismaClientValidationError(message)

  it('extracts the field from the argument phrase', () => {
    const failure = toConstraintError(
      validation(
        'Invalid `prisma.user.create()` invocation in\nD:\app\node_modules\pkg\adapter.js:41:9\n\nArgument `email` is missing.',
      ),
      'User',
    )

    expect(failure).toMatchObject({ constraint: 'required', fields: ['email'] })
    expect(failure?.message).toBe('email is required.')
  })

  it('never forwards the error text, which renders the call site and the data', () => {
    const failure = toConstraintError(
      validation(
        'Invalid invocation in D:\secret\app.js:1:1\n{ password: "hunter2" }\n\nArgument `email` is missing.',
      ),
      'User',
    )

    expect(failure?.message).not.toMatch(/hunter2|secret|invocation/)
  })

  it('names every missing argument', () => {
    expect(
      toConstraintError(
        validation('Argument `email` is missing.\nArgument `name` is missing.'),
        'User',
      ),
    ).toMatchObject({ fields: ['email', 'name'] })
  })

  it('is not confused by a plain Error carrying the same words', () => {
    // Only a PrismaClientValidationError is read this way. Anything else with
    // a similar message is someone else's error, and stays theirs.
    expect(toConstraintError(new Error('Argument `email` is missing.'), 'User')).toBeUndefined()
  })
})

describe('what is left alone', () => {
  it('passes through a code that is not a constraint', () => {
    // P2025 is "record not found", which the adapter already handles.
    expect(toConstraintError(known('P2025'), 'User')).toBeUndefined()
  })

  it('passes through anything that is not a Prisma error at all', () => {
    expect(toConstraintError(new Error('ECONNREFUSED'), 'User')).toBeUndefined()
    expect(toConstraintError(undefined, 'User')).toBeUndefined()
    expect(toConstraintError('P2002', 'User')).toBeUndefined()
  })
})
