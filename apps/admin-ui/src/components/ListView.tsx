/**
 * The generic list screen.
 *
 * One component serves every model. Columns, filters, sort options and the row
 * link all come from the model descriptor the server sent - there is no branch
 * anywhere on a model or field name.
 */
import { ArrowUpDown, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

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
  fieldLabel,
  filterableFields,
  listColumns,
  modelLabel,
  operatorsFor,
  recordId,
  sortableFields,
} from '../metadata/fields.js'
import { formatCell } from '../metadata/format.js'
import { relationForForeignKey, relationLink } from '../metadata/relations.js'
import { Actions } from './Actions.jsx'
import { Empty, ErrorState, Loading } from './States.jsx'
import { Button } from './ui/button.jsx'
import { Checkbox } from './ui/checkbox.jsx'
import { useConfirm } from './ui/confirm.jsx'
import { Input } from './ui/input.jsx'
import { Select } from './ui/select.jsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from './ui/table.jsx'

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
  const confirm = useConfirm()

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
  const [outcome, setOutcome] = useState<BulkDeleteResult | undefined>(undefined)

  /**
   * Bumped to rebuild the filter row.
   *
   * `FilterControl` holds the half-built rule - a field chosen, no operator
   * yet - which belongs to the row rather than to the query. Clearing the query
   * from outside would leave those selects showing a filter that is no longer
   * applied, so the row is remounted instead.
   */
  const [filterKey, setFilterKey] = useState(0)

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

    const agreed = await confirm({
      title: `Delete ${chosen.length} ${chosen.length === 1 ? 'record' : 'records'}?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!agreed) return

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
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">{modelLabel(model)}</h1>
          {state.data ? (
            <p className="text-muted-foreground text-sm tabular">
              {state.data.meta.total} {state.data.meta.total === 1 ? 'record' : 'records'}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {/* Not offered when the policy would refuse it. The request is checked
              again when it arrives; this only stops the interface promising
              something it cannot deliver. */}
          <Actions model={model} scope="list" onDone={state.reload} />
          {model.can?.create === false ? null : (
            <Button onClick={() => navigate({ kind: 'create', model: model.name })}>
              <Plus />
              New {modelLabel(model)}
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          className="w-full sm:max-w-xs"
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
        <div
          data-slot="bulk-bar"
          className="bg-card flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
        >
          <p className="text-sm font-medium" role="status">
            {selected.size} selected
          </p>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={() => void removeSelected()}
          >
            <Trash2 />
            {deleting ? 'Deleting…' : 'Delete selected'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
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
                <Button variant="outline" size="sm" onClick={clearView}>
                  <X />
                  Clear search and filters
                </Button>
              </>
            ) : (
              <>
                <p>No {modelLabel(model)} records yet.</p>
                {model.can?.create === false ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate({ kind: 'create', model: model.name })}
                  >
                    <Plus />
                    Create the first one
                  </Button>
                )}
              </>
            )}
          </Empty>
        ) : (
          <>
            <TableWrap aria-busy={state.loading ? true : undefined}>
              {/* Named, because a page can hold more than one table - a detail
                  page shows related records beside the record itself - and
                  "table" alone does not say which. */}
              <Table aria-label={modelLabel(model)}>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {selectable ? (
                      <TableHead className="w-px whitespace-nowrap">
                        <SelectAll
                          ids={ids}
                          selected={selected}
                          model={modelLabel(model)}
                          onChange={setSelected}
                        />
                      </TableHead>
                    ) : null}
                    {columns.map((column) => (
                      <TableHead key={column.name} scope="col">
                        {columnLabel(model, column)}
                      </TableHead>
                    ))}
                    <TableHead scope="col" aria-label="Actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.data.records.map((record, index) => {
                    const id = recordId(model, record)
                    const ticked = id !== undefined && selected.has(id)
                    return (
                      <TableRow key={id ?? index} data-selected={ticked || undefined}>
                        {selectable ? (
                          <TableCell className="w-px whitespace-nowrap">
                            {id === undefined ? null : (
                              <Checkbox
                                checked={ticked}
                                // Named per row, because "checkbox" repeated
                                // forty times tells a screen reader nothing.
                                aria-label={`Select ${rowLabel(model, record, id)}`}
                                onChange={() => toggle(id)}
                              />
                            )}
                          </TableCell>
                        ) : null}
                        {columns.map((column) => (
                          <TableCell key={column.name}>
                            <Cell model={model} models={models} column={column} record={record} />
                          </TableCell>
                        ))}
                        <TableCell className="w-px text-right whitespace-nowrap">
                          {id === undefined ? null : (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={href({ kind: 'detail', model: model.name, id })}>View</a>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableWrap>

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
 * third has no HTML attribute - `indeterminate` is a property - and without it
 * a partial selection looks identical to an empty one, which makes the next
 * click do the opposite of what it appears to.
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
  const chosen = ids.filter((id) => selected.has(id)).length
  const all = chosen === ids.length && ids.length > 0

  return (
    <Checkbox
      checked={all}
      indeterminate={chosen > 0 && !all}
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
    <div
      data-slot={failed > 0 ? 'error-state' : 'bulk-outcome'}
      className={
        failed > 0
          ? 'border-destructive/40 bg-destructive/8 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm'
          : 'border-success/40 bg-success/8 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm'
      }
      role="status"
    >
      <p className="font-medium">
        {outcome.deleted.length} deleted
        {failed > 0 ? `, ${failed} could not be` : ''}.
      </p>
      {failed > 0 ? (
        <ul className="list-disc pl-5">
          {outcome.failed.map((entry, index) => (
            <li key={entry.id || index}>
              {entry.id ? <code className="opacity-70">{entry.id}</code> : null} {entry.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
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
    <div className="flex items-center gap-2">
      <ArrowUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <Select
        className="w-48"
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
        <option value="">Default order</option>
        {fields.map((field) => (
          <optgroup key={field.name} label={field.name}>
            <option value={`${field.name}:asc`}>{field.name} ascending</option>
            <option value={`${field.name}:desc`}>{field.name} descending</option>
          </optgroup>
        ))}
      </Select>
    </div>
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
  readonly fields: readonly FieldDescriptor[]
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
    <div className="flex flex-wrap items-center gap-2">
      <Select
        className="w-40"
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
        <option value="">Filter by…</option>
        {fields.map((candidate) => (
          <option key={candidate.name} value={candidate.name}>
            {candidate.name}
          </option>
        ))}
      </Select>

      {selected ? (
        <>
          <Select
            className="w-36"
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
          </Select>

          {selected.kind === 'enum' && selected.enumValues && operator !== 'in' ? (
            <Select
              className="w-40"
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
            </Select>
          ) : (
            <Input
              className="w-40"
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setField('')
                setOperator('')
                setText('')
                onChange(undefined)
              }}
            >
              <X />
              Clear
            </Button>
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
    <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-muted-foreground text-sm tabular">
        Page {meta.page} of {lastPage} · {meta.total} total
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page >= lastPage}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </Button>
      </div>
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
    return (
      <a
        className="text-primary underline-offset-4 hover:underline"
        href={href({ kind: 'detail', model: link.model, id: link.id })}
      >
        {link.label}
      </a>
    )
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
