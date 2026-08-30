/**
 * The admin API client.
 *
 * Every HTTP concern lives here: base URL, credentials, envelope unwrapping and
 * error translation. Components call typed functions and never see `fetch`,
 * a status code, or an envelope.
 *
 * Requests are sent with `credentials: 'include'` and nothing else. Phase 4
 * established that authentication belongs to the host application, so the UI
 * carries whatever the browser already has - a session cookie, a proxy header -
 * and never constructs, stores or refreshes a credential of its own.
 */
import { buildQueryString } from './query.js'
import type {
  AdminErrorCode,
  AdminRecord,
  ErrorEnvelope,
  ListQuery,
  ListResult,
  Metadata,
  SuccessEnvelope,
} from './types.js'

/**
 * Where the admin API lives.
 *
 * The server injects `window.__NEST_ADMIN_BASE__` into the shell it serves,
 * because the mount path is the application's choice and this bundle is built
 * long before it is made. The page cannot work it out for itself: routing is
 * hash-based, so `/panel/User` and `/panel#/User` look the same from inside.
 *
 * `VITE_ADMIN_API_BASE` overrides it for development, where the SPA runs on the
 * Vite dev server and the API on the application's own port - see
 * `vite.config.ts`. The final `/admin` is the last resort, for a shell served
 * by something that does not inject the global.
 */
declare global {
  interface Window {
    __NEST_ADMIN_BASE__?: string
  }
}

const API_BASE: string =
  (import.meta.env['VITE_ADMIN_API_BASE'] as string | undefined) ??
  (typeof window === 'undefined' ? undefined : window.__NEST_ADMIN_BASE__) ??
  '/admin'

/**
 * A failed request, carrying the server's machine-readable code.
 *
 * Screens branch on `code`. `message` is safe to show - the server's exception
 * filter forwards it only for the 4xx codes and substitutes a generic string
 * for anything internal - but it is never parsed.
 */
export class AdminApiError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

/** The shape the server sends. Anything else is treated as a transport fault. */
function isEnvelope(value: unknown): value is SuccessEnvelope<unknown> | ErrorEnvelope {
  return typeof value === 'object' && value !== null && 'success' in value
}

async function request<T>(path: string, init?: RequestInit): Promise<SuccessEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      // The browser's existing session is the credential; see the note above.
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...init,
    })
  } catch (cause) {
    // Network-level failure: no response at all, so there is no code to read.
    throw new AdminApiError('INTERNAL_ERROR', 'Could not reach the admin API.', 0)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!isEnvelope(payload)) {
    // A proxy error page, an HTML login redirect, or a crash before the filter
    // ran. Report the status rather than rendering someone else's HTML.
    throw new AdminApiError(
      response.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
      'The admin API returned an unexpected response.',
      response.status,
    )
  }

  if (!payload.success) {
    throw new AdminApiError(payload.error.code, payload.error.message, response.status)
  }

  return payload as SuccessEnvelope<T>
}

/** `GET /admin/meta` - the document every screen renders from. */
export async function fetchMetadata(): Promise<Metadata> {
  const { data } = await request<Metadata>('/meta')
  return data
}

/** `GET /admin/:model` */
export async function listRecords(model: string, query: ListQuery): Promise<ListResult> {
  const envelope = await request<readonly AdminRecord[]>(
    `/${encodeURIComponent(model)}${buildQueryString(query)}`,
  )

  return {
    records: envelope.data,
    // `meta` is present on list responses; the fallback keeps a pager from
    // crashing if a future server omits it.
    meta: envelope.meta ?? { total: envelope.data.length, page: 1, perPage: envelope.data.length },
  }
}

/** `GET /admin/:model/:id` */
export async function fetchRecord(model: string, id: string): Promise<AdminRecord> {
  const { data } = await request<AdminRecord>(
    `/${encodeURIComponent(model)}/${encodeURIComponent(id)}`,
  )
  return data
}

/** `POST /admin/:model` */
export async function createRecord(model: string, body: AdminRecord): Promise<AdminRecord> {
  const { data } = await request<AdminRecord>(`/${encodeURIComponent(model)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data
}

/** `PATCH /admin/:model/:id` */
export async function updateRecord(
  model: string,
  id: string,
  body: AdminRecord,
): Promise<AdminRecord> {
  const { data } = await request<AdminRecord>(
    `/${encodeURIComponent(model)}/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )
  return data
}

/** `DELETE /admin/:model/:id` - the server answers `{ success: true, data: null }`. */
export async function deleteRecord(model: string, id: string): Promise<void> {
  await request<null>(`/${encodeURIComponent(model)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
