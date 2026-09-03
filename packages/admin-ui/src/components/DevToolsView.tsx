/**
 * The developer tools screen.
 *
 * One page, three things, in the order somebody needs them: fill the whole
 * admin, fill one model, and take it back. Everything destructive is below the
 * things that are not, and the one button that empties a table asks for the
 * model's name to be typed.
 *
 * ## Why the first button is the big one
 *
 * The problem this screen exists for is the first thirty seconds of using the
 * package: empty tables, a flat dashboard, relation pickers with nothing in
 * them. "Fill this admin" answers that in one click, in an order the relations
 * allow. Everything else on the page is for afterwards.
 */
import { Database, Loader2, Sparkles, Trash2, Undo2, Wand2 } from 'lucide-react'
import { useState } from 'react'

import {
  devFill,
  devGenerate,
  devPreview,
  devStatus,
  devTruncate,
  devUndo,
  type DevRun,
} from '../api/client.js'
import type { AdminRecord } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { ErrorState, FormSkeleton } from './States.jsx'
import { Alert, AlertDescription, AlertTitle } from './ui/alert.jsx'
import { Badge } from './ui/badge.jsx'
import { Breadcrumb } from './ui/breadcrumb.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.jsx'
import { useConfirm } from './ui/confirm.jsx'
import { Input } from './ui/input.jsx'
import { SimpleSelect } from './ui/select.jsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from './ui/table.jsx'

/** A cell in the preview. Whatever the generator produced, in one line. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return '{…}'
  const text = String(value)
  return text.length > 40 ? `${text.slice(0, 37)}…` : text
}

export function DevToolsView() {
  const confirm = useConfirm()
  const state = useAsync(() => devStatus(), [])

  const [model, setModel] = useState('')
  const [count, setCount] = useState('20')
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)
  const [runs, setRuns] = useState<readonly DevRun[] | undefined>(undefined)
  const [preview, setPreview] = useState<readonly AdminRecord[] | undefined>(undefined)

  const models = state.data?.models ?? []
  const chosen = model === '' ? models[0] : model
  const amount = Number(count)

  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setFailure(undefined)
    try {
      await action()
    } catch (cause) {
      setFailure(cause)
    } finally {
      setBusy(undefined)
    }
  }

  if (state.loading) {
    return (
      <Card>
        <CardContent className="pt-5">
          <FormSkeleton fields={4} />
        </CardContent>
      </Card>
    )
  }
  if (state.error !== undefined) return <ErrorState error={state.error} onRetry={state.reload} />

  return (
    <section className="flex flex-col gap-4">
      <Breadcrumb trail={[{ label: 'Home', href: '#/' }, { label: 'Developer tools' }]} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Developer tools</h1>
          <p className="text-muted-foreground text-sm">
            Believable data, from your own schema. Nothing here is available in a build that did not
            ask for it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.data?.faker ? (
            <Badge variant="outline">faker installed</Badge>
          ) : (
            <Badge variant="outline" title="Optional. Install @faker-js/faker for more variety.">
              built-in words
            </Badge>
          )}
          {state.data?.images ? <Badge variant="outline">pictures on</Badge> : null}
        </div>
      </header>

      {failure === undefined ? null : <ErrorState error={failure} />}

      {/* The headline. An empty database becomes something to click through. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden="true" />
            Fill this admin
          </CardTitle>
          <CardDescription>
            Every model, in an order that satisfies the relations - so a post always has an author.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy !== undefined}
            onClick={() =>
              void run('fill', async () => {
                const result = await devFill({
                  perModel: Number.isFinite(amount) ? amount : 12,
                  ...(seed === '' ? {} : { seed }),
                })
                setRuns(result)
                setPreview(undefined)
                state.reload()
              })
            }
          >
            {busy === 'fill' ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy === 'fill' ? 'Filling…' : `Fill every model`}
          </Button>
          <span className="text-muted-foreground text-sm">
            {models.length} {models.length === 1 ? 'model' : 'models'} you may write
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="size-4" aria-hidden="true" />
            Generate one model
          </CardTitle>
          <CardDescription>
            Preview first. The same seed gives the same records, so a demo can be rebuilt exactly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Model</span>
              <SimpleSelect
                className="w-52"
                aria-label="Model to generate"
                placeholder="Choose a model"
                value={chosen ?? ''}
                options={models.map((name) => ({ value: name, label: name }))}
                onValueChange={setModel}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">How many</span>
              <Input
                type="number"
                min={1}
                className="w-24"
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Seed</span>
              <Input
                className="w-40"
                placeholder="optional"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
              />
            </label>

            <Button
              variant="outline"
              disabled={busy !== undefined || chosen === undefined}
              onClick={() =>
                void run('preview', async () => {
                  const result = await devPreview({
                    model: chosen as string,
                    count: Math.min(Number.isFinite(amount) ? amount : 5, 5),
                    ...(seed === '' ? {} : { seed }),
                  })
                  setPreview(result.records)
                  setRuns(undefined)
                })
              }
            >
              {busy === 'preview' ? <Loader2 className="animate-spin" /> : null}
              Preview
            </Button>

            <Button
              disabled={busy !== undefined || chosen === undefined}
              onClick={() =>
                void run('generate', async () => {
                  const result = await devGenerate({
                    model: chosen as string,
                    ...(Number.isFinite(amount) ? { count: amount } : {}),
                    ...(seed === '' ? {} : { seed }),
                  })
                  setRuns([result])
                  setPreview(undefined)
                  state.reload()
                })
              }
            >
              {busy === 'generate' ? <Loader2 className="animate-spin" /> : <Wand2 />}
              Generate
            </Button>
          </div>

          {preview === undefined ? null : <Preview records={preview} />}
        </CardContent>
      </Card>

      {runs === undefined ? null : <Outcome runs={runs} />}

      {state.data?.lastRun === undefined ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Undo2 className="size-4" aria-hidden="true" />
              Undo the last run
            </CardTitle>
            <CardDescription>
              Deletes only what was generated at{' '}
              {new Date(state.data.lastRun.at).toLocaleTimeString()} - records you made yourself are
              left alone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={busy !== undefined}
              onClick={() =>
                void run('undo', async () => {
                  const result = await devUndo()
                  setRuns(result)
                  state.reload()
                })
              }
            >
              {busy === 'undo' ? <Loader2 className="animate-spin" /> : <Undo2 />}
              Undo{' '}
              {state.data?.lastRun?.runs.reduce((total, entry) => total + entry.created, 0) ??
                0}{' '}
              records
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" aria-hidden="true" />
            Empty a model
          </CardTitle>
          <CardDescription>
            Deletes every record of one model, including the ones you made. There is no undo for
            this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            disabled={busy !== undefined || chosen === undefined}
            onClick={() =>
              void run('truncate', async () => {
                const name = chosen as string
                const agreed = await confirm({
                  title: `Delete every ${name}?`,
                  description: 'This cannot be undone.',
                  confirmLabel: 'Delete everything',
                  destructive: true,
                })
                if (!agreed) return

                const result = await devTruncate(name)
                setRuns([{ model: name, created: result.deleted, ids: [], failed: [] }])
                state.reload()
              })
            }
          >
            {busy === 'truncate' ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Empty {chosen ?? 'a model'}
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}

/** What would be written. The same code path that writes it, stopped short. */
function Preview({ records }: { readonly records: readonly AdminRecord[] }) {
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))]

  return (
    <TableWrap>
      <Table aria-label="Preview">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead key={column} scope="col">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell key={column}>{cell(record[column])}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrap>
  )
}

/**
 * What a run did, both halves.
 *
 * Failures are grouped by reason: two hundred rows failing one unique
 * constraint is a single fact, and printing it two hundred times buries it.
 */
function Outcome({ runs }: { readonly runs: readonly DevRun[] }) {
  const total = runs.reduce((sum, run) => sum + run.created, 0)
  const problems = runs.filter((run) => run.failed.length > 0)

  return (
    <Alert>
      <Sparkles />
      <AlertTitle>
        {total} {total === 1 ? 'record' : 'records'}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <span>{runs.map((run) => `${run.model}: ${run.created}`).join(' · ')}</span>
        {runs
          .filter((run) => run.note !== undefined)
          .map((run) => (
            <span key={`${run.model}:note`} className="text-muted-foreground">
              {run.model} — {run.note}
            </span>
          ))}
        {problems.map((run) =>
          run.failed.map((entry) => (
            <span key={`${run.model}:${entry.reason}`} className="text-destructive">
              {run.model} — {entry.reason} ({entry.count})
            </span>
          )),
        )}
      </AlertDescription>
    </Alert>
  )
}
