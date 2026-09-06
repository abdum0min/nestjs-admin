/**
 * The rich-text editor, loaded only where there is one.
 *
 * TipTap and ProseMirror are around two hundred kilobytes. Most schemas have no
 * rich-text field at all, and every one of those would otherwise carry the
 * editor in the bundle it downloads on the first page.
 *
 * So this module is the only thing the rest of the interface imports, and it
 * reaches the editor through `React.lazy`. Vite turns that dynamic import into
 * its own chunk, which arrives when a form or a record page actually contains
 * one of these fields - and never otherwise.
 *
 * The fallback is a box the size of the control rather than a spinner: the
 * chunk is usually already cached, and a spinner that flashes for eighty
 * milliseconds reads as a fault.
 */
import { lazy, Suspense } from 'react'

import { cn } from '../../lib/utils.js'
import { textFromHtml } from '../../metadata/html.js'

const Editor = lazy(async () => ({
  default: (await import('./rich-text.jsx')).RichTextEditor,
}))

const Reader = lazy(async () => ({
  default: (await import('./rich-text.jsx')).RichTextReader,
}))

export function RichTextField(props: {
  readonly value: string
  readonly onChange: (html: string) => void
  readonly disabled?: boolean
  readonly id?: string
  readonly 'aria-describedby'?: string
  /** The label's id: a div with `role="textbox"` cannot be named by `for`. */
  readonly 'aria-labelledby'?: string
}) {
  return (
    <Suspense
      fallback={
        <div className={cn('border-input bg-background h-40 animate-pulse rounded-md border')} />
      }
    >
      <Editor {...props} />
    </Suspense>
  )
}

/**
 * Stored HTML, shown rather than run.
 *
 * Never `innerHTML`. The value is parsed into the editor's document model,
 * which drops everything the model does not describe - so a `<script>` that
 * reached the column cannot reach the page.
 */
export function RichTextValue({ value }: { readonly value: string }) {
  if (value === '') return <span className="text-muted-foreground">—</span>

  return (
    <Suspense
      fallback={<span className="text-muted-foreground text-sm">{textFromHtml(value)}</span>}
    >
      <Reader value={value} />
    </Suspense>
  )
}
