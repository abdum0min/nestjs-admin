/**
 * The documentation examples, compiled.
 *
 * Every snippet in docs/getting-started.md and docs/configuration.md that a
 * reader would copy, typed against the real published surface. It exists
 * because a documentation error is invisible until someone else hits it: the
 * auth interface was documented with the wrong shape and nothing failed.
 *
 * Nothing here runs. `tsc --noEmit` is the whole test.
 */
import {
  builtInAuth,
  ForbiddenError,
  UnauthorizedError,
  unsafeAllowAllRequests,
  ValidationError,
  type AdminAction,
  type AdminAuth,
  type AdminDashboard,
  type AdminHooksByModel,
  type AdminResourceAuth,
  type ModelOverrides,
} from '@nest-admin/nestjs'
import { prismaAccountStore } from '@nest-admin/nestjs/prisma'

import { PrismaService } from './prisma.service.js'

/* getting-started.md - "You already have authentication" */
const hostAuth: AdminAuth = {
  authorize(context) {
    const request = context.switchToHttp().getRequest<{ user?: { isStaff?: boolean } }>()
    const user = request.user
    if (!user) throw new UnauthorizedError('Sign in first.')
    if (!user.isStaff) throw new ForbiddenError('Staff only.')
  },
}

/* getting-started.md - "You do not" */
function packageAuth(prisma: PrismaService): AdminAuth {
  return builtInAuth({
    store: prismaAccountStore({ client: prisma }),
    session: { secret: process.env['ADMIN_SESSION_SECRET'] ?? '' },
  })
}

/* configuration.md - the development-only escape hatch */
const openAuth: AdminAuth = unsafeAllowAllRequests()

/* getting-started.md - "Who may see what" */
const resourceAuth: AdminResourceAuth = {
  authorize({ model, operation }) {
    if (model === 'Invoice') return operation === 'metadata' || operation === 'list'
    return true
  },
}

/* getting-started.md - "Make it yours" */
const models = {
  User: {
    label: 'People',
    displayField: 'name',
    icon: 'users',
    order: 1,

    fields: {
      email: { widget: 'email', order: 2 },
      bio: { widget: 'textarea', order: 4 },
      avatarUrl: { label: 'Avatar', widget: 'url' },
      passwordHash: { label: 'Password', widget: 'password', writeOnly: true },
      internalNote: { hidden: true },
      views: { readOnly: true },
    },
  },
} as const satisfies ModelOverrides

/* getting-started.md - "Add rules the schema cannot express" */
function hooks(prisma: PrismaService): AdminHooksByModel {
  return {
    User: {
      beforeCreate: ({ data }) => ({ ...data, passwordHash: String(data['passwordHash']) }),
    },

    Post: {
      beforeDelete: async ({ id }) => {
        const post = await prisma.post.findUnique({ where: { id: String(id) } })
        if (post?.status === 'PUBLISHED') {
          throw new ValidationError('Published posts cannot be deleted.')
        }
      },
    },
  }
}

/* getting-started.md - actions */
function actions(prisma: PrismaService): Readonly<Record<string, readonly AdminAction[]>> {
  return {
    Post: [
      {
        name: 'publish',
        label: 'Publish',
        scope: 'record',
        confirm: 'Publish this post?',
        run: async ({ id }) => {
          await prisma.post.update({
            where: { id: String(id) },
            data: { status: 'PUBLISHED' },
          })
          return { message: 'Published.' }
        },
      },
    ],
  }
}

/* getting-started.md and configuration.md - the dashboard */
const dashboard = [
  { kind: 'count', title: 'Customers', model: 'User', compareDays: 30 },
  { kind: 'count', title: 'Awaiting payment', model: 'Order', filter: 'status:eq:PENDING' },
  { kind: 'chart', title: 'New customers', model: 'User', bucket: 'day', buckets: 30 },
  { kind: 'list', title: 'Latest orders', model: 'Order', limit: 6 },
  {
    kind: 'stat',
    title: 'Revenue',
    description: 'Paid and shipped orders.',
    load: async () => ({ value: '$12,400', delta: 8, hint: 'vs last month' }),
  },
] as const satisfies AdminDashboard

/* Referenced so nothing above is dropped as unused. */
export const documented = {
  hostAuth,
  packageAuth,
  openAuth,
  resourceAuth,
  models,
  hooks,
  actions,
  dashboard,
}
