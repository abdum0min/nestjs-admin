/**
 * The response envelope.
 *
 * Every admin endpoint returns the same two shapes, so a generic frontend can
 * branch on one field rather than on status codes plus per-endpoint knowledge.
 *
 * Success:  { success: true,  data: <payload>, meta?: <pagination> }
 * Failure:  { success: false, error: { code, message, details? } }
 *
 * @experimental The HTTP contract is expected to change before 1.0.
 */

/** Pagination facts a list response carries alongside its rows. */
export interface PageMeta {
  readonly total: number
  readonly page: number
  readonly perPage: number
}

export interface SuccessResponse<T> {
  readonly success: true
  readonly data: T
  readonly meta?: PageMeta
}

/**
 * Stable, machine-readable error codes.
 *
 * Clients branch on these, never on the human-readable message. Adding a code
 * is a compatible change; renaming one is not.
 */
export type AdminErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'MODEL_NOT_FOUND'
  | 'RECORD_NOT_FOUND'
  | 'FIELD_NOT_FOUND'
  | 'INVALID_QUERY'
  | 'VALIDATION_ERROR'
  | 'CONSTRAINT_VIOLATION'
  | 'INTERNAL_ERROR'

export interface ErrorResponse {
  readonly success: false
  readonly error: {
    readonly code: AdminErrorCode
    readonly message: string
    /** Structured context, e.g. `{ model, field }`. Never internal detail. */
    readonly details?: Readonly<Record<string, unknown>>
  }
}

export type AdminResponse<T> = SuccessResponse<T> | ErrorResponse

export function success<T>(data: T): SuccessResponse<T> {
  return { success: true, data }
}

/**
 * A list response. Rows live in `data` and pagination in `meta`, rather than
 * nesting the whole `Page` under `data` - `data.data` would be an awkward thing
 * to hand a frontend.
 */
export function successPage<T>(data: readonly T[], meta: PageMeta): SuccessResponse<readonly T[]> {
  return { success: true, data, meta }
}

export function failure(
  code: AdminErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ErrorResponse {
  return { success: false, error: { code, message, ...(details ? { details } : {}) } }
}
