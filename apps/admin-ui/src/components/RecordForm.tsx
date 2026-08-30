/**
 * The generic create and edit form.
 *
 * One component for both, because the only differences are where the initial
 * values come from and which verb is sent. Inputs are chosen from
 * `field.kind`, and which fields appear at all is decided by metadata:
 * generated, relation and list fields are excluded, because the API rejects
 * writing them. A foreign key is not excluded - it is an ordinary scalar the
 * API does accept - but it is rendered as a picker rather than a text box, so
 * nobody is asked to paste an id.
 *
 * Client-side validation is limited to `required`. The adapter is the authority
 * on what is valid, and duplicating its rules here would create two places to
 * be wrong.
 */
import { useState } from 'react'

import { createRecord, fetchRecord, updateRecord } from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import { inputTypeFor, isEditable, toFormValue, toRequestValue } from '../metadata/fields.js'
import { relationForForeignKey } from '../metadata/relations.js'
import { RelationPicker } from './RelationPicker.jsx'
import { ErrorState, Loading } from './States.jsx'

type FormValues = Record<string, string | boolean>

export function RecordForm({
  model,
  models,
  id,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  /** Absent when creating. */
  readonly id?: string
}) {
  const editable = model.fields.filter(isEditable)

  const existing = useAsync(
    async () => (id === undefined ? undefined : await fetchRecord(model.name, id)),
    [model.name, id],
  )

  if (existing.loading) return <Loading label="Loading record…" />
  if (existing.error !== undefined) {
    return <ErrorState error={existing.error} onRetry={existing.reload} />
  }

  return (
    <Form
      model={model}
      models={models}
      editable={editable}
      id={id}
      // Remounts when the loaded record arrives, so inputs start populated
      // rather than needing an effect to sync them.
      key={id === undefined ? 'create' : `edit:${id}:${existing.data ? 'ready' : 'empty'}`}
      initial={existing.data}
    />
  )
}

function Form({
  model,
  models,
  editable,
  id,
  initial,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly editable: readonly FieldDescriptor[]
  readonly id?: string
  readonly initial?: AdminRecord
}) {
  const [values, setValues] = useState<FormValues>(() => {
    const seed: FormValues = {}
    for (const field of editable) {
      seed[field.name] =
        initial !== undefined
          ? toFormValue(field, initial[field.name])
          : // On create, a literal default from the schema is a pre-fill.
            toFormValue(field, field.defaultValue)
    }
    return seed
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)

    const body: AdminRecord = {}
    for (const field of editable) {
      const converted = toRequestValue(field, values[field.name] ?? '')
      // `undefined` means "omit" - a required field left blank on create is
      // the server's to reject, and an omitted key on PATCH means unchanged.
      if (converted !== undefined) body[field.name] = converted
    }

    try {
      const saved =
        id === undefined
          ? await createRecord(model.name, body)
          : await updateRecord(model.name, id, body)

      const savedId = id ?? readId(model, saved)
      navigate(
        savedId === undefined
          ? { kind: 'list', model: model.name }
          : { kind: 'detail', model: model.name, id: savedId },
      )
    } catch (cause) {
      setError(cause)
      setSubmitting(false)
    }
  }

  return (
    <section className="record">
      <header className="list__header">
        <div>
          <a className="record__back" href={href({ kind: 'list', model: model.name })}>
            ← {model.name}
          </a>
          <h1>{id === undefined ? `New ${model.name}` : `Edit ${model.name}`}</h1>
        </div>
      </header>

      {error !== undefined ? <ErrorState error={error} /> : null}

      <form className="form" onSubmit={(event) => void onSubmit(event)}>
        {editable.length === 0 ? (
          <p className="muted">This resource has no editable fields.</p>
        ) : null}

        {editable.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            model={model}
            models={models}
            value={values[field.name] ?? ''}
            onChange={(next) => setValues((current) => ({ ...current, [field.name]: next }))}
          />
        ))}

        <div className="form__actions">
          <button type="submit" disabled={submitting || editable.length === 0}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
          <a href={href({ kind: 'list', model: model.name })}>Cancel</a>
        </div>
      </form>
    </section>
  )
}

function FieldInput({
  field,
  model,
  models,
  value,
  onChange,
}: {
  readonly field: FieldDescriptor
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly value: string | boolean
  readonly onChange: (next: string | boolean) => void
}) {
  const label = `${field.name}${field.isRequired ? ' *' : ''}`

  // A foreign key is a string field whose values are ids. Offer the records by
  // name; the picker still submits the key, so the request is unchanged.
  const relationField = relationForForeignKey(model, field.name)
  const target = models.find((candidate) => candidate.name === relationField?.relation?.targetModel)

  if (relationField && target) {
    return (
      <label className="form__row">
        <span>{label}</span>
        <RelationPicker
          target={target}
          value={String(value)}
          required={field.isRequired}
          onChange={onChange}
        />
      </label>
    )
  }

  if (field.kind === 'enum' && field.enumValues) {
    return (
      <label className="form__row">
        <span>{label}</span>
        <select
          value={String(value)}
          required={field.isRequired}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">—</option>
          {field.enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.kind === 'boolean') {
    return (
      <label className="form__row form__row--inline">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
    )
  }

  return (
    <label className="form__row">
      <span>{label}</span>
      <input
        type={inputTypeFor(field)}
        value={String(value)}
        required={field.isRequired}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function readId(model: ModelDescriptor, record: AdminRecord): string | undefined {
  const [name] = model.primaryKey
  if (name === undefined) return undefined
  const value = record[name]
  return value === null || value === undefined ? undefined : String(value)
}
