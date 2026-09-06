/**
 * Putting a file in, in three steps that cannot be skipped.
 *
 *   choose a file  ->  map its columns  ->  see what would happen  ->  do it
 *
 * The third step is the point. There is no transaction across an import, so a
 * failure halfway through leaves the rows before it written; the dry run is
 * what turns that from a hazard into a known quantity, because the errors are
 * on the screen before the first row is written rather than discovered during
 * the four hundredth.
 *
 * The file is uploaded once per step. It is capped at a thousand rows, so
 * sending it again costs less than the alternative - a handle, an expiry, and
 * server memory that grows with every import somebody abandoned.
 */
import { AlertTriangle, Check, ChevronLeft, Upload } from 'lucide-react'
import { useState } from 'react'

import { importColumns, importPlan, runImport } from '../api/client.js'
import type { ImportOutcome, ImportPlan, ImportShape, ModelDescriptor } from '../api/types.js'
import { modelLabel } from '../metadata/fields.js'
import { ErrorState } from './States.jsx'
import { Alert, AlertDescription, AlertTitle } from './ui/alert.jsx'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './ui/dialog.jsx'
import { SimpleSelect } from './ui/select.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.jsx'

/** Nothing is written until the last one. */
type Step = 'file' | 'map' | 'plan' | 'done'

const NOT_MAPPED = '—'

export function ImportDialog({
  model,
  onClose,
  onImported,
}: {
  readonly model: ModelDescriptor
  readonly onClose: () => void
  readonly onImported: () => void
}) {
  const [step, setStep] = useState<Step>('file')
  const [filename, setFilename] = useState('')
  const [body, setBody] = useState('')
  const [shape, setShape] = useState<ImportShape | undefined>(undefined)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [matchBy, setMatchBy] = useState('')
  const [plan, setPlan] = useState<ImportPlan | undefined>(undefined)
  const [outcome, setOutcome] = useState<ImportOutcome | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(undefined)

  const read = async (file: File): Promise<void> => {
    setBusy(true)
    setFailure(undefined)

    try {
      const text = await file.text()
      const found = await importColumns(model.name, text)

      setBody(text)
      setFilename(file.name)
      setShape(found)
      setMapping({ ...found.mapping })
      // Pre-chosen when the file carries a key column, because a file with ids
      // in it is almost always an export somebody edited and sent back.
      setMatchBy(
        found.matchable.find((field) => found.mapping[field] !== undefined || has(found, field)) ??
          '',
      )
      setStep('map')
    } catch (cause) {
      setFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  const dryRun = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)

    try {
      setPlan(await importPlan(model.name, body, mapping, matchBy === '' ? undefined : matchBy))
      setStep('plan')
    } catch (cause) {
      setFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)

    try {
      setOutcome(await runImport(model.name, body, mapping, matchBy === '' ? undefined : matchBy))
      setStep('done')
      onImported()
    } catch (cause) {
      setFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogTitle>Import {modelLabel(model)}</DialogTitle>

        <div className="flex flex-col gap-4">
          {failure === undefined ? null : <ErrorState error={failure} />}

          {step === 'file' ? <ChooseFile busy={busy} onFile={(file) => void read(file)} /> : null}

          {step === 'map' && shape !== undefined ? (
            <Mapping
              shape={shape}
              filename={filename}
              mapping={mapping}
              matchBy={matchBy}
              onMap={(field, column) =>
                setMapping((current) => {
                  const next = { ...current }
                  if (column === NOT_MAPPED) delete next[field]
                  else next[field] = column
                  return next
                })
              }
              onMatchBy={setMatchBy}
            />
          ) : null}

          {step === 'plan' && plan !== undefined ? <Preview plan={plan} /> : null}

          {step === 'done' && outcome !== undefined ? <Result outcome={outcome} /> : null}
        </div>

        <DialogFooter>
          {step === 'map' ? (
            <Button variant="ghost" onClick={() => setStep('file')} disabled={busy}>
              <ChevronLeft />
              Another file
            </Button>
          ) : null}

          {step === 'plan' ? (
            <Button variant="ghost" onClick={() => setStep('map')} disabled={busy}>
              <ChevronLeft />
              Change the mapping
            </Button>
          ) : null}

          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>

          {step === 'map' ? (
            <Button
              onClick={() => void dryRun()}
              disabled={busy || Object.keys(mapping).length === 0}
            >
              {busy ? 'Checking…' : 'Check the file'}
            </Button>
          ) : null}

          {step === 'plan' && plan !== undefined ? (
            <Button onClick={() => void apply()} disabled={busy || plan.create + plan.update === 0}>
              {busy
                ? 'Importing…'
                : `Import ${(plan.create + plan.update).toLocaleString()} ${
                    plan.create + plan.update === 1 ? 'record' : 'records'
                  }`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChooseFile({
  busy,
  onFile,
}: {
  readonly busy: boolean
  readonly onFile: (file: File) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        A CSV with a header row, or a JSON array of objects — including a file this admin exported.
        Up to 1,000 rows.
      </p>

      <label className="border-input hover:bg-accent flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed px-4 py-10 text-sm">
        <Upload className="text-muted-foreground size-6" />
        <span className="font-medium">{busy ? 'Reading…' : 'Choose a file'}</span>
        <span className="text-muted-foreground">CSV or JSON</span>
        <input
          type="file"
          accept=".csv,.json,text/csv,application/json,text/plain"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so choosing the same file twice fires the event again -
            // which is what somebody who just fixed that file will do.
            event.target.value = ''
            if (file) onFile(file)
          }}
        />
      </label>
    </div>
  )
}

function Mapping({
  shape,
  filename,
  mapping,
  matchBy,
  onMap,
  onMatchBy,
}: {
  readonly shape: ImportShape
  readonly filename: string
  readonly mapping: Readonly<Record<string, string>>
  readonly matchBy: string
  readonly onMap: (field: string, column: string) => void
  readonly onMatchBy: (field: string) => void
}) {
  const columns = [
    { value: NOT_MAPPED, label: 'Not imported' },
    ...shape.columns.map((name) => ({ value: name, label: name })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        <span className="text-foreground font-medium">{filename}</span> —{' '}
        {shape.rows.toLocaleString()} {shape.rows === 1 ? 'row' : 'rows'}, {shape.columns.length}{' '}
        {shape.columns.length === 1 ? 'column' : 'columns'}.
      </p>

      {shape.truncated ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>This file is too long</AlertTitle>
          <AlertDescription>
            An import carries up to 1,000 rows. Split the file, or use a script and your ORM
            directly — which has no limit and no request to time out.
          </AlertDescription>
        </Alert>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">When a record already exists</span>
        <SimpleSelect
          value={matchBy === '' ? NOT_MAPPED : matchBy}
          onValueChange={(value) => onMatchBy(value === NOT_MAPPED ? '' : value)}
          placeholder="Always create"
          className="w-full sm:w-80"
          options={[
            { value: NOT_MAPPED, label: 'Create every row' },
            ...shape.matchable.map((field) => ({ value: field, label: `Update by ${field}` })),
          ]}
        />
        <span className="text-muted-foreground text-xs">
          {matchBy === ''
            ? 'Every row becomes a new record.'
            : `Rows whose ${matchBy} is already in the database update that record instead of adding one.`}
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Columns</span>

        <div className="border-input overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Column in the file</TableHead>
                <TableHead>First value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shape.targets.map((target) => {
                const column = mapping[target.field]
                const first = column === undefined ? undefined : shape.sample[0]?.[column]

                return (
                  <TableRow key={target.field}>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-medium">{target.field}</span>
                      {target.required ? (
                        <span className="text-destructive" title="Required">
                          {' '}
                          *
                        </span>
                      ) : null}
                      <div className="text-muted-foreground text-xs">
                        {target.relation === undefined
                          ? target.kind
                          : `${target.relation.model} — key or ${target.relation.display}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <SimpleSelect
                        value={column ?? NOT_MAPPED}
                        onValueChange={(value) => onMap(target.field, value)}
                        placeholder="Not imported"
                        className="w-full min-w-40"
                        options={columns}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-56 truncate text-sm">
                      {first === undefined || first === '' ? '—' : first}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function Preview({ plan }: { readonly plan: ImportPlan }) {
  const refused = plan.rows.filter((row) => row.action === 'refused')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{plan.create.toLocaleString()} to create</Badge>
        <Badge variant="outline">{plan.update.toLocaleString()} to update</Badge>
        {plan.refused > 0 ? (
          <Badge variant="destructive">{plan.refused.toLocaleString()} refused</Badge>
        ) : null}
      </div>

      <p className="text-muted-foreground text-sm">
        Nothing has been written yet. Refused rows are skipped; the rest are imported one at a time,
        and there is no undo.
      </p>

      {refused.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">What is wrong</span>
          <div className="border-input max-h-48 overflow-y-auto rounded-md border">
            <Table>
              <TableBody>
                {refused.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="tabular text-muted-foreground w-16 align-top">
                      Line {row.line}
                    </TableCell>
                    <TableCell className="text-sm">{row.problems.join(' ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">A sample of what will be written</span>
        <div className="border-input overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Line</TableHead>
                <TableHead className="w-20">Action</TableHead>
                <TableHead>Values</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.rows
                .filter((row) => row.action !== 'refused')
                .map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="tabular text-muted-foreground">{row.line}</TableCell>
                    <TableCell>
                      <Badge variant={row.action === 'create' ? 'outline' : 'secondary'}>
                        {row.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-sm">
                      {Object.entries(row.values)
                        .map(([field, value]) => `${field}: ${short(value)}`)
                        .join('  ·  ')}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function Result({ outcome }: { readonly outcome: ImportOutcome }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant={outcome.failed.length === 0 ? 'success' : 'warning'}>
        {outcome.failed.length === 0 ? <Check /> : <AlertTriangle />}
        <AlertTitle>
          {outcome.created.toLocaleString()} created, {outcome.updated.toLocaleString()} updated
          {outcome.failed.length > 0 ? `, ${outcome.failed.length.toLocaleString()} failed` : ''}
        </AlertTitle>
        {outcome.failed.length === 0 ? null : (
          <AlertDescription>
            The rows that worked are in. Fix these lines and import the file again — the ones
            already written will update rather than duplicate, as long as the match column stays the
            same.
          </AlertDescription>
        )}
      </Alert>

      {outcome.failed.length === 0 ? null : (
        <div className="border-input max-h-56 overflow-y-auto rounded-md border">
          <Table>
            <TableBody>
              {outcome.failed.map((row) => (
                <TableRow key={row.line}>
                  <TableCell className="tabular text-muted-foreground w-16 align-top">
                    Line {row.line}
                  </TableCell>
                  <TableCell className="text-sm">{row.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/** Does the file have a column of this name? */
function has(shape: ImportShape, field: string): boolean {
  const flatten = (name: string): string => name.toLowerCase().replaceAll(/[\s_-]+/g, '')
  return shape.columns.some((column) => flatten(column) === flatten(field))
}

function short(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}
