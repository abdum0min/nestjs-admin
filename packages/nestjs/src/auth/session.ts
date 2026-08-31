/**
 * The session, as a signed cookie.
 *
 * ## Stateless, and what that costs
 *
 * There is no session table. The cookie carries the account id and an expiry,
 * signed with a secret only the server has, so a request can be authenticated
 * without a round trip to storage for the session itself.
 *
 * The cost is real and worth stating rather than discovering: **a session
 * cannot be revoked before it expires.** Two things soften it. Lifetimes are
 * short and renew as they are used, so an abandoned session dies on its own.
 * And every authenticated request loads the account, so disabling or deleting
 * one stops it working immediately - which is the revocation people actually
 * need. What remains unrevocable is one specific stolen cookie, until it
 * expires or the secret is rotated.
 *
 * ## What is in it
 *
 *     v1.<base64url payload>.<base64url HMAC-SHA256>
 *
 * The payload is `{ sub, exp }` and nothing else. Not the email, not the name,
 * not a role: a cookie is readable by whoever holds it, and none of that is
 * worth putting in front of them to save one lookup. It is also why the
 * account is fetched per request rather than trusted from the token - a
 * cookie issued yesterday would otherwise still claim yesterday's permissions.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Bumped if the payload's shape ever changes, so old cookies simply fail. */
const VERSION = 'v1'

interface Payload {
  /** The account id. */
  readonly sub: string
  /** Expiry, as a Unix timestamp in seconds. */
  readonly exp: number
}

const encode = (value: Buffer | string): string => Buffer.from(value as never).toString('base64url')

/**
 * Issue a token for an account.
 *
 * `lifetime` is in seconds. There is no "remember me": a longer session is a
 * longer window for a stolen cookie, and the renewal below already means an
 * active person is never asked to sign in again.
 */
export function signSession(accountId: string, secret: string, lifetime: number): string {
  const payload: Payload = {
    sub: accountId,
    exp: Math.floor(Date.now() / 1000) + lifetime,
  }

  const body = `${VERSION}.${encode(JSON.stringify(payload))}`
  return `${body}.${sign(body, secret)}`
}

/**
 * The account id a token names, or `undefined`.
 *
 * `undefined` covers every failure without distinguishing them: expired,
 * tampered with, from an older version, or simply not a token. A caller has
 * the same response to all of them - ask for a sign-in - and telling them
 * apart on the wire would say whether a forgery was close.
 */
export function readSession(token: unknown, secret: string): string | undefined {
  if (typeof token !== 'string') return undefined

  const cut = token.lastIndexOf('.')
  if (cut < 1) return undefined

  const body = token.slice(0, cut)
  const presented = token.slice(cut + 1)

  if (!body.startsWith(`${VERSION}.`)) return undefined
  if (!matches(presented, sign(body, secret))) return undefined

  try {
    const payload = JSON.parse(
      Buffer.from(body.slice(VERSION.length + 1), 'base64url').toString('utf8'),
    ) as Payload

    if (typeof payload.sub !== 'string' || payload.sub === '') return undefined
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return undefined

    return payload.sub
  } catch {
    // Signed, and still not JSON. Only reachable with the secret, so this is a
    // bug rather than an attack - but it is still not a reason to throw at
    // whoever is holding the cookie.
    return undefined
  }
}

/**
 * Is this token far enough through its life to be reissued?
 *
 * Renewing on every request would set a cookie on every response, which is
 * noise; renewing at the halfway point means an active session never expires
 * under someone and an abandoned one still dies on schedule.
 */
export function shouldRenew(token: string, secret: string, lifetime: number): boolean {
  const cut = token.lastIndexOf('.')
  if (cut < 1 || !matches(token.slice(cut + 1), sign(token.slice(0, cut), secret))) return false

  try {
    const payload = JSON.parse(
      Buffer.from(token.slice(VERSION.length + 1, cut), 'base64url').toString('utf8'),
    ) as Payload
    const remaining = payload.exp - Math.floor(Date.now() / 1000)
    return remaining < lifetime / 2
  } catch {
    return false
  }
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/**
 * Compare two signatures without leaking how far they matched.
 *
 * `===` on strings returns at the first differing byte, and the timing
 * difference is measurable often enough to reconstruct a signature one byte at
 * a time. The length check first is safe: a signature's length is not a secret.
 */
function matches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The floor for a session secret.
 *
 * 32 characters, checked at startup rather than trusted. A short secret is a
 * forgeable cookie, and the failure mode is silent: everything works, and
 * anybody can mint a session for any account.
 */
export const MIN_SECRET_LENGTH = 32

/** A secret of the right shape, for a consumer that needs one generated. */
export function generateSessionSecret(): string {
  return randomBytes(32).toString('base64url')
}
