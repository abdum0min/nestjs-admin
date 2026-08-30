/**
 * Loading, empty and error states.
 *
 * Error rendering branches on the server's `code`, never on message text. Each
 * code gets a heading that says what the reader can do about it; the server's
 * message is shown underneath only because its exception filter already
 * guarantees it is safe - the four 4xx codes carry a real message and
 * everything internal is replaced with a generic string before it leaves the
 * server. No stack trace, path or ORM detail can reach here.
 */
import { AdminApiError } from '../api/client.js'
import type { AdminErrorCode } from '../api/types.js'

export function Loading({ label = 'Loading…' }: { readonly label?: string }) {
  return (
    <div className="state" role="status">
      {label}
    </div>
  )
}

export function Empty({ children }: { readonly children: React.ReactNode }) {
  return <div className="state state--empty">{children}</div>
}

const HEADINGS: Readonly<Record<AdminErrorCode, string>> = {
  UNAUTHORIZED: 'Not signed in',
  FORBIDDEN: 'No access',
  MODEL_NOT_FOUND: 'Resource not found',
  RECORD_NOT_FOUND: 'Record not found',
  FIELD_NOT_FOUND: 'Unknown field',
  INVALID_QUERY: 'Invalid request',
  VALIDATION_ERROR: 'Not accepted',
  INTERNAL_ERROR: 'Something went wrong',
}

const HINTS: Readonly<Record<AdminErrorCode, string>> = {
  UNAUTHORIZED: 'Sign in to the application, then reload this page.',
  FORBIDDEN: 'Your account does not have access to this resource.',
  MODEL_NOT_FOUND: 'It may have been renamed, or you may not have access to it.',
  RECORD_NOT_FOUND: 'It may have been deleted.',
  FIELD_NOT_FOUND: 'Reset the filters and try again.',
  INVALID_QUERY: 'Adjust the filters or the page and try again.',
  // The server's message says what is wrong and is shown beside this, so the
  // hint only has to point at where the correction goes.
  VALIDATION_ERROR: 'Change the value and try again.',
  INTERNAL_ERROR: 'Try again. If it keeps happening, contact an administrator.',
}

export function ErrorState({
  error,
  onRetry,
}: {
  readonly error: unknown
  readonly onRetry?: () => void
}) {
  const code: AdminErrorCode = error instanceof AdminApiError ? error.code : 'INTERNAL_ERROR'
  const detail =
    error instanceof AdminApiError
      ? error.message
      : 'The admin interface hit an unexpected problem.'

  return (
    <div className="state state--error" role="alert">
      <h2>{HEADINGS[code]}</h2>
      <p>{HINTS[code]}</p>
      <p className="state__detail">{detail}</p>
      {onRetry && code !== 'UNAUTHORIZED' && code !== 'FORBIDDEN' ? (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}
