/**
 * Sample data, so the admin has something to show on first run.
 *
 * Idempotent: re-running it adds nothing and changes nothing, so it is safe to
 * call whenever the example looks empty.
 *
 * Imports the built client from `dist/`, which is why `pnpm seed` builds first.
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from './dist/generated/prisma/client.js'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

const users = [
  ['Ada Lovelace', 'ada@example.com'],
  ['Alan Turing', 'alan@example.com'],
  ['Grace Hopper', 'grace@example.com'],
  ['Linus Torvalds', 'linus@example.com'],
  ['Barbara Liskov', 'barbara@example.com'],
  ['Donald Knuth', 'knuth@example.com'],
]

const products = [
  ['Keyboard', 249.99],
  ['Mouse', 79.5],
  ['Monitor 27"', 1299],
  ['USB-C cable', 19.99],
  ['Laptop sleeve', 89],
  ['Webcam', 159.9],
]

// `email` is unique, so an upsert keyed on it is the natural no-op on re-run.
for (const [name, email] of users) {
  await prisma.user.upsert({ where: { email }, update: {}, create: { name, email } })
}

// `Product.name` is not unique, so there is no key to upsert on.
for (const [name, price] of products) {
  const existing = await prisma.product.findFirst({ where: { name } })
  if (!existing) await prisma.product.create({ data: { name, price } })
}

console.log(`User: ${await prisma.user.count()}   Product: ${await prisma.product.count()}`)
