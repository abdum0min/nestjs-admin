/**
 * The generic record detail screen, plus delete.
 *
 * Every field the server described is shown, in schema order, formatted by
 * kind. A to-one relation is a link to the record it names, because the server
 * now sends that record's label alongside the key. A to-many is still only
 * named: nothing loads it yet.
 */
import { deleteRecord, fetchRecord } from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import { formatDetail } from '../metadata/format.js'
import { relationLink } from '../metadata/relations.js'
import { ErrorState, Loading } from './States.jsx'

export function RecordView({
  model,
  models,
  id,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly id: string
}) {
  const state = useAsync(() => fetchRecord(model.name, id), [model.name, id])

  const onDelete = async (): Promise<void> => {
    // A native confirm keeps a destructive action behind an explicit step
    // without pulling in a modal library for one call site.
    if (!window.confirm(`Delete this ${model.name}? This cannot be undone.`)) return

    try {
      await deleteRecord(model.name, id)
      navigate({ kind: 'list', model: model.name })
    } catch (cause) {
      // Surfaced rather than swallowed: a failed delete that looks like a
      // success is the worst outcome here.
      window.alert(cause instanceof Error ? cause.message : 'The record could not be deleted.')
    }
  }

  if (state.loading) return <Loading label="Loading record…" />
  if (state.error !== undefined) return <ErrorState error={state.error} onRetry={state.reload} />
  if (!state.data) return null

  const record = state.data

  return (
    <section className="record">
      <header className="list__header">
        <div>
          <a className="record__back" href={href({ kind: 'list', model: model.name })}>
            ← {model.name}
          </a>
          <h1>
            {model.name} {id}
          </h1>
        </div>
        <div className="record__actions">
          <button type="button" onClick={() => navigate({ kind: 'edit', model: model.name, id })}>
            Edit
          </button>
          <button type="button" className="danger" onClick={() => void onDelete()}>
            Delete
          </button>
        </div>
      </header>

      <dl className="record__fields">
        {model.fields.map((field) => (
          <div key={field.name} className="record__field">
            <dt>
              {field.name}
              <span className="record__kind">
                {field.kind}
                {field.isList ? '[]' : ''}
                {field.isGenerated ? ' · generated' : ''}
                {field.relation ? ` → ${field.relation.targetModel}` : ''}
              </span>
            </dt>
            <dd>
              {field.kind === 'relation' ? (
                <RelationValue field={field} models={models} record={record} />
              ) : (
                <pre>{formatDetail(field, record[field.name])}</pre>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * A relation on the detail page.
 *
 * A to-one that is set becomes a link to the record it names. Everything else
 * says plainly what it is rather than pretending: an unset relation is a dash,
 * and a to-many is named but not listed, because 0.3.0 does not load it.
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
    return <a href={href({ kind: 'detail', model: link.model, id: link.id })}>{link.label}</a>
  }

  if (field.relation?.cardinality === 'many') {
    return <span className="muted">Related {field.relation.targetModel} records</span>
  }

  return <span className="muted">—</span>
}
