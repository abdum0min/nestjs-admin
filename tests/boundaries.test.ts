/**
 * Architectural boundaries, enforced mechanically.
 *
 * These rules were previously kept by documentation and review. A written rule
 * decays; a failing build does not. This is a plain source scan rather than an
 * ESLint plugin because the rules are few and specific - adding a linting
 * framework to express four assertions would cost more than it protects.
 *
 * If one of these fails, the fix is almost never to relax the test.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.generated', 'build', 'coverage'])

/** Every source file under a directory, recursively. */
function sourceFiles(root: string): string[] {
  const found: string[] = []

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (SKIP_DIRECTORIES.has(entry)) continue
      const full = join(directory, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
        found.push(full)
      }
    }
  }

  walk(root)
  return found
}

/**
 * Module specifiers a file imports or re-exports.
 *
 * Matches `import ... from 'x'`, `export ... from 'x'`, bare `import 'x'` and
 * dynamic `import('x')`. Comments mentioning a package are not matched, which
 * is the point - the previous grep-based check could not tell the difference.
 */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specifiers: string[] = []

  const staticPattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g
  const barePattern = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  for (const pattern of [staticPattern, barePattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier !== undefined) specifiers.push(specifier)
    }
  }
  return specifiers
}

const isPrismaPackage = (specifier: string): boolean =>
  specifier === 'prisma' || specifier.startsWith('@prisma/')

const isNestPackage = (specifier: string): boolean => specifier.startsWith('@nestjs/')

/** Files violating a rule, reported as `relative/path -> specifier`. */
function violations(root: string, predicate: (specifier: string) => boolean): string[] {
  return sourceFiles(root).flatMap((file) =>
    importsOf(file)
      .filter(predicate)
      .map((specifier) => `${relative(repoRoot, file).replace(/\\/g, '/')} -> ${specifier}`),
  )
}

describe('packages/core is framework- and ORM-independent', () => {
  const coreSrc = join(repoRoot, 'packages/core/src')

  it('does not import any Prisma package', () => {
    expect(violations(coreSrc, isPrismaPackage)).toEqual([])
  })

  it('does not import NestJS', () => {
    expect(violations(coreSrc, isNestPackage)).toEqual([])
  })

  it('declares no runtime dependencies', () => {
    const manifest: { dependencies?: Record<string, string> } = JSON.parse(
      readFileSync(join(repoRoot, 'packages/core/package.json'), 'utf8'),
    )
    expect(manifest.dependencies ?? {}).toEqual({})
  })
})

describe('the NestJS HTTP layer is ORM-independent', () => {
  const nestSrc = join(repoRoot, 'packages/nestjs/src')

  it('does not import any Prisma package', () => {
    expect(violations(nestSrc, isPrismaPackage)).toEqual([])
  })

  /**
   * `src/prisma.ts` is the published `./prisma` subpath and exists only to
   * re-export the adapter to consumers - a packaging concern. Every other file
   * must reach the ORM through Core's `OrmAdapter` contract.
   */
  it('reaches the adapter only through the published subpath', () => {
    const offenders = sourceFiles(nestSrc)
      .filter((file) => !file.endsWith(`${join('src', 'prisma.ts')}`))
      .flatMap((file) =>
        importsOf(file)
          .filter((specifier) => specifier.startsWith('@nest-admin/prisma'))
          .map((specifier) => `${relative(repoRoot, file).replace(/\\/g, '/')} -> ${specifier}`),
      )

    expect(offenders).toEqual([])
  })
})

describe('@prisma/get-dmmf stays confined to the metadata reader', () => {
  it('is imported by exactly one module', () => {
    const importers = sourceFiles(join(repoRoot, 'packages'))
      .filter((file) => importsOf(file).some((specifier) => specifier === '@prisma/get-dmmf'))
      .map((file) => relative(repoRoot, file).replace(/\\/g, '/'))

    expect(importers).toEqual(['packages/prisma/src/metadata/read-dmmf.ts'])
  })
})
