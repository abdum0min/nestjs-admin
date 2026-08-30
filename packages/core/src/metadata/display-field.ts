/**
 * Which field names a record when it has to be referred to in one line.
 *
 * A relation is stored as an id, and an id is not something a person can read.
 * An admin that renders `cmtf50g710000mocjbygyfyfr` where it means "Ada
 * Lovelace" is technically correct and useless, so every model needs one field
 * that stands for the record.
 *
 * The rule lives in Core rather than in an adapter because it is a question
 * about a *model*, not about an ORM: the same reasoning applies whatever
 * produced the metadata. Two places need the answer and must agree on it - the
 * adapter, which selects the column when loading a relation, and the metadata
 * document, which tells the UI what to render.
 */
import type { FieldMetadata, ModelMetadata } from './model.js'

/**
 * Conventional names for "the human-readable one", most specific first.
 *
 * Ordered by how strongly the name implies a label. `name` and `title` are
 * unambiguous; `email` is a real identifier people recognise; `slug` is a
 * last resort among the conventional names because it is machine-shaped, but
 * it is still readable, which an id is not.
 */
const CONVENTIONAL = ['name', 'title', 'label', 'displayName', 'username', 'email', 'slug']

/** Could this field stand in for the record in a list or a dropdown? */
function isReadable(field: FieldMetadata): boolean {
  return (
    field.kind === 'string' &&
    !field.isList &&
    !field.relation &&
    // A generated string is a cuid or a uuid: readable characters, no meaning.
    !field.isGenerated
  )
}

/**
 * Pick the field that names a record of this model.
 *
 * Order of preference:
 *
 *  1. a conventional name (`name`, `title`, ...), most specific first;
 *  2. any other unique string - unique suggests it identifies the record;
 *  3. any other plain string;
 *  4. the first primary-key field.
 *
 * The last step is the honest fallback rather than a good answer: a model with
 * nothing but an id and a timestamp has no readable field, and showing the id
 * is better than showing nothing. Adapters and applications may override the
 * result; this is the default, not a rule.
 */
export function displayFieldFor(model: ModelMetadata): string {
  const readable = model.fields.filter(isReadable)

  for (const candidate of CONVENTIONAL) {
    const match = readable.find((field) => field.name === candidate)
    if (match) return match.name
  }

  const unique = readable.find((field) => field.isUnique && !field.isId)
  if (unique) return unique.name

  const plain = readable.find((field) => !field.isId)
  if (plain) return plain.name

  return model.primaryKey[0] ?? model.fields[0]?.name ?? 'id'
}
