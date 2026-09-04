/**
 * The developer tools screen.
 *
 * ## The problem it exists for
 *
 * The first thirty seconds of using this package: empty tables, a flat
 * dashboard chart, relation pickers with nothing in them. Nothing to click, so
 * nothing to judge - and the judgement gets made anyway.
 *
 * ## One screen, not a wizard
 *
 * Every model is a row with its own count, and the whole thing is one press.
 * The four-step arrangement this kind of page naturally suggests - choose,
 * configure, preview, generate - reads well the first time and costs four
 * clicks on every one after it, which is the wrong trade for a tool somebody
 * opens twenty times in an afternoon. Preview is still there and still writes
 * nothing; it is a button rather than a stage.
 *
 * ## What is deliberately not hidden
 *
 * Failures. A run that asks for five profiles on a schema with two spare users
 * gets two, and says why. A screen that showed only green ticks would be
 * describing a product that does not exist.
 */
import {
  Database,
  FlaskConical,
  Layers,
  Loader2,
  Server,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  devFill,
  devPreview,
  devReset,
  devStatus,
  devTruncate,
  devUndo,
  type DevRun,
  type DevStatus,
} from '../api/client.js'
import type { AdminRecord } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { ErrorState, FormSkeleton } from './States.jsx'
import { Alert, AlertDescription, AlertTitle } from './ui/alert.jsx'
import { Badge } from './ui/badge.jsx'
import { Breadcrumb } from './ui/breadcrumb.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.jsx'
import { Checkbox } from './ui/checkbox.jsx'
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

/** A cell in the preview: whatever the generator produced, in one line. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return '{…}'
  const text = String(value)
  return text.length > 40 ? `${text.slice(0, 37)}…` : text
}

/** How many rows a model starts with. */
const DEFAULT_COUNT = 20

export function DevToolsView() {
  const confirm = useConfirm()
  const state = useAsync(() => devStatus(), [])

  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const [counts, setCounts] = useState<Readonly<Record<string, string>>>({})
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)
  const [runs, setRuns] = useState<readonly DevRun[] | undefined>(undefined)
  const [preview, setPreview] = useState<{ model: string; records: readonly AdminRecord[] }>()

  const models = state.data?.models ?? []

  // Everything ticked when the models first arrive: the common press is "fill
  // this admin", and starting with nothing selected makes that ten clicks.
  useEffect(() => {
    if (models.length === 0) return
    setChosen((current) => (current.size === 0 ? new Set(models.map((m) => m.name)) : current))
  }, [models.length])

  const countOf = (name: string): number => {
    const typed = counts[name]
    const parsed = typed === undefined || typed === '' ? DEFAULT_COUNT : Number(typed)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  }

  const selection = models
    .filter((model) => chosen.has(model.name))
    .map((model) => ({ name: model.name, count: countOf(model.name) }))
    .filter((entry) => entry.count > 0)

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
          <FormSkeleton fields={5} />
        </CardContent>
      </Card>
    )
  }
  if (state.error !== undefined) return <ErrorState error={state.error} onRetry={state.reload} />

  const status = state.data as DevStatus
  const undoable = status.history[0]
  const undoCount = undoable?.runs.reduce((total, entry) => total + entry.created, 0) ?? 0

  return (
    <section className="flex flex-col gap-4">
      <Breadcrumb trail={[{ label: 'Home', href: '#/' }, { label: 'Developer tools' }]} />

      <header className="flex items-center gap-3">
        <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <FlaskConical className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Developer tools</h1>
          <p className="text-muted-foreground text-sm">
            Believable data from your own schema. Absent entirely from a build that did not ask for
            them.
          </p>
        </div>
      </header>

      <StatusCards status={status} />

      {failure === undefined ? null : <ErrorState error={failure} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="size-4" aria-hidden="true" />
                Generate data
              </CardTitle>
              <CardDescription>
                Pick the models and how many of each. They are written in an order the relations
                allow, so a post always has an author.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              <TableWrap>
                <Table aria-label="Models to generate">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-px whitespace-nowrap">
                        <Checkbox
                          checked={chosen.size === models.length && models.length > 0}
                          indeterminate={chosen.size > 0 && chosen.size < models.length}
                          aria-label={
                            chosen.size === models.length
                              ? 'Deselect all models'
                              : 'Select all models'
                          }
                          onChange={() =>
                            setChosen(
                              chosen.size === models.length
                                ? new Set()
                                : new Set(models.map((model) => model.name)),
                            )
                          }
                        />
                      </TableHead>
                      <TableHead scope="col">Model</TableHead>
                      <TableHead scope="col">Relations</TableHead>
                      <TableHead scope="col">Records now</TableHead>
                      <TableHead scope="col">Generate</TableHead>
                      <TableHead scope="col">
                        <span className="sr-only">Preview</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {models.map((model) => {
                      const ticked = chosen.has(model.name)

                      return (
                        <TableRow key={model.name} data-selected={ticked || undefined}>
                          <TableCell className="w-px whitespace-nowrap">
                            <Checkbox
                              checked={ticked}
                              aria-label={`Generate ${model.name}`}
                              onChange={() =>
                                setChosen((current) => {
                                  const next = new Set(current)
                                  if (!next.delete(model.name)) next.add(model.name)
                                  return next
                                })
                              }
                            />
                          </TableCell>
                          <TableCell className="font-medium">{model.name}</TableCell>
                          <TableCell>
                            {model.relations === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <Badge
                                variant="outline"
                                title="Linked from your schema, automatically"
                              >
                                Auto ({model.relations})
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular">
                            {model.records}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              className="w-24"
                              aria-label={`How many ${model.name}`}
                              disabled={!ticked}
                              value={counts[model.name] ?? String(DEFAULT_COUNT)}
                              onChange={(event) =>
                                setCounts((current) => ({
                                  ...current,
                                  [model.name]: event.target.value,
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="w-px whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy !== undefined}
                              onClick={() =>
                                void run('preview', async () => {
                                  const result = await devPreview({
                                    model: model.name,
                                    count: 5,
                                    ...(seed === '' ? {} : { seed }),
                                  })
                                  setPreview(result)
                                  setRuns(undefined)
                                })
                              }
                            >
                              Preview
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableWrap>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={busy !== undefined || selection.length === 0}
                  onClick={() =>
                    void run('fill', async () => {
                      const result = await devFill({
                        models: selection,
                        ...(seed === '' ? {} : { seed }),
                      })
                      setRuns(result)
                      setPreview(undefined)
                      state.reload()
                    })
                  }
                >
                  {busy === 'fill' ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {busy === 'fill'
                    ? 'Generating…'
                    : `Generate ${selection.reduce((total, entry) => total + entry.count, 0)} records`}
                </Button>

                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  Seed
                  <Input
                    className="w-36"
                    placeholder="optional"
                    aria-label="Seed"
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                  />
                </label>

                <span className="text-muted-foreground text-sm">
                  {selection.length} of {models.length} selected
                </span>
              </div>

              {preview === undefined ? null : <Preview preview={preview} />}
              {runs === undefined ? null : <Outcome runs={runs} />}
            </CardContent>
          </Card>

          {undoable === undefined ? null : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Undo2 className="size-4" aria-hidden="true" />
                  Undo the last run
                </CardTitle>
                <CardDescription>
                  Deletes only what was generated at {new Date(undoable.at).toLocaleTimeString()}.
                  Records you made yourself are left alone — which is what makes generating into a
                  working database safe to try.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  disabled={busy !== undefined || undoCount === 0}
                  onClick={() =>
                    void run('undo', async () => {
                      const result = await devUndo()
                      setRuns(result)
                      state.reload()
                    })
                  }
                >
                  {busy === 'undo' ? <Loader2 className="animate-spin" /> : <Undo2 />}
                  Undo {undoCount} records
                </Button>
              </CardContent>
            </Card>
          )}

          <DangerZone
            models={models.map((model) => model.name)}
            busy={busy}
            onTruncate={(model) =>
              void run('truncate', async () => {
                const agreed = await confirm({
                  title: `Delete every ${model}?`,
                  description: 'This cannot be undone.',
                  confirmLabel: 'Delete everything',
                  destructive: true,
                })
                if (!agreed) return

                const result = await devTruncate(model)
                setRuns([{ model, created: result.deleted, ids: [], failed: [] }])
                state.reload()
              })
            }
            onReset={() =>
              void run('reset', async () => {
                const agreed = await confirm({
                  title: 'Empty every model?',
                  description:
                    'Every record in every model this admin can write, including the ones you made by hand. This cannot be undone.',
                  confirmLabel: 'Empty everything',
                  destructive: true,
                })
                if (!agreed) return

                const result = await devReset()
                setRuns(
                  result.map((entry) => ({
                    model: entry.model,
                    created: entry.deleted,
                    ids: [],
                    failed:
                      entry.remaining > 0
                        ? [{ reason: `${entry.remaining} still in place`, count: entry.remaining }]
                        : [],
                  })),
                )
                state.reload()
              })
            }
          />
        </div>

        <aside className="flex flex-col gap-4">
          <SmartDefaults status={status} />
          <History history={status.history} />
        </aside>
      </div>
    </section>
  )
}

/**
 * The state of the world, above everything that changes it.
 *
 * The environment card names what the deployment check actually saw rather than
 * `NODE_ENV` alone. A card that named one variable would teach the wrong rule
 * about a gate that reads a dozen.
 */
function StatusCards({ status }: { readonly status: DevStatus }) {
  const environment = status.environment.deployed
    ? status.environment.because.join(', ')
    : 'No deployment signals'

  const cards = [
    { icon: Layers, label: 'Models', value: String(status.models.length), hint: 'you may write' },
    { icon: Database, label: 'Adapter', value: status.adapter, hint: 'in use' },
    {
      icon: Server,
      label: 'Environment',
      value: status.environment.deployed ? 'Looks deployed' : 'Local',
      hint: environment,
    },
    {
      icon: Sparkles,
      label: 'Records',
      value: status.totalRecords.toLocaleString(),
      hint: 'across every model',
    },
  ] as const

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="flex items-start gap-3 pt-5">
            <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
              <card.icon className="size-4" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-muted-foreground text-xs">{card.label}</span>
              <span className="truncate text-lg font-semibold">{card.value}</span>
              <span className="text-muted-foreground truncate text-xs" title={card.hint}>
                {card.hint}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** What the generator promises, where somebody decides whether to trust it. */
function SmartDefaults({ status }: { readonly status: DevStatus }) {
  const points = [
    {
      title: 'From your schema',
      detail: 'A column called email gets an address; a price gets money. No model names anywhere.',
    },
    {
      title: 'Relation aware',
      detail: 'Parents first, and a one-to-one hands out each parent exactly once.',
    },
    {
      title: 'Same seed, same data',
      detail: 'So a demo can be rebuilt after emptying it, or screenshotted twice.',
    },
    {
      title: status.faker ? 'Using faker' : 'Built-in words',
      detail: status.faker
        ? '@faker-js/faker is installed and in use.'
        : 'Optional. Install @faker-js/faker for more variety; everything works without it.',
    },
    {
      title: status.images ? 'Pictures on' : 'Pictures off',
      detail: status.images
        ? 'Identicons drawn from the record and written through your file storage.'
        : 'No file storage configured, so image columns are left empty.',
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">What it will do</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {points.map((point) => (
          <div key={point.title} className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{point.title}</span>
            <span className="text-muted-foreground text-xs">{point.detail}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * What has been generated since the server started.
 *
 * Only the newest can be undone, and the list says so by offering that button
 * elsewhere. The rest answer "did that actually do anything", which is asked
 * far more often than it is answered.
 */
function History({ history }: { readonly history: DevStatus['history'] }) {
  if (history.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent runs</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {history.map((batch) => {
          const created = batch.runs.reduce((total, run) => total + run.created, 0)
          const refused = batch.runs.reduce((total, run) => total + run.failed.length, 0)

          return (
            <div key={batch.at} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {created} records
                {refused > 0 ? (
                  <span className="text-destructive"> · {refused} refused</span>
                ) : null}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {new Date(batch.at).toLocaleTimeString()}
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

/** The two destructive things, together and below everything else. */
function DangerZone({
  models,
  busy,
  onTruncate,
  onReset,
}: {
  readonly models: readonly string[]
  readonly busy: string | undefined
  readonly onTruncate: (model: string) => void
  readonly onReset: () => void
}) {
  const [model, setModel] = useState('')
  const chosen = model === '' ? models[0] : model

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="size-4" aria-hidden="true" />
          Danger zone
        </CardTitle>
        <CardDescription>
          Deletes records you made as well as generated ones. There is no undo for either of these.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Model</span>
          <SimpleSelect
            className="w-44"
            aria-label="Model to empty"
            placeholder="Choose a model"
            value={chosen ?? ''}
            options={models.map((name) => ({ value: name, label: name }))}
            onValueChange={setModel}
          />
        </label>

        <Button
          variant="outline"
          disabled={busy !== undefined || chosen === undefined}
          onClick={() => onTruncate(chosen as string)}
        >
          {busy === 'truncate' ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Empty {chosen ?? 'a model'}
        </Button>

        <Button variant="destructive" disabled={busy !== undefined} onClick={onReset}>
          {busy === 'reset' ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Empty every model
        </Button>
      </CardContent>
    </Card>
  )
}

/** What would be written. The same code path that writes it, stopped short. */
function Preview({
  preview,
}: {
  readonly preview: { model: string; records: readonly AdminRecord[] }
}) {
  const columns = [...new Set(preview.records.flatMap((record) => Object.keys(record)))]

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-sm">
        {preview.model} — what would be written. Nothing has been.
      </p>
      <TableWrap>
        <Table aria-label={`${preview.model} preview`}>
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
            {preview.records.map((record, index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column}>{cell(record[column])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrap>
    </div>
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
  const problems = runs.filter((run) => run.failed.length > 0 || run.note !== undefined)

  return (
    <Alert>
      <Sparkles />
      <AlertTitle>
        {total} {total === 1 ? 'record' : 'records'}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <span>
          {runs
            .filter((run) => run.created > 0)
            .map((run) => `${run.model}: ${run.created}`)
            .join(' · ')}
        </span>
        {problems.map((run) => (
          <span key={`${run.model}:notes`} className="flex flex-col gap-0.5">
            {run.note === undefined ? null : (
              <span className="text-muted-foreground">
                {run.model} — {run.note}
              </span>
            )}
            {run.failed.map((entry) => (
              <span key={entry.reason} className="text-destructive">
                {run.model} — {entry.reason} ({entry.count})
              </span>
            ))}
          </span>
        ))}
      </AlertDescription>
    </Alert>
  )
}
