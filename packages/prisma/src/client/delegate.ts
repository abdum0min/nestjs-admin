/**
 * Dynamic model resolution.
 *
 * The admin addresses models by name at runtime (`"User"`), so the Prisma
 * Client's statically-typed delegates cannot be reached through their types.
 * This module is the single, deliberately narrow place where that type escape
 * happens. Nothing else in the package casts the client.
 */
import { AdapterError, ModelNotFoundError } from '@nest-admin/core'

/**
 * The subset of a Prisma model delegate the adapter uses.
 *
 * Declared structurally rather than imported from `@prisma/client`: the client
 * is generated in the consumer's project against their schema, so there is no
 * meaningful shared type to import, and depending on one would couple us to a
 * Prisma version we do not control.
 */
export interface PrismaModelDelegate {
  findMany(args?: unknown): Promise<unknown[]>
  findUnique(args: unknown): Promise<unknown>
  count(args?: unknown): Promise<number>
  create(args: unknown): Promise<unknown>
  update(args: unknown): Promise<unknown>
  delete(args: unknown): Promise<unknown>
}

const REQUIRED_METHODS = [
  'findMany',
  'findUnique',
  'count',
  'create',
  'update',
  'delete',
] as const satisfies readonly (keyof PrismaModelDelegate)[]

/**
 * Property names that must never be used as a delegate lookup key, regardless
 * of what the caller passes. Model names are validated against known metadata
 * before we get here, so this is defence in depth rather than the only guard.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Prisma exposes `model User` as `prisma.user` - the model name with only its
 * first character lower-cased. Note this is not general camelCase conversion:
 * `UserProfile` becomes `userProfile`, and `HTTPLog` becomes `hTTPLog`.
 */
export function toDelegateKey(modelName: string): string {
  if (modelName.length === 0) return modelName
  return modelName.charAt(0).toLowerCase() + modelName.slice(1)
}

/**
 * Resolve a model name to its Prisma Client delegate.
 *
 * `knownModels` is the metadata-derived allowlist. A name outside it is
 * rejected before the client is touched at all, so an attacker-controlled
 * model name can never reach arbitrary client properties.
 */
export function resolveDelegate(
  client: unknown,
  modelName: string,
  knownModels: readonly string[],
): PrismaModelDelegate {
  if (!knownModels.includes(modelName)) {
    throw new ModelNotFoundError(modelName, knownModels)
  }

  const key = toDelegateKey(modelName)
  if (FORBIDDEN_KEYS.has(key)) {
    throw new ModelNotFoundError(modelName, knownModels)
  }

  if (typeof client !== 'object' || client === null) {
    throw new AdapterError(
      'PrismaAdapter requires a constructed Prisma Client instance. ' +
        `Received ${client === null ? 'null' : typeof client}.`,
    )
  }

  // The one type escape. Guarded above by the metadata allowlist and below by
  // a shape check, so the cast is asserted rather than assumed.
  const candidate = (client as Record<string, unknown>)[key]

  if (typeof candidate !== 'object' || candidate === null) {
    throw new AdapterError(
      `The Prisma Client has no delegate "${key}" for model "${modelName}". ` +
        'This usually means the client was generated from a different schema ' +
        'than the one Nest Admin read - re-run `prisma generate`.',
    )
  }

  const delegate = candidate as Record<string, unknown>
  const missing = REQUIRED_METHODS.filter((method) => typeof delegate[method] !== 'function')
  if (missing.length > 0) {
    throw new AdapterError(
      `Prisma Client delegate "${key}" is missing expected methods: ${missing.join(', ')}.`,
    )
  }

  return candidate as PrismaModelDelegate
}
