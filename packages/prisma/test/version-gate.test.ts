import { describe, expect, it } from 'vitest'

import {
  assertSupportedPrismaVersion,
  PrismaVersionUnsupportedError,
  readClientVersion,
  SUPPORTED_PRISMA_MAJORS,
} from '../src/client/version-gate.js'
import { createTestClient } from './client.js'

describe('reading the client version', () => {
  it('reads it from a real Prisma Client', async () => {
    const client = createTestClient()
    // Proves the gate reads something real, not a shape we invented.
    expect(readClientVersion(client)).toMatch(/^\d+\.\d+\.\d+/)
    await client.$disconnect()
  })

  it('returns undefined when it cannot be determined', () => {
    expect(readClientVersion({})).toBeUndefined()
    expect(readClientVersion(null)).toBeUndefined()
    expect(readClientVersion('nonsense')).toBeUndefined()
    expect(readClientVersion({ _clientVersion: '' })).toBeUndefined()
    expect(readClientVersion({ _clientVersion: 42 })).toBeUndefined()
  })
})

describe('the version gate', () => {
  it('accepts the Prisma version this package is built against', async () => {
    const client = createTestClient()
    expect(() => assertSupportedPrismaVersion(client)).not.toThrow()
    await client.$disconnect()
  })

  it('rejects an unsupported major with an actionable message', () => {
    expect(() => assertSupportedPrismaVersion({ _clientVersion: '6.2.0' })).toThrow(
      PrismaVersionUnsupportedError,
    )
    expect(() => assertSupportedPrismaVersion({ _clientVersion: '6.2.0' })).toThrow(
      /Prisma Client 6\.2\.0/,
    )
  })

  it('names both the shipped parser and the consumer version', () => {
    try {
      assertSupportedPrismaVersion({ _clientVersion: '9.0.0' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(PrismaVersionUnsupportedError)
      const gateError = error as PrismaVersionUnsupportedError
      expect(gateError.clientVersion).toBe('9.0.0')
      expect(gateError.supportedMajors).toEqual(SUPPORTED_PRISMA_MAJORS)
    }
  })

  /**
   * The gate must never become the outage. If Prisma renames the internal
   * field the gate reads, it has to fall silent rather than break every
   * consumer on an otherwise-fine upgrade.
   */
  it('fails open when the version is unreadable', () => {
    expect(() => assertSupportedPrismaVersion({})).not.toThrow()
    expect(() => assertSupportedPrismaVersion({ _clientVersion: 'not-a-version' })).not.toThrow()
  })

  it('compares majors only, so patch and minor bumps pass', () => {
    for (const version of ['7.0.0', '7.10.0', '7.99.5-rc.1']) {
      expect(() => assertSupportedPrismaVersion({ _clientVersion: version })).not.toThrow()
    }
  })
})
