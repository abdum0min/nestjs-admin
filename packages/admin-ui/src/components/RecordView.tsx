/**
 * The generic record detail screen, plus delete.
 *
 * Every field the server described is shown, in schema order, formatted by
 * kind. A to-one relation is a link to the record it names, because the server
 * sends that record's label alongside the key. A to-many gets its own
 * paginated section below the fields.
 */
import { ChevronRight, Copy, Pencil, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { deleteRecord, fetchRecord, restoreRecord } from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import { fieldLabel, modelLabel } from '../metadata/fields.js'
import { formatDetail } from '../metadata/format.js'
import { relationLink } from '../metadata/relations.js'
import { fieldGroups } from '../metadata/sections.js'
import { ActionRail, RailButton, WithRail } from './ActionRail.jsx'
import { Actions } from './Actions.jsx'
import { RelatedList } from './RelatedList.jsx'
import { ErrorState, FormSkeleton } from './States.jsx'
import { Alert, AlertDescription, AlertTitle } from './ui/alert.jsx'
import { Breadcrumb } from './ui/breadcrumb.jsx'
import { Button } from './ui/button.jsx'
import { Tabs } from './ui/tabs.jsx'
import { Card, CardContent } from './ui/card.jsx'
import { MediaCell } from './ui/media.jsx'
import { RichTextValue } from './ui/rich-text-lazy.jsx'
import { useConfirm } from './ui/confirm.jsx'

export function RecordView({
  model,
  models,
  id,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly id: string
}) {
  const confirm = useConfirm()
  const state = useAsync(() => fetchRecord(model.name, id), [model.name, id])
  const [failure, setFailure] = useState<unknown>(undefined)

  const onDelete = async (permanent: boolean, reversible: boolean): Promise<void> => {
    const agreed = await confirm({
      title: permanent
        ? `Delete this ${modelLabel(model)} forever?`
        : `Delete this ${modelLabel(model)}?`,
      description:
        permanent || !reversible
          ? 'This cannot be undone.'
          : 'It will be hidden from the list and can be restored later.',
      confirmLabel: permanent ? 'Delete forever' : 'Delete',
      destructive: true,
    })
    if (!agreed) return

    try {
      await deleteRecord(model.name, id, permanent)
      navigate({ kind: 'list', model: model.name })
    } catch (cause) {
      // Shown on the page rather than in a `window.alert`. A refusal here is
      // usually a constraint violation naming a field, and an alert box
      // truncates it into one unstyled line you cannot copy from.
      setFailure(cause)
    }
  }

  if (state.loading) {
    return (
      <Card>
        <CardContent className="pt-5">
          <FormSkeleton fields={Math.min(model.fields.length, 8)} />
        </CardContent>
      </Card>
    )
  }
  if (state.error !== undefined) return <ErrorState error={state.error} onRetry={state.reload} />
  if (!state.data) return null

  const record = state.data
  const title = record[model.displayField]
  const named = title === null || title === undefined || title === '' ? id : String(title)

  // A marked record is still readable at its own URL - that is how anybody
  // restores one - so this page has to say what it is looking at. Without the
  // banner it is an ordinary record that has silently left every list.
  const reversible = model.softDeleteField !== undefined
  const markedField = model.fields.find((field) => field.name === model.softDeleteField)
  const markedAt = markedField === undefined ? undefined : record[markedField.name]
  const gone = markedAt !== null && markedAt !== undefined

  const onRestore = async (): Promise<void> => {
    try {
      await restoreRecord(model.name, id)
      state.reload()
    } catch (cause) {
      setFailure(cause)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <Breadcrumb
        trail={[
          { label: 'Home', href: '#/' },
          { label: modelLabel(model), href: href({ kind: 'list', model: model.name }) },
          { label: named },
        ]}
      />

      <WithRail
        rail={
          <>
            <ActionRail>
              {model.can?.update === false ? null : (
                <RailButton onClick={() => navigate({ kind: 'edit', model: model.name, id })}>
                  <Pencil />
                  Edit
                </RailButton>
              )}

              {/* A create that starts somewhere other than empty. Offered where
                  somebody is standing when they decide the next record is like
                  this one, and only where they may create at all. */}
              {model.can?.create === false ? null : (
                <RailButton
                  variant="outline"
                  onClick={() => navigate({ kind: 'create', model: model.name, from: id })}
                >
                  <Copy />
                  Duplicate
                </RailButton>
              )}

              {model.can?.delete === false || !gone ? null : (
                <RailButton variant="outline" onClick={() => void onRestore()}>
                  <Undo2 />
                  Restore
                </RailButton>
              )}

              {/* Last, and the only one drawn as a warning. In a column it
                  cannot be mistaken for its neighbour the way it could when
                  five buttons shared a line. */}
              {model.can?.delete === false ? null : (
                <RailButton variant="destructive" onClick={() => void onDelete(gone, reversible)}>
                  <Trash2 />
                  {gone ? 'Delete forever' : 'Delete'}
                </RailButton>
              )}
            </ActionRail>

            {/* The application's own, in a card of their own: they are not
                variations on Edit and Delete, and a heading says so. */}
            {(model.actions ?? []).some((action) => action.scope === 'record') ? (
              <ActionRail title={modelLabel(model)}>
                <Actions
                  model={model}
                  scope="record"
                  id={id}
                  onDone={state.reload}
                  layout="column"
                />
              </ActionRail>
            ) : null}
          </>
        }
      >
        <header className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{named}</h1>
          <p className="text-muted-foreground font-mono text-xs">{id}</p>
        </header>

        {gone ? (
          <Alert>
            <Trash2 />
            <AlertTitle>This record is deleted</AlertTitle>
            <AlertDescription>
              {markedField === undefined
                ? 'It is hidden'
                : `Deleted ${formatDetail(markedField, markedAt)}. It is hidden`}{' '}
              from the {modelLabel(model)} list until it is restored.
            </AlertDescription>
          </Alert>
        ) : null}

        {failure === undefined ? null : <ErrorState error={failure} />}

        <RecordFields model={model} models={models} record={record} />
      </WithRail>

      {/* Each to-many relation gets its own paginated section below the
          fields. They are separate requests, so a parent with many kinds of
          child does not turn its detail page into one enormous response.

          Outside the rail: a related table is as wide as the page, and pinning
          it into the left column beside an empty rail would waste the width
          the table is the one thing here that needs. */}
      {model.fields
        .filter((field) => field.relation?.cardinality === 'many')
        .map((field) => {
          const target = models.find((candidate) => candidate.name === field.relation?.targetModel)
          if (!target) return null
          const shape = field.relation?.shape === 'many-to-many' ? 'many-to-many' : 'one-to-many'
          return (
            <RelatedList
              key={field.name}
              parent={model}
              parentId={id}
              field={field}
              target={target}
              shape={shape}
              detachBlocked={field.relation?.detachBlocked}
            />
          )
        })}
    </section>
  )
}

/**
 * The record's own fields, however the application grouped them.
 *
 * One flat list where nothing was configured, which is what this screen always
 * showed. Sections stack down the page; tabs put one group at a time in front
 * of somebody who came for that group.
 */
function RecordFields({
  model,
  models,
  record,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly record: AdminRecord
}) {
  const { layout, groups } = fieldGroups(model, model.fields)
  const [active, setActive] = useState(0)

  const rows = (fields: readonly FieldDescriptor[]) => (
    <FieldRows model={model} models={models} record={record} fields={fields} />
  )

  if (layout === 'tabs' && groups.length > 1) {
    return (
      <Card>
        <CardContent className="pt-4">
          <Tabs
            tabs={groups.map((group, index) => ({ id: String(index), label: group.heading }))}
            active={String(active)}
            onSelect={(id) => setActive(Number(id))}
          >
            <div className="pt-4">{rows(groups[active]?.fields ?? [])}</div>
          </Tabs>
        </CardContent>
      </Card>
    )
  }

  if (layout === 'flat') {
    return (
      <Card>
        <CardContent className="pt-5">{rows(groups[0]?.fields ?? [])}</CardContent>
      </Card>
    )
  }

  return (
    <>
      {groups.map((group) => (
        <Card key={group.heading}>
          <CardContent className="pt-5">
            <details open={group.collapsed !== true} className="group/section">
              <summary className="mb-3 flex cursor-pointer list-none items-center gap-2">
                <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open/section:rotate-90" />
                <span className="text-base font-semibold">{group.heading}</span>
                {group.description === undefined ? null : (
                  <span className="text-muted-foreground truncate text-sm">
                    {group.description}
                  </span>
                )}
              </summary>
              {rows(group.fields)}
            </details>
          </CardContent>
        </Card>
      ))}
    </>
  )
}

function FieldRows({
  model,
  models,
  record,
  fields,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly record: AdminRecord
  readonly fields: readonly FieldDescriptor[]
}) {
  void model

  return (
    <dl className="divide-y">
      {fields.map((field) => (
        <div
          key={field.name}
          data-slot="detail-row"
          className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[14rem_1fr] sm:gap-4"
        >
          <dt className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{fieldLabel(field)}</span>
            <span className="text-muted-foreground text-xs">
              {field.kind}
              {field.isList ? '[]' : ''}
              {field.isGenerated ? ' · generated' : ''}
              {field.relation ? ` → ${field.relation.targetModel}` : ''}
            </span>
          </dt>
          <dd className="min-w-0 text-sm">
            {field.writeOnly === true ? (
              // The value is never sent, so the blank here is not the
              // record having none. Saying which it is matters most for
              // exactly the field this exists for.
              <span className="text-muted-foreground italic">Not shown</span>
            ) : field.kind === 'relation' ? (
              <RelationValue field={field} models={models} record={record} />
            ) : field.widget === 'richtext' ? (
              // Through the editor's parser, never through innerHTML:
              // HTML out of a database, rendered on the admin's own
              // origin, is an XSS wherever anything less trusted than an
              // administrator can write that column.
              <RichTextValue value={String(record[field.name] ?? '')} />
            ) : field.widget === 'image' || field.widget === 'file' ? (
              // The key is still available - it is what the edit form
              // shows - but this page is for looking at the record, and
              // a person cannot look at `2026/09/abc123-ada.png`.
              <MediaCell field={field} value={record[field.name]} size="detail" />
            ) : (
              <span className="wrap-break-word whitespace-pre-wrap">
                {formatDetail(field, record[field.name])}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A relation on the detail page.
 *
 * A to-one that is set becomes a link to the record it names. Everything else
 * says plainly what it is rather than pretending: an unset relation is a dash,
 * and a to-many is named here and listed in its own section below.
 */
function RelationValue({
  field,
  models,
  record,
}: {
  readonly field: FieldDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly record: AdminRecord
}) {
  const link = relationLink(field, models, record)

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

  if (field.relation?.cardinality === 'many') {
    return (
      <span className="text-muted-foreground">Related {field.relation.targetModel} records</span>
    )
  }

  return <span className="text-muted-foreground">—</span>
}
