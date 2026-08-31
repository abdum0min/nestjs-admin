# Adapters

Nest Admin talks to exactly one thing it did not write: your ORM. The whole of
that conversation goes through `OrmAdapter`. Core, the NestJS integration, the
HTTP contract and the interface know nothing else.

This page describes that contract, what the two shipped adapters do differently,
and what writing a third actually involves — which is now a question with a
measured answer rather than a hopeful one.

- [The contract](#the-contract)
- [Prisma and Drizzle, compared](#prisma-and-drizzle-compared)
- [Writing an adapter](#writing-an-adapter)
- [What the second adapter proved](#what-the-second-adapter-proved)

---

## The contract

```ts
interface OrmAdapter {
  readonly name: string

  getModels(): Promise<readonly ModelMetadata[]>

  list(model: string, query: ListQuery): Promise<Page<RecordData>>
  findOne(model: string, id: RecordId): Promise<RecordData | null>
  create(model: string, data: RecordData): Promise<RecordData>
  update(model: string, id: RecordId, data: RecordData): Promise<RecordData>
  delete(model: string, id: RecordId): Promise<void>

  listRelated(
    model: string,
    id: RecordId,
    field: string,
    query: ListQuery,
  ): Promise<Page<RecordData>>
  attachRelated(model: string, id: RecordId, field: string, targetId: RecordId): Promise<void>
  detachRelated(model: string, id: RecordId, field: string, targetId: RecordId): Promise<void>
}
```

Nine methods. Everything the admin can do is built from them.

### `getModels`

The one that matters. Everything the interface draws, every route that exists,
every field a form shows and every filter the query parser will accept comes
from this document.

```ts
interface ModelMetadata {
  name: string
  primaryKey: readonly string[]
  fields: readonly FieldMetadata[]
}

interface FieldMetadata {
  name: string
  kind: 'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'json' | 'relation' | 'unknown'
  isId: boolean
  isRequired: boolean
  isUnique: boolean
  isList: boolean
  isGenerated: boolean // the database or ORM supplies it; not asked of a person
  defaultValue?: unknown // a literal, offered as a pre-fill
  enumValues?: readonly string[]
  relation?: {
    targetModel: string
    cardinality: 'one' | 'many'
    name?: string // shared by both ends, so they can be paired
    from?: string // on the 'one' side: the foreign key
    to?: string // on the 'one' side: what it points at
  }
}
```

Three rules that are easy to get wrong:

- **`isGenerated` means "produced by running something"** — `now()`, a uuid
  function, autoincrement, an updated-at trigger. A _literal_ default is not
  generated; it goes in `defaultValue` and becomes a pre-filled form field.
  Getting this backwards makes forms ask people for ids.
- **`relation.name` must be the same string on both ends.** The admin pairs a
  to-many with its to-one by that name to learn which column a related list is
  filtered by. Without it, nested routes cannot work.
- **`from` and `to` belong on the `one` side only.** The `many` side is resolved
  by finding its partner.

### `list`

Applies `ListQuery` — page, perPage, sort, filters, search — and returns a page
plus the **total beyond that page**, which is what the pager counts.

Refusals are part of the job, and the messages are part of the promise:

| Situation                                               | Throw                                  |
| ------------------------------------------------------- | -------------------------------------- |
| No such model                                           | `ModelNotFoundError`                   |
| No such field, or one that cannot be filtered or sorted | `FieldNotFoundError`                   |
| An operator the field's kind does not admit             | `InvalidQueryError`                    |
| The database refused a write                            | `ConstraintError(kind, model, fields)` |
| A record that is not there                              | `RecordNotFoundError`                  |
| Anything else                                           | `AdapterError`                         |

`ConstraintError` is the one worth care: its `fields` are what let the interface
put "that email is taken" under the email box instead of in a banner. Report
them in **your schema's** names, not the database's — `authorId`, not
`author_id`, or the message lands on a field the form does not have.

### The relation methods

`listRelated` pages the far side of a to-many. `attachRelated` and
`detachRelated` link and unlink without deleting either record — across a
one-to-many that means writing and clearing the child's foreign key.

They are separate from `list` rather than expressed as a filter because a
many-to-many has no column to filter on: the link lives in a join table.

---

## Prisma and Drizzle, compared

Both implement the same contract. What differs is what the ORM hands over, and
each difference had to be absorbed inside the adapter.

|                                   | Prisma                                   | Drizzle                                                               |
| --------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| **Metadata source**               | DMMF, generated from the schema file     | the schema module object, read the way Drizzle Kit reads it           |
| **Model names**                   | the Prisma model name                    | the export key (`users`)                                              |
| **Field names**                   | the Prisma field name                    | the property key (`createdAt`, not `created_at`)                      |
| **Relations**                     | always present and always named          | from `relations()` when declared; derived from foreign keys otherwise |
| **Many-to-many**                  | first-class                              | none — a join table is a resource of its own                          |
| **Errors**                        | `P2xxx` codes with a `meta` object       | whatever the driver threw                                             |
| **Case-insensitive search**       | `mode: 'insensitive'`, on some providers | `lower()` on both sides                                               |
| **`contains` escaping**           | done by Prisma                           | done by the adapter                                                   |
| **To-one loaded with the record** | yes, via `include`                       | no — the interface resolves the label                                 |
| **Dialects**                      | whatever Prisma supports                 | SQLite and PostgreSQL; MySQL refused, see below                       |

### Notes on the Drizzle adapter

**Names come from your code, not the database.** A table exported as `users` is
the model `users`; a column declared as `createdAt: integer('created_at')` is the
field `createdAt`. Those are the names your own queries use, and — since rows
come back keyed by property — the names the data already arrives under.

**Relations without `relations()`.** A foreign key gives both ends:
`posts.authorId` produces `author` on a post and `posts` on a user. Declare
`relations()` and your names win instead; the derived pair is not added beside
them.

**MySQL is refused at startup**, with a message saying why: it has no
`RETURNING`, so `create` and `update` could not report the stored row without a
second query and a driver-specific way to identify it. An adapter that returned
the submitted data instead would hide every default and every trigger, silently.
Better to refuse than to be quietly wrong.

**Case insensitivity costs an index.** `lower(column) LIKE lower(?)` is portable
across every dialect the adapter supports, which `ilike` is not. It will not use
a plain index on that column; declare an expression index if the table is large.

---

## Writing an adapter

The honest version, from having done it once:

1. **Start with `getModels`.** Nothing else can be tested until the metadata is
   right, and most of the work is here. Write the metadata tests first — they
   are fast, they need no database, and they catch the mistakes that are
   otherwise invisible until a form asks someone for a primary key.

2. **Then `list`.** Pagination, sort, filters, search, and the refusals. Mirror
   the existing adapters' messages: an admin that says different things about
   the same mistake depending on the ORM underneath is worse than one that says
   nothing.

3. **Then the single-record methods**, then the relation ones.

4. **Map the errors last**, once you have seen real ones. Do not guess at the
   driver's shapes — write the failing case, print what comes out, then map it.
   Both shipped adapters do this from a real database, and both found surprises.

Test it against a real database, not a mock of one. `packages/drizzle/test`
runs an in-memory SQLite per suite: no fixtures to maintain, no mock to keep in
step with a driver, and a wrong `LIKE` pattern fails the way it would in
production.

Then prove the layers above do not care. `packages/nestjs/test/drizzle-e2e.test.ts`
boots the whole module over the second adapter and drives the same routes the
Prisma suite drives — metadata, filters, writes, constraint mapping, nested
relation routes, the dashboard. Nothing above the adapter changed to make it
pass, and that is the assertion.

### Publishing it

An adapter is a Core implementation, not a NestJS package — neither shipped one
imports `@nestjs/*`, and a boundary test enforces that. In this repository an
adapter is a private workspace package re-exported through a subpath of the
published one (`src/prisma.ts`, `src/drizzle.ts`), so an application that never
imports it never loads its code. A third-party adapter would simply be its own
package depending on `@nest-admin/core`.

---

## What the second adapter proved

`OrmAdapter` was written against Prisma, and until 0.11.0 Prisma was the only
implementation — which made "contract" and "description of Prisma"
indistinguishable. The point of writing the Drizzle adapter was to find out
which it was, **before** 1.0 freezes it.

The result:

- **Core needed no changes.** Not one type, not one field, not one error.
- **Nothing above the adapter needed changes.** The module, the controller, the
  query parser, the metadata DTO, the exception filter, the dashboard and the
  interface are the same code both adapters run under.
- **Everything that differed fit inside the adapter**, and each difference is
  documented at the line that handles it.

Two things did surface, and both were about the contract's _edges_ rather than
its shape:

- **`RecordId` is a single value.** A model with a composite primary key can be
  listed but not addressed, so the Drizzle adapter refuses `findOne` on one with
  a reason. Prisma had the same limitation and it had simply never been hit,
  because a Prisma schema tends to have an `@id`.
- **Not every ORM normalises errors.** The contract assumed an adapter could
  always report _which_ column a constraint was about. Drizzle can, but only by
  parsing a driver message — and on some drivers, for some violations, it
  genuinely cannot. `ConstraintError` already allowed an empty field list, and
  the interface already degrades to a banner, so this held; it was luck that it
  did rather than design.

Both are recorded in [project-state.md](project-state.md) as things to settle
before the freeze.
