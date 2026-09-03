/**
 * What to put in a column, decided from what the column is.
 *
 * Two layers, in this order:
 *
 *   1. **the name** - `email` gets an address, `slug` gets a slug, `price` gets
 *      money with two decimals. This is where believable data comes from: a
 *      table of `string-41` values proves the generator ran and nothing else.
 *   2. **the kind** - whatever the name did not answer falls back to the type,
 *      which is always available because the metadata always has it.
 *
 * Nothing here branches on a *model* name. The admin renders schemas it has
 * never seen, and a generator that knew about `User` would work on the example
 * application and on nobody else's.
 *
 * ## The rules the metadata already states
 *
 * Uniqueness, enum membership, optionality and required-ness are not
 * suggestions to the generator - they are what the database will enforce a
 * moment later. A value that ignores them turns into a constraint violation
 * with a stack trace, which is a worse first impression than an empty table.
 */
import type { FieldMetadata } from '@nest-admin/core'

import type { Random } from './random.js'
import {
  ADJECTIVES,
  CITIES,
  COLOURS,
  COMPANIES,
  COUNTRIES,
  CURRENCIES,
  FIRST_NAMES,
  LAST_NAMES,
  NOUNS,
  SENTENCES,
  STREETS,
} from './words.js'

/**
 * The part of `@faker-js/faker` this uses, structurally.
 *
 * Declared rather than imported: the package is an optional peer, so its types
 * are not there to import from in an installation that does not have it. Every
 * call site is guarded, because faker's namespaces have moved between majors
 * and a generator that throws on somebody's version is worse than one that
 * quietly produces its own words.
 */
export interface FakerLike {
  seed?: (value: number) => unknown
  person?: { firstName?: () => string; lastName?: () => string }
  internet?: { email?: () => string; url?: () => string; username?: () => string }
  company?: { name?: () => string }
  location?: {
    city?: () => string
    country?: () => string
    streetAddress?: () => string
    zipCode?: () => string
  }
  lorem?: { sentences?: (count: number) => string }
  phone?: { number?: () => string }
}

/** Anything faker might answer, reduced to a string this can use, or nothing. */
function tryFaker(produce: (() => string | undefined) | undefined): string | undefined {
  if (produce === undefined) return undefined
  try {
    const value = produce()
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    // A namespace that moved, or a version that wants arguments. The built-in
    // words are the fallback, and the generator carries on.
    return undefined
  }
}

/**
 * What a column appears to hold, judged by its name.
 *
 * Ordered longest-intent-first: `firstName` has to be tested before `name`, and
 * `companyName` before both, or every one of them becomes a person's name.
 */
const CATEGORIES: readonly (readonly [RegExp, string])[] = [
  [/^(id|uuid|guid)$/, 'id'],
  [/email|mail(address)?$/, 'email'],
  [/first(name)?$|given(name)?/, 'firstName'],
  [/last(name)?$|surname|family(name)?/, 'lastName'],
  [/user(name)?$|handle|login|nickname/, 'userName'],
  [/company|organisation|organization|brand|vendor|supplier|employer/, 'company'],
  [/slug|permalink/, 'slug'],
  [/phone|mobile|telephone|^tel$/, 'phone'],
  [/website|homepage|^url$|link$|href/, 'url'],
  [/colou?r/, 'colour'],
  [/postcode|postalcode|^zip/, 'postcode'],
  [/city|town/, 'city'],
  [/country/, 'country'],
  [/address|street/, 'address'],
  [/currency/, 'currency'],
  [/sku|barcode|serial|reference|^ref$|^code$/, 'code'],
  [/price|amount|total|cost|salary|fee|balance|revenue|subtotal/, 'money'],
  [/percent|discount|^rate$|^tax/, 'percent'],
  [/rating|stars/, 'rating'],
  [/latitude|^lat$/, 'latitude'],
  [/longitude|^lng$|^lon$/, 'longitude'],
  [/^age$/, 'age'],
  [
    /quantity|^qty|count$|stock|units|views|likes|score|position|^order$|weight|height|width/,
    'count',
  ],
  [/bio|description|body|content|excerpt|summary|note|message|comment|about|remark|text$/, 'prose'],
  [/title|headline|subject|label|^name$/, 'title'],
] as const

function categoryOf(name: string): string | undefined {
  const normalised = name.toLowerCase().replace(/[^a-z]/g, '')
  return CATEGORIES.find(([pattern]) => pattern.test(normalised))?.[1]
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export interface ValueContext {
  readonly field: FieldMetadata
  /** Which row of this run, so a unique column can stay unique cheaply. */
  readonly index: number
  readonly random: Random
  readonly faker?: FakerLike | undefined
  /**
   * What has been generated for this record so far.
   *
   * So a slug can be made of the title that is already there rather than of
   * unrelated words - the pair reads as one record instead of two.
   */
  readonly record: Readonly<Record<string, unknown>>
  /** Rows already created in this run, so a self-relation has somewhere to point. */
  readonly created?: readonly unknown[]
}

/**
 * A value for one column.
 *
 * Relations are not handled here - they need the database, and this function is
 * pure so it can be tested by reading it. See `generate.ts`.
 */
export function valueFor(context: ValueContext): unknown {
  const { field, random } = context

  // The schema's own answer beats every guess below it.
  if (field.enumValues && field.enumValues.length > 0) return random.pick(field.enumValues)

  const category = categoryOf(field.name)
  const value = byCategory(category, context) ?? byKind(context)

  return unique(value, context)
}

function byCategory(category: string | undefined, context: ValueContext): unknown {
  const { random, faker, record, field } = context
  if (category === undefined) return undefined

  // A name-based guess is about what the column *means*, so it only applies
  // where the type agrees. A column called `count` that holds a string wants
  // the string branch, not a number.
  const wantsText = field.kind === 'string'
  const wantsNumber = field.kind === 'number'

  switch (category) {
    case 'firstName':
      return wantsText
        ? (tryFaker(faker?.person?.firstName) ?? random.pick(FIRST_NAMES))
        : undefined
    case 'lastName':
      return wantsText ? (tryFaker(faker?.person?.lastName) ?? random.pick(LAST_NAMES)) : undefined
    case 'title':
      return wantsText ? personOrThing(context) : undefined
    case 'userName':
      return wantsText
        ? (tryFaker(faker?.internet?.username) ??
            `${random.pick(FIRST_NAMES).toLowerCase()}${random.int(10, 99)}`)
        : undefined
    case 'email': {
      if (!wantsText) return undefined
      const fromFaker = tryFaker(faker?.internet?.email)
      if (fromFaker !== undefined) return fromFaker.toLowerCase()
      const person = `${random.pick(FIRST_NAMES)}.${random.pick(LAST_NAMES)}`
      return `${slugify(person).replace(/-/g, '.')}@example.com`
    }
    case 'company':
      return wantsText ? (tryFaker(faker?.company?.name) ?? random.pick(COMPANIES)) : undefined
    case 'slug': {
      if (!wantsText) return undefined
      // Built from a title already on the record where there is one, so the
      // two fields read as the same thing rather than as two.
      const source = Object.entries(record).find(
        ([key, entry]) => typeof entry === 'string' && categoryOf(key) === 'title',
      )?.[1]
      return slugify(typeof source === 'string' ? source : words(random, 3))
    }
    case 'phone':
      return wantsText
        ? (tryFaker(faker?.phone?.number) ??
            `+1 555 ${random.int(100, 999)} ${random.int(1000, 9999)}`)
        : undefined
    case 'url':
      return wantsText
        ? (tryFaker(faker?.internet?.url) ?? `https://${slugify(words(random, 2))}.example.com`)
        : undefined
    case 'colour':
      return wantsText ? random.pick(COLOURS) : undefined
    case 'city':
      return wantsText ? (tryFaker(faker?.location?.city) ?? random.pick(CITIES)) : undefined
    case 'country':
      return wantsText ? (tryFaker(faker?.location?.country) ?? random.pick(COUNTRIES)) : undefined
    case 'address':
      return wantsText
        ? (tryFaker(faker?.location?.streetAddress) ??
            `${random.int(1, 220)} ${random.pick(STREETS)}`)
        : undefined
    case 'postcode':
      return wantsText
        ? (tryFaker(faker?.location?.zipCode) ?? `${random.int(10000, 99999)}`)
        : undefined
    case 'currency':
      return wantsText ? random.pick(CURRENCIES) : undefined
    case 'code':
      return wantsText
        ? `${words(random, 1).slice(0, 3).toUpperCase()}-${random.int(1000, 9999)}`
        : undefined
    case 'prose':
      return wantsText ? prose(context) : undefined
    case 'money':
      return wantsNumber ? Math.round(random.int(500, 250_000)) / 100 : undefined
    case 'percent':
      return wantsNumber ? random.int(0, 40) : undefined
    case 'rating':
      return wantsNumber ? random.int(1, 5) : undefined
    case 'age':
      return wantsNumber ? random.int(18, 72) : undefined
    case 'count':
      return wantsNumber ? random.int(0, 400) : undefined
    case 'latitude':
      return wantsNumber ? Math.round(random.int(-8500, 8500)) / 100 : undefined
    case 'longitude':
      return wantsNumber ? Math.round(random.int(-17900, 17900)) / 100 : undefined
    default:
      return undefined
  }
}

/**
 * A `name` or `title` column, which is two different things.
 *
 * On something with an email address it is a person; on everything else it is a
 * thing. Decided from the record's other columns rather than from the model
 * name, because the model name is exactly what this generator must not read.
 */
function personOrThing(context: ValueContext): string {
  const { random, faker, record } = context
  const person = Object.keys(record).some((key) => {
    const category = categoryOf(key)
    return category === 'email' || category === 'firstName' || category === 'userName'
  })

  if (person) {
    const first = tryFaker(faker?.person?.firstName) ?? random.pick(FIRST_NAMES)
    const last = tryFaker(faker?.person?.lastName) ?? random.pick(LAST_NAMES)
    return `${first} ${last}`
  }

  const title = `${random.pick(ADJECTIVES)} ${random.pick(NOUNS)}`
  return title.charAt(0).toUpperCase() + title.slice(1)
}

function prose(context: ValueContext): string {
  const { random, faker } = context
  const fromFaker = tryFaker(() => faker?.lorem?.sentences?.(random.int(1, 3)))
  if (fromFaker !== undefined) return fromFaker

  const count = random.int(1, 3)
  const picked = new Set<string>()
  while (picked.size < count) picked.add(random.pick(SENTENCES))
  return `${[...picked].join('. ')}.`
}

function words(random: Random, count: number): string {
  return Array.from({ length: count }, () =>
    random.chance(0.5) ? random.pick(ADJECTIVES) : random.pick(NOUNS),
  ).join(' ')
}

/** Ninety days back, spread out. */
const RECENT_DAYS = 90

function byKind(context: ValueContext): unknown {
  const { field, random } = context

  switch (field.kind) {
    case 'string': {
      const text = words(random, random.int(2, 4))
      return text.charAt(0).toUpperCase() + text.slice(1)
    }
    case 'number':
      return random.int(1, 1000)
    case 'boolean':
      // Not a coin flip. Most flags in a real table are on - `active`,
      // `enabled`, `approved` - and a screen where half the rows are disabled
      // looks like a broken import rather than a working application.
      return random.chance(0.75)
    case 'datetime': {
      /*
       * Spread backwards through time rather than clustered at now.
       *
       * The dashboard draws a chart over a creation date. Rows that all share
       * one timestamp produce a single bar, which makes the chart - and the
       * generated data with it - look broken on the first screen anybody sees.
       */
      const daysAgo = random.int(0, RECENT_DAYS)
      const date = new Date(Date.now() - daysAgo * 86_400_000)
      date.setUTCHours(random.int(6, 21), random.int(0, 59), random.int(0, 59), 0)
      return date
    }
    case 'json':
      return { source: 'nest-admin dev tools', note: words(random, 3) }
    default:
      // `unknown` covers Decimal, BigInt, Bytes and anything an adapter could
      // not map. Guessing at those produces a write the database rejects.
      return undefined
  }
}

/**
 * Keep a unique column unique.
 *
 * The row index alone would collide with rows that are already there, and a
 * random token alone would collide with itself often enough to matter over a
 * few hundred rows. Both, so neither has to be perfect - and a create that
 * still loses the race is reported as one failed row rather than a failed run.
 */
function unique(value: unknown, context: ValueContext): unknown {
  const { field, index, random } = context
  if (!field.isUnique || typeof value !== 'string') return value

  const suffix = `${index + 1}${random.token(3)}`
  const at = value.indexOf('@')

  return at === -1 ? `${value}-${suffix}` : `${value.slice(0, at)}+${suffix}${value.slice(at)}`
}
