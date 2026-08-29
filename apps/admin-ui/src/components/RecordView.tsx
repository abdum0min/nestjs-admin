/**
 * The generic record detail screen, plus delete.
 *
 * Every field the server described is shown, in schema order, formatted by
 * kind. Relations are rendered as a summary rather than a link: the list
 * endpoint has no relation filter, so a link would promise navigation the API
 * cannot serve.
 */
import { deleteRecord, fetchRecord } from '../api/client.js'
import type { ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import { formatDetail } from '../metadata/format.js'
import { ErrorState, Loading } from './States.jsx'

export function RecordView({
  model,
  id,
}: {
  readonly model: ModelDescriptor
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
                <span className="muted">
                  {field.relation?.cardinality === 'many'
                    ? `Related ${field.relation.targetModel} records`
                    : `Related ${field.relation?.targetModel ?? 'record'}`}
                </span>
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
