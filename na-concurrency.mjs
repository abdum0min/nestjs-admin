import { readFileSync, writeFileSync } from 'node:fs'

const TICK = String.fromCharCode(96)
const patch = (file, edits) => {
  let s = readFileSync(file, 'utf8')
  for (const [from, to] of edits) {
    if (!s.includes(from)) throw new Error(`${file}: no match ${JSON.stringify(from.slice(0, 70))}`)
    s = s.replace(from, to)
  }
  writeFileSync(file, s)
  console.log('patched ' + file)
}

/* ------------------------------------------------------------ the token */

patch('packages/nestjs/src/tokens.ts', [
  [
    'export const ADMIN_TEAM',
    `/**
 * Whether a write must carry the version it was based on.
 *
 * A string rather than a boolean so the option reads as a choice between two
 * strategies, which is what it is - and so a third could be added without
 * changing its shape.
 */
export const ADMIN_CONCURRENCY = Symbol.for('nest-admin.concurrency')

export const ADMIN_TEAM`,
  ],
])

/* ------------------------------------------------------- the module option */

patch('packages/nestjs/src/module.ts', [
  ['  ADMIN_CAPABILITIES,', '  ADMIN_CAPABILITIES,\n  ADMIN_CONCURRENCY,'],
  [
    '  readonly roleOf?: RoleResolver',
    `  readonly roleOf?: RoleResolver

  /**
   * What happens when two people edit the same record.
   *
   * \`'last-write-wins'\` is the default and is what the admin has always done:
   * the second save overwrites the first, and neither person is told. That is
   * fine while there is one administrator, and this release is the one that
   * stops being true.
   *
   * \`'optimistic'\` refuses a write whose version no longer matches the stored
   * one, with a 409 and nothing applied. It needs a field the schema updates on
   * every write - \`updatedAt\` and its usual spellings - and warns at startup
   * for every model that has none, because a guard nobody can see is not a
   * guard.
   *
   * Opt-in, because turning it on can refuse a write that succeeds today, and
   * "zero configuration behaves exactly as before" is a rule this release is
   * not going to break for a default.
   */
  readonly concurrency?: 'last-write-wins' | 'optimistic'`,
  ],
  [
    '      { provide: ADMIN_TEAM, useValue: resolveTeam(options) },',
    `      { provide: ADMIN_TEAM, useValue: resolveTeam(options) },
      { provide: ADMIN_CONCURRENCY, useValue: options.concurrency ?? 'last-write-wins' },`,
  ],
  [
    '        derive(ADMIN_TEAM, (resolved) => resolveTeam(resolved)),',
    `        derive(ADMIN_TEAM, (resolved) => resolveTeam(resolved)),
        derive(ADMIN_CONCURRENCY, (resolved) => resolved.concurrency ?? 'last-write-wins'),`,
  ],
])

/* --------------------------------------------------------------- the check */

const VERSION_DOC = [
  '  /**',
  '   * The version a write was based on, if the caller sent one.',
  '   *',
  '   * A header rather than a body key: the body is validated field by field,',
  '   * and a reserved key there would collide with a schema that happens to',
  `   * contain a column of that name. Headers have no such problem.`,
  '   */',
].join('\n')

patch('packages/nestjs/src/admin/service.ts', [
  ['  ADMIN_CAPABILITIES,', '  ADMIN_CAPABILITIES,\n  ADMIN_CONCURRENCY,'],
  [
    '  updatedFieldFor,',
    '  updatedFieldFor,',
  ],
  [
    '    @Inject(ADMIN_CAPABILITIES)\n    private readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean,',
    "    @Inject(ADMIN_CAPABILITIES)\n    private readonly can: (context: ExecutionContext, capability: AdminCapability) => boolean,\n    @Inject(ADMIN_CONCURRENCY)\n    private readonly concurrency: 'last-write-wins' | 'optimistic',",
  ],
  [
    `    // Before the hooks run: a hook must never see a record this principal was
    // not allowed to reach.
    if (scope.length > 0) await this.readInScope(metadata, id, scope)`,
    `    // Before the hooks run: a hook must never see a record this principal was
    // not allowed to reach.
    const current =
      scope.length > 0 || this.concurrency === 'optimistic'
        ? await this.readInScope(metadata, id, scope)
        : undefined

    if (current !== undefined) this.assertNotStale(metadata, current, version)`,
  ],
])
