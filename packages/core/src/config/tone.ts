/**
 * What a value means, as something the eye can land on.
 *
 * ## The problem this solves
 *
 * Everything in a generated admin renders at one visual weight. A status is
 * text, a count is text, a flag is the word "Yes". Nothing is emphasised, so
 * nothing is scannable - a person reads a table instead of looking at it.
 *
 * A schema knows more than it was being asked. `status` is an enum whose values
 * are `PAID`, `PENDING`, `FAILED`, and those three are not equivalent: one is
 * fine, one is waiting, one is wrong. That difference is already in the data,
 * and drawing it costs nothing.
 *
 * ## Guessed, not configured
 *
 * The rule an admin with no configuration must still look right applies here
 * more than anywhere: nobody is going to enumerate the tone of every value of
 * every enum in a thirty-model schema, and an admin that needs them to would be
 * an admin where this feature does not exist in practice.
 *
 * So the tone is inferred from the value's own name, against a list of words
 * that mean the same thing across nearly every schema anybody writes. It will
 * sometimes be wrong - `CLOSED` is good news on a support ticket and bad news
 * on a shop - which is why {@link FieldOverride.badge} exists to say so.
 *
 * ## Why matching is on whole words
 *
 * `UNPAID` must not match `PAID`, and substring matching says it does. The
 * value is split on the separators enum names actually use - `_`, `-`, space,
 * and the camelCase boundary - and each part is looked up whole. That makes
 * `PARTIALLY_REFUNDED` a refund and leaves `UNPAID` to be recognised as its own
 * word rather than as a paid thing with a prefix.
 */

/**
 * The five tones a value can carry.
 *
 * A closed set, mapped to design tokens rather than to colours: `success` is
 * whatever this admin's success colour is, in whichever theme the viewer has.
 * Naming hex here would put a colour in the schema that no palette could move.
 */
export type ValueTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/**
 * Words that carry a tone, by the tone they carry.
 *
 * Kept deliberately short. Every entry is a word that means the same thing in
 * nearly every schema; anything more specific belongs in the application's own
 * `badge` map, because guessing it would be guessing about a business.
 */
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

/** Every word, pointed at its tone, built once. */
const BY_WORD: ReadonlyMap<string, ValueTone> = new Map(
  Object.entries(WORDS).flatMap(([tone, words]) =>
    words.map((word) => [word, tone as ValueTone] as const),
  ),
)

/**
 * Split a value into the words it is made of.
 *
 * Enum names are written four ways and all four turn up in real schemas:
 * `IN_PROGRESS`, `in-progress`, `inProgress`, `In Progress`. The camelCase
 * boundary needs a space inserted before splitting, or `inProgress` is one
 * unrecognisable word.
 */
function wordsOf(value: string): readonly string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')
}

/**
 * The tone a value carries, or `neutral` when nothing recognises it.
 *
 * **First match wins, reading left to right.** `PARTIALLY_REFUNDED` is a
 * warning because `partially` comes first, which is the right answer: the
 * leading word is the qualifier, and a qualified state is what the qualifier
 * says it is.
 *
 * Neutral is a real answer and the common one. Most enums are categories
 * rather than states - `SMALL`, `MEDIUM`, `LARGE` - and colouring those would
 * be decoration that means nothing.
 */
export function toneOf(value: string): ValueTone {
  for (const word of wordsOf(value)) {
    const tone = BY_WORD.get(word)
    if (tone !== undefined) return tone
  }

  return 'neutral'
}

/**
 * How a column's values line up.
 *
 * `right` for numbers, because digits compare by place value and a column of
 * them is unreadable ragged: the eye cannot tell 1,200 from 12,000 unless the
 * commas are above each other.
 */
export type ColumnAlign = 'left' | 'center' | 'right'
