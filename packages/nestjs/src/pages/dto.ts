/**
 * A page, as the metadata document carries it.
 *
 * Discriminated by `kind` rather than by which key is present, because the
 * interface switches on it - the same shape `NavigationDto` and `WidgetDto`
 * already have, so there is one habit to learn rather than three.
 *
 * The declaration's `can` is not here, and could not be: it is a function, it
 * has already been applied, and a page this principal may not open is simply
 * absent. What arrives is the answer, never the rule.
 */
import type { ModelIcon } from '@nest-admin/core'

interface PageCommon {
  /** Its route: `'reports'` is reachable at `#/~reports`. */
  readonly path: string
  readonly title: string
  readonly description?: string
  readonly icon?: ModelIcon
}

export type PageDto =
  /** Drawn from the dashboard's widgets, fetched from `GET pages/:path`. */
  | (PageCommon & { readonly kind: 'widgets' })
  /** Drawn by a browser module the application serves. */
  | (PageCommon & { readonly kind: 'module'; readonly module: string })
  /** Drawn by a document in a sandboxed frame. */
  | (PageCommon & { readonly kind: 'embed'; readonly url: string })
