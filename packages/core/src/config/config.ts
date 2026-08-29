/**
 * Type direction for the future project-level configuration file
 * (`nest-admin.config.ts`).
 *
 * Only the shape is declared here so that the NestJS integration and the CLI
 * can agree on it. The configuration *system* - file discovery, loading,
 * merging, validation, the `defineConfig` helper - is deliberately not built
 * yet and will live alongside this file.
 *
 * @experimental Draft contract. Expected to change during MVP implementation.
 */

export interface ResourceSelection {
  /** When present, only these model names are exposed. */
  readonly include?: readonly string[]
  /** Model names removed from the selection, applied after `include`. */
  readonly exclude?: readonly string[]
}

export interface NestAdminConfig {
  /** Base path the admin API and UI are mounted under. Defaults to `/admin`. */
  readonly path?: string
  readonly resources?: ResourceSelection
}
