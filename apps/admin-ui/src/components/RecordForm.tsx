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
 *
 * ## Where a refusal is shown
 *
 * When the server names the fields a failure is about - a duplicate email, a
 * missing required value, a hook refusing one particular input - the message is
 * shown under that input rather than in a banner above the form. A banner asks
 * the person to re-read a form they have already read; a message under the box
 * is where they are already looking.
 *
 * A failure naming nothing, or naming a field this form does not show, still
 * gets the banner. It has to: the alternative is a submission that appears to
 * do nothing.
 */
import { useState } from 'react'

import { AdminApiError, createRecord, fetchRecord, updateRecord } from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import {
  fieldLabel,
  modelLabel,
  inputTypeFor,
  isEditable,
  toFormValue,
  toRequestValue,
} from '../metadata/fields.js'
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

  /**
   * Fields edited since the failure.
   *
   * A message under an input is about the value that was submitted. Once that
   * value has been changed the message is stale, so it goes - the person has
   * answered it, and leaving it there reads as though they had not.
   */
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set())

  const change = (name: string, next: string | boolean): void => {
    setValues((current) => ({ ...current, [name]: next }))
    setAnswered((current) => (current.has(name) ? current : new Set(current).add(name)))
  }

  // Which inputs the failure is about, of those this form actually shows.
  const named = error instanceof AdminApiError ? error.fields : []
  const shown = named.filter((name) => editable.some((field) => field.name === name))
  const unanswered = shown.filter((name) => !answered.has(name))

  const messageFor = (name: string): string | undefined =>
    error instanceof AdminApiError && unanswered.includes(name) ? error.message : undefined

  // The banner is the fallback, not the default: it appears only when there is
  // no input to attach the message to. Once every named input has been edited,
  // nothing is shown at all.
  const banner = error !== undefined && shown.length === 0 ? error : undefined

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    setAnswered(new Set())

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
            ← {modelLabel(model)}
          </a>
          <h1>{id === undefined ? `New ${modelLabel(model)}` : `Edit ${modelLabel(model)}`}</h1>
        </div>
      </header>

      {banner !== undefined ? <ErrorState error={banner} /> : null}

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
            error={messageFor(field.name)}
            onChange={(next) => change(field.name, next)}
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

/**
 * One labelled control.
 *
 * Every branch produces a control and a single wrapper renders it, so the
 * label, the error message and the accessibility attributes are written once
 * rather than repeated per input kind - which is how one of them ends up
 * missing from the branch nobody looked at.
 */
function FieldInput({
  field,
  model,
  models,
  value,
  error,
  onChange,
}: {
  readonly field: FieldDescriptor
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly value: string | boolean
  /** Why this value was refused, when it was. */
  readonly error?: string
  readonly onChange: (next: string | boolean) => void
}) {
  const label = `${fieldLabel(field)}${field.isRequired ? ' *' : ''}`
  const id = `field-${field.name}`
  const errorId = `${id}-error`

  /*
   * The label points at the control by id rather than wrapping it.
   *
   * Wrapping was simpler and quietly wrong once a message was added inside it:
   * a label's accessible name is its whole text content, so the refusal became
   * part of the field's *name* - "email * Another User already has this email."
   * - which is announced on every visit to the box thereafter, and drowns the
   * name it was supposed to be reading. Naming and describing are different
   * jobs; `for` and `aria-describedby` are how they stay separate.
   */
  const described =
    error === undefined ? { id } : { id, 'aria-invalid': true, 'aria-describedby': errorId }

  // A foreign key is a string field whose values are ids. Offer the records by
  // name; the picker still submits the key, so the request is unchanged.
  const relationField = relationForForeignKey(model, field.name)
  const target = models.find((candidate) => candidate.name === relationField?.relation?.targetModel)

  let control: React.ReactNode
  // A checkbox reads left of its label; everything else reads below it.
  let inline = false

  if (relationField && target) {
    control = (
      <RelationPicker
        target={target}
        value={String(value)}
        required={field.isRequired}
        inputProps={described}
        onChange={onChange}
      />
    )
  } else if (field.kind === 'enum' && field.enumValues) {
    control = (
      <select
        {...described}
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
    )
  } else if (field.widget === 'textarea' || field.widget === 'json') {
    // A widget is the application saying what the column actually holds. The
    // schema cannot tell a sentence from a password from a colour.
    control = (
      <textarea
        {...described}
        value={String(value)}
        required={field.isRequired}
        rows={field.widget === 'json' ? 8 : 4}
        spellCheck={field.widget !== 'json'}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  } else if (field.widget !== undefined && field.kind !== 'boolean') {
    control = (
      <input
        {...described}
        type={field.widget}
        value={String(value)}
        required={field.isRequired}
        // A password box must not be offered to a password manager as the
        // visitor's own credential: it belongs to someone else's record.
        {...(field.widget === 'password' ? { autoComplete: 'new-password' } : {})}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  } else if (field.kind === 'boolean') {
    inline = true
    control = (
      <input
        {...described}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  } else {
    control = (
      <input
        {...described}
        type={inputTypeFor(field)}
        value={String(value)}
        required={field.isRequired}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  const text = (
    <label className="form__label" htmlFor={id}>
      {label}
    </label>
  )

  return (
    <div className={inline ? 'form__row form__row--inline' : 'form__row'}>
      {inline ? control : text}
      {inline ? text : control}
      {error === undefined ? null : (
        <span className="form__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

function readId(model: ModelDescriptor, record: AdminRecord): string | undefined {
  const [name] = model.primaryKey
  if (name === undefined) return undefined
  const value = record[name]
  return value === null || value === undefined ? undefined : String(value)
}
