/**
 * Serves the built admin UI.
 *
 * ## Why a separate controller
 *
 * The API and the UI share the `/admin` prefix, and `@Get(':model')` would
 * happily match `assets`. Registering these routes on their own controller,
 * listed *before* `AdminController`, makes the precedence explicit and
 * testable rather than an accident of declaration order inside one class.
 *
 * It also puts the security boundary somewhere a reader can see it: this
 * controller has **no** `AdminAuthGuard`, and `AdminController` has one.
 *
 * ## Why the UI shell is not behind authentication
 *
 * These routes return a static HTML shell and a JavaScript bundle. They contain
 * no records, no schema, and no configuration - the bundle is byte-identical
 * for every visitor and learns what exists only by calling `/admin/meta`, which
 * *is* guarded. Serving them publicly is the ordinary SPA arrangement.
 *
 * Guarding them instead would render a JSON 401 in the browser rather than a
 * page that can explain itself, and would stop a host from putting its own
 * login redirect in front of the admin. The data boundary is unchanged: an
 * unauthenticated visitor loads the shell, its first request is refused, and
 * the UI shows a signed-out state.
 *
 * ## Why there is no SPA fallback route
 *
 * The UI uses hash routing (`/admin#/User/u1`), so every deep link is still a
 * request for `/admin`. A catch-all fallback would have to match `/admin/*`,
 * which is precisely the space the API occupies - it would shadow every model
 * route. Hash routing is what keeps this to two static routes.
 */
import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common'

import { ADMIN_MOUNT_PATH, ADMIN_UI_ROOT } from '../tokens.js'
import { contentTypeFor, readAsset, renderShell } from './assets.js'

// No path here. The module registers this controller under the application's
// configured mount path through `RouterModule`, so a path on the decorator
// would nest it a second time.
@Controller()
export class AdminUiController {
  /**
   * The rendered shell, built on first use.
   *
   * It depends only on the bundled file and the mount path, and neither changes
   * while the application runs. Held on the instance rather than in a
   * module-level cache: the package ships two bundles that each inline their
   * own copy of a module, so module-level state is not shared between them.
   */
  private shell?: Buffer | undefined

  constructor(
    @Inject(ADMIN_UI_ROOT) private readonly root: string,
    @Inject(ADMIN_MOUNT_PATH) private readonly mountPath: string,
  ) {}

  /**
   * `GET /admin` - the SPA shell.
   *
   * `no-cache` rather than a long max-age: the HTML names hashed asset files,
   * so a cached shell would keep pointing at a previous deployment's bundle.
   */
  @Get()
  @Header('Cache-Control', 'no-cache')
  index(): StreamableFile {
    this.shell ??= renderShell(this.mountPath, this.root)
    const html = this.shell
    if (!html) {
      throw new NotFoundException(
        'The admin UI was not bundled with this package. ' +
          'This build is missing dist/admin-ui - see docs/publishing.md.',
      )
    }
    return new StreamableFile(html, { type: 'text/html; charset=utf-8' })
  }

  /**
   * `GET /admin/assets/:file`
   *
   * A single path segment, so a nested path cannot be requested at all; the
   * reader in `assets.ts` re-checks the name and the resolved location anyway.
   *
   * Vite emits content-hashed filenames, so these are immutable and safe to
   * cache for a long time.
   */
  @Get('assets/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  asset(@Param('file') file: string): StreamableFile {
    const contents = readAsset(file, this.root)
    if (!contents) throw new NotFoundException(`No admin UI asset named "${file}".`)

    return new StreamableFile(contents, { type: contentTypeFor(file) })
  }
}
