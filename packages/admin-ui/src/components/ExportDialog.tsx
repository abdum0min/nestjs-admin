/**
 * Taking the current view away as a file.
 *
 * Opened from the list, and that is the whole design: the export is of what is
 * on the screen. Whatever was searched, filtered, sorted or set to the deleted
 * view is what comes out, because a button that ignored the filter somebody
 * just applied would be answering a different question.
 */
import { Download } from 'lucide-react'
import { useState } from 'react'

import { exportRecords, saveFile } from '../api/client.js'
import type { ListQuery, ModelDescriptor, TransferFormat } from '../api/types.js'
import { modelLabel } from '../metadata/fields.js'
import { ErrorState } from './States.jsx'
import { Button } from './ui/button.jsx'
import { Checkbox } from './ui/checkbox.jsx'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './ui/dialog.jsx'
import { SimpleSelect } from './ui/select.jsx'

/**
 * Columns the file can carry.
 *
 * Every field the model has, not the six the table shows: a table is narrowed
 * so it can be read, and an export exists to take the data somewhere else. A
 * to-one relation contributes its key and its label, which is what the server
 * writes and what it will accept back.
 */
function columnsOf(model: ModelDescriptor): readonly string[] {
  return model.fields.filter((field) => !isToMany(field)).map((field) => field.name)
}

function isToMany(field: ModelDescriptor['fields'][number]): boolean {
  return field.kind === 'relation' && field.relation?.cardinality === 'many'
}

export function ExportDialog({
  model,
  query,
  total,
  onClose,
}: {
  readonly model: ModelDescriptor
  /** The list query behind the screen. Paging is dropped; the file is all of it. */
  readonly query: ListQuery
  readonly total: number | undefined
  readonly onClose: () => void
}) {
  const available = columnsOf(model)

  const [format, setFormat] = useState<TransferFormat>('csv')
  const [delimiter, setDelimiter] = useState(',')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(available))
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<unknown>(undefined)

  const narrowed = query.search !== undefined || (query.filters?.length ?? 0) > 0

  const toggle = (name: string): void => {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const run = async (): Promise<void> => {
    setRunning(true)
    setFailure(undefined)

    try {
      const file = await exportRecords(model.name, query, {
        format,
        // In the model's own order, not the order they were ticked.
        columns: available.filter((name) => chosen.has(name)),
        ...(format === 'csv' ? { delimiter } : {}),
      })

      saveFile(file.blob, file.filename)
      onClose()
    } catch (cause) {
      setFailure(cause)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Export {modelLabel(model)}</DialogTitle>

        <div className="flex flex-col gap-4">
          {failure === undefined ? null : <ErrorState error={failure} />}

          <p className="text-muted-foreground text-sm">
            {total === undefined
              ? 'Everything this view is showing.'
              : `${total.toLocaleString()} ${total === 1 ? 'record' : 'records'}${
                  narrowed ? ', matching the search and filters on the screen' : ''
                }.`}
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Format</span>
              <SimpleSelect
                value={format}
                onValueChange={(value) => setFormat(value as TransferFormat)}
                placeholder="Format"
                className="w-44"
                options={[
                  { value: 'csv', label: 'CSV (Excel, Sheets)' },
                  { value: 'json', label: 'JSON' },
                ]}
              />
            </label>

            {format === 'csv' ? (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Separator</span>
                <SimpleSelect
                  value={delimiter}
                  onValueChange={setDelimiter}
                  placeholder="Separator"
                  className="w-52"
                  options={[
                    { value: ',', label: 'Comma' },
                    { value: ';', label: 'Semicolon' },
                    { value: '\t', label: 'Tab' },
                  ]}
                />
              </label>
            ) : null}
          </div>

          {format === 'csv' ? (
            <p className="text-muted-foreground text-xs">
              Excel splits on the list separator from your system settings, which is a semicolon in
              much of Europe. If the file opens as one column, export it again with the other one.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Columns{' '}
                <span className="text-muted-foreground tabular font-normal">
                  {chosen.size} of {available.length}
                </span>
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setChosen(chosen.size === available.length ? new Set() : new Set(available))
                }
              >
                {chosen.size === available.length ? 'Clear' : 'All'}
              </Button>
            </div>

            <div className="border-input max-h-56 overflow-y-auto rounded-md border p-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {available.map((name) => (
                  <label
                    key={name}
                    className="hover:bg-accent flex items-center gap-2 rounded px-1.5 py-1 text-sm"
                  >
                    <Checkbox checked={chosen.has(name)} onChange={() => toggle(name)} />
                    <span className="truncate">{name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={running || chosen.size === 0}>
            <Download />
            {running ? 'Preparing…' : 'Download'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
