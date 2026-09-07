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
import { ChevronRight, Wand2 } from 'lucide-react'
import { useState } from 'react'

import {
  AdminApiError,
  createRecord,
  devPreview,
  fetchRecord,
  updateRecord,
} from '../api/client.js'
import type { AdminRecord, FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { href, navigate } from '../hooks/use-route.js'
import {
  fieldLabel,
  inputTypeFor,
  isEditable,
  modelLabel,
  toFormValue,
  toRequestValue,
} from '../metadata/fields.js'
import { relationForForeignKey } from '../metadata/relations.js'
import { errorCount, fieldGroups, groupWithError } from '../metadata/sections.js'
import { ActionRail, RailButton, WithRail } from './ActionRail.jsx'
import { cn } from '../lib/utils.js'
import { RelationPicker } from './RelationPicker.jsx'
import { ErrorState, FormSkeleton } from './States.jsx'
import { Breadcrumb } from './ui/breadcrumb.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent } from './ui/card.jsx'
import { Checkbox } from './ui/checkbox.jsx'
import { FileField } from './ui/file-field.jsx'
import { DatePicker } from './ui/date-picker.jsx'
import { Input } from './ui/input.jsx'
import { PasswordInput } from './ui/password-input.jsx'
import { RichTextField } from './ui/rich-text-lazy.jsx'
import { Tabs } from './ui/tabs.jsx'
import { SimpleSelect } from './ui/select.jsx'
import { Textarea } from './ui/textarea.jsx'

type FormValues = Record<string, string | boolean>

export function RecordForm({
  model,
  models,
  id,
  from,
  canFill = false,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  /** Absent when creating. */
  readonly id?: string
  /**
   * A record to copy the starting values from, when creating.
   *
   * "Duplicate this" is a create that begins somewhere other than empty.
   */
  readonly from?: string
  /** Whether to offer the developer tools' one-click example values. */
  readonly canFill?: boolean
}) {
  const editable = model.fields.filter(isEditable)

  // One request for two purposes: the record being edited, or the record being
  // copied. They differ in what is done with the result, not in how it arrives.
  const source = id ?? from

  const existing = useAsync(
    async () => (source === undefined ? undefined : await fetchRecord(model.name, source)),
    [model.name, source],
  )

  if (existing.loading) {
    return (
      <Card>
        <CardContent className="pt-5">
          <FormSkeleton fields={Math.min(editable.length || 5, 8)} />
        </CardContent>
      </Card>
    )
  }
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
      key={source === undefined ? 'create' : `${id ?? from}:${existing.data ? 'ready' : 'empty'}`}
      initial={id === undefined ? withoutIdentity(editable, existing.data) : existing.data}
      canFill={canFill && id === undefined}
    />
  )
}

/**
 * A copied record, with the parts that must not be copied removed.
 *
 * Unique columns are the whole of it: a duplicate that carried the original's
 * email or slug is a create the database refuses, and the person is left
 * clearing a field they did not know was the problem. The id and everything
 * generated are absent already - they are not editable, so they were never in
 * the form.
 *
 * Relations are kept on purpose. A copy of a post belongs to the same author;
 * that is what makes the copy useful.
 */
function withoutIdentity(
  editable: readonly FieldDescriptor[],
  record: AdminRecord | undefined,
): AdminRecord | undefined {
  if (record === undefined) return undefined

  const copy: AdminRecord = { ...record }
  for (const field of editable) {
    if (field.isUnique) delete copy[field.name]
  }
  return copy
}

/**
 * The value this form was opened with, for the field the server nominated.
 *
 * `undefined` whenever the server did not name one - either the guard is off
 * or the model has no column recording a change - and the header is then not
 * sent at all.
 */
function versionOf(model: ModelDescriptor, initial: AdminRecord | undefined): string | undefined {
  const field = model.versionField
  if (field === undefined || initial === undefined) return undefined

  const value = initial[field]
  return value === null || value === undefined ? undefined : String(value)
}

function Form({
  model,
  models,
  editable,
  id,
  initial,
  canFill = false,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly editable: readonly FieldDescriptor[]
  readonly id?: string
  readonly initial?: AdminRecord
  readonly canFill?: boolean
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

  /**
   * The record this form is currently a change to.
   *
   * The prop, until "Save and continue editing" replaces it with what came
   * back. Two things depend on that: the version stamp the next save sends -
   * which has to be the one the database now holds, or the second save is
   * refused as stale - and the values themselves, because a hook may have
   * derived a slug or normalised an address and the form should show what was
   * actually stored.
   */
  const [baseline, setBaseline] = useState<AdminRecord | undefined>(initial)

  const [submitting, setSubmitting] = useState(false)
  const [filling, setFilling] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  /**
   * Fill every box with believable values.
   *
   * The generator's dry run - the same code path that writes records, asked for
   * one and stopped before the write. Testing a form by hand means typing
   * twelve fields, and doing it forty times is how a form stops being tested.
   *
   * Only on create. Offering it while editing would put a button that discards
   * somebody's record beside the button that saves it.
   */
  const fill = async (): Promise<void> => {
    setFilling(true)
    setError(undefined)
    try {
      const { records } = await devPreview({ model: model.name, count: 1 })
      const drafted = records[0]
      if (drafted === undefined) return

      setValues((current) => {
        const next = { ...current }
        for (const field of editable) {
          // Only the fields it produced a value for. A relation the generator
          // had nothing to point at stays as the person left it.
          if (drafted[field.name] !== undefined) {
            next[field.name] = toFormValue(field, drafted[field.name])
          }
        }
        return next
      })
    } catch (cause) {
      setError(cause)
    } finally {
      setFilling(false)
    }
  }

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

  /**
   * Save.
   *
   * `stay` is "Save and continue editing": on a form long enough to need
   * sections, being thrown back to the record after every save means opening
   * it again and finding your place again. The record still has to be re-read
   * afterwards - a hook may have changed it, and the version the next save
   * sends has to be the one the database now holds.
   */
  const onSubmit = async (event: React.FormEvent, stay = false): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    setAnswered(new Set())

    const body: AdminRecord = {}
    for (const field of editable) {
      const raw = values[field.name] ?? ''

      /*
       * A blank write-only field is left out entirely.
       *
       * It is never sent back, so the box is always empty when a form opens -
       * which means "blank" cannot mean "clear it". On a password that
       * distinction is the whole thing: the ordinary rule would send `null`
       * and wipe the password of every record anyone opened and saved.
       */
      if (field.writeOnly === true && raw === '') continue

      const converted = toRequestValue(field, raw)
      // `undefined` means "omit" - a required field left blank on create is
      // the server's to reject, and an omitted key on PATCH means unchanged.
      if (converted !== undefined) body[field.name] = converted
    }

    try {
      const saved =
        id === undefined
          ? await createRecord(model.name, body)
          : await updateRecord(model.name, id, body, versionOf(model, baseline))

      const savedId = id ?? readId(model, saved)

      if (stay && savedId !== undefined) {
        setBaseline(saved)
        setValues(() => {
          const next: FormValues = {}
          for (const field of editable) next[field.name] = toFormValue(field, saved[field.name])
          return next
        })
        setSubmitting(false)
        // A create that stays becomes an edit of what it created, so the next
        // save updates that record rather than making a second one.
        if (id === undefined) navigate({ kind: 'edit', model: model.name, id: savedId })
        return
      }

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
    <section className="flex w-full flex-col gap-4">
      <Breadcrumb
        trail={[
          { label: 'Home', href: '#/' },
          { label: modelLabel(model), href: href({ kind: 'list', model: model.name }) },
          { label: id === undefined ? 'Create new' : 'Edit' },
        ]}
      />

      <WithRail
        rail={
          <ActionRail>
            {/* Outside the form element, and attached to it by `form`. One
                Save, wherever the rail happens to be on this screen size -
                two would have to stay in step about being disabled, and
                would not. */}
            <RailButton type="submit" form={FORM_ID} disabled={submitting || editable.length === 0}>
              {submitting ? 'Saving…' : 'Save'}
            </RailButton>

            {editable.length === 0 ? null : (
              <RailButton
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={(event: React.MouseEvent) => void onSubmit(event, true)}
              >
                Save and continue editing
              </RailButton>
            )}

            <RailButton variant="ghost" asChild>
              <a
                href={
                  id === undefined
                    ? href({ kind: 'list', model: model.name })
                    : href({ kind: 'detail', model: model.name, id })
                }
              >
                Cancel
              </a>
            </RailButton>

            {/* Quiet, and separated. It is a convenience for whoever is
                building the thing, not a step in filling the form in. */}
            {canFill ? (
              <RailButton
                type="button"
                variant="ghost"
                className="border-t pt-3"
                disabled={filling || submitting}
                onClick={() => void fill()}
              >
                <Wand2 />
                {filling ? 'Filling…' : 'Fill with example data'}
              </RailButton>
            ) : null}
          </ActionRail>
        }
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {id === undefined ? `New ${modelLabel(model)}` : `Edit ${modelLabel(model)}`}
          </h1>
        </header>

        {banner !== undefined ? <ErrorState error={banner} /> : null}

        <form id={FORM_ID} className="contents" onSubmit={(event) => void onSubmit(event)}>
          {editable.length === 0 ? (
            <Card>
              <CardContent className="pt-5">
                <p className="text-muted-foreground text-sm">
                  This resource has no editable fields.
                </p>
              </CardContent>
            </Card>
          ) : (
            <FormFields
              model={model}
              models={models}
              editable={editable}
              values={values}
              editing={id !== undefined}
              errorFor={messageFor}
              onChange={change}
            />
          )}
        </form>
      </WithRail>
    </section>
  )
}

/** The id the rail's Save points at. One form per screen, so one id. */
const FORM_ID = 'nest-admin-record-form'

/**
 * The inputs, however the application grouped them.
 *
 * The grouping is shared with the read view, so a field sits under the same
 * heading whether you are looking at it or changing it.
 *
 * ## A group is never allowed to hide a problem
 *
 * Both arrangements can put a field out of sight, and a form that refuses to
 * save while the reason is behind a folded section or an unselected tab is the
 * failure every grouped form has. So a section holding an error is forced
 * open, the tab holding the first one is selected, and every tab carries a
 * count of what is wrong inside it.
 */
function FormFields({
  model,
  models,
  editable,
  values,
  editing,
  errorFor,
  onChange,
}: {
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly editable: readonly FieldDescriptor[]
  readonly values: FormValues
  readonly editing: boolean
  readonly errorFor: (field: string) => string | undefined
  readonly onChange: (field: string, value: string | boolean) => void
}) {
  const { layout, groups } = fieldGroups(model, editable)

  const errors: Record<string, string> = {}
  for (const field of editable) {
    const message = errorFor(field.name)
    if (message !== undefined) errors[field.name] = message
  }

  const broken = groupWithError(groups, errors)
  const [chosen, setChosen] = useState(0)
  // The tab the person picked, unless something on another one is stopping the
  // save. Their choice is about reading; an error is about being unable to
  // finish, and that wins.
  const active = broken ?? chosen

  const inputs = (fields: readonly FieldDescriptor[]) => (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {fields.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          model={model}
          models={models}
          value={values[field.name] ?? ''}
          error={errorFor(field.name)}
          editing={editing}
          onChange={(next) => onChange(field.name, next)}
        />
      ))}
    </div>
  )

  if (layout === 'tabs' && groups.length > 1) {
    return (
      <Card>
        <CardContent className="pt-4">
          <Tabs
            tabs={groups.map((group, index) => {
              const count = errorCount(group, errors)
              return {
                id: String(index),
                label: group.heading,
                ...(count > 0 ? { marker: String(count), alarming: true } : {}),
              }
            })}
            active={String(active)}
            onSelect={(id) => setChosen(Number(id))}
          >
            <div className="pt-5">{inputs(groups[active]?.fields ?? [])}</div>
          </Tabs>
        </CardContent>
      </Card>
    )
  }

  if (layout === 'flat') {
    return (
      <Card>
        <CardContent className="pt-5">{inputs(groups[0]?.fields ?? [])}</CardContent>
      </Card>
    )
  }

  return (
    <>
      {groups.map((group, index) => (
        <Card key={group.heading}>
          <CardContent className="pt-5">
            <details
              // Forced open where something inside it is wrong, whatever the
              // application said about starting folded.
              open={group.collapsed !== true || errorCount(group, errors) > 0}
              className="group/section"
            >
              <summary className="mb-4 flex cursor-pointer list-none items-center gap-2">
                <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open/section:rotate-90" />
                <span className="text-base font-semibold">{group.heading}</span>
                {group.description === undefined ? null : (
                  <span className="text-muted-foreground truncate text-sm">
                    {group.description}
                  </span>
                )}
                {errorCount(group, errors) > 0 ? (
                  <span className="bg-destructive text-destructive-foreground ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                    {errorCount(group, errors)}
                  </span>
                ) : null}
              </summary>
              {inputs(group.fields)}
              {index === 0 ? null : null}
            </details>
          </CardContent>
        </Card>
      ))}
    </>
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
  editing,
  onChange,
}: {
  readonly field: FieldDescriptor
  readonly model: ModelDescriptor
  readonly models: readonly ModelDescriptor[]
  readonly value: string | boolean
  /** Why this value was refused, when it was. */
  readonly error?: string
  /** Editing an existing record rather than creating one. */
  readonly editing: boolean
  readonly onChange: (next: string | boolean) => void
}) {
  const label = `${fieldLabel(field)}${field.isRequired ? ' *' : ''}`
  const id = `field-${field.name}`
  const errorId = `${id}-error`
  const labelId = `${id}-label`

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
  // A field with a paragraph in it takes the whole row: a narrow textarea is
  // worse than a wide one, and a relation picker needs room for its results.
  let wide = false

  if (relationField && target) {
    wide = true
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
      <SimpleSelect
        {...described}
        value={String(value)}
        placeholder="Choose…"
        options={field.enumValues.map((option) => ({ value: option, label: option }))}
        onValueChange={onChange}
      />
    )
  } else if (field.kind === 'datetime') {
    // A calendar drawn by this design system rather than by the operating
    // system, which draws its own in its own font and its own light palette.
    // The value on the wire is unchanged - see date-picker.tsx.
    control = (
      <DatePicker
        {...described}
        value={String(value)}
        required={field.isRequired}
        onChange={onChange}
      />
    )
  } else if (field.widget === 'file' || field.widget === 'image') {
    // The column holds a storage key. The widget turns it into something a
    // person can see, replace and remove; `accept` and `maxSize` come from the
    // metadata and are checked again on the server, from the bytes.
    control = (
      <FileField
        {...described}
        value={String(value)}
        image={field.widget === 'image'}
        {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
        {...(field.accept ? { accept: field.accept } : {})}
        {...(field.maxSize === undefined ? {} : { maxSize: field.maxSize })}
        onChange={onChange}
      />
    )
  } else if (field.widget === 'richtext') {
    // The column holds HTML. The editor is its own chunk, so a schema without
    // one of these never downloads it.
    wide = true
    control = (
      <RichTextField
        {...described}
        value={String(value)}
        onChange={onChange}
        // `htmlFor` names a form control, and this one is a div with
        // `role="textbox"`, which `for` does not reach. Without this the editor
        // has no accessible name at all.
        aria-labelledby={labelId}
      />
    )
  } else if (field.widget === 'textarea' || field.widget === 'json') {
    wide = true
    // A widget is the application saying what the column actually holds. The
    // schema cannot tell a sentence from a password from a colour.
    control = (
      <Textarea
        {...described}
        value={String(value)}
        required={field.isRequired}
        rows={field.widget === 'json' ? 8 : 4}
        spellCheck={field.widget !== 'json'}
        className={field.widget === 'json' ? 'font-mono text-xs' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  } else if (field.widget === 'password') {
    control = (
      <PasswordInput
        {...described}
        value={String(value)}
        // Never required on an edit: leaving it blank means "keep the one
        // already stored", which `onSubmit` turns into an omitted key.
        required={field.isRequired && !editing}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  } else if (field.widget !== undefined && field.kind !== 'boolean') {
    control = (
      <Input
        {...described}
        type={field.widget}
        value={String(value)}
        required={field.isRequired}
        className={field.widget === 'color' ? 'h-9 w-20 p-1' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  } else if (field.kind === 'boolean') {
    inline = true
    control = (
      <Checkbox
        {...described}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  } else {
    control = (
      <Input
        {...described}
        type={inputTypeFor(field)}
        value={String(value)}
        required={field.isRequired}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  const text = (
    <label className="text-sm font-medium" id={labelId} htmlFor={id}>
      {label}
    </label>
  )

  return (
    <div
      data-slot="field"
      className={cn(
        inline ? 'flex flex-wrap items-center gap-2' : 'flex flex-col gap-1.5',
        wide && 'lg:col-span-2',
      )}
    >
      {inline ? control : text}
      {inline ? text : control}
      {error === undefined ? null : (
        <span
          className={inline ? 'text-destructive w-full text-sm' : 'text-destructive text-sm'}
          id={errorId}
          role="alert"
        >
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
