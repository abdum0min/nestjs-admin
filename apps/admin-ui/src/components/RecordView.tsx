/**
 * The generic record detail screen, plus delete.
 *
 * Every field the server described is shown, in schema order, formatted by
 * kind. A to-one relation is a link to the record it names, because the server
 * sends that record's label alongside the key. A to-many gets its own
 * paginated section below the fields.
 */
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { deleteRecord, fetchRecord } from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import { fieldLabel, modelLabel } from '../metadata/fields.js'
import { formatDetail } from '../metadata/format.js'
import { relationLink } from '../metadata/relations.js'
import { Actions } from './Actions.jsx'
import { RelatedList } from './RelatedList.jsx'
import { ErrorState, Loading } from './States.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent } from './ui/card.jsx'
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

  const onDelete = async (): Promise<void> => {
    const agreed = await confirm({
      title: `Delete this ${modelLabel(model)}?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!agreed) return

    try {
      await deleteRecord(model.name, id)
      navigate({ kind: 'list', model: model.name })
    } catch (cause) {
      // Shown on the page rather than in a `window.alert`. A refusal here is
      // usually a constraint violation naming a field, and an alert box
      // truncates it into one unstyled line you cannot copy from.
      setFailure(cause)
    }
  }

  if (state.loading) return <Loading label="Loading record…" />
  if (state.error !== undefined) return <ErrorState error={state.error} onRetry={state.reload} />
  if (!state.data) return null

  const record = state.data
  const title = record[model.displayField]
  const named = title === null || title === undefined || title === '' ? id : String(title)

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <a
            className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm transition-colors"
            href={href({ kind: 'list', model: model.name })}
          >
            <ArrowLeft className="size-4" />
            {modelLabel(model)}
          </a>
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
          {model.can?.delete === false ? null : (
            <Button variant="destructive" onClick={() => void onDelete()}>
              <Trash2 />
              Delete
            </Button>
          )}
        </div>
      </header>

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
                  {field.kind === 'relation' ? (
                    <RelationValue field={field} models={models} record={record} />
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
        className="text-primary underline-offset-4 hover:underline"
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
