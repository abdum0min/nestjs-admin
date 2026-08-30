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
import { useState } from 'react'

import { attachRelated, detachRelated, listRelated } from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href } from '../hooks/use-route.js'
import { formatCell } from '../metadata/format.js'
import { listColumns, recordId } from '../metadata/fields.js'
import { RelationPicker } from './RelationPicker.jsx'
import { ErrorState, Loading } from './States.jsx'

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
    <section className="related">
      <header className="related__header">
        <h3>
          {field.name} <span className="muted">({total})</span>
        </h3>

        {/* Only a one-to-many can be expressed as a filter on the child list:
            a many-to-many has no column to filter on. */}
        {shape === 'one-to-many' && field.relation?.targetForeignKey !== undefined ? (
          <ViewAllLink parent={parent} parentId={parentId} field={field} target={target} />
        ) : null}
      </header>

      {error !== undefined ? <ErrorState error={error} /> : null}

      {state.loading ? (
        <Loading label={`Loading ${field.name}…`} />
      ) : state.error !== undefined ? (
        <ErrorState error={state.error} onRetry={state.reload} />
      ) : total === 0 ? (
        <p className="muted">No {target.name} records.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.name} scope="col">
                    {column.name}
                  </th>
                ))}
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {state.data?.records.map((record, index) => {
                const id = recordId(target, record)
                return (
                  <tr key={id ?? index}>
                    {columns.map((column) => (
                      <td key={column.name}>{formatCell(column, record[column.name])}</td>
                    ))}
                    <td className="cell--actions">
                      {id === undefined ? null : (
                        <>
                          <a href={href({ kind: 'detail', model: target.name, id })}>View</a>
                          {detachBlocked === undefined && parent.can?.update !== false ? (
                            <button
                              type="button"
                              className="link"
                              disabled={busy}
                              onClick={() =>
                                void run(() => detachRelated(parent.name, parentId, field.name, id))
                              }
                            >
                              Detach
                            </button>
                          ) : null}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className="related__pager">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {page} of {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      ) : null}

      {parent.can?.update === false ? null : (
        <Attach
          target={target}
          shape={shape}
          busy={busy}
          onAttach={(id) => void run(() => attachRelated(parent.name, parentId, field.name, id))}
        />
      )}

      {detachBlocked === undefined ? null : <p className="muted related__note">{detachBlocked}</p>}
    </section>
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
    <a
      href={href({
        kind: 'list',
        model: target.name,
        filter: `${filterField}:eq:${parentId}`,
      })}
    >
      View all {target.name} for this {parent.name}
    </a>
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
    <div className="related__attach">
      <RelationPicker
        target={target}
        value={chosen}
        required={false}
        onChange={(value) => setChosen(value)}
      />
      <button
        type="button"
        disabled={busy || chosen === ''}
        onClick={() => {
          onAttach(chosen)
          setChosen('')
        }}
      >
        Attach
      </button>
      {shape === 'one-to-many' ? (
        // Worth saying before the click rather than after: this is a move, not
        // a copy, and it changes a record that is not on this page.
        <p className="muted related__note">
          Attaching moves the {target.name} record here, away from whatever it belongs to now.
        </p>
      ) : null}
    </div>
  )
}
