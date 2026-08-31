/**
 * Signing in, signing out, and asking who you are.
 *
 * ## Why this controller is not behind the guard
 *
 * Everything else in the admin is. These three cannot be: a login route that
 * requires a session is a door that only opens from inside. So the guard is
 * off here and each handler is responsible for its own answer - which is why
 * they are short and why the only thing they do is call into `built-in.ts`.
 *
 * ## Why it exists even when nobody uses it
 *
 * Routes are registered when the module is defined; the `auth` a consumer
 * chose arrives later, from a provider. Rather than make the choice structural
 * - and force every application to declare its auth in two places - the routes
 * are always registered and answer `404` when the configured auth is not one
 * of ours. An application using its own `AdminAuth` sees an admin with no login
 * endpoints, which is what it should see.
 */
import { InvalidQueryError, summarise, UnauthorizedError } from '@nest-admin/core'
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common'

import { AdminExceptionFilter } from '../http/exception.filter.js'
import { success, type SuccessResponse } from '../http/response.js'
import { ADMIN_AUTH } from '../tokens.js'
import {
  attemptKey,
  builtInRuntimeOf,
  clearSessionCookie,
  cookieFrom,
  setSessionCookie,
  type BuiltInAuthRuntime,
} from './built-in.js'
import type { AdminAuth } from './contract.js'
import { readSession, signSession } from './session.js'

/** What the interface is told about whoever is signed in. Never the hash. */
interface SessionResponse {
  readonly account: ReturnType<typeof summarise> | null
}

@Controller('auth')
@UseFilters(AdminExceptionFilter)
export class AdminAuthController {
  constructor(@Inject(ADMIN_AUTH) private readonly auth: AdminAuth) {}

  /**
   * `GET /admin/auth/session` - who is signed in, if anyone.
   *
   * Answers `200` with `account: null` rather than `401` for an absent
   * session. The interface asks this before it has any reason to think anybody
   * is signed in, and an error is the wrong shape for "no, and that is fine" -
   * it would put a failure in the console on every visit to the login page.
   */
  @Get('session')
  async session(@Req() request: RawRequest): Promise<SuccessResponse<SessionResponse>> {
    const runtime = this.runtime()
    const token = cookieFrom(request?.headers?.cookie, runtime.cookieName)
    const id = token === undefined ? undefined : readSession(token, runtime.secret)

    if (id === undefined) return success({ account: null })

    const account = await runtime.store.findById(id)
    return success({
      account: !account || account.disabled === true ? null : summarise(account),
    })
  }

  /**
   * `POST /admin/auth/login` with `{ email, password }`.
   *
   * `200` and a cookie, or `401` and nothing. There is exactly one failure
   * message: an unknown address, a wrong password, a disabled account and a
   * locked-out one are indistinguishable from outside. Telling them apart is
   * convenient for the person signing in perhaps twice a year, and a list of
   * which addresses are registered for everyone else.
   */
  @Post('login')
  @HttpCode(200)
  async login(
    @Req() request: RawRequest,
    @Res({ passthrough: true }) response: unknown,
    @Body() body: { email?: unknown; password?: unknown },
  ): Promise<SuccessResponse<SessionResponse>> {
    const runtime = this.runtime()
    assertSameOrigin(request)

    if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
      throw new InvalidQueryError('Signing in requires an email and a password.')
    }

    const account = await runtime.signIn(body.email, body.password, attemptKey(request, body.email))

    if (!account) {
      throw new UnauthorizedError('Those details do not match an account.')
    }

    /*
     * A new token, always.
     *
     * Whatever cookie arrived with this request is discarded rather than kept
     * or upgraded. That is what stops session fixation: an attacker who can
     * plant a cookie before someone signs in must not still hold a valid one
     * afterwards.
     */
    setSessionCookie(
      response,
      signSession(account.id, runtime.secret, runtime.maxAge),
      runtime,
      request,
    )

    return success({ account: summarise(account) })
  }

  /**
   * `POST /admin/auth/logout`.
   *
   * A POST rather than a GET, so a link or an image somewhere else cannot sign
   * someone out by being loaded. Always `200`: signing out when you were not
   * signed in is not a failure, it is the state you asked for.
   */
  @Post('logout')
  @HttpCode(200)
  logout(
    @Req() request: RawRequest,
    @Res({ passthrough: true }) response: unknown,
  ): SuccessResponse<SessionResponse> {
    const runtime = this.runtime()
    assertSameOrigin(request)
    clearSessionCookie(response, runtime, request)
    return success({ account: null })
  }

  /**
   * The built-in auth's runtime, or a 404.
   *
   * Not a 500: an application using its own `AdminAuth` has no login routes,
   * and "this endpoint does not exist here" is exactly true.
   */
  private runtime(): BuiltInAuthRuntime {
    const runtime = builtInRuntimeOf(this.auth)
    if (!runtime) {
      throw new NotFoundException(
        'This admin is not using the built-in authentication, so it has no login routes.',
      )
    }
    return runtime
  }
}

interface RawRequest {
  readonly method?: string
  readonly headers?: Record<string, string | string[] | undefined>
  readonly socket?: { readonly remoteAddress?: string }
  readonly ip?: string
}

/**
 * Refuse a state-changing request that came from somewhere else.
 *
 * The session cookie is already `SameSite=Lax`, which means a cross-site POST
 * does not carry it and arrives unauthenticated - that is the real defence.
 * This is the second lock: it costs one comparison and it covers the case where
 * a future change loosens the cookie, or a browser is older than the attribute.
 *
 * Checked only when `Origin` is present. Browsers send it on every
 * cross-origin request and on same-origin writes; a script or a curl command
 * sends neither, and refusing those would break using the API from a terminal
 * for no security gain - a program that can set headers can set this one.
 */
function assertSameOrigin(request: RawRequest | undefined): void {
  const origin = header(request, 'origin')
  if (origin === undefined) return

  const host = header(request, 'host')
  if (host === undefined) return

  let sent: string
  try {
    sent = new URL(origin).host
  } catch {
    throw new UnauthorizedError('This request did not come from the admin.')
  }

  if (sent !== host) {
    throw new UnauthorizedError('This request did not come from the admin.')
  }
}

function header(request: RawRequest | undefined, name: string): string | undefined {
  const value = request?.headers?.[name]
  return typeof value === 'string' ? value : undefined
}
