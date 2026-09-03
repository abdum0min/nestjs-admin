import { randomBytes, scryptSync } from 'node:crypto'

import { Module } from '@nestjs/common'
import {
  AdminModule,
  builtInAuth,
  builtInRoleOf,
  ValidationError,
  type AdminDashboard,
  type AdminRoles,
} from '@nest-admin/nestjs'
import { devTools } from '@nest-admin/nestjs/dev-tools'
import { PrismaAdapter, prismaAccountStore } from '@nest-admin/nestjs/prisma'

import { PrismaService } from './prisma.service.js'

/**
 * The reference consumer.
 *
 * Everything here is what a real application writes. Nothing is imported from
 * `@nest-admin/core` or `@nest-admin/prisma` directly - only the single public
 * package and its `./prisma` subpath, exactly as an installed consumer would.
 *
 * The configuration below is deliberately fuller than a "getting started"
 * snippet. The schema has eleven models with three self-relations, two
 * many-to-many relations and a join table with payload, and the point of the
 * example is to show what an application does about a schema like that -
 * which columns it hides, which it renames, which it renders differently, and
 * where its own rules go.
 */

/**
 * Per-field configuration.
 *
 * The options divide on a line worth knowing: `hidden`, `readOnly` and
 * `displayField` are **enforced by the server**, while `label`, `widget` and
 * `order` are sent to a client that may ignore them. Anything in the first
 * group treated as the second would be a security hole with a reassuring name.
 */
const models = {
  User: {
    label: 'People',
    displayField: 'name',
    order: 1,
    // Presentational, from a closed set the interface knows how to draw. A
    // model without one is drawn without one, which is a real answer: the
    // same icon on every entry is decoration rather than information.
    icon: 'users',
    fields: {
      /*
       * Written, never read back.
       *
       * `hidden` was the wrong tool here and this example used it: it refuses
       * the column in both directions, so the admin could show a Person but
       * never give one a password. `writeOnly` is the other half - the value
       * is accepted on a write and left out of every response, which is what a
       * password actually needs.
       *
       * The `password` widget gets the masked box with a reveal toggle; the
       * hook below turns whatever is typed into a hash before it is stored, so
       * the plaintext exists only for the length of one request.
       */
      passwordHash: {
        label: 'Password',
        widget: 'password',
        writeOnly: true,
        order: 7,
      },

      name: { order: 1 },
      email: { widget: 'email', order: 2 } as const,
      role: { order: 3 },
      bio: { widget: 'textarea', order: 4 } as const,
      // A string column that holds a storage key. Nothing else in the
      // schema changes, and with no `files` option the bytes go to the local
      // disk - which is the whole adoption story for an image field.
      avatarUrl: {
        label: 'Avatar',
        widget: 'image',
        accept: ['image/*'],
        maxSize: '2mb',
        // What the table draws for a user with no avatar, or one whose file
        // has since gone. A data URI so the example needs no asset served
        // from anywhere; a real application would point at its own file.
        placeholder:
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"%3E%3Crect width="40" height="40" fill="%23e2e8f0"/%3E%3Ccircle cx="20" cy="15" r="7" fill="%2394a3b8"/%3E%3Cpath d="M6 40c0-8 6-13 14-13s14 5 14 13z" fill="%2394a3b8"/%3E%3C/svg%3E',
        order: 5,
      } as const,
      managerId: { label: 'Manager', order: 6 },
    },
  },

  Profile: {
    displayField: 'headline',
    order: 2,
    icon: 'user',
    fields: {
      website: { widget: 'url' } as const,
      newsletter: { label: 'Subscribed to the newsletter' },
    },
  },

  Category: {
    displayField: 'name',
    order: 3,
    icon: 'layers',
    fields: {
      description: { widget: 'textarea' } as const,
      parentId: { label: 'Parent category' },
      position: { label: 'Sort position' },
    },
  },

  Product: {
    displayField: 'name',
    order: 4,
    icon: 'package',
    fields: {
      // The detection rule guesses well and has no way to know that people
      // here say "SKU" rather than "sku".
      sku: { label: 'SKU', order: 1 },
      name: { order: 2 },
      description: { widget: 'textarea', order: 3 } as const,
      price: { order: 4 },
      categoryId: { label: 'Category', order: 5 },
    },
  },

  Tag: {
    displayField: 'name',
    order: 5,
    icon: 'tag',
    fields: {
      // A `String?` column that holds `#4f46e5`. The schema cannot tell a
      // colour from a sentence; this is the application saying which it is.
      colour: { label: 'Colour', widget: 'color' } as const,
    },
  },

  Order: {
    // `reference` rather than `id`: ORD-00042 is what people say out loud.
    displayField: 'reference',
    order: 6,
    icon: 'receipt',
    fields: {
      reference: { label: 'Reference', order: 1 },
      status: { order: 2 },
      userId: { label: 'Customer', order: 3 },
      note: { widget: 'textarea', order: 5 } as const,
    },
  },

  OrderItem: {
    label: 'Order lines',
    order: 7,
    icon: 'list',
    fields: {
      unitPrice: { label: 'Unit price at order time' },
    },
  },

  Post: {
    displayField: 'title',
    order: 8,
    icon: 'file-text',
    // Delete marks the row instead of removing it. The list gains a
    // Live/Deleted/All chooser, a marked record gains Restore, and the column
    // itself becomes read-only - a date picker that deletes the record when it
    // is filled in would be the same two operations without the confirmation.
    softDelete: 'deletedAt',
    fields: {
      title: { order: 1 },
      slug: { order: 2 },
      status: { order: 3 },
      excerpt: { widget: 'textarea', order: 4 } as const,
      body: { widget: 'textarea', order: 5 } as const,
      authorId: { label: 'Author', order: 6 },
      // Maintained by the application, not by whoever opens the form.
      views: { readOnly: true, order: 7 },
    },
  },

  Comment: {
    displayField: 'body',
    order: 9,
    icon: 'message-square',
    fields: {
      body: { widget: 'textarea', order: 1 } as const,
      postId: { label: 'On post', order: 2 },
      authorId: { label: 'Written by', order: 3 },
      parentId: { label: 'In reply to', order: 4 },
    },
  },

  Review: {
    displayField: 'title',
    order: 10,
    icon: 'star',
    fields: {
      rating: { label: 'Rating (1-5)', order: 1 },
      title: { order: 2 },
      body: { widget: 'textarea', order: 3 } as const,
      productId: { label: 'Product', order: 4 },
      userId: { label: 'Reviewer', order: 5 },
    },
  },
} as const

/**
 * The landing page.
 *
 * An admin with no `dashboard` still gets one, built from the schema: a count
 * per model and the newest records where the schema says which those are. That
 * is a reasonable place to arrive and a poor place to stay, because it treats
 * every table as equally interesting. This example declares its own to show
 * what the difference looks like.
 *
 * Three of the four kinds name a model and a filter and nothing else, so the
 * server does the counting - and so a widget over a resource the reader cannot
 * see is absent from the page rather than hidden by it. `stat` is the escape
 * hatch: it runs application code, for a number that no single table holds.
 */
function dashboard(prisma: PrismaService) {
  return [
    {
      kind: 'count',
      title: 'Customers',
      model: 'User',
      // Needs `createdAt`, which this schema has. Without it the comparison is
      // dropped and the count is still shown.
      compareDays: 30,
    },
    {
      kind: 'count',
      title: 'Orders awaiting payment',
      model: 'Order',
      // The same `field:operator:value` the list screen's URL uses, parsed by
      // the same code - so the widget links straight to those rows.
      filter: 'status:eq:PENDING',
    },
    {
      kind: 'count',
      title: 'Published posts',
      model: 'Post',
      filter: 'status:eq:PUBLISHED',
    },
    {
      kind: 'stat',
      title: 'Revenue',
      description: 'Paid and shipped orders.',
      // No model, because no single table answers it. Whatever this throws
      // becomes one widget saying it could not load, not a broken page.
      load: async () => {
        const paid = await prisma.order.findMany({
          where: { status: { in: ['PAID', 'SHIPPED'] } },
          include: { items: true },
        })

        const total = paid.reduce(
          (sum, order) =>
            sum +
            order.items.reduce((line, item) => line + Number(item.unitPrice) * item.quantity, 0),
          0,
        )

        return {
          value: total.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
          hint: `across ${paid.length} orders`,
        }
      },
    },
    {
      kind: 'chart',
      title: 'New customers',
      description: 'Over the last 30 days.',
      model: 'User',
      bucket: 'day',
      buckets: 30,
    },
    {
      kind: 'list',
      title: 'Latest orders',
      model: 'Order',
      limit: 6,
    },
  ] as const satisfies AdminDashboard
}

/**
 * Who may do what, once they are in.
 *
 * Optional. Deleting this block and the two options that use it leaves an admin
 * where every account may do everything - which is what an admin with a single
 * administrator is, and what this example was before roles existed.
 *
 * Three roles, chosen to show the three things worth knowing:
 *
 *   admin    everything, including the models the others cannot see
 *   editor   the publishing models, and no access to orders or people at all -
 *            not read-only, *invisible*: they never reach the metadata document
 *            so the interface never draws them
 *   support  reads orders and customers, and only the pending orders, which is
 *            row-level scoping rather than a per-model rule
 */
const roles = {
  admin: '*',

  editor: {
    models: {
      Post: ['metadata', 'list', 'read', 'create', 'update', 'action'],
      Comment: ['metadata', 'list', 'read', 'delete'],
      Category: ['metadata', 'list', 'read'],
      Tag: ['metadata', 'list', 'read', 'create', 'update'],
    },
  },

  support: {
    models: {
      Order: ['metadata', 'list', 'read'],
      OrderItem: ['metadata', 'list', 'read'],
      User: ['metadata', 'list', 'read'],
    },
    // Filters, not a refusal: support sees the orders that need attention and
    // the query never returns the rest, so the count is right too.
    scope: ({ model }) =>
      model === 'Order' ? [{ field: 'status', operator: 'eq', value: 'PENDING' }] : undefined,
  },
} as const satisfies AdminRoles

/**
 * Who may open the admin.
 *
 * This example has no identity system of its own, which is the case
 * `builtInAuth` exists for: a login page, a session cookie and a password
 * hash, without writing any of them.
 *
 * The accounts live in `AdminAccount` - a model of its own, separate from the
 * `User` table this admin manages. That separation is the whole point. The
 * people who administer a system are not rows in the table they administer,
 * and pointing this at `User` would mean every customer record carries a
 * password that opens the admin.
 *
 * An application that *does* have identity keeps writing its own `AdminAuth`
 * and never touches any of this - the contract has not changed.
 */
function adminAuth(prisma: PrismaService) {
  const secret = process.env['ADMIN_SESSION_SECRET']
  if (!secret) {
    // Refused here rather than defaulted. A development fallback is a secret
    // that ships, and a shipped secret mints a session for any account.
    throw new Error(
      'ADMIN_SESSION_SECRET is not set. Generate one with:\n' +
        "  node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\"",
    )
  }

  return builtInAuth({
    store: prismaAccountStore({ client: prisma }),
    session: { secret },
  })
}

@Module({ providers: [PrismaService], exports: [PrismaService] })
class DatabaseModule {}

@Module({
  imports: [
    // `forRootAsync` rather than `forRoot`, because the client is a provider
    // rather than a module-level value. That is the normal case: the client
    // usually needs configuration, and configuration usually arrives through
    // DI too. `forRoot` is there for the simpler arrangement.
    AdminModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [PrismaService],

      // Structural, so they stay out of the factory: routes are registered
      // and the shell is rendered before any provider exists. `/admin` is the
      // default and is spelled out here only to show where it goes.
      path: '/admin',

      theme: {
        title: 'Nest Admin Example',
        brandColor: '#3f6212',
      },

      /*
       * The developer tools. Structural for the same reason the theme is: they
       * decide which controllers exist.
       *
       * Imported from a subpath, which is the first of the four things keeping
       * a mock-data generator away from a real database - a build that does not
       * import it does not contain the generator at all. They also refuse to
       * start where the process looks deployed, need this option, and need the
       * role to hold `useDevTools`.
       */
      devTools: devTools({
        generators: {
          // The one column nothing could infer: this schema's SKUs have a
          // shape, and a guessed one would look wrong in every screenshot.
          // The column is unique, so this has to be unique across runs as well
          // as within one - a fixed sequence collides with whatever the last
          // run left behind, and every row fails on the second press.
          'Product.sku': (index: number) =>
            `SKU-${Date.now().toString(36).slice(-4).toUpperCase()}-${100 + index}`,
        },
      }),

      useFactory: (prisma: PrismaService) => ({
        adapter: new PrismaAdapter({ client: prisma }),
        auth: adminAuth(prisma),

        /*
         * The admin does not manage its own administrators.
         *
         * `AdminAccount` is in this schema, so without excluding it the admin
         * would list it like any other table - and anyone who could edit it
         * could set another account's password hash, which is every permission
         * the admin has, reachable from a form. The module warns at startup if
         * this is forgotten.
         */
        resources: { exclude: ['AdminAccount'] },

        models,

        // Both optional. Without them every account may do everything, which
        // is exactly how this example behaved before 0.12.
        roles,
        roleOf: builtInRoleOf(),

        /*
         * Two people editing one record.
         *
         * Opt-in, and this example opts in because it now has three
         * accounts. A save built on a version of the record that has since
         * changed is refused whole - nothing is applied, and the person is
         * told - rather than silently overwriting the other one.
         *
         * It needs a column that moves on every write; the module names the
         * models that have none at startup.
         */
        concurrency: 'optimistic',

        dashboard: dashboard(prisma),

        // Optional. Left permissive so the example is usable for exploring;
        // the commented line is the shape a per-model rule takes.
        resourceAuth: {
          authorize({ model, operation }) {
            // if (model === 'Product') return operation === 'metadata' || operation === 'list'
            return true
          },
        },

        /**
         * Rules the schema cannot express.
         *
         * These run after authorization and after validation, immediately
         * around the adapter call - so a hook never sees a request that would
         * have been refused, and never sees a payload naming a hidden field.
         * Nothing here is transactional; work that must be atomic belongs in
         * the application's own transaction.
         */
        hooks: {
          User: {
            // scrypt from node:crypto - no dependency, and a real KDF rather
            // than a hash. A salt per password, stored with it, because
            // otherwise two people who chose the same one are visibly the same
            // in the database.
            beforeCreate: ({ data }) => ({ ...data, passwordHash: hash(data['passwordHash']) }),
            // An omitted key means "unchanged", which is what a blank password
            // box sends. Only a value that arrived is re-hashed.
            beforeUpdate: ({ data }) =>
              'passwordHash' in data ? { ...data, passwordHash: hash(data['passwordHash']) } : data,
          },

          Post: {
            // A slug is derived from the title rather than typed. Returning
            // new data from a `before` hook is how a value is supplied that
            // the person filling in the form should not have to think about.
            beforeCreate: ({ data }) => ({
              ...data,
              slug:
                typeof data['slug'] === 'string' && data['slug'] !== ''
                  ? data['slug']
                  : slugify(String(data['title'] ?? '')),
            }),

            // Refusing, with a reason that reaches the person who pressed the
            // button. A `ValidationError` naming a field puts the message
            // under that field rather than in a banner; naming none, as here,
            // means the objection is about the record as a whole.
            beforeDelete: async ({ id }) => {
              const post = await prisma.post.findUnique({ where: { id: String(id) } })
              if (post?.status === 'PUBLISHED') {
                throw new ValidationError('Published posts cannot be deleted. Archive it first.')
              }
            },
          },

          Review: {
            beforeCreate: ({ data }) => {
              const rating = Number(data['rating'])
              if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                // Named, so the interface shows it under the rating box.
                throw new ValidationError('A rating must be a whole number from 1 to 5.', [
                  'rating',
                ])
              }
              return data
            },
          },
        },

        /**
         * Buttons the application declares and the interface draws from
         * metadata. Adding one is a server-side change; the UI never learns
         * what any of them do.
         */
        actions: {
          Post: [
            {
              name: 'publish',
              label: 'Publish',
              scope: 'record',
              confirm: 'Publish this post now?',
              run: async ({ id }) => {
                const post = await prisma.post.update({
                  where: { id: String(id) },
                  data: { status: 'PUBLISHED', publishedAt: new Date() },
                })
                return { message: `"${post.title}" is now published.` }
              },
            },
            {
              name: 'archive-drafts',
              label: 'Archive every draft',
              scope: 'list',
              confirm: 'Archive all drafts?',
              danger: true,
              run: async () => {
                const { count } = await prisma.post.updateMany({
                  where: { status: 'DRAFT' },
                  data: { status: 'ARCHIVED' },
                })
                return { message: `Archived ${count} draft${count === 1 ? '' : 's'}.` }
              },
            },
          ],

          Comment: [
            {
              name: 'approve',
              label: 'Approve',
              scope: 'record',
              run: async ({ id }) => {
                await prisma.comment.update({
                  where: { id: String(id) },
                  data: { approved: true },
                })
                return { message: 'Comment approved.' }
              },
            },
          ],

          Order: [
            {
              name: 'mark-shipped',
              label: 'Mark as shipped',
              scope: 'record',
              confirm: 'Mark this order as shipped?',
              run: async ({ id }) => {
                const order = await prisma.order.findUnique({ where: { id: String(id) } })
                if (order?.status !== 'PAID') {
                  throw new ValidationError('Only a paid order can be shipped.')
                }
                await prisma.order.update({ where: { id: order.id }, data: { status: 'SHIPPED' } })
                return { message: `${order.reference} is on its way.` }
              },
            },
          ],
        },
      }),
    }),
  ],
})
export class AppModule {}

/**
 * A password, as something safe to store.
 *
 * scrypt with a random salt, both from `node:crypto`. Deliberately not a plain
 * SHA: a password hash has to be slow, and a general-purpose digest is designed
 * to be fast, which is the whole problem with using one here.
 */
function hash(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const salt = randomBytes(16).toString('hex')
  // `scrypt$<salt>$<hash>`, so the salt travels with the hash and a future
  // change of parameters is recognisable rather than silently incompatible.
  return ['scrypt', salt, scryptSync(value, salt, 64).toString('hex')].join(String.fromCharCode(36))
}

/** Enough for a slug in an example. A real application has a library for this. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}
