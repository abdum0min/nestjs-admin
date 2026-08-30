# examples/basic

A real consumer of the published package, not documentation scaffolding. It
imports `@nest-admin/nestjs` and its `./prisma` subpath — nothing from
`@nest-admin/core` or `@nest-admin/prisma` directly — exactly as an application
that ran `npm install` would.

It proves the whole chain:

```text
consumer app → public package → AdminModule → auth → resource authorization
             → metadata → Prisma adapter → SQLite → Admin UI at /admin
```

## Run it

From the repository root:

```bash
pnpm install
pnpm build                                         # the package itself
pnpm prisma:setup                                  # generated client + dev.db
pnpm --filter @nest-admin/example-basic seed       # ~1,150 sample rows
pnpm --filter @nest-admin/example-basic start
```

Then open **http://localhost:3000/admin**.

## The schema

Eleven models, chosen so that each is a shape the admin has to handle
differently from the others. Two models proved the CRUD engine worked; they
proved nothing about the shapes a real schema has, and every relation defect
this project has shipped was found by pointing the admin at a schema with one
more shape than the fixtures had.

```text
User ─┬─ 1:1 ── Profile            the only @unique on a foreign key
      ├─ self ── manager/reports   optional both ways
      ├─ 1:n ── Order, Post, Comment, Review

Category ── self ── parent/children    a tree, two levels deep
         └─ 1:n ── Product

Product ─┬─ n:1 ── Category         required: a bad key is a 409
         ├─ m:n ── Tag              implicit join table
         └─ 1:n ── OrderItem, Review

Post ─┬─ m:n ── Tag                 a second m:n sharing one side
      └─ 1:n ── Comment ── self ── parent/replies   threaded

Order ── 1:n ── OrderItem           a join table *with payload*
Review                              composite @@unique(productId, userId)
```

Plus the scalar variety the metadata mapper has to describe: three enums,
optional and required strings, integers, floats, booleans, `now()` and
`@updatedAt` timestamps, and nullable dates that mean "has not happened yet".

None of it appears in this project's TypeScript. Adding a model to
`prisma/schema.prisma` and re-running `pnpm prisma:setup` makes it appear in the
interface with no code change.

## The seed

`seed.mjs` is deterministic: faker is given a fixed seed, so every run produces
byte-identical data. Two people looking at the same bug should be looking at the
same rows.

It **empties every table first**. `dev.db` is a throwaway that `pnpm
prisma:setup` already recreates whenever the schema changes.

```text
Category 11   Tag 20    User 60    Profile 42   Product 120
Order 90      OrderItem 287        Review 220   Post 40      Comment 260
```

Six people are hand-written rather than generated — Ada Lovelace, Alan Turing,
Grace Hopper, Barbara Liskov, Linus Torvalds, Donald Knuth — so there is
something specific to search for. Ada manages Alan and Grace; most of the other
54 report to one of those two.

## What it configures

| Concern                | How                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Database client        | The app builds it, with a driver adapter. The framework never does                                                             |
| Authentication         | An `AdminAuth` reading `x-admin-token`, enabled by setting `ADMIN_TOKEN`. Unset means open — fine locally, nowhere else        |
| Resource authorization | Left permissive, so the example is usable for exploring. The shape a per-model rule takes is in a comment beside it            |
| Hidden fields          | `User.passwordHash` is `hidden`, so it leaves the server in no response at all                                                 |
| Labels and widgets     | `sku` reads "SKU"; `bio` and `body` are textareas; `colour` is a colour picker; `email` and `website` get their input types    |
| Display fields         | An Order is named by its `reference`, not its id — ORD-00042 is what people say out loud                                       |
| Hooks                  | A Post's slug is derived from its title; a rating outside 1–5 is refused, naming the field; a published Post cannot be deleted |
| Actions                | Publish a post, archive every draft, approve a comment, mark an order shipped                                                  |

`User.passwordHash` is nullable in the schema, and that is not an accident: a
**required** column with no default cannot be hidden, because that would leave
no way to supply a value and every create would fail. The module refuses to
start rather than let that happen.

The auth implementation is deliberately crude. Its point is to show where your
identity system plugs in, not to be one — the framework never inspects a
credential itself.

## Worth trying in the interface

- **Search "Lovelace"** in People, then open her and look at _Reports_.
- **Open a Category** like Hardware and page through its children, then open a
  child and follow _Parent_ back up.
- **Open a Product** and attach or detach a Tag — then open that Tag and see the
  product on the other side. That is one many-to-many, edited from both ends.
- **Open an Order** and look at its lines. Try to detach one: the admin explains
  that `OrderItem.order` is required, so the record cannot exist without an
  order, rather than offering a button that would fail.
- **Open a Comment that is a reply** and follow _In reply to_; open the parent
  and see the replies listed.
- **Create a Product with an sku that already exists** — a 409 naming the field,
  not a 500.
- **Create a Review twice for the same person and product** — the composite
  unique is reported naming both columns.
- **Delete a published Post** — refused by a hook, with the reason.
- **Select several rows and delete them** — the result says what happened to
  each.

## Try the API directly

```bash
curl localhost:3000/admin/meta
curl 'localhost:3000/admin/Product?search=keyboard&sort=price:desc'
curl 'localhost:3000/admin/Product?filter=category:eq:<categoryId>'
curl 'localhost:3000/admin/User/<id>/reports'
curl 'localhost:3000/admin/Order/<id>/items'

# a duplicate value is a conflict naming the column
curl -X POST localhost:3000/admin/Product -H 'Content-Type: application/json' \
  -d '{"sku":"SKU-0001","name":"Clash","price":1,"categoryId":"<id>"}'

# unsupported syntax is refused rather than ignored
curl 'localhost:3000/admin/User?filter[age][gte]=18'   # 400
```

With `ADMIN_TOKEN` set, add `-H 'x-admin-token: <value>'`; without it you get
`401`, and with a wrong value `403`.

## A limitation this schema makes visible

`User.profile` is the non-owning half of a one-to-one: the `@unique` foreign key
lives on `Profile`, so `User` has no column for it. The admin therefore shows
the relation from `Profile` (a link to its User) but **not** from `User` — the
field is absent from the record and `GET /admin/User/:id/profile` answers 400.

Deliberate as far as the loader goes — there is no column on that side to
resolve — but the consequence is that half of every one-to-one is invisible.
Recorded in [`docs/project-state.md`](../../docs/project-state.md).
