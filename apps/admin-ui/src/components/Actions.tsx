/**
 * The buttons an application added.
 *
 * Drawn entirely from metadata, so adding one is a server-side change and this
 * file never learns what any of them do. The server has already filtered out
 * the ones this principal may not run, so anything rendered here is something
 * the policy will allow.
 *
 * A `confirm` is asked before the request, not after: the point of it is the
 * actions that cannot be undone. It is a courtesy to the person pressing the
 * button, never a check - the server decides again when the request arrives.
 */
import { useState } from 'react'

import { runAction } from '../api/client.js'
import type { ActionDescriptor, ModelDescriptor } from '../api/types.js'
import { ErrorState } from './States.jsx'

export function Actions({
  model,
  scope,
  id,
  onDone,
}: {
  readonly model: ModelDescriptor
  readonly scope: 'record' | 'list'
  /** The record an action applies to. Required for `scope="record"`. */
  readonly id?: string
  /** Called after a successful run, so the screen can re-read what changed. */
  readonly onDone?: () => void
}) {
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)

  const available = (model.actions ?? []).filter((action) => action.scope === scope)
  if (available.length === 0) return null

  const run = async (action: ActionDescriptor): Promise<void> => {
    if (action.confirm !== undefined && !window.confirm(action.confirm)) return

    setBusy(action.name)
    setError(undefined)
    setMessage(undefined)

    try {
      const result = await runAction(model.name, action.name, id)
      // An action that says nothing still has to say it worked: silence after a
      // button press is indistinguishable from a button that did not respond.
      setMessage(result.message ?? `${action.label} done.`)
      onDone?.()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="actions">
      {available.map((action) => (
        <button
          key={action.name}
          type="button"
          className={action.danger === true ? 'danger' : undefined}
          disabled={busy !== undefined}
          onClick={() => void run(action)}
        >
          {busy === action.name ? `${action.label}…` : action.label}
        </button>
      ))}

      {message === undefined ? null : (
        <p className="actions__result" role="status">
          {message}
        </p>
      )}
      {error === undefined ? null : <ErrorState error={error} />}
    </div>
  )
}
