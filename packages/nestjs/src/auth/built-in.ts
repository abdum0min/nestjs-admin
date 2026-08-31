/**
 * An `AdminAuth` that ships in the box.
 *
 * ## This does not move the boundary
 *
 * `AdminAuth` is unchanged and still the only way in. An application with its
 * own identity system implements it and never sees any of this. What changes is
 * that an application *without* one no longer has to write a password hash, a
 * cookie and a form before the admin can be put behind a login.
 *
 * So there are three answers to "who may open this?", and a consumer picks one:
 *
 *     auth: unsafeAllowAllRequests()   development only, warns at startup
 *     auth: myOwnAuth                  an application that already has identity
 *     auth: builtInAuth({ ... })       a login page, sessions and a store
 *
 * ## The accounts are separate from the application's users
 *
 * By construction: the store is a contract over storage the application
 * nominates, and the intended shape is a model of its own. The admin never
 * consults the application's user table to decide who may sign in, and adding
 * a customer never adds someone who can administer the system.
 */
import {
  summarise,
  UnauthorizedError,
  type AdminAccount,
  type AdminAccountStore,
  type AdminAccountSummary,
} from '@nest-admin/core'
import { Logger, type ExecutionContext } from '@nestjs/common'

import type { AdminAuth } from './contract.js'
import { NO_SUCH_ACCOUNT, verifyAdminPassword } from './password.js'
import { MIN_SECRET_LENGTH, readSession, shouldRenew, signSession } from './session.js'

const logger = new Logger('NestAdmin')

/** Twelve hours. Long enough for a working day, short enough to matter. */
const DEFAULT_MAX_AGE = 12 * 60 * 60

export interface BuiltInAuthOptions {
  /**
   * Where the accounts live.
   *
   * `prismaAccountStore` from `@nest-admin/nestjs/prisma` covers the usual
   * case; anything satisfying the contract works.
   */
  readonly store: AdminAccountStore

  readonly session: {
    /**
     * The key the session cookie is signed with. **Required.**
     *
     * At least 32 characters, checked at startup. A short secret is a
     * forgeable cookie, and the failure is silent: everything works, and
     * anybody can mint a session for any account.
     *
     * Read it from the environment. A secret in source control is a secret
     * everyone who has ever cloned the repository knows.
     */
    readonly secret: string

    /** How long a session lasts, in seconds. Twelve hours by default. */
    readonly maxAge?: number

    /** The cookie's name. Change it only to avoid a collision. */
    readonly cookieName?: string

    /**
     * Send the cookie only over HTTPS.
     *
     * Left unset it is decided per request: on for everything except
     * localhost, which is what makes the admin work in development without
     * being insecure anywhere else. Set it to `true` to require HTTPS always.
     */
    readonly secure?: boolean
  }

  /** Failed attempts before a pause. Ten by default. */
  readonly maxAttempts?: number

  /** How long that pause lasts, in seconds. Fifteen minutes by default. */
  readonly lockoutSeconds?: number
}

/** The parts of a built-in auth the login routes need. */
export interface BuiltInAuthRuntime {
  readonly store: AdminAccountStore
  readonly secret: string
  readonly maxAge: number
  readonly cookieName: string
  readonly secure: boolean | undefined
  /** Try an email and password. `undefined` when they do not match. */
  signIn(email: unknown, password: unknown, from: string): Promise<AdminAccount | undefined>
}

/**
 * Recognising a built-in auth without adding anything to `AdminAuth`.
 *
 * `Symbol.for` rather than a private symbol, for the reason the error taxonomy
 * gives: the published package inlines its own copy of this module per
 * entrypoint, and two copies agree on a registered symbol where two `Symbol()`
 * calls would not.
 */
const RUNTIME = Symbol.for('nest-admin.built-in-auth')

/** The runtime behind an auth, if it is one of ours. */
export function builtInRuntimeOf(auth: unknown): BuiltInAuthRuntime | undefined {
  return typeof auth === 'object' && auth !== null
    ? ((auth as Record<symbol, BuiltInAuthRuntime | undefined>)[RUNTIME] ?? undefined)
    : undefined
}

/**
 * The account this request signed in as.
 *
 * For a `resourceAuth` policy or a hook that needs to know who is asking.
 * `undefined` when the admin is not using the built-in auth, which is why it
 * is optional rather than assumed.
 */
export function adminAccountOf(context: ExecutionContext): AdminAccountSummary | undefined {
  const request = context.switchToHttp().getRequest<{ adminAccount?: AdminAccountSummary }>()
  return request?.adminAccount
}

export function builtInAuth(options: BuiltInAuthOptions): AdminAuth {
  const secret = options.session?.secret
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `builtInAuth() requires \`session.secret\` of at least ${MIN_SECRET_LENGTH} characters. ` +
        'A short secret can be guessed, and a guessed one mints a session for any account. ' +
        'Read it from the environment rather than writing it here.',
    )
  }

  if (!options.store || typeof options.store.findByEmail !== 'function') {
    throw new Error(
      'builtInAuth() requires a `store`. Use `prismaAccountStore({ client })` from ' +
        '`@nest-admin/nestjs/prisma`, or supply your own AdminAccountStore.',
    )
  }

  const maxAge = options.session.maxAge ?? DEFAULT_MAX_AGE
  const cookieName = options.session.cookieName ?? 'nest_admin_session'
  const attempts = new Attempts(options.maxAttempts ?? 10, options.lockoutSeconds ?? 15 * 60)

  const runtime: BuiltInAuthRuntime = {
    store: options.store,
    secret,
    maxAge,
    cookieName,
    secure: options.session.secure,

    async signIn(email, password, from) {
      if (typeof email !== 'string' || typeof password !== 'string') return undefined
      if (attempts.lockedOut(from)) return undefined

      const account = await options.store.findByEmail(email.trim().toLowerCase())

      /*
       * The verification runs whether or not the account exists.
       *
       * Returning early for an unknown email answers in microseconds while a
       * real one takes a hundred milliseconds, and that difference is a list of
       * which addresses are registered. `NO_SUCH_ACCOUNT` is a hash of a random
       * string nobody kept, so the work is the same and the answer is no.
       */
      const stored = account?.passwordHash ?? (await NO_SUCH_ACCOUNT)
      const correct = await verifyAdminPassword(password, stored)

      if (!correct || !account || account.disabled === true) {
        attempts.failed(from)
        return undefined
      }

      attempts.succeeded(from)

      // Not awaited, and a failure is logged rather than surfaced: "your login
      // worked but we could not write down that it did" is not something the
      // person signing in can act on.
      void options.store.recordLogin?.(account.id).catch((cause: unknown) => {
        logger.warn(`Could not record a login: ${String(cause)}`)
      })

      return account
    },
  }

  const auth: AdminAuth = {
    async authorize(context) {
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
      const token = cookieFrom(request?.headers?.cookie, cookieName)

      const id = token === undefined ? undefined : readSession(token, secret)
      if (id === undefined) throw new UnauthorizedError('Sign in to continue.')

      /*
       * The account is loaded on every request rather than trusted from the
       * cookie.
       *
       * It is the difference between "sessions expire eventually" and
       * "disabling an account works now". It also means a token cannot outlive
       * the thing it names: delete the row and the next request is refused.
       */
      const account = await options.store.findById(id)
      if (!account || account.disabled === true) {
        throw new UnauthorizedError('Sign in to continue.')
      }

      request.adminAccount = summarise(account)

      // Halfway through its life, so an active session never expires under
      // someone while an abandoned one still dies on schedule.
      if (token !== undefined && shouldRenew(token, secret, maxAge)) {
        setSessionCookie(
          context.switchToHttp().getResponse(),
          signSession(account.id, secret, maxAge),
          runtime,
          request,
        )
      }
    },
  }

  Object.defineProperty(auth, RUNTIME, { value: runtime, enumerable: false })
  return auth
}

interface AuthenticatedRequest {
  readonly headers?: Record<string, string | string[] | undefined>
  readonly socket?: { readonly remoteAddress?: string }
  readonly ip?: string
  adminAccount?: AdminAccountSummary
}

/**
 * One cookie out of the header, without a cookie parser.
 *
 * A dependency for eleven lines is a poor trade in a package that has one, and
 * the format is `name=value; name=value` - not a grammar worth importing.
 * Values are decoded because a signature is base64url and survives encoding
 * either way, but a future value might not.
 */
export function cookieFrom(header: unknown, name: string): string | undefined {
  if (typeof header !== 'string') return undefined

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue

    const value = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  return undefined
}

/**
 * Write the session cookie.
 *
 * `httpOnly` so script cannot read it, which is what turns a cross-site
 * scripting bug into a smaller problem than a stolen session. `sameSite=Lax`
 * is the CSRF defence for the whole admin API: a cross-site POST, PATCH or
 * DELETE does not carry the cookie at all, so a forged request arrives
 * unauthenticated. `Strict` would be marginally stronger and would also log
 * someone out when they follow a link to the admin from anywhere else.
 *
 * `Secure` is on unless the request came from localhost, so development works
 * over http without the flag being off anywhere it matters.
 */
export function setSessionCookie(
  response: unknown,
  token: string,
  runtime: BuiltInAuthRuntime,
  request?: AuthenticatedRequest,
): void {
  writeCookie(
    response,
    [
      `${runtime.cookieName}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${runtime.maxAge}`,
      ...(isSecure(runtime.secure, request) ? ['Secure'] : []),
    ].join('; '),
  )
}

/** Remove it, with the same attributes - a browser matches on those too. */
export function clearSessionCookie(
  response: unknown,
  runtime: BuiltInAuthRuntime,
  request?: AuthenticatedRequest,
): void {
  writeCookie(
    response,
    [
      `${runtime.cookieName}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
      ...(isSecure(runtime.secure, request) ? ['Secure'] : []),
    ].join('; '),
  )
}

function isSecure(configured: boolean | undefined, request?: AuthenticatedRequest): boolean {
  if (configured !== undefined) return configured

  const host = String(request?.headers?.['host'] ?? '')
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
  return !local
}

/** `setHeader` on Node's response; `header` on Fastify's reply. */
function writeCookie(response: unknown, value: string): void {
  const target = response as {
    setHeader?: (name: string, value: string) => void
    header?: (name: string, value: string) => void
  }
  if (typeof target?.setHeader === 'function') return target.setHeader('Set-Cookie', value)
  if (typeof target?.header === 'function') target.header('Set-Cookie', value)
}

/**
 * Somewhere to count failed attempts against.
 *
 * The address plus the email, so one person guessing at one account cannot
 * lock out everybody, and a spread of guesses from one place still adds up.
 */
export function attemptKey(request: AuthenticatedRequest | undefined, email: unknown): string {
  const address =
    (typeof request?.ip === 'string' ? request.ip : undefined) ??
    request?.socket?.remoteAddress ??
    'unknown'
  return `${address}|${typeof email === 'string' ? email.trim().toLowerCase() : ''}`
}

/**
 * Failed sign-ins, counted in memory.
 *
 * In memory, and therefore per process: behind several instances an attacker
 * gets the allowance once per instance. Said plainly rather than implied,
 * because the alternative is a shared store this package would have to invent,
 * and slowing an attack down by an order of magnitude without a dependency is
 * worth more than the difference between that and stopping it.
 *
 * It is not a substitute for a rate limiter at the edge, and does not pretend
 * to be one.
 */
class Attempts {
  readonly #failures = new Map<string, { count: number; since: number; until: number }>()

  constructor(
    private readonly max: number,
    private readonly seconds: number,
  ) {}

  lockedOut(key: string): boolean {
    const entry = this.#failures.get(key)
    if (!entry) return false

    // Counting, but not locked yet. An earlier version deleted the entry here,
    // which reset the count on every attempt and meant the lockout never
    // triggered at all - a rate limiter that rate-limits nothing. Found by the
    // test that tries the right password after ten wrong ones.
    if (entry.until === 0) return false

    if (entry.until > Date.now()) return true

    // The window passed. Forget the whole thing rather than leaving someone
    // one attempt away from being locked out again forever.
    this.#failures.delete(key)
    return false
  }

  failed(key: string): void {
    const now = Date.now()
    const existing = this.#failures.get(key)

    // Failures that are older than the lockout window do not count towards
    // the next one. Otherwise a typo in March and nine more in September add
    // up to a lockout nobody can explain.
    const entry =
      existing && now - existing.since < this.seconds * 1000
        ? existing
        : { count: 0, since: now, until: 0 }

    entry.count += 1
    if (entry.count >= this.max) entry.until = now + this.seconds * 1000
    this.#failures.set(key, entry)

    // Nothing else prunes this map, and an attacker choosing a new email each
    // time would otherwise grow it without limit.
    if (this.#failures.size > 10_000) this.#prune()
  }

  succeeded(key: string): void {
    this.#failures.delete(key)
  }

  #prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.#failures) {
      const locked = entry.until > now
      const recent = now - entry.since < this.seconds * 1000
      if (!locked && !recent) this.#failures.delete(key)
    }
  }
}
