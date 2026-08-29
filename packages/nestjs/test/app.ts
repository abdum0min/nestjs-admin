import { AdminModule } from '../src/module.js'
import type { OrmAdapter } from '@nest-admin/core'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'

/**
 * Boot a Nest application containing only `AdminModule`.
 *
 * Uses the real Nest testing utilities and a real HTTP server, so routing,
 * dependency injection, serialisation and the exception filter are all
 * exercised rather than called directly.
 */
export async function createAdminApp(adapter: OrmAdapter): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AdminModule.forRoot({ adapter })],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}
