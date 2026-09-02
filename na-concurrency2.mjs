import { readFileSync, writeFileSync } from 'node:fs'

const F = 'packages/nestjs/src/admin/service.ts'
let s = readFileSync(F, 'utf8')
const edit = (from, to) => {
  if (!s.includes(from)) throw new Error('no match: ' + JSON.stringify(from.slice(0, 70)))
  s = s.replace(from, to)
}

/* imports */
edit('  createdFieldFor,', '  ConflictError,\n  createdFieldFor,')
edit('  isReadOnly,', '  isReadOnly,\n  updatedFieldFor,')
edit('  ADMIN_CAPABILITIES,', '  ADMIN_CAPABILITIES,\n  ADMIN_CONCURRENCY,')

/* the injected strategy */
edit(
  `    @Inject(ADMIN_CAPABILITIES)
    private readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean,`,
  `    @Inject(ADMIN_CAPABILITIES)
    private readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean,
    @Inject(ADMIN_CONCURRENCY)
    private readonly concurrency: 'last-write-wins' | 'optimistic',`,
)

/* update takes the version the caller was working from */
edit(
  `  async update(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    data: RecordData,
  ): Promise<RecordData> {`,
  `  async update(
    context: ExecutionContext,
    model: string,
    id: RecordId,
    data: RecordData,
    /**
     * The version this write was based on, if the caller sent one.
     *
     * Only consulted under \`concurrency: 'optimistic'\`. Absent is permitted
     * rather than refused: a script that patches one field is not the collision
     * this exists for, and refusing it would break every non-browser caller the
     * moment the option is turned on.
     */
    version?: string,
  ): Promise<RecordData> {`,
)

edit(
  `    // Before the hooks run: a hook must never see a record this principal was
    // not allowed to reach.
    if (scope.length > 0) await this.readInScope(metadata, id, scope)`,
  `    // Read when either reason needs it, and only once. A hook must never see a
    // record this principal could not reach, and a stale write must be refused
    // before anything runs.
    const current =
      scope.length > 0 || this.concurrency === 'optimistic'
        ? await this.readInScope(metadata, id, scope)
        : undefined

    if (current !== undefined) this.assertFresh(metadata, current, version)`,
)

/* the check itself */
edit(
  `  /** The policy's answer for one operation, with a thrown denial read as \`false\`. */`,
  `  /**
   * Refuse a write built on a version of the record that no longer exists.
   *
   * The version is whatever the model's updated-at column held when the caller
   * read it. Two people who opened the same record hold the same value; the
   * second to save is holding a stale one, and their form carries every field,
   * so saving it would silently undo the first person's work.
   *
   * Compared as strings after normalising through \`Date\`, because the value
   * makes a round trip through JSON and a \`Date\` never comes back as one.
   *
   * Three ways this does nothing, all deliberate:
   *
   *   - the strategy is \`last-write-wins\` - the caller did not ask for it
   *   - the caller sent no version - a script, not a person in a form
   *   - the model has no updated-at column - warned about at startup
   */
  private assertFresh(
    model: ModelMetadata,
    current: RecordData,
    version: string | undefined,
  ): void {
    if (this.concurrency !== 'optimistic' || version === undefined) return

    const field = updatedFieldFor(model)
    if (field === undefined) return

    const stored = current[field]
    if (stored === null || stored === undefined) return

    if (stamp(stored) !== stamp(version)) throw new ConflictError(model.name)
  }

  /** The policy's answer for one operation, with a thrown denial read as \`false\`. */`,
)

/* the normaliser, beside the other module-level helpers */
edit(
  `function readableFields(model: ModelMetadata): readonly FieldMetadata[] {`,
  `/**
 * A timestamp as one comparable string.
 *
 * The stored value is a \`Date\`; the one that came back from the client is the
 * ISO string it was serialised to. Comparing them directly always differs, so
 * both go through \`Date\` - and anything that is not a date compares as itself,
 * which fails closed rather than passing by accident.
 */
function stamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

function readableFields(model: ModelMetadata): readonly FieldMetadata[] {`,
)

writeFileSync(F, s)
console.log('service checks freshness')
