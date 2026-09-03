/**
 * What a file actually is.
 *
 * Never what the request said it was, and never what the extension claims. Both
 * are supplied by whoever is uploading, and the whole reason this module exists
 * is that one of them may be lying.
 *
 * ## The attack this closes
 *
 * Upload a file called `avatar.png`, declare `Content-Type: image/png`, and put
 * HTML in it. If the admin later serves it back with the type it was told, the
 * browser renders it - on the admin's own origin, with the admin's session
 * cookie in scope. That is a complete account takeover from an avatar field.
 *
 * So the type comes from the first few bytes, and only a file whose bytes say
 * "image" is ever served inline.
 *
 * ## Why a short table rather than a library
 *
 * `file-type` is excellent and is 200 kB of detectors for formats an admin will
 * never be asked to preview. What is needed here is a decision - *may this be
 * rendered in a browser* - and that is answered by the handful of formats a
 * browser renders. Everything else is a download, and a download does not need
 * to be identified precisely.
 */

/** Formats a browser renders, and the bytes that identify them. */
const SIGNATURES: readonly {
  readonly type: string
  readonly bytes: readonly number[]
  /** Where the signature starts. Non-zero for formats with a leading header. */
  readonly offset?: number
}[] = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  // RIFF....WEBP - the size sits between the two halves, so the second is
  // matched at its own offset rather than as one run.
  { type: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
]

/** How much of a file has to be read before its type is known. */
export const SNIFF_BYTES = 16

function matches(head: Uint8Array, signature: (typeof SIGNATURES)[number]): boolean {
  const offset = signature.offset ?? 0
  if (head.length < offset + signature.bytes.length) return false

  return signature.bytes.every((byte, index) => head[offset + index] === byte)
}

/**
 * The content type these bytes really are, or `undefined`.
 *
 * `undefined` is not a failure - it is most files. It means "not something a
 * browser should render", which is all the caller needs to decide to serve it
 * as a download.
 */
export function sniffType(head: Uint8Array): string | undefined {
  return SIGNATURES.find((signature) => matches(head, signature))?.type
}

/**
 * Types that may be sent to a browser with no `Content-Disposition`.
 *
 * SVG is deliberately absent, and it is the exception worth explaining: it is
 * an image, browsers render it, and it can contain script. An SVG served inline
 * from the admin's origin is the same takeover as an HTML file. It uploads and
 * downloads fine; it just never renders in place.
 */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function mayRenderInline(type: string | undefined): boolean {
  return type !== undefined && INLINE.has(type)
}

/**
 * Whether a sniffed type satisfies a field's `accept` list.
 *
 * A list entry ending in `/*` matches a family. An empty list accepts
 * anything - the caller decides what "nothing declared" means for its widget,
 * because an image field and a document field want different defaults.
 */
export function accepts(patterns: readonly string[], type: string | undefined): boolean {
  if (patterns.length === 0) return true
  if (type === undefined) return false

  return patterns.some((pattern) =>
    pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type,
  )
}

/** `'2mb'`, `'512kb'`, or a number of bytes. */
export function toBytes(size: number | string): number {
  if (typeof size === 'number') return size

  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(size.trim())
  if (!match?.[1]) throw new Error(`Invalid size ${JSON.stringify(size)}. Try 2mb, 512kb, or 2048.`)

  const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }
  return Math.floor(Number(match[1]) * (units[(match[2] ?? 'b').toLowerCase()] ?? 1))
}
