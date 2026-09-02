/**
 * Loading, empty and error states.
 *
 * Error rendering branches on the server's `code`, never on message text. Each
 * code gets a heading that says what the reader can do about it; the server's
 * message is shown underneath only because its exception filter already
 * guarantees it is safe - the 4xx codes carry a real message and everything
 * internal is replaced with a generic string before it leaves the server. No
 * stack trace, path or ORM detail can reach here.
 */
import {
  CircleAlert,
  History,
  Inbox,
  Lock,
  RefreshCw,
  ShieldOff,
  TriangleAlert,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { AdminApiError } from '../api/client.js'
import type { AdminErrorCode } from '../api/types.js'
import { Button } from './ui/button.jsx'
import { Skeleton } from './ui/skeleton.jsx'

/**
 * Waiting, in the shape of what is coming.
 *
 * A spinner says "something is happening" and nothing else. A skeleton says how
 * much is arriving and where it will be, so the page does not jump when it
 * lands - and jumping is what makes an interface feel unreliable even when it
 * is fast.
 *
 * `role="status"` with the label in `sr-only` gives the same information to
 * someone who cannot see any of it.
 */
export function Loading({ label = 'Loading…' }: { readonly label?: string }) {
  return (
    <div data-slot="loading" className="flex flex-col gap-3" role="status">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

/**
 * A table that has not arrived.
 *
 * Drawn as a table rather than as three grey bars: the column count is known
 * before the rows are, so the header can be the right width and the rows the
 * right height. When the data lands, nothing moves.
 */
export function TableSkeleton({
  columns,
  rows = 8,
  label = 'Loading…',
}: {
  readonly columns: number
  readonly rows?: number
  readonly label?: string
}) {
  return (
    <div
      data-slot="table-skeleton"
      role="status"
      className="bg-card w-full overflow-hidden rounded-xl border shadow-xs"
    >
      <div className="flex items-center gap-4 border-b px-3 py-2.5">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 border-b px-3 py-3 last:border-0">
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton
              key={index}
              className="h-4 flex-1"
              // Varied widths, so it reads as content rather than as a grid.
              // Deterministic, so it does not shimmer differently on re-render.
              style={{ maxWidth: `${60 + ((row * 7 + index * 23) % 40)}%` }}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

/** A form that has not arrived. Label, field, label, field. */
export function FormSkeleton({ fields = 5 }: { readonly fields?: number }) {
  return (
    <div data-slot="form-skeleton" role="status" className="flex flex-col gap-5">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export function Empty({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      data-slot="empty"
      className="bg-card text-muted-foreground flex flex-col items-center gap-3 rounded-xl border px-6 py-14 text-center text-sm"
    >
      <Inbox className="size-8 opacity-50" aria-hidden="true" />
      {children}
    </div>
  )
}

const HEADINGS: Readonly<Record<AdminErrorCode, string>> = {
  UNAUTHORIZED: 'Not signed in',
  FORBIDDEN: 'No access',
  MODEL_NOT_FOUND: 'Resource not found',
  RECORD_NOT_FOUND: 'Record not found',
  FIELD_NOT_FOUND: 'Unknown field',
  INVALID_QUERY: 'Invalid request',
  VALIDATION_ERROR: 'Not accepted',
  CONSTRAINT_VIOLATION: 'Not accepted',
  CONFLICT: 'Someone else changed this',
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
  CONSTRAINT_VIOLATION: 'The database refused this. Change the value and try again.',
  // Nothing was written, so reloading loses only what is on this screen - and
  // saying so is the difference between a warning and a threat.
  CONFLICT: 'Nothing was saved. Reload to see the current values, then make your change again.',
  INTERNAL_ERROR: 'Try again. If it keeps happening, contact an administrator.',
}

/** The icon carries the same distinction the heading does, for a faster read. */
const ICONS: Readonly<Record<AdminErrorCode, ComponentType<{ className?: string }>>> = {
  UNAUTHORIZED: Lock,
  FORBIDDEN: ShieldOff,
  MODEL_NOT_FOUND: CircleAlert,
  RECORD_NOT_FOUND: CircleAlert,
  FIELD_NOT_FOUND: CircleAlert,
  INVALID_QUERY: CircleAlert,
  VALIDATION_ERROR: TriangleAlert,
  CONSTRAINT_VIOLATION: TriangleAlert,
  CONFLICT: History,
  INTERNAL_ERROR: TriangleAlert,
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
  const Icon = ICONS[code]

  return (
    <div
      data-slot="error-state"
      className="border-destructive/40 bg-destructive/8 flex flex-col gap-2 rounded-xl border px-4 py-3"
      role="alert"
    >
      <div className="text-destructive flex items-center gap-2 font-medium">
        <Icon className="size-4 shrink-0" />
        {HEADINGS[code]}
      </div>
      <p className="text-sm">{HINTS[code]}</p>
      <p className="text-muted-foreground text-sm">{detail}</p>
      {onRetry && code !== 'UNAUTHORIZED' && code !== 'FORBIDDEN' ? (
        <div>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  )
}
