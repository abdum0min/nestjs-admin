/**
 * Buttons the application adds.
 *
 * CRUD covers what a schema implies. It does not cover "publish", "resend the
 * invitation", "recalculate the total" - operations that are obvious to the
 * domain and invisible to the database. Without somewhere to put them, the
 * usual answer is a second internal tool beside the admin.
 *
 * An action is defined once and drawn by the interface from metadata, so adding
 * one is a server-side change and needs no rebuild of the UI.
 *
 * ## Authorization
 *
 * Actions are a distinct operation, `'action'`, rather than folded into
 * `update`. An action can do anything, including things no CRUD route offers,
 * so a policy should be able to decide about it separately - and a policy
 * written before actions existed denies the unfamiliar value, which is the
 * right direction to fail in.
 *
 * Actions the principal may not run are absent from the metadata, so the
 * interface does not draw a button that would be refused.
 */
import type { ExecutionContext } from '@nestjs/common'
import type { RecordId } from '@nest-admin/core'

/** What an action reports back. */
export interface AdminActionResult {
  /**
   * A sentence for the person who pressed the button.
   *
   * Shown as-is, so it is published - the same responsibility as a
   * `ValidationError` message.
   */
  readonly message?: string
}

export interface AdminAction {
  /** Stable identifier, used in the URL. Letters, digits, `-` and `_`. */
  readonly name: string

  /** What the button says. Defaults to `name`. */
  readonly label?: string

  /**
   * Whether the action applies to one record or to the model as a whole.
   *
   * A `'record'` action is offered on the detail page and receives the record's
   * id; a `'list'` action is offered above the list and receives none.
   */
  readonly scope: 'record' | 'list'

  /**
   * Ask before running, with this as the question.
   *
   * Worth setting for anything that cannot be undone. The interface refuses to
   * proceed without an answer; it is not a substitute for the server checking
   * that the action is permitted.
   */
  readonly confirm?: string

  /** Draw the button as destructive. Presentation only. */
  readonly danger?: boolean

  /**
   * The work.
   *
   * Throw to refuse: a `ValidationError` reaches the caller with its message,
   * anything else becomes a 500 with the message withheld.
   */
  readonly run: (args: {
    readonly context: ExecutionContext
    readonly model: string
    /** Present for a `'record'` action, absent for a `'list'` one. */
    readonly id?: RecordId
  }) => AdminActionResult | void | Promise<AdminActionResult | void>
}

/** Actions per model. Models without an entry have none. */
export type AdminActionsByModel = Readonly<Record<string, readonly AdminAction[]>>

/** Names must be usable in a URL segment and stable enough to link to. */
export const ACTION_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
