/**
 * A server with no login routes.
 *
 * The interface asks `GET /admin/auth/session` before anything else, and an
 * admin whose application supplied its own `AdminAuth` answers `404` - it has
 * no login endpoints, which is exactly what the interface needs to know in
 * order not to show a sign-in form for an identity system it does not own.
 *
 * Every test below this one is about a screen rather than about signing in, so
 * they all describe that server. Written once here rather than eleven times,
 * and named for what it means rather than for the status code.
 */
export const NO_LOGIN_ROUTES = {
  status: 404,
  json: async () => ({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'This admin is not using the built-in authentication.',
    },
  }),
} as unknown as Response

/** Is this the session probe? */
export const isSessionProbe = (url: unknown): boolean => String(url).includes('/auth/session')
