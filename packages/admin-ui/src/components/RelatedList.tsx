/**
 * The records on the far side of a to-many relation, shown on the parent.
 *
 * Paginated rather than listed, because how many children a record has is a
 * property of the data: a user with fifty thousand posts must not be a page
 * that never finishes loading.
 *
 * What can be done to the relation depends on where the link is stored, and the
 * two cases are not the same operation:
 *
 *   many-to-many  attach and detach add and remove a join-table row. Both are
 *                 offered.
 *   one-to-many   the child owns the column. Attaching rewrites it, which takes
 *                 the record away from whoever had it - so the button says so.
 *                 Detaching is only possible when that column is optional, and
 *                 the server refuses it otherwise; the button is not offered
 *                 when it is known to be impossible.
 */
import { ArrowUpRight, Info, Link2, Unlink } from 'lucide-react'
import { useState } from 'react'

import { attachRelated, detachRelated, listRelated } from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href } from '../hooks/use-route.js'
import { fieldLabel, listColumns, modelLabel, recordId } from '../metadata/fields.js'
import { formatCell } from '../metadata/format.js'
import { RelationPicker } from './RelationPicker.jsx'
import { ErrorState, TableSkeleton } from './States.jsx'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'
import { MediaCell } from './ui/media.jsx'
import { Pagination } from './ui/pagination.jsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from './ui/table.jsx'

const PER_PAGE = 5

export function RelatedList({
  parent,
  parentId,
  field,
  target,
  shape,
  detachBlocked,
}: {
  readonly parent: ModelDescriptor
  readonly parentId: string
  readonly field: FieldDescriptor
  readonly target: ModelDescriptor
  readonly shape: 'one-to-many' | 'many-to-many'
  /** Why detaching is impossible, when it is. */
  readonly detachBlocked: string | undefined
}) {
  const [page, setPage] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  const state = useAsync(
    () => listRelated(parent.name, parentId, field.name, { page, perPage: PER_PAGE }),
    [parent.name, parentId, field.name, page, reloadKey],
  )

  const refresh = () => setReloadKey((current) => current + 1)

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
      refresh()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  const columns = listColumns(target, 4)
  const total = state.data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          {fieldLabel(field)}
          <Badge data-slot="related-count" variant="secondary" className="tabular">
            {total}
          </Badge>
          {/* Which kind of relation this is, because attaching means different
              things and the buttons below behave differently. */}
          <Badge variant="outline" className="font-normal">
            {shape}
          </Badge>
        </h3>

        {/* Only a one-to-many can be expressed as a filter on the child list:
            a many-to-many has no column to filter on. */}
        {shape === 'one-to-many' && field.relation?.targetForeignKey !== undefined ? (
          <ViewAllLink parent={parent} parentId={parentId} field={field} target={target} />
        ) : null}
      </header>

      {error !== undefined ? <ErrorState error={error} /> : null}

      {state.loading && state.data === undefined ? (
        <TableSkeleton
          columns={columns.length + 1}
          rows={3}
          label={`Loading ${fieldLabel(field)}…`}
        />
      ) : state.error !== undefined ? (
        <ErrorState error={state.error} onRetry={state.reload} />
      ) : total === 0 ? (
        <p className="text-muted-foreground text-sm">No {modelLabel(target)} records.</p>
      ) : (
        <TableWrap aria-busy={state.loading ? true : undefined}>
          <Table aria-label={fieldLabel(field)}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableHead key={column.name} scope="col">
                    {fieldLabel(column)}
                  </TableHead>
                ))}
                <TableHead scope="col" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data?.records.map((record, index) => {
                const id = recordId(target, record)
                return (
                  <TableRow key={id ?? index}>
                    {columns.map((column) => (
                      <TableCell key={column.name}>
                        {column.widget === 'image' || column.widget === 'file' ? (
                          <MediaCell field={column} value={record[column.name]} />
                        ) : (
                          formatCell(column, record[column.name])
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="w-px text-right whitespace-nowrap">
                      {id === undefined ? null : (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" asChild>
                            <a href={href({ kind: 'detail', model: target.name, id })}>View</a>
                          </Button>
                          {detachBlocked === undefined && parent.can?.update !== false ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void run(() => detachRelated(parent.name, parentId, field.name, id))
                              }
                            >
                              <Unlink />
                              Detach
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableWrap>
      )}

      {pages > 1 ? <Pagination page={page} lastPage={pages} onPage={setPage} /> : null}

      {parent.can?.update === false ? null : (
        <Attach
          target={target}
          shape={shape}
          busy={busy}
          onAttach={(id) => void run(() => attachRelated(parent.name, parentId, field.name, id))}
        />
      )}

      {detachBlocked === undefined ? null : <Note>{detachBlocked}</Note>}
    </section>
  )
}

/** A quiet explanation of why something is the way it is. */
function Note({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-sm">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/**
 * A link into the child list, filtered to this parent.
 *
 * Only meaningful for a one-to-many: the filter is on the child's foreign key,
 * and a many-to-many has none.
 */
function ViewAllLink({
  parent,
  parentId,
  field,
  target,
}: {
  readonly parent: ModelDescriptor
  readonly parentId: string
  readonly field: FieldDescriptor
  readonly target: ModelDescriptor
}) {
  // Sent by the server, which already had to pair the two halves of the
  // relation in order to work out its shape.
  const filterField = field.relation?.targetForeignKey
  if (filterField === undefined) return null

  return (
    <Button variant="ghost" size="sm" asChild>
      <a
        href={href({
          kind: 'list',
          model: target.name,
          filter: `${filterField}:eq:${parentId}`,
        })}
      >
        View all {modelLabel(target)} for this {modelLabel(parent)}
        <ArrowUpRight />
      </a>
    </Button>
  )
}

/** Choosing a record to link. */
function Attach({
  target,
  shape,
  busy,
  onAttach,
}: {
  readonly target: ModelDescriptor
  readonly shape: 'one-to-many' | 'many-to-many'
  readonly busy: boolean
  readonly onAttach: (id: string) => void
}) {
  const [chosen, setChosen] = useState('')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-full sm:max-w-xs">
          <RelationPicker
            target={target}
            value={chosen}
            required={false}
            onChange={(value) => setChosen(value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={busy || chosen === ''}
          onClick={() => {
            onAttach(chosen)
            setChosen('')
          }}
        >
          <Link2 />
          Attach
        </Button>
      </div>
      {shape === 'one-to-many' ? (
        // Worth saying before the click rather than after: this is a move, not
        // a copy, and it changes a record that is not on this page.
        <Note>
          Attaching moves the {modelLabel(target)} record here, away from whatever it belongs to
          now.
        </Note>
      ) : null}
    </div>
  )
}
