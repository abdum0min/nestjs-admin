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
  AdminSession,
  Dashboard,
  TeamMember,
  TeamView,
  BulkDeleteResult,
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
    /** Whatever the server attached. Read through the accessors below. */
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }

  /**
   * The inputs this failure is about, if the server named any.
   *
   * A duplicate email, a missing required value, a hook that refused one
   * particular field: all of them arrive naming the column, which is what lets
   * a form put the message under that input instead of in a banner.
   *
   * Read defensively. `details` is a free-form object on the wire, and a form
   * that trusted its shape would break on a server that sent something else.
   */
  get fields(): readonly string[] {
    const named = this.details?.['fields']
    return Array.isArray(named) ? named.filter((entry) => typeof entry === 'string') : []
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
    // Announced before it is thrown, so the shell can react while the caller
    // still gets an error it can render if it wants to.
    if (payload.error.code === 'UNAUTHORIZED') {
      for (const listener of listeners) listener()
    }

    throw new AdminApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.details,
    )
  }

  return payload as SuccessEnvelope<T>
}

/**
 * Whoever is signed in, when the admin has a login of its own.
 *
 * Three answers, and they are three different situations rather than degrees
 * of failure:
 *
 *   `{ account }`   signed in
 *   `{ account: null }`  the admin has a login and nobody is using it
 *   `undefined`     this admin has no login routes, because the application
 *                   supplied its own `AdminAuth`
 *
 * The third is a 404 and is not an error. An application with its own identity
 * system should not see a sign-in screen from a package it asked to stay out of
 * authentication.
 */
export async function fetchSession(): Promise<AdminSession | undefined> {
  try {
    const { data } = await request<AdminSession>('/auth/session')
    return data
  } catch (cause) {
    if (cause instanceof AdminApiError && cause.status === 404) return undefined
    throw cause
  }
}

/** `POST /admin/auth/login`. Throws `UNAUTHORIZED` when the details do not match. */
export async function signIn(email: string, password: string): Promise<AdminSession> {
  const { data } = await request<AdminSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return data
}

/** `POST /admin/auth/logout`. */
export async function signOut(): Promise<void> {
  await request<AdminSession>('/auth/logout', { method: 'POST' })
}

/**
 * Told when a request comes back unauthenticated.
 *
 * A session can expire while the admin is open, and the screen that finds out
 * is whichever one happened to make a request - a table, a related list, an
 * action. Each of them showing "not signed in" in its own corner is worse than
 * useless: the person is signed out, and the page is still pretending to be an
 * admin.
 *
 * So the client says so once, centrally, and the shell decides what to do
 * about it. Not an error class, because it is not the requester's problem.
 */
const listeners = new Set<() => void>()

export function onUnauthorized(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `GET /admin/dashboard` - the widgets the landing page draws. */
export async function fetchDashboard(): Promise<Dashboard> {
  const { data } = await request<Dashboard>('/dashboard')
  return data
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
  /**
   * What the record's updated-at column held when this form was opened.
   *
   * Sent whenever the record had one. The server ignores it unless the admin
   * is configured with `concurrency: 'optimistic'`, so sending it always is
   * cheaper than asking whether it matters.
   */
  version?: string,
): Promise<AdminRecord> {
  const { data } = await request<AdminRecord>(
    `/${encodeURIComponent(model)}/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...(version === undefined ? {} : { headers: { 'x-admin-version': version } }),
    },
  )
  return data
}

/** `DELETE /admin/:model/:id` - the server answers `{ success: true, data: null }`. */
export async function deleteRecord(model: string, id: string, permanent = false): Promise<void> {
  await request<null>(
    `/${encodeURIComponent(model)}/${encodeURIComponent(id)}${permanent ? '?permanent=true' : ''}`,
    { method: 'DELETE' },
  )
}

/**
 * `POST /admin/restore/:model/:id` - undo a soft delete.
 *
 * Under a reserved first segment, like actions, because `/:model/:id/restore`
 * would be indistinguishable from a relation of that name.
 */
export async function restoreRecord(model: string, id: string): Promise<AdminRecord> {
  const { data } = await request<AdminRecord>(
    `/restore/${encodeURIComponent(model)}/${encodeURIComponent(id)}`,
    { method: 'POST' },
  )
  return data
}

/**
 * `DELETE /admin/:model` with `{ ids }` - delete a selection.
 *
 * Answers 200 even when some records survived, carrying both lists: deleting
 * thirty rows where two are still referenced is not a failed request, and an
 * error response would say nothing about which twenty-eight are gone. The
 * caller reports what came back.
 */
export async function deleteRecords(
  model: string,
  ids: readonly string[],
  permanent = false,
): Promise<BulkDeleteResult> {
  const { data } = await request<BulkDeleteResult>(
    `/${encodeURIComponent(model)}${permanent ? '?permanent=true' : ''}`,
    { method: 'DELETE', body: JSON.stringify({ ids }) },
  )
  return data
}

/**
 * A page of the records on the far side of a to-many relation.
 *
 * The query applies to the records being returned, not to the one they hang
 * off, so this behaves exactly like `listRecords` on the target model.
 */
export async function listRelated(
  model: string,
  id: string,
  relation: string,
  query: ListQuery,
): Promise<ListResult> {
  const envelope = await request<readonly AdminRecord[]>(
    `/${encodeURIComponent(model)}/${encodeURIComponent(id)}/${encodeURIComponent(relation)}` +
      buildQueryString(query),
  )

  return {
    records: envelope.data,
    meta: envelope.meta ?? { total: envelope.data.length, page: 1, perPage: envelope.data.length },
  }
}

/** Link an existing record to this one. */
export async function attachRelated(
  model: string,
  id: string,
  relation: string,
  targetId: string,
): Promise<void> {
  await request<null>(
    `/${encodeURIComponent(model)}/${encodeURIComponent(id)}/${encodeURIComponent(relation)}`,
    { method: 'POST', body: JSON.stringify({ id: targetId }) },
  )
}

/** Unlink a record from this one, leaving both in place. */
export async function detachRelated(
  model: string,
  id: string,
  relation: string,
  targetId: string,
): Promise<void> {
  await request<null>(
    `/${encodeURIComponent(model)}/${encodeURIComponent(id)}/${encodeURIComponent(relation)}/` +
      encodeURIComponent(targetId),
    { method: 'DELETE' },
  )
}

/**
 * Run an application-defined action.
 *
 * `id` is present for a record-scoped action and absent for a list-scoped one;
 * the server refuses the mismatch rather than guessing.
 */
export async function runAction(
  model: string,
  action: string,
  id?: string,
): Promise<{ message?: string }> {
  const path =
    `/actions/${encodeURIComponent(model)}/${encodeURIComponent(action)}` +
    (id === undefined ? '' : `/${encodeURIComponent(id)}`)

  const { data } = await request<{ message?: string }>(path, { method: 'POST' })
  return data ?? {}
}

/** `GET /admin/team` - the accounts that can sign in. */
export async function fetchTeam(): Promise<TeamView> {
  const { data } = await request<TeamView>('/team')
  return data
}

export async function createTeamMember(body: {
  email: string
  name?: string
  role?: string
  password: string
}): Promise<TeamMember> {
  const { data } = await request<TeamMember>('/team', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data
}

export async function updateTeamMember(
  id: string,
  body: { name?: string; role?: string; disabled?: boolean; password?: string },
): Promise<TeamMember> {
  const { data } = await request<TeamMember>(`/team/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return data
}

export async function deleteTeamMember(id: string): Promise<void> {
  await request(`/team/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * `POST /admin/files` — the body is the file itself.
 *
 * Not multipart: the server takes the raw bytes and reads the name from a
 * header, which means no parser on either side and a stream from the first
 * byte. `XMLHttpRequest` rather than `fetch`, only because it is still the only
 * way a browser reports upload progress.
 */
export function uploadFile(
  file: File,
  options: {
    readonly accept?: readonly string[]
    readonly maxSize?: number
    readonly onProgress?: (percent: number) => void
  } = {},
): Promise<{ key: string; url: string; type: string; size: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${API_BASE}/files`)

    request.setRequestHeader('content-type', 'application/octet-stream')
    request.setRequestHeader('x-admin-filename', encodeURIComponent(file.name))
    if (options.accept?.length) request.setRequestHeader('x-admin-accept', options.accept.join(','))
    if (options.maxSize !== undefined) {
      request.setRequestHeader('x-admin-max-size', String(options.maxSize))
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
    })

    request.addEventListener('load', () => {
      let body: { success?: boolean; data?: unknown; error?: { message?: string } } = {}
      try {
        body = JSON.parse(request.responseText) as typeof body
      } catch {
        // A response that is not JSON is a proxy or a crash, not the admin.
      }

      if (request.status >= 200 && request.status < 300 && body.data) {
        resolve(body.data as { key: string; url: string; type: string; size: number })
      } else {
        reject(new Error(body.error?.message ?? 'That file could not be uploaded.'))
      }
    })

    request.addEventListener('error', () => reject(new Error('The upload could not be sent.')))
    request.send(file)
  })
}

/** Where a stored file lives, when the admin is the one serving it. */
export function fileUrl(key: string): string {
  return `${API_BASE}/files/${key.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The developer tools.
 *
 * Present only when the application mounted them and this role may use them,
 * which the metadata says once - every function here 404s or 403s otherwise,
 * and the screen is not reachable in the first place.
 */
export interface DevModel {
  readonly name: string
  /** How many relations the generator will wire up on its own. */
  readonly relations: number
  readonly records: number
}

export interface DevBatch {
  readonly at: string
  readonly runs: readonly DevRun[]
}

export interface DevStatus {
  readonly models: readonly DevModel[]
  readonly totalRecords: number
  /** The adapter this admin runs on, as it names itself. */
  readonly adapter: string
  /** What the deployment check saw - not `NODE_ENV` alone. */
  readonly environment: { readonly deployed: boolean; readonly because: readonly string[] }
  /** Whether `@faker-js/faker` is installed. It works either way. */
  readonly faker: boolean
  readonly images: boolean
  /** Newest first. Only the newest can be undone. */
  readonly history: readonly DevBatch[]
}

export interface DevRun {
  readonly model: string
  readonly created: number
  readonly ids: readonly string[]
  readonly failed: readonly { readonly reason: string; readonly count: number }[]
  /** True about the run, but not a failure - a one-to-one that ran out of parents. */
  readonly note?: string
}

export async function devStatus(): Promise<DevStatus> {
  const { data } = await request<DevStatus>('/dev')
  return data
}

export async function devPreview(body: {
  model: string
  count?: number
  seed?: string
}): Promise<{ model: string; records: readonly AdminRecord[] }> {
  const { data } = await request<{ model: string; records: readonly AdminRecord[] }>(
    '/dev/preview',
    { method: 'POST', body: JSON.stringify(body) },
  )
  return data
}

export async function devGenerate(body: {
  model: string
  count?: number
  seed?: string
  images?: boolean
}): Promise<DevRun> {
  const { data } = await request<DevRun>('/dev/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data
}

export async function devFill(body: {
  models?: readonly { name: string; count: number }[]
  perModel?: number
  seed?: string
  images?: boolean
}): Promise<readonly DevRun[]> {
  const { data } = await request<readonly DevRun[]>('/dev/fill', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data
}

export async function devUndo(): Promise<readonly DevRun[]> {
  const { data } = await request<readonly DevRun[]>('/dev/undo', { method: 'POST' })
  return data
}

/** What emptying everything did, and what it left alone. */
export interface DevResetResult {
  readonly emptied: readonly { model: string; deleted: number; remaining: number }[]
  /**
   * Models it did not touch, each with a reason.
   *
   * Shown rather than swallowed: the button says "every model" and means every
   * model *this admin manages*, and somebody who believes the shorter version
   * will eventually be wrong about their own database.
   */
  readonly skipped: readonly { model: string; reason: string }[]
}

/** Empty every model, children first. Needs the acknowledgement. */
export async function devReset(): Promise<DevResetResult> {
  const { data } = await request<DevResetResult>('/dev/reset', {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  })
  return data
}

export async function devTruncate(model: string): Promise<{ deleted: number; remaining: number }> {
  const { data } = await request<{ deleted: number; remaining: number }>('/dev/truncate', {
    method: 'POST',
    body: JSON.stringify({ model }),
  })
  return data
}
