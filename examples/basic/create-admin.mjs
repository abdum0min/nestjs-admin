/**
 * Create the first admin account.
 *
 * The admin deliberately cannot do this itself - an admin that mints its own
 * administrators is an escalation waiting for a mistake in a policy - so
 * seeding is the application's job, and this is what that looks like.
 *
 *   node create-admin.mjs admin@example.com "a good password"
 *
 * Re-running it with the same address updates the password rather than
 * failing, which is also how you reset one.
 */
import path from 'node:path'

import { hashAdminPassword } from '@nest-admin/nestjs'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from './dist/generated/prisma/client.js'

const [email, password] = process.argv.slice(2)

if (!email || !password) {
  console.error('Usage: node create-admin.mjs <email> <password>')
  process.exit(1)
}

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? 'file:' + path.join(process.cwd(), 'dev.db'),
  }),
})

// Lower-cased on the way in, because the store looks it up that way - someone
// who registered as `Ada@example.com` will type `ada@example.com` eventually.
const account = await prisma.adminAccount.upsert({
  where: { email: email.trim().toLowerCase() },
  update: { passwordHash: await hashAdminPassword(password), disabled: false },
  create: {
    email: email.trim().toLowerCase(),
    name: email.split('@')[0],
    passwordHash: await hashAdminPassword(password),
  },
})

console.log(`Admin account ready: ${account.email}`)
await prisma.$disconnect()
