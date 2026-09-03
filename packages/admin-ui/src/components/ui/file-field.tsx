/**
 * A file on a string column.
 *
 * The column holds a storage key; this turns that into something a person can
 * see and change. Three ways in, because the one people reach for differs:
 * click the box, drop onto it, or paste. Pasting is the one nobody expects and
 * everybody wants - a screenshot is two keystrokes away from being an avatar.
 *
 * ## What it does not do
 *
 * It never decides whether a file is allowed. `accept` and `maxSize` come from
 * the metadata document and are used to filter the picker and to fail fast on
 * something obviously wrong; the server checks both again, from the bytes. A
 * check in a browser has never been a rule, and this one exists only so the
 * answer arrives before a hundred megabytes do.
 */
import { File as FileIcon, Loader2, Upload, X } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'

import { fileUrl, uploadFile } from '../../api/client.js'
import { cn } from '../../lib/utils.js'
import { Button } from './button.jsx'

/** Whatever a stored key looks like, this is what the person sees. */
function nameOf(key: string): string {
  const last = key.split('/').at(-1) ?? key
  const dash = last.indexOf('-')
  return dash === -1 ? last : last.slice(dash + 1)
}

/**
 * Where a stored key can be read from.
 *
 * A key that already looks like a location is one: a store with its own URLs -
 * S3, R2 - writes an absolute one onto the column, and rewriting that would
 * break every record saved before the store changed.
 */
function urlOf(key: string): string {
  return /^https?:\/\//.test(key) || key.startsWith('/') ? key : fileUrl(key)
}

/**
 * A byte count in the unit a person would say it in.
 *
 * A sub-megabyte limit rendered as "larger than 0 MB", which is what the test
 * for it found. Rounding is only readable in the right unit.
 */
function readableSize(bytes: number): string {
  if (bytes >= 1024 ** 2) {
    const mb = bytes / 1024 ** 2
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

export function FileField({
  value,
  onChange,
  image = false,
  accept,
  maxSize,
  disabled,
  'aria-describedby': describedBy,
  id,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  /** Draw a preview and default to accepting pictures. */
  readonly image?: boolean
  readonly accept?: readonly string[]
  readonly maxSize?: number
  readonly disabled?: boolean
  readonly 'aria-describedby'?: string
  readonly id?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [over, setOver] = useState(false)
  const hintId = useId()

  const patterns = accept ?? (image ? ['image/*'] : [])

  const send = useCallback(
    async (file: File): Promise<void> => {
      setFailure(undefined)

      // Fails before the upload rather than after it. The server checks again.
      if (maxSize !== undefined && file.size > maxSize) {
        setFailure(`That file is larger than ${readableSize(maxSize)}.`)
        return
      }

      setBusy(true)
      setProgress(0)
      try {
        const uploaded = await uploadFile(file, {
          accept: patterns,
          ...(maxSize === undefined ? {} : { maxSize }),
          onProgress: setProgress,
        })
        onChange(uploaded.key)
      } catch (error) {
        setFailure(error instanceof Error ? error.message : 'That file could not be uploaded.')
      } finally {
        setBusy(false)
      }
    },
    [maxSize, onChange, patterns],
  )

  const isImage = image || IMAGE.test(value)

  if (value !== '' && !busy) {
    return (
      <div className="flex items-center gap-3" id={id}>
        {isImage ? (
          <a href={urlOf(value)} target="_blank" rel="noreferrer" className="shrink-0">
            <img
              src={urlOf(value)}
              alt=""
              className="bg-muted size-16 rounded-md border object-cover"
            />
          </a>
        ) : (
          <span className="bg-muted flex size-16 shrink-0 items-center justify-center rounded-md border">
            <FileIcon className="text-muted-foreground size-6" aria-hidden="true" />
          </span>
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <a
            href={urlOf(value)}
            target="_blank"
            rel="noreferrer"
            className="hover:text-link truncate text-sm transition-colors"
          >
            {nameOf(value)}
          </a>

          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange('')}
            >
              <X />
              Remove
            </Button>
          </div>
        </div>

        <input
          ref={input}
          type="file"
          className="sr-only"
          accept={patterns.join(',')}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void send(file)
            event.target.value = ''
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        id={id}
        disabled={disabled || busy}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(' ') || undefined}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          const file = event.dataTransfer.files[0]
          if (file) void send(file)
        }}
        // A screenshot is two keystrokes from being an avatar, and every other
        // route to that involves saving it to a folder first.
        onPaste={(event) => {
          const file = event.clipboardData.files[0]
          if (file) void send(file)
        }}
        className={cn(
          'border-input flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6',
          'text-muted-foreground text-sm transition-colors',
          'hover:border-primary/50 hover:bg-accent/40 cursor-pointer',
          'focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:outline-none',
          over && 'border-primary bg-accent/60',
          (disabled || busy) && 'pointer-events-none opacity-60',
        )}
      >
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>Uploading… {progress}%</span>
          </>
        ) : (
          <>
            <Upload className="size-5" aria-hidden="true" />
            <span>
              <span className="text-foreground font-medium">Choose a file</span>, drop one here, or
              paste
            </span>
          </>
        )}
      </button>

      <span id={hintId} className="text-muted-foreground text-xs">
        {patterns.length > 0 ? patterns.join(', ') : 'Any file'}
        {maxSize === undefined ? '' : ` · up to ${readableSize(maxSize)}`}
      </span>

      {failure === undefined ? null : <span className="text-destructive text-xs">{failure}</span>}

      <input
        ref={input}
        type="file"
        className="sr-only"
        accept={patterns.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void send(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}
