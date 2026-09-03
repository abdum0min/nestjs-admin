/**
 * A file column, rendered as the thing it holds.
 *
 * The column stores a key - `2026/09/abc123-ada.png` - and until now every
 * screen except the form printed it. A table full of keys is the tell of a
 * generic admin: true, unreadable, and useless for the one job an avatar
 * column has, which is being recognised at a glance.
 *
 * ## Three states, not two
 *
 * A picture that is missing and a picture that is broken are different facts
 * about a record, and collapsing them hides the one worth acting on. A blank
 * avatar is normal; an avatar whose file will not load means the column points
 * at something that is gone. So an empty column draws a quiet placeholder, and
 * a value that fails to load draws a struck-through icon that says why on
 * hover.
 *
 * Never the browser's own broken-image glyph, which is the third state nobody
 * chooses: it is unstyled, it is different in every browser, and it reports a
 * missing file as a rendering fault.
 *
 * ## Why the fallback is a chain
 *
 * `placeholder` is the application's own default - a house avatar, a product
 * silhouette. It is tried when the column is empty *and* when its value will
 * not load, and the built-in icon catches the case where the placeholder is
 * itself wrong. That last link matters: a default avatar with a typo in its
 * path would otherwise turn every row into a broken glyph, which is worse than
 * the state it was added to improve.
 */
import { Image as ImageIcon, ImageOff, Paperclip } from 'lucide-react'
import { useState } from 'react'

import type { FieldDescriptor } from '../../api/types.js'
import { cn } from '../../lib/utils.js'
import { fileHref, fileNameOf, looksLikeImage } from '../../metadata/files.js'

/** Table-row size. Large enough to recognise a face, small enough to scan. */
const ROW = 'size-9'
/** Detail-page size, where there is room to actually look at it. */
const DETAIL = 'size-24'

const BOX = 'shrink-0 overflow-hidden rounded-md border bg-muted'

export function Thumbnail({
  value,
  placeholder,
  alt = '',
  className,
}: {
  readonly value: string
  /** The application's own default, from the field's configuration. */
  readonly placeholder?: string
  readonly alt?: string
  readonly className?: string
}) {
  const stored = value.trim()

  // In order of preference. The value first, the application's default second,
  // and the icon below when both are gone.
  const sources = [stored === '' ? undefined : fileHref(stored), placeholder].filter(
    (source): source is string => source !== undefined && source !== '',
  )

  // Which of them is being shown. Keyed by the sources themselves so a row
  // recycled onto a different record starts again rather than inheriting the
  // previous one's failure - the standard way to reset state from props,
  // without an effect that would render the wrong picture first.
  const signature = sources.join('|')
  const [attempt, setAttempt] = useState({ signature, index: 0 })
  if (attempt.signature !== signature) setAttempt({ signature, index: 0 })

  const index = attempt.signature === signature ? attempt.index : 0
  const source = sources[index]

  if (source === undefined) {
    // Every source is exhausted. A column that held something and still got
    // here had a value that would not load - a different fact from a column
    // that was empty, and the only one of the two worth acting on.
    const broken = stored !== ''
    return (
      <span
        title={broken ? 'This image could not be loaded.' : undefined}
        className={cn(
          BOX,
          ROW,
          'text-muted-foreground flex items-center justify-center',
          className,
        )}
      >
        {broken ? (
          <ImageOff className="h-1/2 w-1/2" aria-hidden="true" />
        ) : (
          <ImageIcon className="h-1/2 w-1/2 opacity-60" aria-hidden="true" />
        )}
      </span>
    )
  }

  return (
    <img
      src={source}
      alt={alt}
      // A hundred rows of avatars are a hundred requests, and most of them are
      // below the fold.
      loading="lazy"
      decoding="async"
      onError={() => setAttempt({ signature, index: index + 1 })}
      className={cn(BOX, ROW, 'object-cover', className)}
    />
  )
}

/** A file that is not a picture: what it is called, and a way to open it. */
export function FileLink({ value }: { readonly value: string }) {
  return (
    <a
      href={fileHref(value)}
      target="_blank"
      rel="noreferrer"
      className="text-link inline-flex max-w-64 items-center gap-1.5 underline-offset-4 hover:underline"
    >
      <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{fileNameOf(value)}</span>
    </a>
  )
}

/**
 * A file column wherever it is read rather than edited.
 *
 * One component for the table, the related table and the detail page, so all
 * three agree about what a broken picture looks like.
 */
export function MediaCell({
  field,
  value,
  size = 'row',
}: {
  readonly field: FieldDescriptor
  readonly value: unknown
  readonly size?: 'row' | 'detail'
}) {
  const stored = value === null || value === undefined ? '' : String(value)
  const detail = size === 'detail'

  // `image` is the application saying so. A `file` field is judged by its
  // extension, because a field that holds both a PDF and a screenshot should
  // show the screenshot.
  const picture = field.widget === 'image' || (stored !== '' && looksLikeImage(stored))

  if (picture) {
    const thumbnail = (
      <Thumbnail
        value={stored}
        {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
        // Decorative in a table: the row is identified by its other columns and
        // the header already names this one, so a filename per row is noise a
        // screen reader has to sit through. On the detail page it is the
        // subject, so it is named.
        alt={detail ? fileNameOf(stored) : ''}
        className={detail ? DETAIL : undefined}
      />
    )

    // Linked only where there is one of them. A link per row would be an extra
    // tab stop on every record for a picture already shown.
    return detail && stored !== '' ? (
      <a href={fileHref(stored)} target="_blank" rel="noreferrer" className="inline-block">
        {thumbnail}
      </a>
    ) : (
      thumbnail
    )
  }

  if (stored === '') return <span className="text-muted-foreground">—</span>

  return <FileLink value={stored} />
}
