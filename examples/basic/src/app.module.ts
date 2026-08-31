import { Module } from '@nestjs/common'
import {
  AdminModule,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  type AdminAuth,
} from '@nest-admin/nestjs'
import { PrismaAdapter } from '@nest-admin/nestjs/prisma'

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
 * The application owns identity.
 *
 * A deliberately crude stand-in for whatever the host already has - a session,
 * a JWT verified by middleware, a gateway header. The framework never inspects
 * a credential itself; it only asks this question.
 *
 * Set `ADMIN_TOKEN` to require the header; leave it unset and the admin is open,
 * which is fine for a local example and nothing else.
 */
const adminAuth: AdminAuth = {
  authorize(context) {
    const expected = process.env['ADMIN_TOKEN']
    if (!expected) return

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
    const presented = request.headers['x-admin-token']

    if (typeof presented !== 'string' || presented === '') throw new UnauthorizedError()
    if (presented !== expected) throw new ForbiddenError()
  },
}

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
    fields: {
      // Enforced. The column leaves the server in no response at all - not in
      // the schema document, not in a list, not in a detail page - and is
      // refused in filters, sorts and writes.
      //
      // It is nullable in the schema, and that is not an accident: a *required*
      // column with no default cannot be hidden, because that would leave no
      // way to supply a value and every create would fail. The module refuses
      // to start rather than let that happen.
      passwordHash: { hidden: true },

      name: { order: 1 },
      email: { widget: 'email', order: 2 } as const,
      role: { order: 3 },
      bio: { widget: 'textarea', order: 4 } as const,
      avatarUrl: { label: 'Avatar', widget: 'url', order: 5 } as const,
      managerId: { label: 'Manager', order: 6 },
    },
  },

  Profile: {
    displayField: 'headline',
    order: 2,
    fields: {
      website: { widget: 'url' } as const,
      newsletter: { label: 'Subscribed to the newsletter' },
    },
  },

  Category: {
    displayField: 'name',
    order: 3,
    fields: {
      description: { widget: 'textarea' } as const,
      parentId: { label: 'Parent category' },
      position: { label: 'Sort position' },
    },
  },

  Product: {
    displayField: 'name',
    order: 4,
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
    fields: {
      unitPrice: { label: 'Unit price at order time' },
    },
  },

  Post: {
    displayField: 'title',
    order: 8,
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
    fields: {
      rating: { label: 'Rating (1-5)', order: 1 },
      title: { order: 2 },
      body: { widget: 'textarea', order: 3 } as const,
      productId: { label: 'Product', order: 4 },
      userId: { label: 'Reviewer', order: 5 },
    },
  },
} as const

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

      useFactory: (prisma: PrismaService) => ({
        adapter: new PrismaAdapter({ client: prisma }),
        auth: adminAuth,

        models,

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

/** Enough for a slug in an example. A real application has a library for this. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}
