/**
 * `@nest-admin/nestjs/dev-tools` - mock data, and the empty-admin problem.
 *
 * ```ts
 * import { devTools } from '@nest-admin/nestjs/dev-tools'
 *
 * AdminModule.forRoot({ adapter, auth, devTools: devTools() })
 * ```
 *
 * ## Why it is a separate entrypoint
 *
 * These tools write hundreds of records and empty tables. The first line of
 * defence is not a flag but an import: `AdminModule` has no reference to
 * anything in this directory, so an application that never imports this
 * subpath does not have the routes, the generator or the word lists in its
 * bundle. They are absent, not disabled, and absent is a promise a
 * configuration mistake cannot undo.
 *
 * Three more layers behind it: the option has to be passed, the process has to
 * not look like a deployment, and the role has to hold `useDevTools`.
 */
import { Logger, type Provider } from '@nestjs/common'

import { ADMIN_DEV_TOOLS } from '../tokens.js'
import type { DevToolsContribution, DevToolsOptions } from './contract.js'
import { DevToolsController } from './controller.js'
import { deploymentSignal } from './deployed.js'
import { DevToolsService, loadFaker } from './service.js'

export type { DevToolsOptions, DevToolsContribution } from './contract.js'

/**
 * Mount the developer tools.
 *
 * Refuses to build where the process looks deployed, which is a start-up
 * failure rather than a warning. A warning about a tool that can empty a table
 * is a warning somebody reads afterwards.
 */
export function devTools(options: DevToolsOptions = {}): DevToolsContribution {
  const signal = deploymentSignal()

  if (signal.deployed && options.allowInProduction !== true) {
    throw new Error(
      `The Nest Admin developer tools refuse to start: this looks like a deployment ` +
        `(${signal.because.join(', ')}). They generate records and can empty a table, ` +
        `so this is an error rather than a warning. Remove devTools() from this build, ` +
        `or pass devTools({ allowInProduction: true }) if the database really is a ` +
        `disposable one.`,
    )
  }

  if (signal.deployed) {
    // Every start-up, permanently. An acknowledgement that goes quiet is one
    // nobody remembers giving.
    new Logger('NestAdmin').warn(
      `Developer tools are enabled on what looks like a deployment ` +
        `(${signal.because.join(', ')}), because allowInProduction was set. ` +
        `They can generate records and empty tables.`,
    )
  }

  /*
   * Start resolving faker now rather than on the first request.
   *
   * It is a large package, and the first `import()` of it took ten seconds on
   * a cold cache - which, resolved inside a request handler, is a screen that
   * hangs the first time somebody opens the developer tools and is instant
   * afterwards. Exactly the kind of intermittent slowness nobody manages to
   * reproduce. Deliberately not awaited: whether it arrives changes only how
   * varied the generated words are.
   */
  void loadFaker()

  // The options themselves are provided by the module, from `options` below,
  // so there is one provider for `ADMIN_DEV_TOOLS` rather than two racing to be
  // last - the module has to provide it either way, because `AdminService`
  // reads it to decide whether to advertise the capability.
  const providers: Provider[] = [DevToolsService]

  return {
    kind: 'nest-admin.dev-tools',
    options,
    controllers: [DevToolsController],
    providers,
  }
}
