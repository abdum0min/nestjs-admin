# Getting started

From an existing NestJS application to a working admin, in the order you
actually do it. Every snippet here is the real API — the reference consumer in
[`examples/basic`](../examples/basic) is built the same way and is what each
release is verified against.

- [1. Install](#1-install)
- [2. Wire the module](#2-wire-the-module)
- [3. Put it behind a login](#3-put-it-behind-a-login)
- [4. Make it yours](#4-make-it-yours)
- [5. Add rules the schema cannot express](#5-add-rules-the-schema-cannot-express)
- [6. Give it a dashboard](#6-give-it-a-dashboard)
- [Using Drizzle instead](#using-drizzle-instead)
- [Where to go next](#where-to-go-next)

---

## 1. Install

```bash
npm install @nest-admin/nestjs
```

One package. It contains the NestJS integration, both ORM adapters and the
built admin interface — you do not install or build a front end.

Requirements: Node ≥ 20.11, NestJS 10–12, and either Prisma ≥ 6 or Drizzle
≥ 0.44.

## 2. Wire the module

The smallest thing that works:

```ts
import { Module } from '@nestjs/common'
import { AdminModule, unsafeAllowAllRequests } from '@nest-admin/nestjs'
import { PrismaAdapter } from '@nest-admin/nestjs/prisma'

import { PrismaService } from './prisma.service'

@Module({
  imports: [
    AdminModule.forRoot({
      adapter: new PrismaAdapter({ client: new PrismaService() }),
      auth: unsafeAllowAllRequests(),
    }),
  ],
})
export class AppModule {}
```

Start the application and open `http://localhost:3000/admin`.

`unsafeAllowAllRequests()` makes every admin route public. It is named that way
on purpose, it logs a warning at startup, and it exists so you can see the thing
working before you decide how people will sign in. **Do not deploy it.** Step 3
replaces it.

### When the client comes from DI

Which is the usual case — the client needs configuration, and configuration
arrives through the container too:

```ts
AdminModule.forRootAsync({
  imports: [DatabaseModule],
  inject: [PrismaService],

  // Structural options stay outside the factory: routes are registered and
  // the interface is rendered before any provider exists.
  path: '/admin',
  theme: { title: 'Acme Admin', brandColor: '#3f6212' },

  useFactory: (prisma: PrismaService) => ({
    adapter: new PrismaAdapter({ client: prisma }),
    auth: myAuth(prisma),
  }),
})
```

`path`, `uiRoot` and `theme` belong on the outer object, not on what the factory
returns. Returning one of them is a startup error with a message saying so —
TypeScript cannot catch it, because excess property checks do not run through a
function's return type.

## 3. Put it behind a login

Two ways, and they are genuinely different situations.

### You already have authentication

Implement `AdminAuth`. It is one method, and it gets the raw `ExecutionContext`,
so whatever your application already uses — a guard, a session, a JWT, a
header — works unchanged:

```ts
import { ForbiddenError, UnauthorizedError, type AdminAuth } from '@nest-admin/nestjs'

const auth: AdminAuth = {
  authorize(context) {
    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user) throw new UnauthorizedError('Sign in first.')
    if (!user.isStaff) throw new ForbiddenError('Staff only.')
  },
}
```

Returning normally admits the request. Throwing `UnauthorizedError` produces
401, `ForbiddenError` produces 403, and the interface renders each differently
— one says "sign in", the other says "you do not have access".

Returning `false` also denies, mapped to 403, so a guard written in the
reflexive NestJS style fails closed rather than silently allowing. Prefer
throwing: `false` cannot express the 401/403 distinction.

This is the boundary the package will not move: **authentication belongs to the
host application.** Nothing below is a replacement for that, only an
implementation of it.

### You do not

`builtInAuth()` is an `AdminAuth` implementation the package provides: a login
screen, a signed session cookie, scrypt password hashing and a user menu, with
no code from you.

Its accounts live in a table of their own — **not** your `User` table. That
separation is the whole point: the people who administer a system are not rows
in the table they administer, and pointing this at `User` would put a password
that opens the admin on every customer record.

```prisma
model AdminAccount {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String?
  passwordHash String
  disabled     Boolean   @default(false)
  createdAt    DateTime  @default(now())
  lastLoginAt  DateTime?
}
```

```ts
import { builtInAuth } from '@nest-admin/nestjs'
import { prismaAccountStore } from '@nest-admin/nestjs/prisma'

AdminModule.forRootAsync({
  imports: [DatabaseModule],
  inject: [PrismaService],
  useFactory: (prisma: PrismaService) => ({
    adapter: new PrismaAdapter({ client: prisma }),

    auth: builtInAuth({
      store: prismaAccountStore({ client: prisma }),
      session: { secret: process.env.ADMIN_SESSION_SECRET! },
    }),

    // The admin must not administer its own administrators: anyone who could
    // edit this table could set another account's password hash, which is
    // every permission the admin has, reachable from a form. The module warns
    // at startup if you forget.
    resources: { exclude: ['AdminAccount'] },
  }),
})
```

Generate the secret once and keep it out of the repository. There is no
development fallback, by design — a shipped default secret mints a session for
any account:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Create the first account with a script; the example ships one
([`create-admin.mjs`](../examples/basic/create-admin.mjs)) you can copy.

Already have an accounts table under different names? `prismaAccountStore`
takes `model` and a `fields` map. Storing accounts somewhere else entirely —
LDAP, another service — means implementing `AdminAccountStore`: three required
methods (`findByEmail`, `findById`, `count`) and two optional ones.

### Who may see what

`AdminAuth` answers "may this person open the admin". `AdminResourceAuth`
answers "which parts":

```ts
resourceAuth: {
  authorize({ model, operation, context }) {
    if (model === 'Invoice') return operation === 'metadata' || operation === 'list'
    return true
  },
}
```

A model this returns `false` for is **absent from `/admin/meta`**, so the
interface never draws it. This is not client-side hiding: the routes refuse it
too, and a dashboard widget over it is dropped before anything is queried.

### When there is more than one administrator

Two things, and they are separate. **Roles** say what a person may _do_;
**scoping** says which _rows_ they may do it to. Neither is needed for a single
administrator, and configuring neither leaves the admin exactly as it is.

```ts
roles: {
  admin: '*',
  editor: { models: { Post: ['metadata', 'list', 'read', 'create', 'update'] } },
},

// With the built-in login, the role comes off the signed-in account.
roleOf: builtInRoleOf(),
```

A model a role does not mention is **invisible** rather than read-only — it
never reaches the metadata document, so the interface never learns it exists.

For multi-tenant, return filters instead of `true` and they reach the database:

```ts
support: {
  models: { Order: ['metadata', 'list', 'read'] },
  scope: ({ context }) => [
    { field: 'tenantId', operator: 'eq', value: tenantOf(context) },
  ],
},
```

The filters are applied everywhere a row can be reached — lists, single records,
writes, related lists, dashboard counts and record actions — and a row outside
the scope answers **404**, because a 403 would confirm it exists.

Roles are granted wherever accounts are created, not in the admin: the account
store is read-only on purpose. Full reference:
[configuration.md](configuration.md#roles-and-roleof).

## 4. Make it yours

Everything here is optional, and the admin is usable before you write any of it.

```ts
models: {
  User: {
    label: 'People',          // what the sidebar and headings call it
    displayField: 'name',     // how a record is named when referenced elsewhere
    icon: 'users',            // from a closed list the interface can draw
    order: 1,                 // where it sits in the navigation

    fields: {
      email: { widget: 'email', order: 2 },
      bio: { widget: 'textarea', order: 4 },
      avatarUrl: { label: 'Avatar', widget: 'url' },
      passwordHash: { label: 'Password', widget: 'password', writeOnly: true },
      internalNote: { hidden: true },
      views: { readOnly: true },
    },
  },
}
```

The options divide on a line worth knowing:

- **Enforced by the server** — `hidden`, `readOnly`, `writeOnly`,
  `displayField`. A hidden field is not in the metadata, not in responses, and
  refused in writes.
- **Sent to the client** — `label`, `widget`, `order`, `icon`. Presentation. A
  client could ignore them.

Anything in the first group treated as the second would be a security hole with
a reassuring name.

Choosing which models appear at all:

```ts
resources: {
  exclude: ['AdminAccount', 'AuditLog']
}
// or
resources: {
  include: ['User', 'Order', 'Product']
}
```

## 5. Add rules the schema cannot express

Hooks run after authorization and validation, immediately around the adapter
call — so a hook never sees a request that would have been refused, and never
sees a payload naming a hidden field.

```ts
hooks: {
  User: {
    // Returning new data from a `before` hook supplies a value the person
    // filling in the form should not have to think about.
    beforeCreate: ({ data }) => ({ ...data, passwordHash: hash(data.passwordHash) }),
  },

  Post: {
    beforeDelete: async ({ id }) => {
      const post = await prisma.post.findUnique({ where: { id: String(id) } })
      if (post?.status === 'PUBLISHED') {
        // Reaches the person who pressed the button. Naming a field puts the
        // message under that field; naming none makes it about the record.
        throw new ValidationError('Published posts cannot be deleted.')
      }
    },
  },
}
```

Buttons work the same way — declared on the server, drawn by the interface,
which never learns what any of them do:

```ts
actions: {
  Post: [
    {
      name: 'publish',
      label: 'Publish',
      scope: 'record',
      confirm: 'Publish this post?',
      run: async ({ id }) => {
        await prisma.post.update({ where: { id: String(id) }, data: { status: 'PUBLISHED' } })
        return { message: 'Published.' }
      },
    },
  ],
}
```

## 6. Give it a dashboard

An admin with no `dashboard` option still gets one, built from your schema: a
count per model, and recent records where the schema says which those are. That
is a reasonable place to arrive and a poor place to stay, because it treats
every table as equally interesting.

```ts
dashboard: [
  { kind: 'count', title: 'Customers', model: 'User', compareDays: 30 },
  { kind: 'count', title: 'Awaiting payment', model: 'Order', filter: 'status:eq:PENDING' },
  { kind: 'chart', title: 'New customers', model: 'User', bucket: 'day', buckets: 30 },
  { kind: 'list', title: 'Latest orders', model: 'Order', limit: 6 },

  // The escape hatch: a number no single table holds.
  {
    kind: 'stat',
    title: 'Revenue',
    description: 'Paid and shipped orders.',
    load: async () => ({ value: await revenueThisMonth(), hint: 'vs last month' }),
  },
]
```

The first four name a model, which is what lets them be authorized: a widget
over a resource this person cannot list is absent from the page and its model
is never queried. `stat` runs your code, so your rules apply to it — and if it
throws, that one card says it could not load while the rest of the page still
answers.

## Using Drizzle instead

Same module, same everything above. Only the adapter changes:

```ts
import { AdminModule } from '@nest-admin/nestjs'
import { DrizzleAdapter } from '@nest-admin/nestjs/drizzle'

import { db } from './db'
import * as schema from './schema'

AdminModule.forRoot({
  adapter: new DrizzleAdapter({ db, schema }),
  auth,
})
```

Pass the schema module itself — `import * as schema` — because that object is
what the adapter reads. Models are named by their **export key** and fields by
their **property key**, which are the names your own queries use.

Three things behave differently, and all three are properties of Drizzle rather
than choices:

- **Relations.** Declared `relations()` are used when present, and their names
  win. Where they are absent, both ends are derived from the foreign key
  (`posts.authorId` gives you `author` on a post and `posts` on a user).
- **Many-to-many.** Drizzle has none. A join table is a table, and appears in
  the admin as its own resource with a to-one on each side.
- **MySQL** is refused at startup with a reason — it has no `RETURNING`, so a
  write could not report the stored row. SQLite and PostgreSQL work.

The full comparison is in [adapters.md](adapters.md).

## Where to go next

- **[Configuration reference](configuration.md)** — every option, in one place.
- **[Security](../SECURITY.md)** — what is guaranteed, what is not, and the
  three things you have to get right.
- **[Adapters](adapters.md)** — the `OrmAdapter` contract, and writing one.
- **[Architecture](architecture.md)** — why the pieces are shaped this way.
- **[Project state](project-state.md)** — what is missing, and the open risks.
