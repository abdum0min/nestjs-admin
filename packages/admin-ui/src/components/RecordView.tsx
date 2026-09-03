/**
 * The generic record detail screen, plus delete.
 *
 * Every field the server described is shown, in schema order, formatted by
 * kind. A to-one relation is a link to the record it names, because the server
 * sends that record's label alongside the key. A to-many gets its own
 * paginated section below the fields.
 */
import { Pencil, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { deleteRecord, fetchRecord, restoreRecord } from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import { fieldLabel, modelLabel } from '../metadata/fields.js'
import { formatDetail } from '../metadata/format.js'
import { relationLink } from '../metadata/relations.js'
import { Actions } from './Actions.jsx'
import { RelatedList } from './RelatedList.jsx'
import { ErrorState, FormSkeleton } from './States.jsx'
import { Alert, AlertDescription, AlertTitle } from './ui/alert.jsx'
import { Breadcrumb } from './ui/breadcrumb.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent } from './ui/card.jsx'
import { MediaCell } from './ui/media.jsx'
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

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{named}</h1>
          <p className="text-muted-foreground font-mono text-xs">{id}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Actions model={model} scope="record" id={id} onDone={state.reload} />
          {model.can?.update === false ? null : (
            <Button
              variant="outline"
              onClick={() => navigate({ kind: 'edit', model: model.name, id })}
            >
              <Pencil />
              Edit
            </Button>
          )}
          {model.can?.delete === false || !gone ? null : (
            <Button variant="outline" onClick={() => void onRestore()}>
              <Undo2 />
              Restore
            </Button>
          )}
          {model.can?.delete === false ? null : (
            <Button variant="destructive" onClick={() => void onDelete(gone, reversible)}>
              <Trash2 />
              {gone ? 'Delete forever' : 'Delete'}
            </Button>
          )}
        </div>
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

      <Card>
        <CardContent className="pt-5">
          <dl className="divide-y">
            {model.fields.map((field) => (
              <div
                key={field.name}
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
        </CardContent>
      </Card>

      {/* Each to-many relation gets its own paginated section below the
          fields. They are separate requests, so a parent with many kinds of
          child does not turn its detail page into one enormous response. */}
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
