/**
 * The two pieces of cryptography this release rests on.
 *
 * Tested apart from the HTTP that uses them, because the properties that matter
 * are properties of the functions: a hash nobody can reverse, a token nobody
 * can forge, and neither of them throwing at input it does not recognise.
 */
import { describe, expect, it } from 'vitest'

import { hashAdminPassword, verifyAdminPassword } from '../src/auth/password.js'
import {
  generateSessionSecret,
  MIN_SECRET_LENGTH,
  readSession,
  shouldRenew,
  signSession,
} from '../src/auth/session.js'

const SECRET = 'a'.repeat(MIN_SECRET_LENGTH)

describe('hashing a password', () => {
  it('verifies the password it was made from', async () => {
    const hash = await hashAdminPassword('correct horse battery staple')
    expect(await verifyAdminPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('refuses anything else', async () => {
    const hash = await hashAdminPassword('hunter2')
    expect(await verifyAdminPassword('hunter3', hash)).toBe(false)
    expect(await verifyAdminPassword('', hash)).toBe(false)
    expect(await verifyAdminPassword('hunter2 ', hash)).toBe(false)
  })

  it('never produces the same hash twice', async () => {
    // A salt per password. Without one, two people who chose the same password
    // are visibly the same row in the database, and one cracked hash is two
    // accounts.
    const a = await hashAdminPassword('hunter2')
    const b = await hashAdminPassword('hunter2')

    expect(a).not.toBe(b)
    expect(await verifyAdminPassword('hunter2', a)).toBe(true)
    expect(await verifyAdminPassword('hunter2', b)).toBe(true)
  })

  it('carries its parameters, so they can be raised later', async () => {
    // The cost is recorded with the hash rather than assumed from this file.
    // Raising it later has to leave every existing password verifiable, and
    // the alternative is a migration nobody can run - the plaintext is gone.
    const hash = await hashAdminPassword('hunter2')
    const [scheme, n, r, p] = hash.split(String.fromCharCode(36))

    expect(scheme).toBe('scrypt')
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 14)
    expect(Number(r)).toBeGreaterThan(0)
    expect(Number(p)).toBeGreaterThan(0)
  })

  it('answers false for a hash it does not understand, rather than throwing', async () => {
    // A store holding something unexpected is a configuration problem. Turning
    // it into a 500 on the login route would say that the account exists and
    // that its record is unusual.
    for (const stored of [
      '',
      'not-a-hash',
      'bcrypt$2b$10$abcdef',
      'scrypt$notanumber$8$1$aa$bb',
      'scrypt$32768$8$1$zz$hash', // salt is not hex
      'scrypt$1$8$1$aa$bb', // cost below the accepted range
      'scrypt$1099511627776$8$1$aa$bb', // and above it
    ]) {
      expect(await verifyAdminPassword('hunter2', stored), stored).toBe(false)
    }
  })

  it('refuses to hash an empty password rather than storing one nobody set', async () => {
    await expect(hashAdminPassword('')).rejects.toThrow(/password is required/i)
  })
})

describe('the session token', () => {
  it('names the account it was issued for', () => {
    expect(readSession(signSession('acc_1', SECRET, 3600), SECRET)).toBe('acc_1')
  })

  it('is worthless without the secret', () => {
    const token = signSession('acc_1', SECRET, 3600)
    expect(readSession(token, 'b'.repeat(MIN_SECRET_LENGTH))).toBeUndefined()
  })

  it('cannot be edited', () => {
    // The obvious attack: swap the account id for someone else's and keep the
    // signature. It is over the payload, so it stops matching.
    const token = signSession('acc_1', SECRET, 3600)
    const [version, payload, signature] = token.split('.')

    const forged = Buffer.from(JSON.stringify({ sub: 'acc_2', exp: 2 ** 40 })).toString('base64url')
    expect(readSession(`${version}.${forged}.${signature}`, SECRET)).toBeUndefined()

    // And the signature cannot be dropped either.
    expect(readSession(`${version}.${payload}`, SECRET)).toBeUndefined()
  })

  it('expires', () => {
    expect(readSession(signSession('acc_1', SECRET, -1), SECRET)).toBeUndefined()
  })

  it('answers undefined for anything that is not a token', () => {
    for (const junk of [undefined, null, 42, '', 'x', 'a.b.c', 'v9.abc.def']) {
      expect(readSession(junk, SECRET), String(junk)).toBeUndefined()
    }
  })

  it('renews only once it is past halfway', () => {
    // Renewing every request would set a cookie on every response; renewing at
    // the halfway point means an active session never expires under someone.
    const lifetime = 3600
    expect(shouldRenew(signSession('acc_1', SECRET, lifetime), SECRET, lifetime)).toBe(false)
    expect(shouldRenew(signSession('acc_1', SECRET, 100), SECRET, lifetime)).toBe(true)
  })

  it('does not renew a token it cannot verify', () => {
    const token = signSession('acc_1', SECRET, 100)
    expect(shouldRenew(token, 'b'.repeat(MIN_SECRET_LENGTH), 3600)).toBe(false)
  })

  it('generates a secret long enough to be one', () => {
    expect(generateSessionSecret().length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH)
    expect(generateSessionSecret()).not.toBe(generateSessionSecret())
  })
})
