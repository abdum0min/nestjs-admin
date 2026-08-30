/**
 * Sample data, so the admin has something worth looking at.
 *
 * ## Deterministic, not random
 *
 * Faker is seeded with a fixed number, so every run of this script produces
 * byte-identical data. That matters more than variety: two people looking at
 * the same bug need to be looking at the same rows, and "it works on my seed"
 * is not a thing anyone should have to say.
 *
 * A handful of records at the top are hand-written rather than generated, for
 * the same reason. Searching for "Ada Lovelace" and finding her is a better
 * test than searching for whatever name faker produced this time.
 *
 * ## It resets first
 *
 * Every table is emptied before anything is inserted. `examples/basic/dev.db`
 * is a throwaway file that `pnpm prisma:setup` already recreates whenever the
 * schema changes; making the seed idempotent by upserting eleven models with
 * relations would be considerably more machinery than the problem has.
 *
 * ## Volume
 *
 * Enough for the interface to be exercised rather than merely populated:
 * more than one page of most models, so pagination is real; several hundred
 * relation rows, so the related lists have something to page through; and
 * names that overlap, so search returns a set rather than a row.
 *
 * Imports the built client from `dist/`, which is why `pnpm seed` builds first.
 */
import { faker } from '@faker-js/faker'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from './dist/generated/prisma/client.js'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

faker.seed(20260830)

/** Pick `count` distinct members of `items`. */
const sample = (items, count) => faker.helpers.arrayElements(items, Math.min(count, items.length))
const one = (items) => faker.helpers.arrayElement(items)
const maybe = (probability, value) => (faker.number.float() < probability ? value : null)

/**
 * Emptied in dependency order, children before parents.
 *
 * The three self-relations need two passes each: SQLite checks foreign keys
 * per row, so a single DELETE over a table that references itself can fail
 * halfway through depending on the order rows happen to come back in.
 */
async function reset() {
  await prisma.comment.deleteMany({ where: { parentId: { not: null } } })
  await prisma.comment.deleteMany()
  await prisma.review.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  // Implicit many-to-many join rows cascade from either side, so Post and
  // Product carry their tag links away with them.
  await prisma.post.deleteMany()
  await prisma.product.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.category.deleteMany({ where: { parentId: { not: null } } })
  await prisma.category.deleteMany()
  await prisma.user.deleteMany({ where: { managerId: { not: null } } })
  await prisma.user.deleteMany()
}

// ---------------------------------------------------------------- categories

/**
 * A two-level tree. Deep enough that "parent" and "children" are both
 * populated on the middle rows, which is the case a link and a related list
 * are both drawn for.
 */
const CATEGORY_TREE = {
  Hardware: ['Keyboards', 'Displays', 'Audio'],
  Accessories: ['Cables', 'Stands', 'Bags'],
  Software: ['Editors', 'Utilities'],
}

async function seedCategories() {
  const all = []

  for (const [root, children] of Object.entries(CATEGORY_TREE)) {
    const parent = await prisma.category.create({
      data: {
        name: root,
        slug: faker.helpers.slugify(root).toLowerCase(),
        description: faker.commerce.productDescription(),
        position: all.length,
      },
    })
    all.push(parent)

    for (const child of children) {
      all.push(
        await prisma.category.create({
          data: {
            name: child,
            slug: faker.helpers.slugify(child).toLowerCase(),
            description: maybe(0.7, faker.commerce.productDescription()),
            position: all.length,
            parentId: parent.id,
          },
        }),
      )
    }
  }

  return all
}

// --------------------------------------------------------------------- tags

const TAG_NAMES = [
  'featured',
  'clearance',
  'new',
  'refurbished',
  'bestseller',
  'limited',
  'ergonomic',
  'wireless',
  'mechanical',
  'portable',
  'heavy',
  'quiet',
  'announcement',
  'tutorial',
  'release-notes',
  'opinion',
  'interview',
  'deep-dive',
  'changelog',
  'roadmap',
]

async function seedTags() {
  const tags = []
  for (const name of TAG_NAMES) {
    tags.push(
      await prisma.tag.create({
        data: { name, colour: maybe(0.6, faker.color.rgb()) },
      }),
    )
  }
  return tags
}

// -------------------------------------------------------------------- users

/**
 * Six people worth recognising, so there is something specific to search for,
 * and a reporting line that is three deep rather than flat.
 */
const NAMED_USERS = [
  { name: 'Ada Lovelace', email: 'ada@example.com', role: 'ADMIN', age: 36 },
  { name: 'Alan Turing', email: 'alan@example.com', role: 'ADMIN', age: 41 },
  { name: 'Grace Hopper', email: 'grace@example.com', role: 'EDITOR', age: 45 },
  { name: 'Barbara Liskov', email: 'barbara@example.com', role: 'EDITOR', age: 52 },
  { name: 'Linus Torvalds', email: 'linus@example.com', role: 'MEMBER', age: 34 },
  { name: 'Donald Knuth', email: 'knuth@example.com', role: 'MEMBER', age: 61 },
]

const GENERATED_USERS = 54

async function seedUsers() {
  const users = []

  for (const person of NAMED_USERS) {
    users.push(
      await prisma.user.create({
        data: {
          ...person,
          // Never a real hash, and never shown: the admin configuration marks
          // this field hidden, so it leaves the server in no response at all.
          passwordHash: `scrypt$${faker.string.alphanumeric(32)}`,
          bio: faker.person.bio(),
          avatarUrl: faker.image.avatarGitHub(),
          createdAt: faker.date.past({ years: 3 }),
        },
      }),
    )
  }

  for (let index = 0; index < GENERATED_USERS; index++) {
    const name = faker.person.fullName()
    users.push(
      await prisma.user.create({
        data: {
          name,
          // Indexed rather than faked, because faker will eventually collide
          // on an email and a unique violation in a seed is a confusing way to
          // learn that.
          email: `${faker.helpers.slugify(name).toLowerCase()}.${index}@example.com`,
          passwordHash: `scrypt$${faker.string.alphanumeric(32)}`,
          bio: maybe(0.5, faker.person.bio()),
          avatarUrl: maybe(0.7, faker.image.avatarGitHub()),
          age: maybe(0.8, faker.number.int({ min: 19, max: 68 })),
          role: one(['MEMBER', 'MEMBER', 'MEMBER', 'EDITOR', 'ADMIN']),
          active: faker.datatype.boolean({ probability: 0.85 }),
          createdAt: faker.date.past({ years: 3 }),
        },
      }),
    )
  }

  // A reporting line: two leads under Ada, everyone else under one of them.
  // Assigned after creation because a manager has to exist first.
  const [ada, alan, grace] = users
  await prisma.user.update({ where: { id: alan.id }, data: { managerId: ada.id } })
  await prisma.user.update({ where: { id: grace.id }, data: { managerId: ada.id } })

  for (const person of users.slice(3)) {
    if (faker.datatype.boolean({ probability: 0.7 })) {
      await prisma.user.update({
        where: { id: person.id },
        data: { managerId: one([alan.id, grace.id]) },
      })
    }
  }

  // Not everyone has one - the relation is optional, and an interface that
  // only ever sees it populated is not being tested.
  for (const person of sample(users, Math.floor(users.length * 0.7))) {
    await prisma.profile.create({
      data: {
        userId: person.id,
        headline: faker.person.jobTitle(),
        website: maybe(0.6, faker.internet.url()),
        location: maybe(0.8, `${faker.location.city()}, ${faker.location.country()}`),
        newsletter: faker.datatype.boolean(),
      },
    })
  }

  return users
}

// ----------------------------------------------------------------- products

const PRODUCTS = 120

async function seedProducts(categories, tags) {
  // Leaves only. A product hanging off "Hardware" rather than "Keyboards"
  // would be correct and would make the tree pointless.
  const leaves = categories.filter((category) => category.parentId !== null)
  const products = []

  for (let index = 0; index < PRODUCTS; index++) {
    products.push(
      await prisma.product.create({
        data: {
          sku: `SKU-${String(index + 1).padStart(4, '0')}`,
          name: `${faker.commerce.productAdjective()} ${faker.commerce.product()}`,
          description: maybe(0.8, faker.commerce.productDescription()),
          price: Number(faker.commerce.price({ min: 5, max: 2400 })),
          stock: faker.number.int({ min: 0, max: 240 }),
          active: faker.datatype.boolean({ probability: 0.88 }),
          releasedAt: maybe(0.75, faker.date.past({ years: 2 })),
          createdAt: faker.date.past({ years: 2 }),
          categoryId: one(leaves).id,
          tags: {
            connect: sample(tags.slice(0, 12), faker.number.int({ min: 0, max: 4 })).map((tag) => ({
              id: tag.id,
            })),
          },
        },
      }),
    )
  }

  return products
}

// ------------------------------------------------------------------- orders

const ORDERS = 90

async function seedOrders(users, products) {
  let items = 0

  for (let index = 0; index < ORDERS; index++) {
    const status = one([
      'DRAFT',
      'PENDING',
      'PENDING',
      'PAID',
      'PAID',
      'PAID',
      'SHIPPED',
      'CANCELLED',
      'REFUNDED',
    ])
    const lines = sample(products, faker.number.int({ min: 1, max: 5 })).map((product) => ({
      productId: product.id,
      quantity: faker.number.int({ min: 1, max: 6 }),
      // Copied from the product at order time, then nudged, so the column is
      // visibly its own value rather than a mirror of the product's.
      unitPrice: Number((product.price * faker.number.float({ min: 0.85, max: 1 })).toFixed(2)),
    }))

    await prisma.order.create({
      data: {
        reference: `ORD-${String(index + 1).padStart(5, '0')}`,
        status,
        total: Number(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0).toFixed(2)),
        note: maybe(0.3, faker.lorem.sentence()),
        placedAt: status === 'DRAFT' ? null : faker.date.recent({ days: 180 }),
        createdAt: faker.date.recent({ days: 200 }),
        userId: one(users).id,
        items: { create: lines },
      },
    })

    items += lines.length
  }

  return items
}

// ------------------------------------------------------------------ reviews

const REVIEWS = 220

async function seedReviews(users, products) {
  // One review per person per product, enforced by a composite unique. Tracked
  // here rather than caught, because a seed that relies on the database to
  // reject its own duplicates is a seed that is hard to read.
  const seen = new Set()
  let written = 0

  for (let attempt = 0; attempt < REVIEWS * 3 && written < REVIEWS; attempt++) {
    const product = one(products)
    const user = one(users)
    const pair = `${product.id}:${user.id}`
    if (seen.has(pair)) continue
    seen.add(pair)

    await prisma.review.create({
      data: {
        productId: product.id,
        userId: user.id,
        rating: faker.number.int({ min: 1, max: 5 }),
        title: maybe(0.8, faker.lorem.sentence({ min: 3, max: 8 })),
        body: maybe(0.7, faker.lorem.paragraph()),
        createdAt: faker.date.recent({ days: 400 }),
      },
    })
    written++
  }

  return written
}

// -------------------------------------------------------------------- posts

const POSTS = 40

async function seedPosts(users, tags) {
  const authors = users.filter((user) => user.role !== 'MEMBER')
  const posts = []

  for (let index = 0; index < POSTS; index++) {
    const title = faker.lorem.sentence({ min: 4, max: 9 }).replace(/\.$/, '')
    const status = one(['DRAFT', 'REVIEW', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'ARCHIVED'])

    posts.push(
      await prisma.post.create({
        data: {
          title,
          slug: `${faker.helpers.slugify(title).toLowerCase().slice(0, 48)}-${index}`,
          excerpt: maybe(0.8, faker.lorem.sentences(2)),
          body: faker.lorem.paragraphs(4),
          status,
          views: status === 'PUBLISHED' ? faker.number.int({ min: 0, max: 24000 }) : 0,
          publishedAt: status === 'PUBLISHED' ? faker.date.recent({ days: 300 }) : null,
          createdAt: faker.date.past({ years: 2 }),
          authorId: one(authors).id,
          tags: {
            connect: sample(tags.slice(12), faker.number.int({ min: 1, max: 3 })).map((tag) => ({
              id: tag.id,
            })),
          },
        },
      }),
    )
  }

  return posts
}

// ----------------------------------------------------------------- comments

const COMMENTS = 260

async function seedComments(users, posts) {
  const published = posts.filter((post) => post.status === 'PUBLISHED')
  const roots = []
  let replies = 0

  for (let index = 0; index < COMMENTS; index++) {
    // A third of them are replies, so the self-relation has both halves
    // populated and the "Replies" list on a comment is not always empty.
    const parent = roots.length > 0 && faker.number.float() < 0.35 ? one(roots) : undefined

    const comment = await prisma.post
      .findUnique({ where: { id: parent ? parent.postId : one(published).id } })
      .then((post) =>
        prisma.comment.create({
          data: {
            body: faker.lorem.sentences({ min: 1, max: 4 }),
            approved: faker.datatype.boolean({ probability: 0.75 }),
            createdAt: faker.date.recent({ days: 250 }),
            postId: post.id,
            authorId: one(users).id,
            ...(parent ? { parentId: parent.id } : {}),
          },
        }),
      )

    if (parent) replies++
    else roots.push(comment)
  }

  return { total: COMMENTS, replies }
}

// --------------------------------------------------------------------- run

console.log('Resetting…')
await reset()

const categories = await seedCategories()
const tags = await seedTags()
const users = await seedUsers()
const products = await seedProducts(categories, tags)
const orderItems = await seedOrders(users, products)
const reviews = await seedReviews(users, products)
const posts = await seedPosts(users, tags)
const comments = await seedComments(users, posts)

const counts = {
  Category: await prisma.category.count(),
  Tag: await prisma.tag.count(),
  User: await prisma.user.count(),
  Profile: await prisma.profile.count(),
  Product: await prisma.product.count(),
  Order: await prisma.order.count(),
  OrderItem: await prisma.orderItem.count(),
  Review: await prisma.review.count(),
  Post: await prisma.post.count(),
  Comment: await prisma.comment.count(),
}

console.log('\nSeeded:')
for (const [model, count] of Object.entries(counts)) {
  console.log(`  ${model.padEnd(12)} ${String(count).padStart(5)}`)
}
console.log(`\n  ${Object.values(counts).reduce((a, b) => a + b, 0)} rows in total.`)
console.log(`  ${comments.replies} of ${comments.total} comments are replies.`)
console.log(`  ${orderItems} order lines, ${reviews} reviews.`)

await prisma.$disconnect()
