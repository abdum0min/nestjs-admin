/**
 * What happened, and putting it back.
 *
 * ## One screen, two jobs
 *
 * The whole trail, and one record's history. They are the same table with a
 * filter, because they are the same question asked at different widths - and
 * because a second screen would drift from this one about what an entry means.
 *
 * ## Undo is offered honestly
 *
 * The server says whether an entry is *structurally* reversible - an
 * application action ran code nobody here wrote, an export changed nothing. It
 * deliberately does not say whether this person may, or whether the record has
 * moved since, because both can change between drawing the button and pressing
 * it. So the button is drawn where the shape allows it and the refusal, when it
 * comes, is shown as the server phrased it.
 */
import { ChevronRight, RotateCcw, ShieldAlert } from 'lucide-react'
import { useState } from 'react'

import { fetchAudit, undoAudit } from '../api/client.js'
import type { AuditEntry, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href } from '../hooks/use-route.js'
import { modelLabel } from '../metadata/fields.js'
import { cn } from '../lib/utils.js'
import { Empty, ErrorState, Loading } from './States.jsx'
import { Badge } from './ui/badge.jsx'
import { Breadcrumb } from './ui/breadcrumb.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent } from './ui/card.jsx'
import { useConfirm } from './ui/confirm.jsx'
import { Pagination } from './ui/pagination.jsx'
import { SimpleSelect } from './ui/select.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.jsx'

const PER_PAGE = 25

const ANY = '—'

/** Actions worth filtering by, in the order they are worth looking for. */
const ACTIONS = [
  'update',
  'create',
  'delete',
  'restore',
  'undo',
  'action',
  'import',
  'export',
  'denied',
] as const

/** What each action looks like at a glance. */
const TONE: Readonly<Record<string, string>> = {
  create: 'bg-success/12 text-success border-success/30',
  delete: 'bg-destructive/12 text-destructive border-destructive/30',
  denied: 'bg-destructive/12 text-destructive border-destructive/30',
  undo: 'bg-warning/12 text-warning border-warning/30',
}

export function AuditView({
  models,
  model,
  record,
}: {
  readonly models: readonly ModelDescriptor[]
  /** Set when this is one record's history rather than the whole trail. */
  readonly model?: string
  readonly record?: string
}) {
  const confirm = useConfirm()

  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [chosen, setChosen] = useState(model ?? '')
  const [open, setOpen] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)

  const state = useAsync(
    () =>
      fetchAudit({
        page,
        perPage: PER_PAGE,
        ...(chosen === '' ? {} : { model: chosen }),
        ...(record === undefined ? {} : { record }),
        ...(action === '' ? {} : { action }),
      }),
    [page, chosen, record, action],
  )

  const undo = async (entry: AuditEntry): Promise<void> => {
    const agreed = await confirm({
      title: 'Put this back?',
      description:
        'This is a new change, not a rewind: your hooks run, the permissions are checked, ' +
        'and it is recorded like any other edit.',
      confirmLabel: 'Undo',
    })
    if (!agreed) return

    setFailure(undefined)
    try {
      await undoAudit(entry.id)
      state.reload()
    } catch (cause) {
      setFailure(cause)
    }
  }

  const named = record === undefined ? undefined : (state.data?.entries[0]?.recordLabel ?? record)
  const total = state.data?.meta.total ?? 0

  return (
    <section className="flex flex-col gap-4">
      <Breadcrumb
        trail={
          record === undefined
            ? [{ label: 'Home', href: '#/' }, { label: 'History' }]
            : [
                { label: 'Home', href: '#/' },
                ...(model === undefined
                  ? []
                  : [{ label: model, href: href({ kind: 'list', model }) }]),
                ...(model === undefined || record === undefined
                  ? []
                  : [
                      { label: named ?? record, href: href({ kind: 'detail', model, id: record }) },
                    ]),
                { label: 'History' },
              ]
        }
      />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {record === undefined ? 'History' : `History of ${named ?? record}`}
        </h1>
        <p className="text-muted-foreground text-sm">
          {record === undefined
            ? 'Every change made through this admin. '
            : 'Every change made to this record through this admin. '}
          A script or a migration changes the same rows and is not recorded here.
        </p>
      </header>

      {failure === undefined ? null : <ErrorState error={failure} />}

      {record === undefined ? (
        <div className="flex flex-wrap items-center gap-2">
          <SimpleSelect
            value={chosen === '' ? ANY : chosen}
            onValueChange={(value) => {
              setChosen(value === ANY ? '' : value)
              setPage(1)
            }}
            placeholder="Every model"
            className="w-52"
            options={[
              { value: ANY, label: 'Every model' },
              ...models.map((entry) => ({ value: entry.name, label: modelLabel(entry) })),
            ]}
          />

          <SimpleSelect
            value={action === '' ? ANY : action}
            onValueChange={(value) => {
              setAction(value === ANY ? '' : value)
              setPage(1)
            }}
            placeholder="Everything"
            className="w-44"
            options={[
              { value: ANY, label: 'Everything' },
              ...ACTIONS.map((name) => ({ value: name, label: name })),
            ]}
          />

          {chosen === '' && action === '' ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setChosen('')
                setAction('')
                setPage(1)
              }}
            >
              Clear
            </Button>
          )}

          <span className="text-muted-foreground ml-auto text-sm tabular-nums">
            {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      ) : null}

      {state.loading && state.data === undefined ? (
        <Loading label="Reading the history…" />
      ) : state.error !== undefined ? (
        <ErrorState error={state.error} onRetry={state.reload} />
      ) : state.data === undefined || state.data.entries.length === 0 ? (
        <Empty>
          <p>Nothing recorded yet.</p>
        </Empty>
      ) : (
        <Card>
          <CardContent className="px-0 pt-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="w-44">
                    When
                  </TableHead>
                  <TableHead scope="col" className="w-40">
                    Who
                  </TableHead>
                  <TableHead scope="col" className="w-28">
                    What
                  </TableHead>
                  <TableHead scope="col">Summary</TableHead>
                  <TableHead scope="col" className="w-px">
                    <span className="sr-only">Undo</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.data.entries.map((entry) => (
                  <Row
                    key={entry.id}
                    entry={entry}
                    expanded={open === entry.id}
                    onToggle={() => setOpen(open === entry.id ? undefined : entry.id)}
                    onUndo={() => void undo(entry)}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {total > PER_PAGE ? (
        <Pagination page={page} lastPage={Math.ceil(total / PER_PAGE)} onPage={setPage} />
      ) : null}
    </section>
  )
}

function Row({
  entry,
  expanded,
  onToggle,
  onUndo,
}: {
  readonly entry: AuditEntry
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly onUndo: () => void
}) {
  const changes = entry.changes ?? []

  return (
    <>
      <TableRow>
        <TableCell className="text-muted-foreground align-top text-sm whitespace-nowrap tabular-nums">
          {when(entry.at)}
        </TableCell>
        <TableCell className="align-top text-sm">
          <span className="font-medium">{entry.actor}</span>
          {entry.actorEmail === undefined ? null : (
            <div className="text-muted-foreground truncate text-xs">{entry.actorEmail}</div>
          )}
        </TableCell>
        <TableCell className="align-top">
          <Badge variant="outline" className={cn('capitalize', TONE[entry.action])}>
            {entry.action}
          </Badge>
        </TableCell>
        <TableCell className="align-top text-sm">
          <button
            type="button"
            className="hover:text-link flex items-start gap-1.5 text-left transition-colors"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <ChevronRight
              className={cn(
                'mt-0.5 size-3.5 shrink-0 transition-transform',
                expanded && 'rotate-90',
              )}
              aria-hidden="true"
            />
            <span>{entry.summary}</span>
          </button>
          {entry.outcome === 'refused' ? (
            <div className="text-destructive mt-1 flex items-center gap-1 text-xs">
              <ShieldAlert className="size-3" aria-hidden="true" />
              {entry.detail ?? 'Refused.'}
            </div>
          ) : null}
        </TableCell>
        <TableCell className="align-top whitespace-nowrap">
          {entry.undoable ? (
            <Button variant="outline" size="sm" onClick={onUndo}>
              <RotateCcw />
              Undo
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs" title={entry.undoableReason}>
              —
            </span>
          )}
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/40">
            <div className="flex flex-col gap-3 py-1">
              <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Model</dt>
                <dd>
                  {entry.model === '*' ? (
                    'Not about a model'
                  ) : entry.recordId === undefined ? (
                    entry.model
                  ) : (
                    <a
                      className="text-link underline-offset-4 hover:underline"
                      href={href({ kind: 'detail', model: entry.model, id: entry.recordId })}
                    >
                      {entry.recordLabel ?? entry.recordId}
                    </a>
                  )}
                </dd>

                {entry.detail === undefined ? null : (
                  <>
                    <dt className="text-muted-foreground">Detail</dt>
                    <dd>{entry.detail}</dd>
                  </>
                )}

                {entry.undoable ? null : (
                  <>
                    <dt className="text-muted-foreground">Undo</dt>
                    <dd className="text-muted-foreground">{entry.undoableReason}</dd>
                  </>
                )}
              </dl>

              {changes.length === 0 ? (
                <p className="text-muted-foreground text-sm">No field values were recorded.</p>
              ) : (
                <div className="border-input overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col" className="w-48">
                          Field
                        </TableHead>
                        <TableHead scope="col">Was</TableHead>
                        <TableHead scope="col">Became</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {changes.map((change) => (
                        <TableRow key={change.field}>
                          <TableCell className="font-medium">{change.field}</TableCell>
                          <TableCell className="text-muted-foreground max-w-xs truncate">
                            {show(change.from)}
                          </TableCell>
                          <TableCell className="max-w-xs truncate">{show(change.to)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

/** The local rendering of an ISO instant, which is what a reader wants. */
function when(at: string): string {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString()
}

/** A recorded value, as one readable cell. */
function show(value: unknown): string {
  if (value === null) return 'nothing'
  if (value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)

  const text = String(value)
  return text === '' ? 'empty' : text
}
