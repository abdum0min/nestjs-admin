/**
 * Locating and reading the built admin UI.
 *
 * The UI is compiled by `apps/admin-ui` and copied into this package's `dist`
 * at build time, so a consumer who installs the published package gets the
 * interface without cloning the repository or running Vite.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the built UI sits relative to the compiled bundle.
 *
 * `import.meta.url` works in both the ESM and CJS outputs because tsup is
 * configured with `shims: true`, which rewrites it for the CJS build. Resolving
 * from the bundle rather than `process.cwd()` matters: a consumer starts their
 * application from their own directory, not ours.
 */
function moduleDirectory(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/** Absolute path of the directory holding `index.html` and `assets/`. */
export function uiRoot(): string {
  return join(moduleDirectory(), 'admin-ui')
}

/** Is a built UI actually present? */
export function uiAvailable(root: string = uiRoot()): boolean {
  return existsSync(join(root, 'index.html'))
}

/** Content types for what a Vite build emits. Anything else is a download. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

export function contentTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const extension = dot === -1 ? '' : fileName.slice(dot).toLowerCase()
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

/**
 * Read a file from the UI's `assets/` directory.
 *
 * Returns `undefined` when the file does not exist or the name tries to escape
 * the directory. Two independent guards, because serving arbitrary files off a
 * consumer's disk is the worst thing this package could do:
 *
 *  1. the name must look like a plain build artefact - no separators, no `..`;
 *  2. the resolved path must still sit inside the assets directory.
 *
 * The route only binds a single path segment, so a traversal attempt would have
 * to survive URL decoding *and* both checks.
 */
export function readAsset(fileName: string, root: string = uiRoot()): Buffer | undefined {
  if (!/^[\w.-]+$/.test(fileName) || fileName.includes('..')) return undefined

  const assetsDirectory = join(root, 'assets')
  const candidate = resolve(assetsDirectory, fileName)

  if (!candidate.startsWith(assetsDirectory + sep)) return undefined
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return undefined

  return readFileSync(candidate)
}

/** The SPA shell, or `undefined` when the UI was not bundled. */
export function readIndexHtml(root: string = uiRoot()): Buffer | undefined {
  const indexPath = join(root, 'index.html')
  return existsSync(indexPath) ? readFileSync(indexPath) : undefined
}
