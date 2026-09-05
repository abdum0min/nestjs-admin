# Configuration reference

Every option `AdminModule` accepts, what it does, and what it does not.

If you are setting this up for the first time, read
[getting-started.md](getting-started.md) instead — it covers the same ground in
the order you actually need it. This page is for looking things up.

- [The two entry points](#the-two-entry-points)
- [`adapter`](#adapter)
- [`auth`](#auth)
- [`resourceAuth`](#resourceauth)
- [`roles` and `roleOf`](#roles-and-roleof)
- [`resources`](#resources)
- [`concurrency`](#concurrency)
- [`files`](#files)
- [`devTools`](#devtools)
- [`models`](#models)
- [`hooks`](#hooks)
- [`actions`](#actions)
- [`dashboard`](#dashboard)
- [`path`, `uiRoot`, `theme`](#path-uiroot-theme)
- [The query string](#the-query-string)
- [Errors](#errors)

---

## The two entry points

```ts
AdminModule.forRoot(options)
AdminModule.forRootAsync({ imports, inject, useFactory, path, uiRoot, theme, devTools })
```

`forRootAsync` also accepts `useClass` / `useExisting` with an
`AdminModuleOptionsFactory`.

**`path`, `uiRoot`, `theme` and `devTools` are structural** and belong on the outer object
of `forRootAsync`, never on what the factory returns. Routes are registered and
the interface is rendered before any provider exists, so a value produced by a
factory arrives too late to be used. Returning one is a startup error naming
the option — TypeScript cannot catch it, because excess property checks do not
run through a function's return type.

| Option         | Required   | Where   |
| -------------- | ---------- | ------- |
| `adapter`      | yes        | factory |
| `auth`         | yes        | factory |
| `resourceAuth` | no         | factory |
| `roles`        | no         | factory |
| `roleOf`       | with roles | factory |
| `resources`    | no         | factory |
| `models`       | no         | factory |
| `hooks`        | no         | factory |
| `actions`      | no         | factory |
| `dashboard`    | no         | factory |
| `devTools`     | no         | outer   |
| `path`         | no         | outer   |
| `uiRoot`       | no         | outer   |
| `theme`        | no         | outer   |

---

## `adapter`

An `OrmAdapter`. Two ship with the package:

```ts
import { PrismaAdapter } from '@nest-admin/nestjs/prisma'
new PrismaAdapter({ client, schemaPath?, cwd? })

import { DrizzleAdapter } from '@nest-admin/nestjs/drizzle'
new DrizzleAdapter({ db, schema })
```

`schemaPath` and `cwd` are only needed when the Prisma schema is not where
Prisma itself would look for it. `DrizzleAdapter` needs the schema module
object — `import * as schema from './schema'` — because that object is what it
reads.

Writing your own: [adapters.md](adapters.md).

---

## `auth`

Who may open the admin at all. One method, applied to every route including
`/admin/meta`.

```ts
interface AdminAuth {
  authorize(context: ExecutionContext): void | boolean | Promise<void | boolean>
}
```

Return to admit. Throw `UnauthorizedError` for 401, `ForbiddenError` for 403 —
the interface renders those differently, so the distinction matters. Returning
`false` denies as 403; it exists so a guard written reflexively fails closed,
not as the preferred way to say no.

Note the shape: `authorize` takes the `ExecutionContext` **positionally**.
`AdminResourceAuth.authorize` below takes an object, because it carries three
things rather than one.

Three ready-made answers:

```ts
auth: unsafeAllowAllRequests()  // development only; warns at startup
auth: myOwnAuth                 // an application that already has identity
auth: builtInAuth({ ... })      // a login screen this package provides
```

### `builtInAuth(options)`

| Option               | Default              | Notes                                                                                   |
| -------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `store`              | —                    | An `AdminAccountStore`. `prismaAccountStore({ client })` is provided.                   |
| `session.secret`     | —                    | At least 32 characters. No fallback: a shipped default mints a session for any account. |
| `session.maxAge`     | 12 hours             | Seconds. Renewed on use.                                                                |
| `session.cookieName` | `nest_admin_session` |                                                                                         |
| `session.secure`     | auto                 | Forced on behind HTTPS; settable for a proxy that terminates TLS.                       |
| `maxAttempts`        | 10                   | Failed sign-ins before that email and address are locked out. Failures decay.           |
| `lockoutSeconds`     | 15 minutes           | How long a lockout lasts.                                                               |

`prismaAccountStore({ client, model?, fields? })` defaults to a model called
`AdminAccount`; `fields` maps `id`, `email`, `name`, `passwordHash` and
`disabled` onto your own column names.

`AdminAccountStore` itself is `findByEmail`, `findById` and `count`, plus two
optional members: `recordLogin` and `describes`.

Whatever you pass, **exclude the account table from `resources`**. Anyone who
could edit it could set another account's password hash, which is every
permission the admin has, reachable from a form. The module warns at startup if
you have not.

---

## `resourceAuth`

Which parts of it, per model and per operation.

```ts
resourceAuth: {
  authorize({ model, operation, context }): boolean | Promise<boolean>
}
```

`operation` is one of `metadata`, `list`, `read`, `create`, `update`, `delete`.

Refusing `metadata` removes the model from `/admin/meta` entirely, so the
interface never draws it, no route serves it, and no dashboard widget over it
is built. Refusing a write leaves the model visible and its buttons absent.

This is server-side. There is no client-side hiding anywhere in the admin.

### Which rows: scoping

Return filters instead of `true` and they are merged into the query, so the
database does the filtering:

```ts
resourceAuth: {
  authorize({ model, operation, context }) {
    const user = context.switchToHttp().getRequest().user
    if (user.isAdmin) return true
    if (model !== 'Order') return true
    return { filters: [{ field: 'tenantId', operator: 'eq', value: user.tenantId }] }
  },
}
```

`{ filters: [] }` means the same as `true`, so a policy that builds its filters
conditionally need not change its return type when it builds none. The filters
use the same `field`, `operator`, `value` vocabulary the query string does, and
are ANDed with whatever the caller asked for — a caller cannot widen them.

**Everywhere a row can be reached**, not only lists:

| Route                             | With a scope                                       |
| --------------------------------- | -------------------------------------------------- |
| `GET /admin/:model`               | filtered, and `total` counts only what is in scope |
| `GET /admin/:model/:id`           | **404** for a row outside it                       |
| `PATCH` / `DELETE`                | 404, and before any hook runs                      |
| bulk delete                       | checked per row; the rest come back as failures    |
| `GET /admin/:model/:id/:relation` | both the parent and the children                   |
| dashboard widgets                 | counts, lists and charts all respect it            |
| record actions                    | the id is checked before your code sees it         |

**404 rather than 403**, deliberately: a 403 confirms a record with that id
exists. "No such record" and "not yours" have to be indistinguishable, or the
scope leaks the thing it was added to hide.

**What it costs.** One extra query per _addressed_ record, and only when a scope
applies. An admin that configures no scope issues exactly the queries it issued
before.

---

## `roles` and `roleOf`

Named roles, as a shorthand for the policy above. Optional: without them every
administrator may do everything, which is what an admin has always been.

```ts
roles: {
  admin: '*',

  editor: {
    models: {
      Post: ['metadata', 'list', 'read', 'create', 'update'],
      Comment: ['metadata', 'list', 'read', 'delete'],
    },
  },

  support: {
    models: { Order: ['metadata', 'list', 'read'] },
    scope: ({ context, model }) =>
      model === 'Order'
        ? [{ field: 'tenantId', operator: 'eq', value: tenantOf(context) }]
        : undefined,
  },
},

roleOf: (context) => context.switchToHttp().getRequest().user.role,
```

With the built-in login the role comes off the signed-in account, and the
resolver is one call:

```ts
import { builtInRoleOf } from '@nest-admin/nestjs'

roleOf: builtInRoleOf(),
```

### Rules worth knowing before writing a table

|                                     |                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A model a role does not mention     | **invisible**, not read-only — it fails the `metadata` check, so the interface never learns it exists                                 |
| `'*'` as the whole role             | every operation on every model, and every capability                                                                                  |
| `'*'` as a model's operations       | every operation on that model                                                                                                         |
| `action`                            | never implied by `update`: an action runs your code and can do anything, so permission to edit a post is not permission to publish it |
| A role name `roles` does not define | denied — a typo in `roleOf` must not quietly grant everything                                                                         |
| No role on the request              | denied                                                                                                                                |
| `roles` without `roleOf`            | **refuses to start**, naming the missing option                                                                                       |

### Roles beside a policy of your own

Supplying both is allowed and means **both must agree**: a request needs
permission from the roles _and_ from `resourceAuth`, and both scopes apply.

Fail closed is the only sane direction — adding a rule can then only remove
access, never grant it. Use it when roles cover the ordinary cases and one model
needs something they cannot express.

### One role, not several

`roleOf` returns one role. Combining two roles' _scopes_ needs OR, and filters
are ANDed; expressing that properly means changing the adapter contract, so it
is deferred rather than half-built. A principal that needs two roles today needs
a third role that is their union.

### The team screen

When the login is `builtInAuth` and its store can list accounts, the admin gets
a **Team** page, reached from the user menu. It is not the account table exposed
as a resource — that stays excluded, and must:

> As an ordinary model resource, anyone with `update` on it could write another
> account's `passwordHash` directly. A complete takeover, from a form, with no
> password ever typed.

The screen is the opposite arrangement:

|                            |                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A password hash            | **never accepted.** A password is typed, and the hash is derived on the server                                     |
| Who may open it            | a role holding the `manageTeam` capability. Without `roles`, every administrator — which is what they already were |
| Your own row               | you cannot delete it, disable it, or change its role                                                               |
| A role you did not declare | refused — it would create an account that signs in and sees nothing                                                |
| A store that cannot write  | the screen is read-only; one that cannot list has no screen at all, and the routes answer 404                      |

```ts
roles: {
  owner: '*',                                                    // manageTeam included
  manager: { models: { … }, capabilities: ['manageTeam'] },
  editor: { models: { … } },                                     // cannot open it
}
```

**What this does not defend against**, stated plainly: someone who already holds
`manageTeam` can create another account that holds it. That is not an escalation
— they are already an administrator — but it is _persistence_, so `manageTeam`
is a capability a role has to name rather than one everybody gets.

To implement it against your own storage, add the four optional methods to
`AdminAccountStore`: `listAccounts`, `createAccount`, `updateAccount`,
`deleteAccount`. A store without them keeps working.

### Where roles are granted

On the team screen above, or wherever accounts are created — a migration, a seed
script, or your own form. A store that does not implement the write methods
keeps the older arrangement, where the admin reads a role and never writes one.

### What the interface does with it

Nothing it is trusted for. The role appears in the user menu so a person can see
who they are signed in as. Which buttons appear comes from the `can` block in
the metadata document, computed on the server per request — and every request is
checked again when it arrives.

---

## `resources`

Which models are part of this admin at all.

```ts
resources: {
  include: ['User', 'Order']
}
resources: {
  exclude: ['AdminAccount', 'AuditLog']
}
```

One or the other, not both. An excluded model is unknown to every route — it
answers 404, identically for everyone, because whether a model is part of the
admin is structural rather than a permission.

---

## `concurrency`

What happens when two people edit the same record.

```ts
concurrency: 'optimistic',   // default: 'last-write-wins'
```

### The problem it solves

Anna and Bora open the same post at 10:00. Anna changes the title and saves.
Bora changes only the summary a minute later — but the form sends every field,
including the title as it was when he opened it. Anna’s change is gone, and
neither of them is told anything.

That is fine while an admin has one administrator. Roles are what stop that
being true.

### How it works

|                |                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The version    | whatever the model’s updated-at column held when the record was read                                                                                                 |
| How it travels | the `x-admin-version` header on `PATCH`. A header, not a body key: the body is validated field by field, and a reserved key would collide with a column of that name |
| A stale write  | **409 `CONFLICT`**, and **nothing is applied** — not even the field the person meant to change                                                                       |
| The recovery   | reload, then save again. Nothing is locked and nobody waits, which is what “optimistic” means                                                                        |

The interface sends it automatically. The metadata document names the field
(`versionField` on each model), so the interface never works it out for itself —
a second implementation of that rule would drift from the one enforcing it.

### What it needs, and what it says when it cannot

A column that **moves on every write** — `updatedAt` and its usual spellings, and
one the schema maintains (`@updatedAt` in Prisma, `$onUpdate` in Drizzle). A column
called `updatedAt` that nothing updates would produce a version that never changes,
and a guard comparing an unchanging value passes every time.

Metadata cannot tell those apart, so the admin does not pretend to. At startup it
names every model it cannot protect:

```text
WARN [NestAdmin] concurrency: 'optimistic' cannot protect Profile, Category,
Product, Tag, Order, OrderItem, Comment, Review - no column recording when a row
last changed. Edits to those models still overwrite each other silently.
```

A guard nobody can see is not a guard.

### Two things it deliberately does not do

**A caller that sends no version is allowed through.** A script patching one
field is not the collision this exists for, and refusing it would break every
non-browser caller the moment the option is turned on.

**It is off by default.** Turning it on can refuse a write that succeeds today,
and “zero configuration behaves exactly as before” is worth more than a better
default. That changes at 1.0, which is where defaults are allowed to.

---

## `models`

Per-model and per-field configuration.

```ts
models: {
  User: {
    label: 'People',
    displayField: 'name',
    icon: 'users',
    order: 1,
    fields: {
      email: { label: 'Email address', widget: 'email', order: 2 },
    },
  },
}
```

### Model options

| Option         | Effect                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| `label`        | What the navigation, headings and dashboard call it                             |
| `displayField` | Which field names a record when it is referenced elsewhere. **Server-enforced** |
| `icon`         | One of the closed list below                                                    |
| `order`        | Position in the navigation; unset models follow, alphabetically                 |
| `softDelete`   | Column to mark instead of removing the row. **Server-enforced**                 |
| `fields`       | Per-field options                                                               |

`icon` accepts: `users` `user` `building` `box` `package` `tag`
`shopping-cart` `credit-card` `receipt` `file-text` `folder` `image` `calendar`
`clock` `mail` `message-square` `bell` `star` `map-pin` `globe` `settings`
`key` `shield` `database` `table` `layers` `list` `chart-bar` `activity`
`truck` `gift` `bookmark` `link`.

Closed because the interface has to be able to draw each one; an unknown value
would silently render nothing. A model with no icon gets its initial, which
distinguishes one row from the next on the collapsed rail — the same icon on
every entry would be decoration rather than information.

### `softDelete`

Many schemas already carry a `deletedAt` column. Name it, and Delete stops
destroying rows:

```ts
models: {
  Post: { softDelete: 'deletedAt' },
}
```

What changes, all of it enforced on the server:

|                      |                                                                     |
| -------------------- | ------------------------------------------------------------------- |
| Delete               | writes the current time into the column instead of removing the row |
| Every list           | hides marked records, including a related list under its parent     |
| The list toolbar     | gains **Live / Deleted / All**                                      |
| A marked record      | offers **Restore**, and a **Delete forever** that means it          |
| The confirmation     | stops saying "this cannot be undone", because it can                |
| The column itself    | becomes read-only, so no form can delete a record by accident       |
| `beforeDelete` hooks | still run - from everywhere but the database, this is a delete      |

Restoring is authorized as `delete`, not as `update`: it undoes a delete, and
somebody who may only edit records should not be able to resurrect what
somebody else removed.

The column must be an **optional `DateTime` the database does not generate**.
Anything else is refused at startup, including a boolean - a date records
_when_, which a flag cannot, and a nullable boolean has two ways of saying "not
deleted" that no reader keeps straight.

A model without `softDelete` behaves exactly as it always has.

### Field options

| Option        | Enforced by | Effect                                                           |
| ------------- | ----------- | ---------------------------------------------------------------- |
| `hidden`      | server      | Absent from metadata, from every response, and refused in writes |
| `readOnly`    | server      | Shown, never written. Refused if submitted                       |
| `writeOnly`   | server      | Accepted on writes, never returned. What a password needs        |
| `accept`      | server      | Which content types a file field takes, checked from the bytes   |
| `maxSize`     | server      | How large, checked while it uploads                              |
| `label`       | client      | The name on the column and the form                              |
| `widget`      | client      | How to render it                                                 |
| `placeholder` | client      | The picture to draw when a file field has none of its own        |
| `order`       | client      | Position in forms and tables                                     |

That division is the thing to remember: the first five are security, the rest
are presentation. Treating one of the first as one of the last would be a hole
with a reassuring name.

`widget` accepts `textarea`, `password`, `email`, `url`, `color`, `json`,
`file`, `image`. Anything else is inferred from the field's kind — a date gets
a date picker, an enum a select, a boolean a checkbox, a relation a picker.

---

## `files`

Uploads. A file field is a **string column** holding a storage key, so nothing
in the schema changes - most projects already have an unused
`avatarUrl String?`.

```ts
models: {
  User: {
    fields: {
      avatarUrl: { widget: 'image', accept: ['image/*'], maxSize: '2mb' },
      contract: { widget: 'file', accept: ['application/pdf'] },
    },
  },
}
```

That is the whole of it. With no `files` option the bytes go to the local disk
under `.nest-admin/uploads` and are served from `/admin/files/…`, behind the same
guard as every other route.

### What the interface gives you

|                    |                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Three ways in      | click, drag and drop, or **paste** - a screenshot is two keystrokes from being an avatar |
| Preview            | pictures inline, everything else as an icon and its name                                 |
| Progress           | a percentage while it uploads                                                            |
| Replace and remove | in place, no dialog                                                                      |
| The original name  | read back out of the key, so downloads keep it                                           |

### Where it is shown

A file field is drawn wherever it is read, not only in the form: the table, the
related tables on a detail page, and the detail page itself. An `image` column
shows the picture; a `file` column shows what it is called and links to it, and
shows the picture anyway if the name says it is one.

Two of a file column's states are not a picture — it is empty, or it points at
something that is no longer there — and they are worth telling apart. Give the
field a `placeholder` and both fall back to it:

```ts
avatarUrl: {
  widget: 'image',
  accept: ['image/*'],
  maxSize: '2mb',
  placeholder: '/img/default-avatar.png',
}
```

Without one the admin draws its own icon: a plain outline for an empty column,
a struck-through one that says why on hover for a value that would not load.
Never the browser's broken-image glyph, which is unstyled, different in every
browser, and reports a missing file as a fault in the page.

A `placeholder` must be an absolute URL, a path starting with `/`, or a
`data:image/` URI. A relative path is **refused at startup**: the admin is one
hash-routed page, so `img/avatar.png` resolves against whichever screen is open
and would load on the list and 404 on a detail page.

### The key

```text
2026/09/k3n8vq2f-quarterly-report.pdf
└─date  └─random  └─the original name
```

The random part makes it unique and unguessable; the date keeps a directory
listing usable after a year; the name is what a person sees and downloads as.
A size is the one thing a string column cannot carry.

Names are reduced to Unicode letters, digits, dots and underscores - an
allowlist, because a list of characters to _strip_ fails open for every one it
forgets. `ҳисобот.pdf` survives intact; `../../etc/passwd` does not.

### S3, R2, or anything else

Three methods. No adapter ships in the package, because `@aws-sdk/client-s3`
is ten megabytes and this one has a single runtime dependency - and because an
implementation nobody can test against a real bucket is a guess. Copy this:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { AdminStorage } from '@nest-admin/nestjs'

const client = new S3Client({
  region: process.env.S3_REGION,
  // Cloudflare R2 is S3-compatible: the only difference is this line.
  // endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: …, secretAccessKey: … },
})

const Bucket = process.env.S3_BUCKET

export const s3: AdminStorage = {
  name: 's3',
  async put({ key, type, bytes }) {
    await client.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: type }))
  },
  url: (key) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: 900 }),
  remove: async (key) => {
    await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
  },
}
```

```ts
files: {
  storage: s3
}
```

`url()` may be asynchronous, which is what makes a **private bucket** work: it
mints a signed link per request rather than needing the bucket to be public.
The admin never serves those bytes itself.

### Security

The substance of this feature, not an afterthought. Serving an uploaded file
inline from the admin's own origin is a session-stealing XSS in waiting.

|              |                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------- |
| Content type | sniffed **from the bytes**, never from the extension or the header the uploader sent     |
| Inline       | only for PNG, JPEG, GIF and WebP. Everything else downloads                              |
| SVG          | uploads and downloads, never renders - it is an image that can contain script            |
| Size         | counted as the stream arrives, and refused on the announced length before a byte is read |
| Keys         | generated here. A key that resolves outside the upload directory is refused              |
| The route    | behind the same guard as the data, because a file belongs to a record                    |

An HTML file uploaded as `avatar.png` is refused at upload, and would download
rather than execute even if it somehow got in.

### Two things to know

**The local disk is a default, not a recommendation.** Containers and
serverless hosts lose it on the next deploy, so the module warns at startup
when it is still in use with `NODE_ENV=production`.

**A replaced file is not deleted.** Another record may hold the same key and
nothing here can count references. Finding orphans is a job for the dev tools,
where scanning makes sense.

---

## `devTools`

Believable data, from your own schema. The answer to opening a fresh admin and
finding empty tables, a flat dashboard chart and relation pickers with nothing
in them.

```ts
import { devTools } from '@nest-admin/nestjs/dev-tools'

AdminModule.forRoot({ adapter, auth, devTools: devTools() })
```

A **Developer tools** entry appears at the bottom of the navigation, marked, and
separated from the resources — a tool that can empty a table must not look like
a table.

### What it does

One screen. Every model is a row with its own count, so "twenty users, fifty
products, no order lines" is one press rather than three visits.

|                   |                                                                                   |
| ----------------- | --------------------------------------------------------------------------------- |
| **Generate**      | the models you tick, each with its own number, in an order the relations allow    |
| Preview           | per model, and it writes nothing                                                  |
| Seeds             | the same seed gives the same records, so a demo can be rebuilt or screenshotted   |
| Pictures          | identicons and gradients drawn from the record, written through your file storage |
| **Undo**          | deletes what the last run created — records you made by hand are left alone       |
| Recent runs       | the last ten, so "did that do anything" has an answer                             |
| Empty a model     | one model, named, with a confirmation                                             |
| Empty every model | children first, refused without an acknowledgement, and it says what it skipped   |

The header says which **database engine** it is pointed at - PostgreSQL, SQLite,
MySQL - with the adapter underneath it, how many records exist, and **what the
deployment check actually saw** — not `NODE_ENV` alone, because the gate reads a
dozen things and a screen that named one would teach the wrong rule.

Each row shows how many relations the generator will wire up on its own.
Trusting a generator starts with knowing what it will touch.

### The schema report

At the top of the page, above everything that writes: **what the admin had to
guess about your schema, and what it cannot do.**

This package renders schemas it has never seen, so it guesses - which column
names a record, how the halves of a relation pair up, whether a date is a
creation date. Every wrong guess degrades **silently**. The report is the list
of them:

| Finding                       | What it costs today                                            |
| ----------------------------- | -------------------------------------------------------------- |
| Display field fell back to id | Every relation picker and link shows a cuid                    |
| Composite or missing key      | The list works; opening, editing and deleting all fail         |
| Unpaired relation             | Attach and Detach are not offered, and no link to the children |
| No creation date              | The dashboard offers a count and no chart                      |
| No version column             | `concurrency: 'optimistic'` is silently not running on it      |
| Decimal, BigInt or Bytes      | A required one makes every create fail                         |
| File field, no storage        | The widget is drawn and every upload fails                     |

Two severities: **broken** does not work, **guessed** works with less than it
could. A third level would only start an argument about the middle.

Every finding a configuration option can fix carries that option, ready to
copy - the reason these problems persist is that nobody knows the option
exists. Where none can, it says so rather than inventing one.

**It never touches the database.** No data quality, no missing rows, and
deliberately no index advice: indexes are invisible from here, and guessing
would be advice that is confidently wrong.

The navigation shows a count beside **Developer tools** for the broken ones
only. Most schemas leave the admin guessing something, and a badge that never
goes out is a warning people stop seeing.

### What "empty every model" does not empty

Every model **this admin manages**, which is not the same as every table.

A model `resources` excluded is out of reach here as it is everywhere else, and
that is deliberate twice over. `resources` is the whole of this package's
security model, so a developer tool that ignored it would make every `exclude`
in every application a suggestion. And the excluded table is usually the account
table — emptying it would delete the login of the person pressing the button,
permanently, with no way back through the admin.

So the result names what it left alone and why: `outside this admin`, `not in
the developer tools configuration`, or `you may not write it`.

It also deletes **rows**, not tables. Autoincrement counters keep counting and
migration state is untouched. The command that truly resets a database belongs
to your ORM — under Prisma, `npx prisma db push --force-reset` — and the screen
says so where somebody would otherwise find out the slow way.

Values come from the field's **name** first (`email`, `slug`, `price`, `city`)
and its **kind** second. Nothing branches on a model name: the admin renders
schemas it has never seen, and a generator that knew about `User` would work on
one application. Unique columns stay unique, enums stay inside their values,
relations point at rows that exist — including one-to-ones, where each parent is
handed out once.

Dates are spread backwards over ninety days, so the dashboard chart has a shape.

### What it is not

**Not a person filling in a form.** Records are written through the adapter, so
generated timestamps can be set — and so **your hooks do not run**. Two hundred
fake users should not send two hundred welcome emails.

Authorization is _not_ skipped: every model goes through the same `resourceAuth`
boundary the HTTP routes use.

### `@faker-js/faker` is optional

Installed, it is used automatically and the words get more varied. Absent, the
built-in lists do the job. "Install ten megabytes before you can see any data"
is not a first step this package asks for.

### Options

```ts
devTools({
  allowInProduction: false, // second, explicit acknowledgement
  models: ['User', 'Post'], // default: everything you may write
  images: true,
  maxPerRun: 500,
  generators: {
    // The escape hatch. One column with a format nothing could infer should
    // not make the feature useless for that model.
    'Product.sku': (index) => `SKU-${1000 + index}`,
  },
})
```

### Keeping it away from a real database

Four layers, and the first is the strongest:

1. **A separate entrypoint.** A build that does not import
   `@nest-admin/nestjs/dev-tools` does not contain the generator, the word
   lists or the routes. Absent, not disabled — which no configuration mistake
   can undo.
2. The option has to be passed.
3. **It refuses to start where the process looks deployed** — `NODE_ENV`, and
   any of `VERCEL`, `RENDER`, `FLY_APP_NAME`, `RAILWAY_*`, `DYNO`, `K_SERVICE`,
   `KUBERNETES_SERVICE_HOST` and friends. `NODE_ENV` alone is not the check:
   staging runs as production and plenty of deployments never set it.
   `allowInProduction: true` gets through, and warns on every start-up.
4. The role needs the `useDevTools` capability. Without roles, every
   administrator has it, exactly as with `manageTeam`.

`devTools` is **structural**, like `path` and `theme`: it decides which
controllers exist, so on `forRootAsync` it goes on the outer object rather than
in the factory.

---

## `hooks`

Your own rules, per model, around every write.

```ts
hooks: {
  Post: {
    beforeCreate: ({ data, context, model }) => data,
    afterCreate: ({ record, context, model }) => void 0,
    beforeUpdate: ({ id, data, context, model }) => data,
    afterUpdate: ({ id, record, context, model }) => void 0,
    beforeDelete: ({ id, context, model }) => void 0,
    afterDelete: ({ id, context, model }) => void 0,
  },
}
```

They run **after** authorization and validation and immediately around the
adapter call, so a hook never sees a request that would have been refused and
never sees a payload naming a hidden field.

A `before` hook that returns an object replaces the data. Throwing
`ValidationError(message, fields?)` refuses the write with a message that
reaches the person who pressed the button — naming a field puts it under that
field, naming none makes it about the record.

Nothing here is transactional. Work that must be atomic belongs in your own
transaction.

---

## `actions`

Buttons the server declares and the interface draws. The interface never learns
what any of them do.

```ts
actions: {
  Post: [
    {
      name: 'publish',            // stable id, used in the route
      label: 'Publish',           // defaults to `name`
      scope: 'record',            // or 'list'
      confirm: 'Publish this?',   // shows a confirmation first
      danger: false,              // renders destructively
      run: async ({ context, model, id }) => ({ message: 'Published.' }),
    },
  ],
}
```

`scope: 'record'` gives `id`; `scope: 'list'` does not. What `run` returns is
shown to the person who pressed it; what it throws is reported the same way a
hook's refusal is.

---

## `dashboard`

What the landing page shows. Four kinds, closed for the same reason `widget` is.

```ts
dashboard: [
  { kind: 'count', title: 'Customers', model: 'User', filter?, compareDays? },
  { kind: 'list',  title: 'Latest',    model: 'Order', filter?, limit? },
  { kind: 'chart', title: 'Signups',   model: 'User', filter?, bucket?, buckets? },
  { kind: 'stat',  title: 'Revenue',   load: async ({ context }) => ({ value, delta?, hint? }) },
]
```

Common to all four: `title`, `description?`, `span?` (1–4 columns; sensible per
kind when omitted).

| Option        | Kind               | Notes                                                                                            |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `filter`      | count, list, chart | `field:operator:value`, parsed exactly as the list screen's URL is                               |
| `compareDays` | count              | Adds a change against that period. Needs a creation timestamp; silently omitted without one      |
| `limit`       | list               | 5 by default, 10 at most — more belongs on the list screen                                       |
| `bucket`      | chart              | `day` (default), `week`, `month`                                                                 |
| `buckets`     | chart              | 30 by default, 90 at most — each bucket is one query                                             |
| `load`        | stat               | Your code. Whatever it returns is shown; whatever it throws makes one card say it could not load |

The first three name a model, which is what makes them **authorizable**: a
widget over a resource this person cannot list is absent from the document and
its model is never queried.

Omit the option entirely and a dashboard is generated from the schema: a count
per model, plus recent records and a month of activity for models that record
when a row was created. Declaring widgets replaces that rather than adding to
it.

---

## `path`, `uiRoot`, `theme`

```ts
path: '/admin'                 // default
uiRoot: '/absolute/path'       // where the built interface lives; only for a fork
theme: {
  title: 'Acme Admin',
  brandColor: '#3f6212',
  logoUrl: '/logo.svg',
  appearance: 'system',        // 'system' | 'light' | 'dark'
}
```

`brandColor` is one hex value. The server derives the rest — a fill colour, a
readable ink for it and a link colour — separately for the light and dark
palettes, adjusting the lightness until each meets its WCAG contrast floor
(4.5:1 for text, 3:1 for a surface). So a brand colour that would be unreadable
in dark mode is corrected rather than shipped.

An unknown key here is a startup error. `accent` instead of `brandColor` would
otherwise do nothing, silently, forever.

---

## The query string

The list route accepts these, and the interface builds them:

```
GET /admin/User?page=2&perPage=50&sort=name:asc&filter=active:eq:true&search=ada
```

| Parameter | Form                                      |
| --------- | ----------------------------------------- |
| `page`    | 1-based                                   |
| `perPage` | clamped to 100                            |
| `sort`    | `field:asc` or `field:desc`, repeatable   |
| `filter`  | `field:operator:value`, repeatable        |
| `search`  | free text over the model's string columns |

Operators: `eq` `ne` `contains` `startsWith` `endsWith` `gt` `gte` `lt` `lte`
`in`.

Values are coerced against the schema, so `active:eq:true` is the boolean.
`contains`, `startsWith` and `endsWith` are case-insensitive and require a text
field; comparisons are refused on booleans; `in` takes a comma-separated list.
An unknown field or operator is a 400 naming it.

Search skips generated columns and foreign keys — an opaque id column would
make a one-letter search match nearly every row.

---

## Errors

Every failure crosses the wire in one shape:

```json
{ "success": false, "error": { "code": "CONSTRAINT_VIOLATION", "message": "…", "details": {} } }
```

| Code                   | Status | Raised by                                                        |
| ---------------------- | ------ | ---------------------------------------------------------------- |
| `UNAUTHORIZED`         | 401    | `UnauthorizedError`                                              |
| `FORBIDDEN`            | 403    | `ForbiddenError`                                                 |
| `MODEL_NOT_FOUND`      | 404    | An unknown or excluded model                                     |
| `RECORD_NOT_FOUND`     | 404    | `RecordNotFoundError`                                            |
| `FIELD_NOT_FOUND`      | 400    | `FieldNotFoundError`                                             |
| `INVALID_QUERY`        | 400    | `InvalidQueryError`                                              |
| `VALIDATION_ERROR`     | 400    | `ValidationError` — yours, from a hook                           |
| `CONSTRAINT_VIOLATION` | 409    | The database refused it. A missing required value is 400 instead |
| `CONFLICT`             | 409    | The record changed after it was read; nothing was written        |
| `INTERNAL_ERROR`       | 500    | Everything else                                                  |

Only the first eight carry a real message. `INTERNAL_ERROR` is replaced with a
generic string before it leaves the server: an ORM's own message carries call
sites, file paths and sometimes the submitted data, and none of that belongs in
a browser.

`CONSTRAINT_VIOLATION` carries `details.fields`, which is how the interface puts
"that email is taken" under the email box rather than in a banner.
