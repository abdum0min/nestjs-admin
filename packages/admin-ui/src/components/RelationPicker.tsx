/**
 * Choosing the record a to-one relation points at.
 *
 * The field being edited is the foreign key - `authorId` - and what it holds is
 * a cuid. Rendered as the text input its `string` kind implies, it asks a
 * person to paste an id they would have to go and look up. This offers the
 * related records by name instead, and still submits the key.
 *
 * ## Why it searches rather than listing everything
 *
 * A `<select>` of every row works until the target table is large, and then it
 * fails quietly by being enormous. Searching asks the server for a page at a
 * time, so the cost does not depend on how many records exist. The trade is
 * that the current value has to be resolved separately - see `label` below.
 */
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { fetchRecord, listRecords } from '../api/client.js'
import type { AdminRecord, ModelDescriptor } from '../api/types.js'
import { Button } from './ui/button.jsx'
import { Input } from './ui/input.jsx'

/** How many suggestions to show. Enough to choose from, few enough to scan. */
const SUGGESTIONS = 8

/** Wait this long after typing before asking the server. */
const DEBOUNCE_MS = 200

export function RelationPicker({
  target,
  value,
  required,
  inputProps,
  onChange,
}: {
  readonly target: ModelDescriptor
  readonly value: string
  readonly required: boolean
  /**
   * Accessibility attributes for the search box.
   *
   * The form owns whether this field was refused and what to say about it; the
   * picker only knows which input the message should be attached to.
   */
  readonly inputProps?: Readonly<Record<string, unknown>>
  readonly onChange: (value: string) => void
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<readonly AdminRecord[]>([])
  const [label, setLabel] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  const [key] = target.primaryKey
  const idOf = (record: AdminRecord) => (key === undefined ? undefined : record[key])
  const labelOf = (record: AdminRecord) => {
    const shown = record[target.displayField]
    return shown === null || shown === undefined || shown === ''
      ? String(idOf(record))
      : String(shown)
  }

  /**
   * Resolve the current value to a name.
   *
   * Editing an existing record starts with a key and no label, and the key is
   * not in the suggestion list until someone searches for it. One direct read
   * is cheaper and more reliable than hoping it appears.
   */
  useEffect(() => {
    let cancelled = false
    if (!value) {
      setLabel(undefined)
      return
    }

    fetchRecord(target.name, value)
      .then((record) => {
        if (!cancelled) setLabel(labelOf(record))
      })
      .catch(() => {
        // The record may have been deleted, or be hidden from this principal.
        // Showing the raw key is honest; failing the whole form is not.
        if (!cancelled) setLabel(undefined)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.name, value])

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!open) return

    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      listRecords(target.name, { search: term || undefined, perPage: SUGGESTIONS })
        .then((page) => {
          setOptions(page.records)
          setFailed(false)
        })
        .catch(() => {
          // Most often a principal who may not list the target model.
          setOptions([])
          setFailed(true)
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer.current)
  }, [open, term, target.name])

  const chosen = value ? (label ?? value) : undefined

  return (
    <div className="relative flex flex-col gap-1.5">
      {chosen === undefined ? null : (
        <p className="bg-muted flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm">
          <span className="truncate">{chosen}</span>
          {required ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-1.5"
              aria-label="Clear selection"
              onClick={() => onChange('')}
            >
              <X />
            </Button>
          )}
        </p>
      )}

      <Input
        {...inputProps}
        type="search"
        value={term}
        placeholder={chosen === undefined ? `Search ${target.name}…` : `Change ${target.name}…`}
        onChange={(event) => {
          setTerm(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />

      {open ? (
        <ul className="bg-popover absolute top-full right-0 left-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-md border p-1 shadow-md">
          {failed ? (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">
              No access to {target.name}.
            </li>
          ) : options.length === 0 ? (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">No matches.</li>
          ) : (
            options.map((record) => {
              const id = idOf(record)
              if (id === null || id === undefined) return null
              return (
                <li key={String(id)}>
                  <button
                    type="button"
                    className="hover:bg-accent focus-visible:bg-accent w-full truncate rounded-sm px-2 py-1.5 text-left text-sm"
                    onClick={() => {
                      onChange(String(id))
                      setLabel(labelOf(record))
                      setTerm('')
                      setOpen(false)
                    }}
                  >
                    {labelOf(record)}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}
