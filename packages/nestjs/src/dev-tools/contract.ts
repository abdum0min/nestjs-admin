/**
 * What the developer tools are configured with, and what they hand back to the
 * module.
 *
 * Kept apart from the implementation so the module can name these types without
 * importing anything that draws an identicon or invents an email address.
 */
import type { Provider, Type } from '@nestjs/common'

export interface DevToolsOptions {
  /**
   * Run even where the deployment looks real.
   *
   * The tools refuse to start when they can see a platform variable or
   * `NODE_ENV=production`, because they write hundreds of fake records and
   * empty tables. This is the second, explicit acknowledgement - and it warns
   * on every start-up, permanently, rather than once.
   *
   * The honest use is a shared staging database that is meant to be filled with
   * demo data. There is no other one.
   */
  readonly allowInProduction?: boolean

  /**
   * Which models the tools may touch. Every model the principal may write, by
   * default.
   *
   * Worth naming when one table is real even in development - a price list
   * loaded from a supplier, a set of reference rows nobody wants regenerated.
   */
  readonly models?: readonly string[]

  /**
   * Generate pictures for image columns. On, when the admin has file storage.
   *
   * Drawn from the record rather than downloaded, and written through the same
   * storage a real upload uses - so generating data exercises the upload path
   * rather than working around it.
   */
  readonly images?: boolean

  /**
   * Take this column's value from here instead of guessing.
   *
   * Keyed `Model.field`. The escape hatch that keeps the generator from being a
   * black box: one column with a format nobody could infer - a national
   * identifier, an internal reference - should not make the whole feature
   * useless for that model.
   *
   * ```ts
   * generators: { 'Product.sku': (index) => `SKU-${1000 + index}` }
   * ```
   */
  readonly generators?: Readonly<Record<string, (index: number) => unknown>>

  /** How many records one request may create per model. Default 500. */
  readonly maxPerRun?: number
}

/**
 * What `devTools()` gives `AdminModule`.
 *
 * A partial module rather than a flag, and that is the whole gating design:
 * `AdminModule` has no static import of anything in this directory, so an
 * application that never imports `@nest-admin/nestjs/dev-tools` does not have
 * the routes, the generator or the word lists in its bundle - not disabled,
 * absent.
 */
export interface DevToolsContribution {
  readonly kind: 'nest-admin.dev-tools'
  readonly options: DevToolsOptions
  readonly controllers: readonly Type<unknown>[]
  readonly providers: readonly Provider[]
}
