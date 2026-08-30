import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from './generated/prisma/client.js'

/**
 * The application's database client, owned by the application.
 *
 * This is the ordinary NestJS shape: a provider that holds the client, so
 * everything else asks for it through injection rather than importing a
 * module-level singleton. `AdminModule.forRootAsync` exists for exactly this -
 * the admin needs the client, and the client is not available where the module
 * is declared.
 *
 * Prisma 7 builds a client from a driver adapter, so only the application knows
 * the provider and the connection. Nest Admin receives what is built here and
 * never constructs one.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaBetterSqlite3({
        url: process.env['DATABASE_URL'] ?? 'file:./dev.db',
      }),
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
