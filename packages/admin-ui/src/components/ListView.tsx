/**
 * The generic list screen.
 *
 * One component serves every model. Columns, filters, sort options and the row
 * link all come from the model descriptor the server sent - there is no branch
 * anywhere on a model or field name.
 */
import { Copy, Eye, MoreHorizontal, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  deleteRecord,
  deleteRecords,
  listRecords,
  restoreRecord,
  runAction,
} from '../api/client.js'
import type {
  ActionDescriptor,
  AdminRecord,
  BulkDeleteResult,
  DeletedView,
  FieldDescriptor,
  FilterRule,
  ModelDescriptor,
  SortRule,
} from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { usePerPage } from '../hooks/use-per-page.js'
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
import { Badge } from './ui/badge.jsx'
import { Empty, ErrorState, TableSkeleton } from './States.jsx'
import { Breadcrumb } from './ui/breadcrumb.jsx'
import { Button } from './ui/button.jsx'
import { Checkbox } from './ui/checkbox.jsx'
import { useConfirm } from './ui/confirm.jsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.jsx'
import { Input } from './ui/input.jsx'
import { MediaCell } from './ui/media.jsx'
import { Pagination } from './ui/pagination.jsx'
import { NONE, SimpleSelect } from './ui/select.jsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from './ui/table.jsx'

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
  const { perPage, setPerPage } = usePerPage()
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

  /**
   * Which records this list is showing, on a model that keeps its deleted rows.
   *
   * Only ever moved off `live` deliberately: a list that remembered it was
   * showing deleted records would eventually have somebody delete from it,
   * wonder why the row stayed, and delete it again - permanently.
   */
  const [deleted, setDeleted] = useState<DeletedView>('live')
  const softDeleteField = model.softDeleteField

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
    setDeleted('live')
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
        perPage,
        ...(search ? { search } : {}),
        ...(sort ? { sort: [sort] } : {}),
        ...(filter ? { filters: [filter] } : {}),
        // Only where the server offered it. A model without soft delete
        // refuses the parameter rather than ignoring it, which is what keeps a
        // request for deleted records from being answered with live ones.
        ...(softDeleteField !== undefined ? { deleted } : {}),
      }),
    [
      model.name,
      page,
      perPage,
      search,
      deleted,
      softDeleteField,
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

  /**
   * What Delete means for a selection depends on which view it was made in.
   *
   * In the Deleted view every selected record is already marked, so the only
   * delete left is the permanent one - emptying the bin, which is what a person
   * looking at that list is there to do. Everywhere else it marks, as a single
   * row does.
   */
  const bulkPermanent = softDeleteField !== undefined && deleted === 'deleted'

  const removeSelected = async (): Promise<void> => {
    const chosen = ids.filter((id) => selected.has(id))
    if (chosen.length === 0) return

    const count = `${chosen.length} ${chosen.length === 1 ? 'record' : 'records'}`
    const agreed = await confirm({
      title: bulkPermanent ? `Delete ${count} forever?` : `Delete ${count}?`,
      description:
        bulkPermanent || softDeleteField === undefined
          ? 'This cannot be undone.'
          : 'They will be hidden from this list and can be restored later.',
      confirmLabel: bulkPermanent ? 'Delete forever' : 'Delete',
      destructive: true,
    })
    if (!agreed) return

    setDeleting(true)
    setOutcome(undefined)
    try {
      const result = await deleteRecords(model.name, chosen, bulkPermanent)
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

  const total = state.data?.meta.total
  const lastPage = Math.max(1, Math.ceil((total ?? 0) / perPage))

  return (
    <section className="flex flex-col gap-4">
      <Breadcrumb trail={[{ label: 'Home', href: '#/' }, { label: modelLabel(model) }]} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">{modelLabel(model)}</h1>
          {total === undefined ? null : (
            <p className="text-muted-foreground text-sm tabular">
              {total} {total === 1 ? 'record' : 'records'}
            </p>
          )}
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

      {/*
       * One row, wrapping only when it has to.
       *
       * Search, sort and filter were on two rows regardless of how much space
       * there was, so a wide screen showed a half-empty line above a lonely
       * filter control. They are one flex row now: they sit together when they
       * fit and wrap in the order they are read when they do not.
       */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          className="w-full min-w-48 sm:w-auto sm:flex-1 sm:max-w-sm"
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

        <FilterControl
          key={filterKey}
          fields={filterable}
          value={filter}
          onChange={(next) => {
            setFilter(next)
            setPage(1)
          }}
        />

        {softDeleteField === undefined ? null : (
          <SimpleSelect
            className="w-36"
            aria-label={`Which ${modelLabel(model)} to show`}
            placeholder="Live"
            value={deleted}
            options={[
              { value: 'live', label: 'Live' },
              { value: 'deleted', label: 'Deleted' },
              { value: 'all', label: 'All' },
            ]}
            onValueChange={(next) => {
              setDeleted(next as DeletedView)
              setPage(1)
              setSelected(new Set())
            }}
          />
        )}

        {narrowed ? (
          <Button variant="ghost" size="sm" onClick={clearView}>
            <X />
            Clear
          </Button>
        ) : null}
      </div>

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
            {deleting ? 'Deleting…' : bulkPermanent ? 'Delete forever' : 'Delete selected'}
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
        <TableSkeleton
          columns={columns.length + (selectable ? 2 : 1)}
          label={`Loading ${modelLabel(model)}…`}
        />
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
                    <TableHead scope="col">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.data.records.map((record, index) => {
                    const id = recordId(model, record)
                    const ticked = id !== undefined && selected.has(id)
                    // The column travels in the record like any other, so
                    // whether a row is marked needs no extra request.
                    const gone =
                      softDeleteField !== undefined &&
                      record[softDeleteField] !== null &&
                      record[softDeleteField] !== undefined
                    return (
                      <TableRow
                        key={id ?? index}
                        data-selected={ticked || undefined}
                        className={gone ? 'opacity-55' : undefined}
                      >
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
                        <TableCell className="w-px whitespace-nowrap">
                          {id === undefined ? null : (
                            <div className="flex items-center justify-end gap-2">
                              {/* Only in the mixed view. In the Deleted view
                                  the control above already says it, once,
                                  instead of on every row. */}
                              {gone && deleted === 'all' ? (
                                <Badge variant="outline">Deleted</Badge>
                              ) : null}
                              <RowActions
                                model={model}
                                id={id}
                                label={rowLabel(model, record, id)}
                                deleted={gone}
                                onDone={state.reload}
                              />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableWrap>

            <Pagination
              page={state.data.meta.page}
              lastPage={lastPage}
              total={state.data.meta.total}
              perPage={perPage}
              onPage={setPage}
              onPerPage={(next) => {
                setPerPage(next)
                // Page 7 of 40 is page 2 of 10 at a hundred rows, and neither
                // is the page the person was reading. The first one is the
                // honest answer to "show me more at a time".
                setPage(1)
              }}
            />
          </>
        )
      ) : null}
    </section>
  )
}

/**
 * What can be done to one row.
 *
 * Opening a record to delete it is two navigations to reach a button that was
 * always going to be pressed, so the row carries its own.
 *
 * ## The same actions, arranged for the screen
 *
 * On a screen with room, view, edit and delete are three buttons: one click
 * each, and you can see what a row offers without opening anything. On a phone
 * three buttons per row is most of the width, so they collapse into one menu.
 *
 * The set is identical either way. A control that exists on a desktop and not
 * on a phone is a feature people cannot find on the device they happen to be
 * holding, which is worse than either arrangement.
 *
 * Anything the application declared lives in the menu on both, because there
 * can be any number of them and a row cannot grow.
 */
function RowActions({
  model,
  id,
  label,
  deleted = false,
  onDone,
}: {
  readonly model: ModelDescriptor
  readonly id: string
  /** The record's name, so a confirmation can say which one. */
  readonly label: string
  /** Already marked deleted, so Delete becomes Restore and Delete forever. */
  readonly deleted?: boolean
  readonly onDone: () => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  const recordActions = (model.actions ?? []).filter((action) => action.scope === 'record')
  const canEdit = model.can?.update !== false
  const canDelete = model.can?.delete !== false
  const reversible = model.softDeleteField !== undefined

  const remove = async (permanent = false): Promise<void> => {
    const agreed = await confirm({
      title: permanent ? `Delete ${label} forever?` : `Delete ${label}?`,
      // The one sentence people actually read before clicking, so it has to be
      // true: on a model that keeps its rows, "this cannot be undone" would be
      // a lie, and a lie in that direction makes every real warning weaker.
      description:
        permanent || !reversible
          ? 'This cannot be undone.'
          : 'It will be hidden from this list and can be restored later.',
      confirmLabel: permanent ? 'Delete forever' : 'Delete',
      destructive: true,
    })
    if (!agreed) return

    setBusy(true)
    setError(undefined)
    try {
      await deleteRecord(model.name, id, permanent)
      onDone()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await restoreRecord(model.name, id)
      onDone()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  const run = async (action: ActionDescriptor): Promise<void> => {
    if (action.confirm !== undefined) {
      const agreed = await confirm({
        title: action.confirm,
        confirmLabel: action.label,
        destructive: action.danger === true,
      })
      if (!agreed) return
    }

    setBusy(true)
    setError(undefined)
    try {
      await runAction(model.name, action.name, id)
      onDone()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      {error === undefined ? null : (
        // A row has no room for an explanation, and a failure that says nothing
        // is worse than one that says where to look.
        <span className="text-destructive mr-1 text-xs" role="alert">
          Failed
        </span>
      )}

      {/* Wide enough for buttons. */}
      <div className="hidden items-center gap-0.5 md:flex">
        <Button variant="ghost" size="icon-sm" aria-label={`View ${label}`} asChild>
          <a href={href({ kind: 'detail', model: model.name, id })}>
            <Eye />
          </a>
        </Button>

        {canEdit ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${label}`} asChild>
            <a href={href({ kind: 'edit', model: model.name, id })}>
              <Pencil />
            </a>
          </Button>
        ) : null}

        {canDelete && deleted ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`Restore ${label}`}
            onClick={() => void restore()}
          >
            <Undo2 />
          </Button>
        ) : null}

        {canDelete ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:text-destructive"
            disabled={busy}
            aria-label={deleted ? `Delete ${label} forever` : `Delete ${label}`}
            onClick={() => void remove(deleted)}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>

      {/*
       * One menu, holding everything.
       *
       * Always on a phone; on a wider screen only when the application declared
       * actions, since the three above already cover the rest.
       */}
      <div className={recordActions.length > 0 ? 'flex' : 'flex md:hidden'}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`More actions for ${label}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {/* The same three, for a screen that is not showing them. */}
            <div className="md:hidden">
              <DropdownMenuItem asChild>
                <a href={href({ kind: 'detail', model: model.name, id })}>
                  <Eye />
                  View
                </a>
              </DropdownMenuItem>
              {canEdit ? (
                <DropdownMenuItem asChild>
                  <a href={href({ kind: 'edit', model: model.name, id })}>
                    <Pencil />
                    Edit
                  </a>
                </DropdownMenuItem>
              ) : null}
              {model.can?.create === false ? null : (
                <DropdownMenuItem asChild>
                  <a href={href({ kind: 'create', model: model.name, from: id })}>
                    <Copy />
                    Duplicate
                  </a>
                </DropdownMenuItem>
              )}
              {canDelete && deleted ? (
                <DropdownMenuItem onSelect={() => void restore()}>
                  <Undo2 />
                  Restore
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={() => void remove(deleted)}>
                  <Trash2 />
                  {deleted ? 'Delete forever' : 'Delete'}
                </DropdownMenuItem>
              ) : null}
              {recordActions.length > 0 ? <DropdownMenuSeparator /> : null}
            </div>

            {recordActions.map((action) => (
              <DropdownMenuItem
                key={action.name}
                variant={action.danger === true ? 'destructive' : 'default'}
                onSelect={() => void run(action)}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
    <SimpleSelect
      className="w-auto min-w-44"
      aria-label="Sort by"
      placeholder="Default order"
      value={value ? `${value.field}:${value.direction}` : ''}
      options={[
        { value: NONE, label: 'Default order' },
        ...fields.map((field) => ({
          group: field.name,
          items: [
            { value: `${field.name}:asc`, label: `${field.name} ascending` },
            { value: `${field.name}:desc`, label: `${field.name} descending` },
          ],
        })),
      ]}
      onValueChange={(raw) => {
        if (raw === NONE) return onChange(undefined)
        const separator = raw.lastIndexOf(':')
        onChange({
          field: raw.slice(0, separator),
          direction: raw.slice(separator + 1) === 'desc' ? 'desc' : 'asc',
        })
      }}
    />
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
      <SimpleSelect
        className="w-auto min-w-40"
        aria-label="Filter field"
        placeholder="Filter by…"
        value={field}
        options={[
          { value: NONE, label: 'No filter' },
          ...fields.map((candidate) => ({ value: candidate.name, label: candidate.name })),
        ]}
        onValueChange={(next) => {
          setField(next === NONE ? '' : next)
          setOperator('')
          setText('')
          onChange(undefined)
        }}
      />

      {selected ? (
        <>
          <SimpleSelect
            className="w-auto min-w-32"
            aria-label="Filter operator"
            placeholder="Operator"
            value={operator}
            options={operators.map((candidate) => ({ value: candidate, label: candidate }))}
            onValueChange={(next) => {
              setOperator(next)
              apply(field, next, text)
            }}
          />

          {selected.kind === 'enum' && selected.enumValues && operator !== 'in' ? (
            <SimpleSelect
              className="w-auto min-w-32"
              aria-label="Filter value"
              placeholder="Value"
              value={text}
              options={selected.enumValues.map((option) => ({ value: option, label: option }))}
              onValueChange={(next) => {
                setText(next)
                apply(field, operator, next)
              }}
            />
          ) : (
            <Input
              className="w-36"
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
        </>
      ) : null}
    </div>
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

  // Before the relation check would be wrong - a foreign key is a key whatever
  // widget it was given - but after it, a file column is drawn rather than
  // printed. A column of `2026/09/abc123-ada.png` is the bug this closes.
  if (column.widget === 'image' || column.widget === 'file') {
    return <MediaCell field={column} value={record[column.name]} />
  }

  if (link) {
    return (
      <a
        className="text-link underline-offset-4 hover:underline"
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
