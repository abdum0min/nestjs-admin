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
import { CircleAlert, Inbox, Lock, RefreshCw, ShieldOff, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'

import { AdminApiError } from '../api/client.js'
import type { AdminErrorCode } from '../api/types.js'
import { Button } from './ui/button.jsx'
import { Skeleton } from './ui/skeleton.jsx'

export function Loading({ label = 'Loading…' }: { readonly label?: string }) {
  return (
    <div data-slot="loading" className="flex flex-col gap-3" role="status">
      {/* The shape of what is coming, rather than a spinner: it says how much
          is arriving and keeps the layout from jumping when it does. */}
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
      <span className="sr-only">{label}</span>
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
