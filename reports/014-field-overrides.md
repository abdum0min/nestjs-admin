# 0.5.0 — Field Overrides and Permissions

Status: **complete.** No row-level permissions, no conditional visibility, no
grouping in the sidebar, nothing published.

---

## 1. Executive Summary

Two things that had been listed as known limitations since `reports/009`:

- **A field could not be hidden.** The adapter returned whole rows and the
  metadata described every column, so `passwordHash` was in the response
  whether or not anything rendered it.
- **The interface offered buttons that always failed.** `/admin/meta` was
  byte-identical for every principal, so a read-only account was shown `New`,
  `Edit` and `Delete`, and every one of them returned 403.

Both are closed. Alongside them: labels, widgets, ordering, and a declared
display field.

**525 tests** (was 458), 40/40 packed-consumer checks. Two of the three startup
checks in this release exist because a real consumer run failed in a way that
was hard to diagnose.

---

## 2. Enforced Versus Presentational

The options divide cleanly, and the division is the design:

|                  | Options                              | Guarantee                                 |
| ---------------- | ------------------------------------ | ----------------------------------------- |
| **Behaviour**    | `hidden`, `readOnly`, `displayField` | Enforced by the server                    |
| **Presentation** | `label`, `widget`, `order`           | Sent to the client, which may ignore them |

Anything in the first group implemented as the second would be a security hole
with a reassuring name. `hidden` in particular: an admin that draws the field
only when told to still _sends_ it, and the value is one `curl` away.

---

## 3. How `hidden` Became a Guarantee

The mechanism is that hidden fields are **removed** from the metadata rather
than flagged in it.

Every layer decides what it may do by reading the metadata. The query parser
rejects a filter on a field it cannot find. The metadata mapper cannot describe
one. Write validation refuses one. So a removed field is unreachable _by
construction_ — none of those layers needs to know the option exists, and none
of them can forget to check a flag.

That covers the layers this package owns. It does not cover the adapter, which
reads a schema and knows nothing about admin configuration. Two separate
mechanisms close that:

**A whitelist on every response.** The service projects each record against the
effective metadata before returning it, on all six paths — list, read, create,
update, and both related routes. Whitelisting rather than deleting named fields
also covers a column the adapter reports that the metadata does not describe: if
it is not part of this admin, it does not leave it.

**A scope on every query.** `ListQuery.fields` tells the adapter which fields
the query may touch. Prisma applies it three ways at once: narrowing the model
so field lookup and free-text search inherit the restriction, and an `omit`
clause so the column is never read.

`omit` rather than `select`, because it composes with `include`. A `select`
would have had to enumerate the relations too, and would silently have dropped
any that were forgotten.

### The search hole

The first version had the projection but not the scope, and a test caught what
that missed: **free-text search still matched the hidden column.** A hidden
value was absent from every response and yet discoverable a substring at a
time — `?search=ada@` returning one row says as much as the value itself.

Filtering and sorting had the same shape: the parser accepted them because the
service's metadata no longer had the field, but the _adapter_ validated against
its own copy and let them through. Both are the same root cause, and the scope
fixes both.

---

## 4. Permissions in the Metadata

`/admin/meta` now carries, per model:

```json
"can": { "list": true, "read": true, "create": false, "update": false, "delete": false }
```

Computed by asking the same policy the requests go through, so the document and
the enforcement cannot disagree. A policy that throws `ForbiddenError` is read as
a denial, exactly as visibility already read it.

It is **a description, not the enforcement**, and the tests say so explicitly:
one asserts that an operation reported as `false` still returns 403 when tried.
A client that ignores the field gets an error rather than access; the field
exists so the interface can stop promising what the server will not do.

The UI withholds `New`, `Edit`, `Delete`, `Attach` and `Detach` accordingly —
and keeps offering them when the field is absent entirely, so a screen still
works against a server that predates it.

---

## 5. Startup Checks

Three, all refusing to boot rather than warning.

**An unknown model or field name.** The cost of ignoring one is asymmetrical: a
mistyped `label` is invisible and harmless, but a mistyped `passwordHash` leaves
the real column exposed while the configuration looks like it is protecting it.

**A hidden field that is required and has no default.** This one was not
planned. Configuring the playground to hide `User.email` made every create
return **500** — the database refused a NOT NULL column, and the admin could
only report that as an internal error, with nothing pointing at the
configuration that caused it. Such a field is a value the caller must supply, so
hiding it removes the only way to supply it. Refused at startup, naming the
field and saying what to do:

```
AdminModule `models` hides User.email, which is a required field with no
default. Hiding it leaves no way to supply a value, so every create would fail.
Give the column a default, make it optional, or leave it visible.
```

**Overrides are validated against the selected models**, so configuring a model
that `resources` excluded is reported as unknown rather than silently having no
effect.

---

## 6. Verified in a Real Consumer

Against the playground, running the packed tarball.

```
User label                      People
Post fields                     id,title,published,author,authorId,createdAt,tags
  body hidden                   yes
  title label                   Headline
  role ordered first            yes
listed record contains body     no
filter=body:eq:x                400 FIELD_NOT_FOUND
sort=body:asc                   400 FIELD_NOT_FOUND
search for a hidden value       0 results
write naming a hidden field     400 FIELD_NOT_FOUND
write naming a read-only field  400 FIELD_NOT_FOUND — "produced by the database"
create without the hidden field 201

can, as admin                   list read create update delete — all true
can, as readonly                list read true; create update delete false
```

Booting with `User.email` hidden:

```
exit code 1
Error: AdminModule `models` hides User.email, which is a required field with
no default. …
```

Through the real UI bundle:

```
as admin      heading "People"; buttons New People, Edit, Delete, Attach
as readonly   heading "People"; no New, no Edit, no Delete, no Attach
              role rendered first, as configured
console       no errors in either
```

---

## 7. Verification

| Check                 | Result                   |
| --------------------- | ------------------------ |
| `pnpm build`          | 0                        |
| `pnpm typecheck`      | 0                        |
| `pnpm format:check`   | 0                        |
| `pnpm test`           | **525 passed**, 26 files |
| `pnpm verify:package` | **40/40**                |

New tests: 67.

| File                                                | Covers                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/test/overrides.test.ts` (16)         | Removal rather than flagging, read-only precedence, the unknown-name report                                                                |
| `packages/nestjs/test/field-overrides.test.ts` (25) | A hidden field on all six response paths, in queries, in writes, in search; read-only; labels, widgets, ordering; all three startup checks |
| `packages/nestjs/test/resource-auth.test.ts` (+5)   | Permissions in the document, and that they are a description rather than the enforcement                                                   |
| `packages/prisma/test/relations.test.ts` (+5)       | `omit`, search scoping, filter and sort refusal, relations still loading                                                                   |
| `apps/admin-ui/test/overrides.test.tsx` (16)        | Withheld controls, labels, each widget, read-only fields absent from forms and requests                                                    |

The in-memory test adapter gained an optional string field on each model,
because every existing one was required — hiding a required field is now
correctly refused, which the fixtures had no way to express.

---

## 8. Known Limitations

- **`hidden` does not apply to the primary key or a foreign key in use.** Both
  are removable in principle and would break navigation; nothing prevents it.
- **No row-level permissions.** `can` is per model. "This user may edit their own
  posts" is not expressible.
- **No conditional visibility.** A field cannot be hidden depending on the value
  of another, or on the principal — `models` is one static configuration.
- **No grouping in the sidebar.** `order` exists; sections do not.
- **A widget is not validated against the field's kind.** `widget: 'color'` on a
  number renders a colour picker over a numeric value. The list is closed, but
  the pairing is not checked.
- **`json` renders as a textarea** with no parsing or formatting, so invalid JSON
  reaches the server and is refused there.
- **Permissions cost five policy calls per model** on every `/admin/meta`. Fine
  for a policy that reads a role; a policy that queries the database would feel
  it.

---

## 9. Result

```
hidden: absent from metadata:                  PASS
hidden: absent from every response path:       PASS
hidden: not filterable, sortable, writable:    PASS
hidden: not matched by free-text search:       PASS
hidden: not read from the database:            PASS
readOnly: shown, refused in writes:            PASS
labels, widgets, ordering:                     PASS
displayField override:                         PASS
permissions in /admin/meta:                    PASS
interface withholds refused actions:           PASS
startup refuses an impossible configuration:   PASS
verified against a real consumer:              PASS
row-level permissions:                         NOT IN SCOPE — §8
```

|               | Before | After   |
| ------------- | ------ | ------- |
| Tests         | 458    | **525** |
| Packed checks | 40/40  | 40/40   |
| Version       | 0.4.0  | 0.5.0   |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.6.0 — extension points.** Hooks, custom actions, and theming without a
custom build. People adopt for features and leave for the missing escape hatch.
