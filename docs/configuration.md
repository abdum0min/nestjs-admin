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
AdminModule.forRootAsync({ imports, inject, useFactory, path, uiRoot, theme })
```

`forRootAsync` also accepts `useClass` / `useExisting` with an
`AdminModuleOptionsFactory`.

**`path`, `uiRoot` and `theme` are structural** and belong on the outer object
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

### Field options

| Option      | Enforced by | Effect                                                           |
| ----------- | ----------- | ---------------------------------------------------------------- |
| `hidden`    | server      | Absent from metadata, from every response, and refused in writes |
| `readOnly`  | server      | Shown, never written. Refused if submitted                       |
| `writeOnly` | server      | Accepted on writes, never returned. What a password needs        |
| `label`     | client      | The name on the column and the form                              |
| `widget`    | client      | How to render it                                                 |
| `order`     | client      | Position in forms and tables                                     |

That division is the thing to remember: the first three are security, the last
three are presentation. Treating one of the first as one of the last would be a
hole with a reassuring name.

`widget` accepts `textarea`, `password`, `email`, `url`, `color`, `json`.
Anything else is inferred from the field's kind — a date gets a date picker, an
enum a select, a boolean a checkbox, a relation a picker.

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
| `INTERNAL_ERROR`       | 500    | Everything else                                                  |

Only the first eight carry a real message. `INTERNAL_ERROR` is replaced with a
generic string before it leaves the server: an ORM's own message carries call
sites, file paths and sometimes the submitted data, and none of that belongs in
a browser.

`CONSTRAINT_VIOLATION` carries `details.fields`, which is how the interface puts
"that email is taken" under the email box rather than in a banner.
