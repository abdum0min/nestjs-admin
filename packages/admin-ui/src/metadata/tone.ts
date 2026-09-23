/**
 * What a value means, worked out in the browser.
 *
 * ## Why this is not simply sent by the server
 *
 * The server knows the rule - it is the same list of words, in
 * `@nest-admin/core` - and it could send a tone with every value. It does not,
 * because the metadata document is fetched once per page load and would then
 * carry a map of every value of every enum in the schema, most of which no
 * screen ever draws. What it sends instead is only what the application
 * *corrected*, which is usually nothing.
 *
 * So the rule lives in two places, and that is a real cost. It is paid
 * deliberately: the alternative is a bigger document on every load for a
 * derivation that is twenty lines and cannot fail.
 *
 * ## The words are the same list, and must stay that way
 *
 * `packages/core/src/config/tone.ts` is the other copy, and its comments carry
 * the reasoning for the words themselves - whole-word matching, why `UNPAID`
 * must not match `PAID`, why the first word wins.
 */
import type { FieldDescriptor, ValueTone } from '../api/types.js'

const WORDS: Readonly<Record<Exclude<ValueTone, 'neutral'>, readonly string[]>> = {
  success: [
    'active',
    'approved',
    'available',
    'complete',
    'completed',
    'confirmed',
    'delivered',
    'done',
    'enabled',
    'fulfilled',
    'live',
    'on',
    'ok',
    'paid',
    'passed',
    'published',
    'ready',
    'resolved',
    'shipped',
    'success',
    'successful',
    'valid',
    'verified',
    'yes',
  ],
  warning: [
    'awaiting',
    'backordered',
    'draft',
    'hold',
    'idle',
    'incomplete',
    'partial',
    'partially',
    'paused',
    'pending',
    'processing',
    'progress',
    'queued',
    'refunded',
    'review',
    'scheduled',
    'unconfirmed',
    'unpaid',
    'unverified',
    'waiting',
    'warning',
  ],
  danger: [
    'archived',
    'banned',
    'blocked',
    'cancelled',
    'canceled',
    'critical',
    'declined',
    'deleted',
    'denied',
    'disabled',
    'error',
    'expired',
    'failed',
    'failure',
    'inactive',
    'invalid',
    'lost',
    'off',
    'overdue',
    'rejected',
    'revoked',
    'suspended',
    'unavailable',
  ],
  info: ['info', 'new', 'open', 'started', 'submitted', 'trial'],
}

const BY_WORD: ReadonlyMap<string, ValueTone> = new Map(
  Object.entries(WORDS).flatMap(([tone, words]) =>
    words.map((word) => [word, tone as ValueTone] as const),
  ),
)

function wordsOf(value: string): readonly string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')
}

/** The tone a value's own name carries, or `neutral` when nothing recognises it. */
export function toneOf(value: string): ValueTone {
  for (const word of wordsOf(value)) {
    const tone = BY_WORD.get(word)
    if (tone !== undefined) return tone
  }

  return 'neutral'
}

/**
 * The tone to draw a field's value with, or `undefined` for plain text.
 *
 * Three answers in order of authority: the application said `false` and wants
 * no badge at all; the application named this value's tone; or the value's own
 * name is read. Only enums are badged - a free string has no fixed set of
 * values, so a badge on one would be a coloured box around arbitrary text.
 */
export function fieldTone(field: FieldDescriptor, value: unknown): ValueTone | undefined {
  if (field.badge === false) return undefined
  if (field.kind !== 'enum') return undefined
  if (typeof value !== 'string' || value === '') return undefined

  return field.badge?.[value] ?? toneOf(value)
}

/**
 * How a column lines up when the application did not say.
 *
 * Numbers right, everything else left. A column of right-aligned digits puts
 * place values above each other, which is the only way 1,200 and 12,000 are
 * distinguishable at a glance.
 *
 * Deliberately not applied to every numeric *column*: an id is stored as a
 * number on plenty of schemas and is read as a label, not as a quantity. That
 * is what `align` exists to correct.
 */
export function columnAlign(field: FieldDescriptor): 'left' | 'center' | 'right' {
  if (field.align !== undefined) return field.align
  return field.kind === 'number' && !field.isId ? 'right' : 'left'
}
