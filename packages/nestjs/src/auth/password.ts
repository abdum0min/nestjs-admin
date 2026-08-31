/**
 * Turning a password into something safe to store, and checking it again.
 *
 * ## Why scrypt and not bcrypt or argon2
 *
 * Both are better-known and both are native modules. This package has exactly
 * one runtime dependency and no compiled code, which is why it installs the
 * same way on every platform and every Node version - and a password hash is a
 * poor reason to give that up. `node:crypto` ships scrypt, which is a memory-
 * hard KDF designed for this and is not a compromise.
 *
 * What is *not* acceptable is a plain digest. SHA-256 is designed to be fast,
 * and fast is the entire problem: a modern card tries billions of them a
 * second. The parameters below are chosen to make one attempt cost something.
 *
 * ## The stored form
 *
 *     scrypt$N$r$p$<salt hex>$<hash hex>
 *
 * The parameters travel with the hash rather than living in this file. That is
 * what makes them changeable: raising the cost later leaves every existing
 * password verifiable with the parameters it was made with, and the alternative
 * is a migration nobody can run because the plaintext is gone.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/**
 * Cost parameters.
 *
 * `N = 2^15` is a deliberate step up from Node's default of 2^14: it puts one
 * derivation in the region of a hundred milliseconds, which nobody signing in
 * notices and an attacker pays for every guess. `maxmem` has to be raised with
 * it, because Node's default ceiling is sized for the default `N` and scrypt
 * throws rather than quietly using less memory.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2
const KEY_LENGTH = 64
const SALT_BYTES = 16

/** `$` as a code point, so a template literal never eats it in transit. */
const SEP = String.fromCharCode(36)

/**
 * Hash a password for storage.
 *
 * Exported for the application, because creating accounts is its business -
 * a seed script, a migration, or a form of its own. The admin never mints an
 * administrator; see `AdminAccountStore` for why.
 */
export async function hashAdminPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('A password is required.')
  }

  const salt = randomBytes(SALT_BYTES).toString('hex')
  const key = await derive(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAXMEM })

  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt, key.toString('hex')].join(SEP)
}

/**
 * Does this password match this stored hash?
 *
 * Never throws for a malformed or unrecognised hash - it answers `false`. A
 * store holding something this function does not understand is a configuration
 * problem, and turning it into a 500 on the login route would tell an attacker
 * that the account exists and that its record is unusual.
 *
 * The comparison is `timingSafeEqual`, not `===`. String equality returns as
 * soon as two bytes differ, and the difference is measurable often enough to
 * recover a hash a byte at a time.
 */
export async function verifyAdminPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) return false

  try {
    const key = await derive(password, parsed.salt, parsed.hash.length / 2, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 128 * parsed.N * parsed.r * 2,
    })
    const expected = Buffer.from(parsed.hash, 'hex')
    return key.length === expected.length && timingSafeEqual(key, expected)
  } catch {
    // A hash whose recorded parameters are outside what this Node build will
    // do. Answering `false` keeps the login route uniform; the operator finds
    // out from the account not working, not from a stack trace on the wire.
    return false
  }
}

interface Parsed {
  readonly N: number
  readonly r: number
  readonly p: number
  readonly salt: string
  readonly hash: string
}

function parse(stored: unknown): Parsed | undefined {
  if (typeof stored !== 'string') return undefined

  const [scheme, n, r, p, salt, hash] = stored.split(SEP)
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return undefined

  const N = Number(n)
  const rounds = Number(r)
  const parallel = Number(p)

  // A power of two, within a range that cannot be used to ask this process for
  // an unbounded amount of memory. A hash is not trusted input in the usual
  // sense, but it is read from storage the admin does not own.
  const usable =
    Number.isInteger(N) &&
    N >= 2 ** 12 &&
    N <= 2 ** 20 &&
    (N & (N - 1)) === 0 &&
    Number.isInteger(rounds) &&
    rounds > 0 &&
    rounds <= 32 &&
    Number.isInteger(parallel) &&
    parallel > 0 &&
    parallel <= 16 &&
    /^[0-9a-f]+$/i.test(salt) &&
    /^[0-9a-f]+$/i.test(hash) &&
    hash.length % 2 === 0

  return usable ? { N, r: rounds, p: parallel, salt, hash } : undefined
}

/**
 * A hash that no password matches, for accounts that do not exist.
 *
 * The sign-in path verifies against this when the email is unknown, so a
 * request for a real account and one for an imaginary account take the same
 * time. Without it, "no such account" returns in microseconds and "wrong
 * password" takes a hundred milliseconds, and the difference is a list of
 * which addresses are registered.
 *
 * Built once at module load, from a random secret nobody keeps.
 */
export const NO_SUCH_ACCOUNT: Promise<string> = hashAdminPassword(randomBytes(32).toString('hex'))
