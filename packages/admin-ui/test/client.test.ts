/**
 * The API client, against a mocked `fetch`.
 *
 * These assert the contract the client depends on - envelope unwrapping, error
 * translation, verbs and URLs. The backend's own behaviour is already covered
 * by its 229 tests and is not restated here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AdminApiError,
  createRecord,
  deleteRecord,
  fetchMetadata,
  fetchRecord,
  listRecords,
  updateRecord,
} from '../src/api/client.js'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A JSON response, as the server would send it. */
function respond(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

const ok = (data: unknown, meta?: unknown) =>
  respond(200, { success: true, data, ...(meta ? { meta } : {}) })

const fail = (status: number, code: string, message = 'nope') =>
  respond(status, { success: false, error: { code, message } })

/** The URL the client requested, without the base prefix. */
function requestedPath(): string {
  return String(fetchMock.mock.calls[0]?.[0]).replace('/admin', '')
}

function requestedInit(): RequestInit {
  return fetchMock.mock.calls[0]?.[1] as RequestInit
}

describe('metadata', () => {
  it('fetches and unwraps the envelope', async () => {
    fetchMock.mockResolvedValue(ok({ models: [{ name: 'User', primaryKey: ['id'], fields: [] }] }))

    const metadata = await fetchMetadata()

    expect(requestedPath()).toBe('/meta')
    expect(metadata.models).toHaveLength(1)
  })
})

describe('list', () => {
  it('builds a colon-syntax query and returns records with pagination', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 'u1' }], { total: 1, page: 2, perPage: 25 }))

    const result = await listRecords('User', {
      page: 2,
      perPage: 25,
      search: 'ada',
      sort: [{ field: 'email', direction: 'asc' }],
      filters: [{ field: 'age', operator: 'gte', value: '18' }],
    })

    const path = decodeURIComponent(requestedPath())
    expect(path).toContain('/User?')
    expect(path).toContain('page=2')
    expect(path).toContain('sort=email:asc')
    expect(path).toContain('filter=age:gte:18')
    expect(path).not.toContain('[')

    expect(result.records).toEqual([{ id: 'u1' }])
    expect(result.meta).toEqual({ total: 1, page: 2, perPage: 25 })
  })

  it('encodes a model name into the path', async () => {
    fetchMock.mockResolvedValue(ok([], { total: 0, page: 1, perPage: 25 }))
    await listRecords('Order Item', {})
    expect(requestedPath()).toContain('/Order%20Item')
  })
})

describe('reads and writes', () => {
  it('GETs one record', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'u1' }))
    await fetchRecord('User', 'u1')

    expect(requestedPath()).toBe('/User/u1')
    expect(requestedInit().method).toBeUndefined()
  })

  it('POSTs a create', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'new' }))
    await createRecord('User', { name: 'Ada' })

    expect(requestedPath()).toBe('/User')
    expect(requestedInit().method).toBe('POST')
    expect(requestedInit().body).toBe('{"name":"Ada"}')
  })

  it('PATCHes an update', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'u1' }))
    await updateRecord('User', 'u1', { name: 'Ada L' })

    expect(requestedPath()).toBe('/User/u1')
    expect(requestedInit().method).toBe('PATCH')
  })

  it('DELETEs, tolerating the null payload', async () => {
    fetchMock.mockResolvedValue(ok(null))
    await expect(deleteRecord('User', 'u1')).resolves.toBeUndefined()

    expect(requestedInit().method).toBe('DELETE')
  })

  it('sends the browser session with every request', async () => {
    fetchMock.mockResolvedValue(ok({ models: [] }))
    await fetchMetadata()

    // Phase 4: authentication is the host's. The UI carries what the browser
    // already has and never builds a credential of its own.
    expect(requestedInit().credentials).toBe('include')
    expect(JSON.stringify(requestedInit().headers)).not.toMatch(/authorization/i)
  })
})

describe('error translation', () => {
  const cases = [
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'MODEL_NOT_FOUND'],
    [404, 'RECORD_NOT_FOUND'],
    [400, 'FIELD_NOT_FOUND'],
    [400, 'INVALID_QUERY'],
    [500, 'INTERNAL_ERROR'],
  ] as const

  for (const [status, code] of cases) {
    it(`surfaces ${code} as a typed error`, async () => {
      fetchMock.mockResolvedValue(fail(status, code))

      await expect(fetchMetadata()).rejects.toBeInstanceOf(AdminApiError)
      await expect(fetchMetadata()).rejects.toMatchObject({ code, status })
    })
  }

  it('treats a non-envelope response as an internal error', async () => {
    // A proxy error page or an HTML login redirect - not something to render.
    fetchMock.mockResolvedValue(respond(502, '<html>Bad Gateway</html>'))

    await expect(fetchMetadata()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  it('maps a non-envelope 401 to UNAUTHORIZED', async () => {
    // An auth proxy that redirects to HTML instead of answering JSON.
    fetchMock.mockResolvedValue(respond(401, '<html>Login</html>'))

    await expect(fetchMetadata()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('reports a network failure without inventing a code', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(fetchMetadata()).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 0 })
  })
})
