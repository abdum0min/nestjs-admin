import type { OrmAdapter } from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { unsafeAllowAllRequests, type AdminAuth } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'

/**
 * Boot a Nest application containing only `AdminModule`.
 *
 * Uses the real Nest testing utilities and a real HTTP server, so routing,
 * dependency injection, guards, serialisation and the exception filter are all
 * exercised rather than called directly.
 *
 * `auth` defaults to the open implementation so suites that are not about
 * authentication stay readable. The auth suite passes its own.
 */
export async function createAdminApp(
  adapter: OrmAdapter,
  auth: AdminAuth = unsafeAllowAllRequests(),
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AdminModule.forRoot({ adapter, auth })],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}
