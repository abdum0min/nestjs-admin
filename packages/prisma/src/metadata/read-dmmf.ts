/**
 * Prisma schema acquisition.
 *
 * This is the ONLY module in the repository permitted to import
 * `@prisma/get-dmmf`. Everything downstream consumes the returned
 * `DMMF.Document` and nothing else, which is what keeps the eventual switch to
 * a build-time Prisma generator (see reports/002-prisma-metadata-spike.md) a
 * change to this file alone.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { AdapterError, NestAdminError } from '@nest-admin/core'
import { getDMMF } from '@prisma/get-dmmf'
import type * as DMMF from '@prisma/dmmf'

/** Paths tried, in order, when no explicit schema location is configured. */
const DEFAULT_SCHEMA_CANDIDATES = ['prisma/schema.prisma', 'prisma/schema', 'schema.prisma']

/** Raised when the Prisma schema cannot be located or read. */
export class PrismaSchemaNotFoundError extends NestAdminError {
  constructor(
    readonly triedPaths: readonly string[],
    explicit: boolean,
  ) {
    super(
      explicit
        ? `Prisma schema not found at "${triedPaths[0]}".`
        : `Could not locate a Prisma schema. Tried: ${triedPaths.join(', ')}. ` +
            'Pass `schemaPath` to PrismaAdapter if your schema lives elsewhere.',
    )
  }
}

/** Raised when Prisma rejects the schema. Carries Prisma's own validation text. */
export class PrismaSchemaInvalidError extends NestAdminError {
  constructor(
    readonly prismaMessage: string,
    options?: { cause?: unknown },
  ) {
    super(`Prisma rejected the schema:\n${prismaMessage}`, options)
  }
}

/**
 * Resolve the schema location to an absolute path.
 *
 * `schemaPath` may point at a single `.prisma` file or, since Prisma 7, at a
 * directory of `.prisma` files. Both are supported.
 */
function locateSchema(schemaPath: string | undefined, cwd: string): string {
  if (schemaPath !== undefined) {
    const absolute = resolve(cwd, schemaPath)
    if (!existsSync(absolute)) throw new PrismaSchemaNotFoundError([absolute], true)
    return absolute
  }

  const tried: string[] = []
  for (const candidate of DEFAULT_SCHEMA_CANDIDATES) {
    const absolute = resolve(cwd, candidate)
    tried.push(absolute)
    if (existsSync(absolute)) return absolute
  }
  throw new PrismaSchemaNotFoundError(tried, false)
}

/**
 * Read the schema as `[filename, content]` tuples.
 *
 * `getDMMF` accepts this shape natively (`SchemaFileInput = string |
 * Array<[filename, content]>`), so multi-file schemas need no concatenation
 * and no parsing on our side. Passing real filenames also means Prisma's
 * validation errors point at the right file.
 */
function readSchemaFiles(absolutePath: string): Array<[string, string]> {
  if (statSync(absolutePath).isDirectory()) {
    const files = readdirSync(absolutePath)
      .filter((name) => name.endsWith('.prisma'))
      .sort()
    if (files.length === 0) {
      throw new PrismaSchemaNotFoundError([join(absolutePath, '*.prisma')], true)
    }
    return files.map((name) => {
      const file = join(absolutePath, name)
      return [file, readFileSync(file, 'utf8')] as [string, string]
    })
  }

  return [[absolutePath, readFileSync(absolutePath, 'utf8')]]
}

export interface ReadDmmfOptions {
  /** Path to a `.prisma` file or a directory of them. Auto-detected if absent. */
  readonly schemaPath?: string
  /** Base directory for relative paths and auto-detection. Defaults to `process.cwd()`. */
  readonly cwd?: string
}

/**
 * Load and parse the Prisma schema into a DMMF document.
 *
 * Note the two traps this function exists to absorb:
 *
 * 1. `getDMMF` is **synchronous** and returns `DMMF.Document | GetDMMFError` -
 *    it does not throw and does not reject. Reading `.datamodel` off an error
 *    result yields a bare `TypeError` with none of Prisma's diagnostics.
 * 2. Returning empty metadata on failure would surface as an admin panel with
 *    no resources, which reads as a configuration mistake and costs hours.
 *    Every failure here is loud.
 */
export function readPrismaDmmf(options: ReadDmmfOptions = {}): DMMF.Document {
  const cwd = options.cwd ?? process.cwd()
  const absolutePath = locateSchema(options.schemaPath, cwd)

  let files: Array<[string, string]>
  try {
    files = readSchemaFiles(absolutePath)
  } catch (cause) {
    if (cause instanceof NestAdminError) throw cause
    throw new AdapterError(`Failed to read the Prisma schema at "${absolutePath}".`, { cause })
  }

  const result = getDMMF({ datamodel: files })

  if (!isDmmfDocument(result)) {
    throw new PrismaSchemaInvalidError(extractPrismaMessage(result), { cause: result.error })
  }
  return result
}

function isDmmfDocument(value: DMMF.Document | { error: Error }): value is DMMF.Document {
  return 'datamodel' in value
}

/**
 * Prisma reports validation failures as a JSON string inside `error.message`,
 * carrying an ANSI-coloured `P1012` report. Unwrap it where possible so the
 * message we surface is the one a developer would see from the Prisma CLI.
 */
function extractPrismaMessage(result: { reason: string; error: Error }): string {
  const raw = result.error?.message ?? result.reason
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
      const message = (parsed as { message: unknown }).message
      if (typeof message === 'string') return stripAnsi(message)
    }
  } catch {
    // Not JSON - fall through and use the raw text.
  }
  return stripAnsi(raw)
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}
