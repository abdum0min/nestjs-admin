/**
 * The generic list screen.
 *
 * One component serves every model. Columns, filters, sort options and the row
 * link all come from the model descriptor the server sent - there is no branch
 * anywhere on a model or field name.
 */
import { useEffect, useRef, useState } from 'react'

import { deleteRecords, listRecords } from '../api/client.js'
import type {
  AdminRecord,
  BulkDeleteResult,
  FieldDescriptor,
  FilterRule,
  ModelDescriptor,
  SortRule,
} from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import {
  filterableFields,
  listColumns,
  operatorsFor,
  recordId,
  sortableFields,
} from '../metadata/fields.js'
import { fieldLabel, modelLabel } from '../metadata/fields.js'
import { formatCell } from '../metadata/format.js'
import { relationForForeignKey, relationLink } from '../metadata/relations.js'
import { Actions } from './Actions.jsx'
import { Empty, ErrorState, Loading } from './States.jsx'

const PER_PAGE = 25

export function ListView({
  model,
  models,
  initialFilter,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  /**
   * A filter carried in the URL, in the API's `field:op:value` form.
   *
   * How "all the posts by this author" arrives: the link into this list says
   * what it is showing, and reloading the page keeps showing it.
   */
  readonly initialFilter?: string
}) {
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortRule | undefined>(undefined)
  const [filter, setFilter] = useState<FilterRule | undefined>(() => parseFilter(initialFilter))

  /**
   * The rows ticked, by id.
   *
   * Held here rather than per row, because "select every row on this page" and
   * "how many are selected" are questions about the set, not about any row.
   */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [deleting, setDeleting] = useState(false)
  /**
   * Bumped to rebuild the filter row.
   *
   * `FilterControl` holds the half-built rule - a field chosen, no operator
   * yet - which belongs to the row rather than to the query. Clearing the query
   * from outside would leave those selects showing a filter that is no longer
   * applied, so the row is remounted instead.
   */
  const [filterKey, setFilterKey] = useState(0)
  const [outcome, setOutcome] = useState<BulkDeleteResult | undefined>(undefined)

  // Reset view state when the model changes; a page number or sort field from
  // the previous model is meaningless here and would produce a 400.
  useEffect(() => {
    setPage(1)
    setSearchInput('')
    setSearch('')
    setSort(undefined)
    // Back to whatever the URL asks for, not to nothing. This effect also runs
    // on mount, so clearing it unconditionally would throw away the filter a
    // link arrived with - "all the posts by this author" would open showing
    // every post, one render after showing the right ones.
    setFilter(parseFilter(initialFilter))
    setSelected(new Set())
    setOutcome(undefined)
  }, [model.name, initialFilter])

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // A selection is a set of rows on the page in front of the person, so it
  // does not survive the page changing under it. Keeping ids selected across a
  // re-query would mean a Delete button acting on rows nobody can see.
  useEffect(() => {
    setSelected(new Set())
  }, [page, search, sort, filter])

  // Is this view narrowed? It decides what an empty result means, which is
  // the difference between "there is nothing here" and "nothing matched" -
  // two states with the same appearance and opposite remedies.
  const narrowed = search !== '' || filter !== undefined

  const clearView = (): void => {
    setSearchInput('')
    setSearch('')
    setFilter(undefined)
    setPage(1)
    setFilterKey((value) => value + 1)
  }

  const columns = listColumns(model)
  const sortable = sortableFields(model)
  const filterable = filterableFields(model)

  const state = useAsync(
    () =>
      listRecords(model.name, {
        page,
        perPage: PER_PAGE,
        ...(search ? { search } : {}),
        ...(sort ? { sort: [sort] } : {}),
        ...(filter ? { filters: [filter] } : {}),
      }),
    [
      model.name,
      page,
      search,
      sort?.field,
      sort?.direction,
      filter?.field,
      filter?.operator,
      filter?.value,
    ],
  )

  const rows = state.data?.records ?? []
  const ids = rows
    .map((record) => recordId(model, record))
    .filter((id): id is string => id !== undefined)

  // Offered only where the policy allows it. The request is checked again when
  // it arrives; this stops the interface promising what it cannot deliver.
  const selectable = model.can?.delete !== false && ids.length > 0

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const removeSelected = async (): Promise<void> => {
    const chosen = ids.filter((id) => selected.has(id))
    if (chosen.length === 0) return
    if (
      !window.confirm(
        `Delete ${chosen.length} ${chosen.length === 1 ? 'record' : 'records'}? This cannot be undone.`,
      )
    ) {
      return
    }

    setDeleting(true)
    setOutcome(undefined)
    try {
      const result = await deleteRecords(model.name, chosen)
      setOutcome(result)
      setSelected(new Set())
      state.reload()
    } catch (cause) {
      // A whole-request failure - refused, or unreachable. Reported the same
      // way a per-record one is, so there is one place to look.
      setOutcome({
        deleted: [],
        failed: [{ id: '', message: cause instanceof Error ? cause.message : String(cause) }],
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="list">
      <header className="list__header">
        <h1>{modelLabel(model)}</h1>
        {/* Not offered when the policy would refuse it. The request is checked
            again when it arrives; this only stops the interface promising
            something it cannot deliver. */}
        <Actions model={model} scope="list" onDone={state.reload} />
        {model.can?.create === false ? null : (
          <button type="button" onClick={() => navigate({ kind: 'create', model: model.name })}>
            New {modelLabel(model)}
          </button>
        )}
      </header>

      <div className="toolbar">
        <input
          type="search"
          className="toolbar__search"
          placeholder={`Search ${modelLabel(model)}…`}
          aria-label={`Search ${modelLabel(model)}`}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />

        <SortControl
          fields={sortable}
          value={sort}
          onChange={(next) => {
            setSort(next)
            setPage(1)
          }}
        />
      </div>

      <FilterControl
        key={filterKey}
        fields={filterable}
        value={filter}
        onChange={(next) => {
          setFilter(next)
          setPage(1)
        }}
      />

      {selectable && selected.size > 0 ? (
        <div className="bulk">
          <p className="bulk__count" role="status">
            {selected.size} selected
          </p>
          <button
            type="button"
            className="danger"
            disabled={deleting}
            onClick={() => void removeSelected()}
          >
            {deleting ? 'Deleting…' : 'Delete selected'}
          </button>
          <button type="button" className="link" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}

      {outcome ? <BulkOutcome outcome={outcome} onDismiss={() => setOutcome(undefined)} /> : null}

      {/* Only the first load blanks the screen. A page change or a new search
          term keeps the previous rows in place and dims them, because replacing
          a table with a line of text and then putting it back is a flash, and a
          flash reads as a bug. `aria-busy` says the same thing to a reader
          that cannot see the dimming. */}
      {state.loading && state.data === undefined ? (
        <Loading label={`Loading ${modelLabel(model)}…`} />
      ) : null}
      {state.error !== undefined ? <ErrorState error={state.error} onRetry={state.reload} /> : null}

      {state.error === undefined && state.data ? (
        state.data.records.length === 0 ? (
          <Empty>
            {narrowed ? (
              <>
                <p>No {modelLabel(model)} matches this search.</p>
                <button type="button" onClick={clearView}>
                  Clear search and filters
                </button>
              </>
            ) : (
              <>
                <p>No {modelLabel(model)} records yet.</p>
                {model.can?.create === false ? null : (
                  <button
                    type="button"
                    onClick={() => navigate({ kind: 'create', model: model.name })}
                  >
                    Create the first one
                  </button>
                )}
              </>
            )}
          </Empty>
        ) : (
          <>
            <div className="table-wrap" aria-busy={state.loading ? true : undefined}>
              {/* Named, because a page can hold more than one table - a detail
                  page shows related records beside the record itself - and
                  "table" alone does not say which. */}
              <table aria-label={modelLabel(model)}>
                <thead>
                  <tr>
                    {selectable ? (
                      <th scope="col" className="cell--select">
                        <SelectAll
                          ids={ids}
                          selected={selected}
                          model={modelLabel(model)}
                          onChange={setSelected}
                        />
                      </th>
                    ) : null}
                    {columns.map((column) => (
                      <th key={column.name} scope="col">
                        {columnLabel(model, column)}
                      </th>
                    ))}
                    <th scope="col" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {state.data.records.map((record, index) => {
                    const id = recordId(model, record)
                    const ticked = id !== undefined && selected.has(id)
                    return (
                      <tr key={id ?? index} className={ticked ? 'row--selected' : undefined}>
                        {selectable ? (
                          <td className="cell--select">
                            {id === undefined ? null : (
                              <input
                                type="checkbox"
                                checked={ticked}
                                // Named per row, because "checkbox" repeated
                                // forty times tells a screen reader nothing.
                                aria-label={`Select ${rowLabel(model, record, id)}`}
                                onChange={() => toggle(id)}
                              />
                            )}
                          </td>
                        ) : null}
                        {columns.map((column) => (
                          <td key={column.name}>
                            <Cell model={model} models={models} column={column} record={record} />
                          </td>
                        ))}
                        <td className="cell--actions">
                          {id === undefined ? null : (
                            <a href={href({ kind: 'detail', model: model.name, id })}>View</a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Pagination meta={state.data.meta} onPage={setPage} />
          </>
        )
      ) : null}
    </section>
  )
}

/**
 * The header checkbox.
 *
 * Three states, not two: none of this page selected, all of it, or some. The
 * third has no HTML attribute - `indeterminate` is a property, set through a
 * ref - and without it a partial selection looks identical to an empty one,
 * which makes the next click do the opposite of what it appears to.
 */
function SelectAll({
  ids,
  selected,
  model,
  onChange,
}: {
  readonly ids: readonly string[]
  readonly selected: ReadonlySet<string>
  readonly model: string
  readonly onChange: (next: ReadonlySet<string>) => void
}) {
  const box = useRef<HTMLInputElement>(null)
  const chosen = ids.filter((id) => selected.has(id)).length
  const all = chosen === ids.length && ids.length > 0

  useEffect(() => {
    if (box.current) box.current.indeterminate = chosen > 0 && !all
  }, [chosen, all])

  return (
    <input
      ref={box}
      type="checkbox"
      checked={all}
      aria-label={all ? `Deselect all ${model}` : `Select all ${model} on this page`}
      onChange={() => onChange(all ? new Set() : new Set(ids))}
    />
  )
}

/**
 * What a bulk delete did.
 *
 * Both halves are reported. "28 deleted" alone hides the two that survived,
 * and a bare failure hides the twenty-eight that did not - and since nothing is
 * rolled back, either omission leaves someone with a wrong idea of what the
 * database now contains.
 */
function BulkOutcome({
  outcome,
  onDismiss,
}: {
  readonly outcome: BulkDeleteResult
  readonly onDismiss: () => void
}) {
  const failed = outcome.failed.length

  return (
    <div className={failed > 0 ? 'state state--error' : 'state'} role="status">
      <p>
        {outcome.deleted.length} deleted
        {failed > 0 ? `, ${failed} could not be` : ''}.
      </p>
      {failed > 0 ? (
        <ul className="bulk__failures">
          {outcome.failed.map((entry, index) => (
            <li key={entry.id || index}>
              {entry.id ? <code>{entry.id}</code> : null} {entry.message}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="link" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

/**
 * A row, named for a screen reader.
 *
 * The display field where there is one, because "Select Ada Lovelace" is worth
 * hearing and "Select cmtf50g0000..." is not.
 */
function rowLabel(model: ModelDescriptor, record: AdminRecord, id: string): string {
  const shown = record[model.displayField]
  return shown === null || shown === undefined || shown === '' ? id : String(shown)
}

function SortControl({
  fields,
  value,
  onChange,
}: {
  readonly fields: readonly { name: string }[]
  readonly value: SortRule | undefined
  readonly onChange: (next: SortRule | undefined) => void
}) {
  if (fields.length === 0) return null

  return (
    <label className="toolbar__control">
      <span>Sort</span>
      <select
        aria-label="Sort by"
        value={value ? `${value.field}:${value.direction}` : ''}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') return onChange(undefined)
          const separator = raw.lastIndexOf(':')
          onChange({
            field: raw.slice(0, separator),
            direction: raw.slice(separator + 1) === 'desc' ? 'desc' : 'asc',
          })
        }}
      >
        <option value="">Default</option>
        {fields.map((field) => (
          <optgroup key={field.name} label={field.name}>
            <option value={`${field.name}:asc`}>{field.name} ascending</option>
            <option value={`${field.name}:desc`}>{field.name} descending</option>
          </optgroup>
        ))}
      </select>
    </label>
  )
}

/**
 * A single filter row.
 *
 * One filter rather than a builder: the server combines multiple filters with
 * AND only, so a multi-row UI would imply an expressiveness the contract does
 * not have. Field and operator choices both come from metadata, so the UI
 * cannot compose a query the server will reject.
 */
function FilterControl({
  fields,
  value,
  onChange,
}: {
  readonly fields: readonly import('../api/types.js').FieldDescriptor[]
  readonly value: FilterRule | undefined
  readonly onChange: (next: FilterRule | undefined) => void
}) {
  const [field, setField] = useState('')
  const [operator, setOperator] = useState('')
  const [text, setText] = useState('')

  if (fields.length === 0) return null

  const selected = fields.find((candidate) => candidate.name === field)
  const operators = selected ? operatorsFor(selected) : []

  const apply = (nextField: string, nextOperator: string, nextText: string): void => {
    const target = fields.find((candidate) => candidate.name === nextField)
    if (!target || nextOperator === '' || nextText === '') return onChange(undefined)
    onChange({
      field: nextField,
      operator: nextOperator as FilterRule['operator'],
      value: nextText,
    })
  }

  return (
    <div className="filters">
      <label className="toolbar__control">
        <span>Filter</span>
        <select
          aria-label="Filter field"
          value={field}
          onChange={(event) => {
            const next = event.target.value
            setField(next)
            setOperator('')
            setText('')
            onChange(undefined)
          }}
        >
          <option value="">None</option>
          {fields.map((candidate) => (
            <option key={candidate.name} value={candidate.name}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>

      {selected ? (
        <>
          <select
            aria-label="Filter operator"
            value={operator}
            onChange={(event) => {
              setOperator(event.target.value)
              apply(field, event.target.value, text)
            }}
          >
            <option value="">Operator</option>
            {operators.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>

          {selected.kind === 'enum' && selected.enumValues && operator !== 'in' ? (
            <select
              aria-label="Filter value"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                apply(field, operator, event.target.value)
              }}
            >
              <option value="">Value</option>
              {selected.enumValues.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label="Filter value"
              type={selected.kind === 'number' ? 'number' : 'text'}
              placeholder={operator === 'in' ? 'comma,separated' : 'value'}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                apply(field, operator, event.target.value)
              }}
            />
          )}

          {value ? (
            <button
              type="button"
              onClick={() => {
                setField('')
                setOperator('')
                setText('')
                onChange(undefined)
              }}
            >
              Clear
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function Pagination({
  meta,
  onPage,
}: {
  readonly meta: { readonly total: number; readonly page: number; readonly perPage: number }
  readonly onPage: (page: number) => void
}) {
  const lastPage = Math.max(1, Math.ceil(meta.total / Math.max(1, meta.perPage)))

  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
        Previous
      </button>
      <span>
        Page {meta.page} of {lastPage} · {meta.total} total
      </span>
      <button type="button" disabled={meta.page >= lastPage} onClick={() => onPage(meta.page + 1)}>
        Next
      </button>
    </nav>
  )
}

/**
 * One table cell.
 *
 * A foreign key is rendered as the related record's name, linking to it -
 * `authorId` says `cmtf50g…`, which is true and unusable. The raw value stays
 * available on the detail page.
 */
function Cell({
  model,
  models,
  column,
  record,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly column: FieldDescriptor
  readonly record: AdminRecord
}) {
  const relationField = relationForForeignKey(model, column.name)
  const link = relationField ? relationLink(relationField, models, record) : undefined

  if (link) {
    return <a href={href({ kind: 'detail', model: link.model, id: link.id })}>{link.label}</a>
  }

  return <>{formatCell(column, record[column.name])}</>
}

/**
 * What to call a column.
 *
 * A foreign-key column shows the related record's name, so heading it
 * `authorId` would label the values with the name of something else. It is
 * headed by the relation it stands for.
 */
function columnLabel(model: ModelDescriptor, column: FieldDescriptor): string {
  const relation = relationForForeignKey(model, column.name)
  return relation ? fieldLabel(relation) : fieldLabel(column)
}

/**
 * A `field:op:value` string from the URL, as a filter rule.
 *
 * Split on the first two colons only: a value may contain them, and a date
 * usually does. Returns `undefined` for anything malformed rather than
 * throwing - a bad link should open an unfiltered list, not a broken screen.
 */
function parseFilter(raw: string | undefined): FilterRule | undefined {
  if (!raw) return undefined

  const first = raw.indexOf(':')
  const second = raw.indexOf(':', first + 1)
  if (first < 1 || second < 0) return undefined

  return {
    field: raw.slice(0, first),
    operator: raw.slice(first + 1, second) as FilterRule['operator'],
    value: raw.slice(second + 1),
  }
}
