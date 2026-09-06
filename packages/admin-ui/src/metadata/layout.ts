/**
 * Where each model sits on the map.
 *
 * ## Why layered, and not a physics simulation
 *
 * A force-directed graph is the obvious answer and the wrong one here. It
 * settles somewhere different on every render, so nobody can say "the box in
 * the top left" to a colleague, and a screenshot taken twice is two pictures.
 *
 * These are layers instead, by dependency: a model with no required parent goes
 * in the first column, its children in the second, and so on. That is the same
 * ordering the mock-data generator uses to decide what to create first, which
 * is not a coincidence - both are asking "what has to exist before this can".
 * It makes the picture say something: **the left edge is where a database
 * starts, and the right edge is what it accumulates.**
 *
 * Deterministic, so the same schema always draws the same map.
 *
 * ## What it does not do
 *
 * Minimise line crossings. Doing that properly is a research problem and doing
 * it badly is worse than not doing it, so within a layer the models keep schema
 * order - which at least matches the order everything else in the admin lists
 * them in.
 */
import type { FieldDescriptor, ModelDescriptor } from '../api/types.js'

export interface Box {
  readonly model: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Edge {
  readonly from: string
  readonly to: string
  /** What the pair is, for the label at the middle of the line. */
  readonly shape: 'to-one' | 'one-to-many' | 'many-to-many'
  /** A relation to the same model, which needs a loop rather than a line. */
  readonly self: boolean
}

export interface Diagram {
  readonly boxes: readonly Box[]
  readonly edges: readonly Edge[]
  readonly width: number
  readonly height: number
}

const BOX_WIDTH = 168
const HEADER = 30
const ROW = 17
/** Beyond this the box says "+n more" rather than growing without limit. */
const MAX_ROWS = 8

const COLUMN_GAP = 96
const ROW_GAP = 28
const PADDING = 24

/** How tall a box is, given how many rows it will show. */
export function boxHeight(model: ModelDescriptor): number {
  return HEADER + Math.min(model.fields.length, MAX_ROWS) * ROW + 10
}

/** The fields a box shows: the key, then relations, then the rest. */
export function boxFields(model: ModelDescriptor): readonly FieldDescriptor[] {
  const key = model.fields.filter((field) => field.isId)
  const relations = model.fields.filter((field) => field.relation !== undefined && !field.isId)
  const rest = model.fields.filter((field) => field.relation === undefined && !field.isId)

  return [...key, ...relations, ...rest].slice(0, MAX_ROWS)
}

/** Whether a box is hiding fields, and how many. */
export function hiddenCount(model: ModelDescriptor): number {
  return Math.max(0, model.fields.length - MAX_ROWS)
}

/**
 * Which models must exist before this one can.
 *
 * A *required* to-one only. An optional relation is not a dependency - a user
 * whose manager is optional does not need another user first - and treating it
 * as one would make every self-relation a cycle and flatten the picture.
 */
function parentsOf(model: ModelDescriptor, present: ReadonlySet<string>): readonly string[] {
  return model.fields
    .filter((field) => field.relation?.cardinality === 'one' && field.relation.from !== undefined)
    .filter((field) => {
      const column = model.fields.find((candidate) => candidate.name === field.relation?.from)
      return column?.isRequired === true
    })
    .map((field) => field.relation?.targetModel as string)
    .filter((target) => target !== model.name && present.has(target))
}

/** Every relation worth drawing a line for, without drawing each one twice. */
export function edgesOf(models: readonly ModelDescriptor[]): readonly Edge[] {
  const present = new Set(models.map((model) => model.name))
  const seen = new Set<string>()
  const edges: Edge[] = []

  for (const model of models) {
    for (const field of model.fields) {
      const relation = field.relation
      if (!relation || !present.has(relation.targetModel)) continue

      // Both halves describe one relationship. Keyed on the pair so the second
      // half is recognised whichever end it is read from.
      const pair = [model.name, relation.targetModel].sort().join('::')
      const key = `${pair}::${relation.name ?? field.name}`
      if (seen.has(key)) continue
      seen.add(key)

      const shape = relation.shape ?? (relation.cardinality === 'one' ? 'to-one' : 'one-to-many')

      // Drawn from the many side to the one side, so an arrow reads "belongs
      // to". A to-one is already that way round; a to-many is not.
      const [from, to] =
        relation.cardinality === 'one'
          ? [model.name, relation.targetModel]
          : [relation.targetModel, model.name]

      edges.push({ from, to, shape, self: model.name === relation.targetModel })
    }
  }

  return edges
}

/**
 * Place every model in a column, by how deep its dependencies go.
 *
 * Kahn's algorithm, with the same softening the generator uses: a cycle does
 * not fail, it is appended. A schema with two models that require each other is
 * unusual and still deserves a picture.
 */
export function layout(models: readonly ModelDescriptor[]): Diagram {
  const present = new Set(models.map((model) => model.name))
  const pending = new Map(models.map((model) => [model.name, new Set(parentsOf(model, present))]))

  const layers: string[][] = []

  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, parents]) => parents.size === 0)
      .map(([name]) => name)

    if (ready.length === 0) {
      // A cycle. Everything left goes in one column rather than nowhere.
      layers.push([...pending.keys()])
      break
    }

    layers.push(ready)
    for (const name of ready) pending.delete(name)
    for (const parents of pending.values()) {
      for (const name of ready) parents.delete(name)
    }
  }

  const byName = new Map(models.map((model) => [model.name, model]))
  const boxes: Box[] = []
  let widest = 0

  layers.forEach((layer, column) => {
    let y = PADDING

    for (const name of layer) {
      const model = byName.get(name)
      if (!model) continue

      const height = boxHeight(model)
      boxes.push({
        model: name,
        x: PADDING + column * (BOX_WIDTH + COLUMN_GAP),
        y,
        width: BOX_WIDTH,
        height,
      })
      y += height + ROW_GAP
    }

    widest = Math.max(widest, y)
  })

  return {
    boxes,
    edges: edgesOf(models),
    width: PADDING * 2 + Math.max(1, layers.length) * BOX_WIDTH + (layers.length - 1) * COLUMN_GAP,
    height: Math.max(widest + PADDING, 120),
  }
}
