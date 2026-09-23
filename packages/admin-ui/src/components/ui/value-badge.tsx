/**
 * A value that is a state, drawn as one.
 *
 * ## Why this is tinted rather than filled
 *
 * The obvious rendering is a solid green pill with white text, and it is wrong
 * twice over. Down a column of forty rows a wall of saturated pills is louder
 * than the data it is describing - and it is unreadable in a theme nobody here
 * chose, because `--success` is defined as a *fill* with `--success-foreground`
 * as its ink, and nothing promises it works as text on the page background.
 *
 * So the tint carries the meaning and the ordinary foreground carries the
 * text. A coloured dot restores the full hue in the one place where contrast
 * does not matter, because it is decoration beside a word that already says
 * the same thing. The result reads at a glance, survives any palette, and does
 * not shout.
 *
 * ## Neutral draws no colour at all
 *
 * Most enums are categories rather than states - `SMALL`, `MEDIUM`, `LARGE` -
 * and a colour on those would be decoration that means nothing. Neutral is a
 * real answer and the common one, so it gets the plain outline.
 */
import type { ValueTone } from '../../api/types.js'
import { cn } from '../../lib/utils.js'

const TINT: Readonly<Record<ValueTone, string>> = {
  success: 'bg-success/12 border-success/30',
  warning: 'bg-warning/15 border-warning/35',
  danger: 'bg-destructive/12 border-destructive/30',
  info: 'bg-primary/10 border-primary/25',
  neutral: 'bg-muted border-border',
}

const DOT: Readonly<Record<ValueTone, string>> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-primary',
  neutral: 'bg-muted-foreground/50',
}

export function ValueBadge({
  tone,
  children,
  className,
}: {
  readonly tone: ValueTone
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return (
    <span
      className={cn(
        'text-foreground inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TINT[tone],
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" />
      {children}
    </span>
  )
}
