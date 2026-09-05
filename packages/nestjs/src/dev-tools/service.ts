/**
 * Filling an empty admin.
 *
 * The problem this exists for is the first thirty seconds. Somebody installs
 * the package, opens `/admin`, and sees empty tables, a flat dashboard chart
 * and relation pickers with nothing in them. There is nothing to click, so
 * there is nothing to judge, and the judgement gets made anyway.
 *
 * ## Written through the adapter, not through the admin
 *
 * These are seeds, not requests. Two consequences, both deliberate:
 *
 *   - **`createdAt` can be set**, so records spread backwards through time and
 *     the dashboard chart has a shape. Through the ordinary write path a
 *     generated column is refused, which is correct for a person filling in a
 *     form and wrong for a seeder.
 *   - **Hooks do not run.** Two hundred fake users should not send two hundred
 *     welcome emails, charge anything, or call a third-party API.
 *
 * Authorization is *not* skipped. Every model goes through the same
 * `resourceAuth` boundary the HTTP routes use - the tools may only write what
 * the person driving them could have written by hand.
 */
import {
  ForbiddenError,
  InvalidQueryError,
  type AdminStorage,
  type ModelMetadata,
  type OrmAdapter,
  type RecordData,
  type RecordId,
} from '@nest-admin/core'
import { Inject, Injectable, type ExecutionContext } from '@nestjs/common'

import type { AdminService } from '../admin/service.js'
import type { AdminCapability } from '../auth/roles.js'
import { clientMessage } from '../http/exception.filter.js'
import {
  ADMIN_ADAPTER,
  ADMIN_CAPABILITIES,
  ADMIN_DEV_TOOLS,
  ADMIN_FILES,
  ADMIN_SERVICE,
} from '../tokens.js'
import type { DevToolsOptions } from './contract.js'
import { deploymentSignal } from './deployed.js'
import {
  draft,
  exclusiveLimit,
  fillOrder,
  foreignKeys,
  missingParents,
  randomFor,
} from './generate.js'
import { pictureFor, pictureKindFor } from './pictures.js'
import type { FakerLike } from './values.js'

/** What one model's run did. Both halves, like every other bulk operation here. */
export interface RunResult {
  readonly model: string
  readonly created: number
  readonly ids: readonly RecordId[]
  readonly failed: readonly { readonly reason: string; readonly count: number }[]
  /**
   * Something true about the run that is not a failure.
   *
   * So far: a one-to-one that ran out of parents. Asking for twenty profiles
   * where five users exist can only produce five, and reporting the other
   * fifteen as errors would describe a schema working correctly as a broken
   * generator.
   */
  readonly note?: string
}

export interface Batch {
  readonly at: string
  readonly runs: readonly RunResult[]
}

/** Everything the developer tools screen draws, in one answer. */
export interface DevStatus {
  readonly models: readonly {
    readonly name: string
    readonly relations: number
    readonly records: number
  }[]
  readonly totalRecords: number
  /** Which adapter this admin is running on, as it names itself. */
  readonly adapter: string
  /**
   * The database engine underneath, when the adapter can say.
   *
   * Asked because "which database am I pointed at" is the question somebody
   * has right before pressing something destructive, and a screen that only
   * named the ORM answers a different one.
   */
  readonly database?: string
  readonly environment: { readonly deployed: boolean; readonly because: readonly string[] }
  readonly faker: boolean
  readonly images: boolean
  readonly history: readonly Batch[]
}

/** What emptying everything actually did - and what it left alone. */
export interface ResetResult {
  readonly emptied: readonly {
    readonly model: string
    readonly deleted: number
    readonly remaining: number
  }[]
  /** Models this could not or would not touch, each with a reason. */
  readonly skipped: readonly { readonly model: string; readonly reason: string }[]
}

export interface Draft {
  readonly model: string
  readonly records: readonly Record<string, unknown>[]
}

/** How many batches of history to keep. Enough to answer "what did I just do". */
const HISTORY_LENGTH = 10

const DEFAULT_MAX_PER_RUN = 500
/** How many rows one truncate removes before answering. */
const TRUNCATE_BATCH = 1000

/**
 * `@faker-js/faker`, if the application installed it.
 *
 * An optional peer, resolved once. Without it the built-in word lists produce
 * data that is a little less varied and works exactly the same - "install ten
 * megabytes before you can see anything" is the sort of first step that ends an
 * evaluation.
 */
let fakerOnce: Promise<FakerLike | undefined> | undefined

export function loadFaker(): Promise<FakerLike | undefined> {
  fakerOnce ??= import('@faker-js/faker')
    .then((module) => (module as { faker?: FakerLike }).faker)
    .catch(() => undefined)

  return fakerOnce
}

@Injectable()
export class DevToolsService {
  constructor(
    // For the two questions only it can answer: which models this admin has,
    // and whether this principal may write them.
    //
    // By token, not by class: this file is compiled into its own entrypoint,
    // which in CJS carries its own copy of every class - so asking for
    // `AdminService` by name asks for an object the module never registered.
    @Inject(ADMIN_SERVICE) private readonly admin: AdminService,
    @Inject(ADMIN_ADAPTER) private readonly adapter: OrmAdapter,
    @Inject(ADMIN_DEV_TOOLS) private readonly options: DevToolsOptions,
    @Inject(ADMIN_FILES) private readonly files: { storage?: AdminStorage } | undefined,
    @Inject(ADMIN_CAPABILITIES)
    private readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean,
  ) {}

  /**
   * What has been generated since this server started, newest first.
   *
   * Held in memory, per process, and gone on restart. That is the right
   * lifetime for the thing it exists for: somebody experimenting on a database
   * that also holds rows they typed themselves. By the time they are willing to
   * restart the server they are past wanting an undo.
   *
   * Only the newest batch can be undone. The rest are history - what happened,
   * and when - because "did that run actually do anything?" is asked far more
   * often than it is answered.
   */
  #history: Batch[] = []

  private remember(runs: readonly RunResult[]): void {
    this.#history.unshift({ at: new Date().toISOString(), runs })
    this.#history = this.#history.slice(0, HISTORY_LENGTH)
  }

  /**
   * Everything the screen needs to draw itself, in one request.
   *
   * Deliberately one: a page that asks five questions to render its header
   * spends its first second half-drawn, and this one is opened dozens of times
   * a day.
   */
  async status(context: ExecutionContext): Promise<DevStatus> {
    this.assertAllowed(context)

    const models = await this.writableModels(context)
    const counted = await Promise.all(
      models.map(async (model) => ({
        name: model.name,
        // How many relations the generator will wire up on its own. Shown
        // because trusting a generator starts with knowing what it will touch.
        relations: foreignKeys(model).length,
        records: await this.countOf(model.name),
      })),
    )

    return {
      models: counted,
      totalRecords: counted.reduce((total, entry) => total + entry.records, 0),
      adapter: this.adapter.name,
      ...(this.adapter.database === undefined ? {} : { database: this.adapter.database }),
      // What the deployment check actually saw, not `NODE_ENV` alone - a card
      // that named one variable would teach the wrong rule about a gate that
      // reads a dozen.
      environment: deploymentSignal(),
      faker: (await loadFaker()) !== undefined,
      images: this.picturesEnabled(),
      history: this.#history,
    }
  }

  /** How many rows a model has. One query, and only for this screen. */
  private async countOf(model: string): Promise<number> {
    try {
      return (await this.adapter.list(model, { page: 1, perPage: 1 })).total
    } catch {
      // A model the adapter cannot count is not worth failing the page over.
      return 0
    }
  }

  /**
   * What would be written, without writing it.
   *
   * The same code path as `generate`, stopped one step short. A preview built
   * by a second function would eventually describe something other than what
   * the button does, which is worse than no preview.
   */
  async preview(
    context: ExecutionContext,
    request: { model: string; count?: number; seed?: string },
  ): Promise<Draft> {
    this.assertAllowed(context)
    const model = await this.writableModel(context, request.model)
    const count = this.countFor(request.count ?? 5)

    const parents = await this.parentIds(context, model)
    const random = randomFor(request.seed ?? 'preview', model.name)
    const faker = await this.seededFaker(request.seed)

    const records = Array.from({ length: count }, (_, index) =>
      draft({
        model,
        index,
        random,
        faker,
        parents,
        siblings: [],
        ...(this.options.generators ? { generators: this.options.generators } : {}),
      }),
    )

    return { model: model.name, records }
  }

  async generate(
    context: ExecutionContext,
    request: { model: string; count?: number; seed?: string; images?: boolean },
  ): Promise<RunResult> {
    this.assertAllowed(context)
    const model = await this.writableModel(context, request.model)

    const run = await this.fillModel(context, model, {
      count: this.countFor(request.count ?? 20),
      seed: request.seed ?? String(Date.now()),
      images: request.images ?? this.picturesEnabled(),
    })

    this.remember([run])
    return run
  }

  /**
   * Every model, in an order that satisfies the relations.
   *
   * The headline: an empty database becomes something a person can click
   * through, once, without choosing anything. Users before Posts because a
   * Post needs an author - which is read from the metadata rather than from a
   * list somebody has to maintain.
   */
  async fill(
    context: ExecutionContext,
    request: {
      /**
       * How many of each, per model. The screen sends one row per model with
       * its own number, because "twenty users and fifty products, no order
       * lines" is what people actually want and one number for everything is
       * not.
       */
      models?: readonly { readonly name: string; readonly count: number }[]
      /** The same number for every model, when no per-model list is given. */
      perModel?: number
      seed?: string
      images?: boolean
    } = {},
  ): Promise<readonly RunResult[]> {
    this.assertAllowed(context)

    const models = await this.writableModels(context)
    const seed = request.seed ?? String(Date.now())
    const images = request.images ?? this.picturesEnabled()

    const wanted = new Map(
      (request.models ?? []).map((entry) => [entry.name, this.countFor(entry.count)]),
    )
    const chosen = wanted.size > 0 ? models.filter((model) => wanted.has(model.name)) : models
    const fallback = this.countFor(request.perModel ?? 12)

    // Ordered by the relations even when the caller listed the models
    // themselves - a request that names Post before User is not a request to
    // create orphans.
    const order = fillOrder(chosen)
    const runs: RunResult[] = []

    for (const name of order) {
      const model = chosen.find((candidate) => candidate.name === name)
      if (!model) continue
      runs.push(
        await this.fillModel(context, model, {
          count: wanted.get(name) ?? fallback,
          seed,
          images,
        }),
      )
    }

    this.remember(runs)
    return runs
  }

  /**
   * Empty every model this principal may write, children first.
   *
   * The most destructive thing in the package, and the reason it is here at all
   * is that the alternative - pressing Empty ten times in the right order - is
   * both slower and easier to get wrong. Reverse dependency order, because a
   * parent cannot go while its children still point at it.
   *
   * Requires `delete` on every model it touches, and refuses without an
   * explicit acknowledgement in the body: a POST somebody triggers by accident
   * must not empty a database.
   */
  async reset(context: ExecutionContext, confirmed: boolean): Promise<ResetResult> {
    this.assertAllowed(context)

    if (!confirmed) {
      throw new InvalidQueryError(
        'Emptying every model needs { "confirm": true }. Nothing was deleted.',
      )
    }

    const models = await this.writableModels(context)
    const order = [...fillOrder(models)].reverse()
    const emptied: { model: string; deleted: number; remaining: number }[] = []

    for (const name of order) {
      try {
        const outcome = await this.truncate(context, name)
        emptied.push({ model: name, ...outcome })
      } catch (cause) {
        // A model this principal may create but not delete. Reported as
        // untouched rather than stopping the rest.
        void cause
        emptied.push({ model: name, deleted: 0, remaining: await this.countOf(name) })
      }
    }

    return { emptied, skipped: await this.untouchable(context, models) }
  }

  /**
   * What "empty everything" did not empty, and why.
   *
   * Said out loud because the button does not mean what it says, and a person
   * who believes it does will eventually be wrong about their own database. The
   * two reasons are different in kind:
   *
   *   - **Outside this admin.** `resources` decided the model is not part of it,
   *     and these tools do not cross that line. That boundary is the whole of
   *     this package's security model - crossing it here would make every
   *     `exclude` in every application a suggestion. It is also, in practice,
   *     the account table: emptying it would delete the login of the person
   *     pressing the button, permanently and with no way back through the
   *     admin.
   *   - **Not yours to delete.** The policy allows creating but not deleting,
   *     which is a real configuration and not a mistake.
   */
  private async untouchable(
    context: ExecutionContext,
    emptied: readonly ModelMetadata[],
  ): Promise<readonly { readonly model: string; readonly reason: string }[]> {
    const handled = new Set(emptied.map((model) => model.name))
    const exposed = new Set((await this.admin.schema()).map((model) => model.name))
    const declared = this.options.models

    const skipped: { model: string; reason: string }[] = []

    for (const model of await this.adapter.getModels()) {
      if (handled.has(model.name)) continue

      if (!exposed.has(model.name)) {
        skipped.push({ model: model.name, reason: 'outside this admin' })
        continue
      }
      if (declared && !declared.includes(model.name)) {
        skipped.push({ model: model.name, reason: 'not in the developer tools configuration' })
        continue
      }
      skipped.push({ model: model.name, reason: 'you may not write it' })
    }

    return skipped
  }

  /**
   * Delete what the last run created, and nothing else.
   *
   * The reason generating into a working database is not frightening. Without
   * it the only way back is to truncate, which takes the rows somebody made by
   * hand along with the fake ones.
   */
  async undo(context: ExecutionContext): Promise<readonly RunResult[]> {
    this.assertAllowed(context)

    const last = this.#history[0]
    if (!last) throw new InvalidQueryError('Nothing has been generated since this server started.')

    const results: RunResult[] = []

    // Reverse order: children were created after their parents, so they have to
    // go first or every delete hits a foreign key.
    for (const run of [...last.runs].reverse()) {
      await this.admin.authorize(context, run.model, 'delete')
      const removed: RecordId[] = []
      const failed = new Map<string, number>()

      for (const id of run.ids) {
        try {
          await this.adapter.delete(run.model, id)
          removed.push(id)
        } catch (cause) {
          const reason = clientMessage(cause)
          failed.set(reason, (failed.get(reason) ?? 0) + 1)
        }
      }

      results.push({
        model: run.model,
        created: removed.length,
        ids: removed,
        failed: [...failed].map(([reason, count]) => ({ reason, count })),
      })
    }

    // Only the newest batch is undoable, so only it leaves the history.
    this.#history = this.#history.slice(1)
    return results
  }

  /**
   * Empty one model.
   *
   * One model, named explicitly, rather than a button that empties everything.
   * Emptying a whole database is a thing somebody can do by pressing this
   * several times, and the slowness is the safety.
   */
  async truncate(
    context: ExecutionContext,
    model: string,
  ): Promise<{ readonly deleted: number; readonly remaining: number }> {
    this.assertAllowed(context)
    const metadata = await this.writableModel(context, model, 'delete')

    const key = metadata.primaryKey[0]
    if (key === undefined) {
      throw new InvalidQueryError(`"${model}" has no single-column primary key to delete by.`)
    }

    const page = await this.adapter.list(model, { page: 1, perPage: TRUNCATE_BATCH })
    let deleted = 0

    for (const record of page.data) {
      const id = record[key]
      if (id === null || id === undefined) continue
      try {
        await this.adapter.delete(model, id as RecordId)
        deleted += 1
      } catch {
        // A row another table still points at. Reported as what is left rather
        // than as a failure: the caller's next question is "how many remain".
      }
    }

    // Whatever the history described is now gone or unaccounted for.
    this.#history = []

    return { deleted, remaining: Math.max(0, page.total - deleted) }
  }

  private async fillModel(
    context: ExecutionContext,
    model: ModelMetadata,
    request: { count: number; seed: string; images: boolean },
  ): Promise<RunResult> {
    const failed = new Map<string, number>()
    const ids: RecordId[] = []

    const parents = await this.parentIds(context, model)
    const missing = missingParents(model, parents)

    if (missing.length > 0) {
      return {
        model: model.name,
        created: 0,
        ids: [],
        failed: [
          {
            reason:
              `Needs a ${missing.join(' and a ')} to point at, and there are none. ` +
              `Generate those first, or use Fill this admin, which orders them for you.`,
            count: request.count,
          },
        ],
      }
    }

    const random = randomFor(request.seed, model.name)
    const faker = await this.seededFaker(request.seed)
    const key = model.primaryKey[0]

    /*
     * A one-to-one takes its parent out of circulation, and rows already in the
     * table took theirs long before this run started.
     *
     * Seeded from what is stored, not only from what this run creates. Without
     * that, generating profiles a second time picks users who already have one
     * and every row fails on a unique constraint - which is what the example
     * application did, twice, before this read existed.
     */
    const claimed = await this.alreadyClaimed(model)
    const free = new Map(
      [...parents].map(([target, ids]) => {
        const key = foreignKeys(model).find((entry) => entry.exclusive && entry.target === target)
        const taken = key ? (claimed.get(key.column) ?? new Set()) : undefined
        return [target, taken ? ids.filter((id) => !taken.has(id)) : ids] as const
      }),
    )

    const limit = exclusiveLimit(model, free)
    const wanted = limit === undefined ? request.count : Math.min(request.count, limit)

    for (let index = 0; index < wanted; index += 1) {
      const record = draft({
        model,
        index,
        random,
        faker,
        parents,
        siblings: ids,
        claimed,
        ...(this.options.generators ? { generators: this.options.generators } : {}),
      })

      if (request.images) await this.attachPictures(model, record, `${request.seed}:${index}`)

      try {
        const created = await this.adapter.create(model.name, record as RecordData)
        const id = key === undefined ? undefined : created[key]
        if (id !== null && id !== undefined) ids.push(id as RecordId)
      } catch (cause) {
        // Grouped by reason. Two hundred rows failing the same unique
        // constraint is one fact, and printing it two hundred times buries it.
        const reason = clientMessage(cause)
        failed.set(reason, (failed.get(reason) ?? 0) + 1)
      }
    }

    return {
      model: model.name,
      created: ids.length,
      ids,
      failed: [...failed].map(([reason, count]) => ({ reason, count })),
      ...(wanted < request.count
        ? {
            note:
              `Stopped at ${wanted}: each one needs a parent of its own, and that is how ` +
              `many were free.`,
          }
        : {}),
    }
  }

  /**
   * Parents that rows already in the table have taken.
   *
   * One query per one-to-one column, and none at all for a model that has no
   * such column - which is most of them.
   */
  private async alreadyClaimed(model: ModelMetadata): Promise<Map<string, Set<unknown>>> {
    const exclusive = foreignKeys(model).filter((key) => key.exclusive)
    const claimed = new Map<string, Set<unknown>>()
    if (exclusive.length === 0) return claimed

    // Bounded: parents are read a hundred at a time, so knowing about more
    // children than that answers a question nobody asked.
    const existing = await this.adapter.list(model.name, { page: 1, perPage: 500 })

    for (const key of exclusive) {
      claimed.set(
        key.column,
        new Set(
          existing.data
            .map((row) => row[key.column])
            .filter((value) => value !== null && value !== undefined),
        ),
      )
    }

    return claimed
  }

  /**
   * Draw pictures for the columns that hold one, and store them.
   *
   * Through the same storage a real upload uses, so a generated database
   * exercises the file path rather than working around it - and so the keys in
   * those columns are keys the admin can actually serve.
   */
  private async attachPictures(
    model: ModelMetadata,
    record: Record<string, unknown>,
    seed: string,
  ): Promise<void> {
    const storage = this.storage()
    if (!storage) return

    for (const field of model.fields) {
      if (field.kind !== 'string' || field.isList) continue

      const kind = pictureKindFor(field.name, undefined)
      if (kind === undefined) continue

      const bytes = pictureFor(kind, `${seed}:${field.name}`)
      const key = `dev/${model.name.toLowerCase()}/${kind}-${seed.replace(/[^a-z0-9]+/gi, '-')}.png`

      try {
        await storage.put({
          key,
          type: 'image/png',
          bytes: (async function* () {
            yield bytes
          })(),
        })
        record[field.name] = key
      } catch {
        // Storage that is misconfigured or read-only. A record without a
        // picture is worth having; a run that stops halfway is not.
      }
    }
  }

  private storage(): AdminStorage | undefined {
    return this.files?.storage
  }

  private picturesEnabled(): boolean {
    return this.options.images !== false && this.storage() !== undefined
  }

  /**
   * Ids of every model this one needs to point at.
   *
   * Read once per run: a hundred records would otherwise be a hundred queries
   * asking a question whose answer does not change. Authorized as `list` on the
   * target, because that is what reading rows of it is - a principal who may
   * not see Users must not receive their ids through this door either.
   */
  private async parentIds(
    context: ExecutionContext,
    model: ModelMetadata,
  ): Promise<ReadonlyMap<string, readonly unknown[]>> {
    const found = new Map<string, readonly unknown[]>()

    const targets = new Set(
      model.fields
        .filter((field) => field.relation?.cardinality === 'one' && field.relation.from)
        .map((field) => field.relation?.targetModel as string)
        .filter((target) => target !== model.name),
    )

    for (const target of targets) {
      try {
        await this.admin.authorize(context, target, 'list')
      } catch {
        // Not readable by this principal. Left out, so a required relation on
        // it reports "nothing to point at" rather than quietly linking to rows
        // they were never allowed to see.
        continue
      }

      const metadata = (await this.admin.schema()).find((candidate) => candidate.name === target)
      const key = metadata?.primaryKey[0]
      if (key === undefined) continue

      const page = await this.adapter.list(target, { page: 1, perPage: 100 })
      found.set(
        target,
        page.data.map((row) => row[key]).filter((id) => id !== null && id !== undefined),
      )
    }

    return found
  }

  /** Faker, seeded to match, so a repeated seed repeats its output too. */
  private async seededFaker(seed: string | undefined): Promise<FakerLike | undefined> {
    const faker = await loadFaker()
    if (faker === undefined) return undefined

    try {
      let hash = 0
      for (const character of seed ?? 'nest-admin') hash = (hash * 31 + character.charCodeAt(0)) | 0
      faker.seed?.(Math.abs(hash))
    } catch {
      // A version whose seeding moved. The values stay believable and stop
      // being reproducible, which is the lesser of the two.
    }

    return faker
  }

  private countFor(requested: number): number {
    const max = this.options.maxPerRun ?? DEFAULT_MAX_PER_RUN
    if (!Number.isFinite(requested) || requested < 1) {
      throw new InvalidQueryError('How many records to generate must be a positive number.')
    }
    if (requested > max) {
      throw new InvalidQueryError(
        `Refusing to create ${requested} records in one request. The limit is ${max}.`,
      )
    }
    return Math.floor(requested)
  }

  /** Every model these tools may write, filtered by configuration and policy. */
  private async writableModels(context: ExecutionContext): Promise<readonly ModelMetadata[]> {
    const declared = this.options.models
    const models = await this.admin.schema()
    const allowed: ModelMetadata[] = []

    for (const model of models) {
      if (declared && !declared.includes(model.name)) continue
      try {
        await this.admin.authorize(context, model.name, 'create')
        allowed.push(model)
      } catch {
        // Not writable by this principal, so not offered. Checked again below
        // whenever one is named directly.
      }
    }

    return allowed
  }

  private async writableModel(
    context: ExecutionContext,
    name: string,
    operation: 'create' | 'delete' = 'create',
  ): Promise<ModelMetadata> {
    const declared = this.options.models
    if (declared && !declared.includes(name)) {
      throw new ForbiddenError(`The developer tools are configured not to touch "${name}".`)
    }

    await this.admin.authorize(context, name, operation)

    const model = (await this.admin.schema()).find((candidate) => candidate.name === name)
    if (!model) throw new InvalidQueryError(`No model named "${name}".`)
    return model
  }

  /**
   * The capability gate.
   *
   * Without roles every administrator has it, which is what an admin with a
   * single superuser has always meant. With roles it has to be granted, like
   * `manageTeam`.
   */
  private assertAllowed(context: ExecutionContext): void {
    if (!this.can(context, 'useDevTools')) {
      throw new ForbiddenError('This role may not use the developer tools.')
    }
  }
}
