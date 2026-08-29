/**
 * Prisma version gate.
 *
 * Phase 1 established that `@prisma/get-dmmf` is pinned exactly and enforces
 * *its own* Prisma version's schema rules: given a Prisma 6 schema, the 7.x
 * parser rejects `url` inside `datasource` even though the schema is perfectly
 * valid for that consumer. Without a gate, that surfaces as a confusing
 * "Prisma rejected the schema" error pointing at the user's own valid file.
 *
 * The gate turns that into a statement about versions.
 *
 * ## Two deliberate design choices
 *
 * **It fails open on detection.** The client version is read from
 * `client._clientVersion`, an underscore-prefixed internal. If Prisma renames
 * or removes it, the gate silently does nothing rather than breaking every
 * consumer on an otherwise-fine upgrade. A version check that itself becomes
 * the outage is worse than no version check.
 *
 * **It compares majors only.** Minor and patch releases have not changed the
 * schema language; majors have. Pinning tighter would produce false alarms on
 * every routine bump.
 *
 * This lives in `packages/prisma`, not Core - Core must never learn what
 * Prisma is.
 */
import { NestAdminError } from '@nest-admin/core'

/**
 * Prisma majors whose schema language this adapter's pinned parser handles.
 *
 * Derived from the parser we ship (`@prisma/get-dmmf`, pinned in
 * package.json), not from what we wish were true. Widen this only after
 * testing against the new major.
 */
export const SUPPORTED_PRISMA_MAJORS: readonly number[] = [7]

/** Raised when the consumer's Prisma Client major is outside the tested range. */
export class PrismaVersionUnsupportedError extends NestAdminError {
  constructor(
    readonly clientVersion: string,
    readonly supportedMajors: readonly number[],
  ) {
    super(
      `Nest Admin ships a Prisma ${supportedMajors.join('/')} schema parser, ` +
        `but this application uses Prisma Client ${clientVersion}. ` +
        'Schema parsing would likely fail with a misleading error, so it was ' +
        'stopped here instead. Align the versions, or open an issue if ' +
        `Prisma ${clientVersion.split('.')[0]} should be supported.`,
    )
  }
}

/**
 * Read the Prisma Client version from an instance.
 *
 * Returns `undefined` when it cannot be determined - see "fails open" above.
 */
export function readClientVersion(client: unknown): string | undefined {
  if (typeof client !== 'object' || client === null) return undefined
  const version = (client as Record<string, unknown>)['_clientVersion']
  return typeof version === 'string' && version !== '' ? version : undefined
}

function majorOf(version: string): number | undefined {
  const major = Number(version.split('.')[0])
  return Number.isInteger(major) ? major : undefined
}

/**
 * Throw when the client's major is known and unsupported.
 *
 * Silent when the version is unreadable or unparseable.
 */
export function assertSupportedPrismaVersion(
  client: unknown,
  supportedMajors: readonly number[] = SUPPORTED_PRISMA_MAJORS,
): void {
  const version = readClientVersion(client)
  if (version === undefined) return

  const major = majorOf(version)
  if (major === undefined) return

  if (!supportedMajors.includes(major)) {
    throw new PrismaVersionUnsupportedError(version, supportedMajors)
  }
}
