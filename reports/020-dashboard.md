# 020 — Dashboard, and rows per page

`0.9.0 → 0.10.0`

Two pieces of work. One is small and was asked for directly: a table should show
as many rows as the person reading it wants. The other is the release: the admin
had a landing page that told you to go somewhere else, and now it answers a
question instead.

---

## 1. Rows per page

`perPage` was the constant `25`. A constant is a guess about a screen and a
schema that whoever chose it has never seen — a table of five columns on a tall
monitor wants a hundred rows, one of fifteen columns on a laptop wants ten.

The control offers 10, 25, 50 and 100, and stops there because the server clamps
`perPage` to 100. Offering 500 would silently deliver 100 with no explanation,
and an option that quietly does something else is worse than no option.

The choice is remembered in `localStorage`, per browser and for the whole admin
rather than per model. It belongs with the theme and the collapsed sidebar: it
is about this screen in this room, not about this table. "I like fifty rows" is
a statement about how someone reads, not about which model they are reading.

Changing the size returns to page one. Staying on page 12 while the page size
quadruples lands somewhere arbitrary, and the row you were looking at is not
there.

Stored values are validated against the offered list before use. A number from
an older version — or from someone editing storage — would otherwise become a
page size that no control on the screen can display or change.

**Files:** `apps/admin-ui/src/hooks/use-per-page.ts`,
`apps/admin-ui/src/components/ui/pagination.tsx`,
`apps/admin-ui/src/components/ListView.tsx`. Eight tests.

---

## 2. The dashboard

### What was decided, and why

**A closed set of four kinds.** `count`, `list`, `chart`, `stat`. Closed for the
same reason `FieldWidget` is: the interface has to know how to draw each one, so
an open string would mean rendering nothing with no way to notice.

It is also the line this release does not cross. An arbitrary React component as
a widget would mean the consuming application builds and bundles one — exactly
the thing this package exists not to make people do, and the reason custom pages
have been out of scope since 0.6.0.

**Three of the four are declarative, and that is a security property.** A widget
that names a model can be _authorized_. One over a resource this principal
cannot list is dropped from the document before anything is queried — not hidden
by the interface, and not "returned empty". A widget built from a closure could
not be checked, only trusted.

```ts
{ kind: 'count', title: 'Awaiting payment', model: 'Order', filter: 'status:eq:PENDING' }
```

A test asserts the stronger half of this: with `Post` denied, the adapter's
`list` is never called with `Post` at all. A dashboard is not a side channel
onto a table someone may not open.

**`stat` is the escape hatch.** It has no model, because the number it shows may
come from anywhere — a payment processor, a queue, three tables joined. It runs
application code, so the application's own rules apply to it, and its failures
are the application's failures.

**Failures are per widget.** A dashboard is several independent questions on one
page. Letting the slowest or most broken of them take the others down is the
wrong shape for that, particularly since `stat` runs code this package did not
write. One widget that throws becomes one card that says it could not load; the
cause is logged and never forwarded, because it came from application code and
carries whatever that code's errors carry.

**Nothing configured still gets a dashboard.** A count per model, and — for
models that record when a row was created — the newest few and a month of
activity. Declaring widgets _replaces_ that rather than adding to it: a
dashboard is a page someone designed, and half-designed is worse than either.

The page says where a generated dashboard came from and how to replace it. Under
the widgets, not above them: it is a note to whoever set the admin up, it stops
being interesting after the first read, and it disappears the moment a dashboard
is declared, so it cannot become permanent furniture.

### No changes to `OrmAdapter`

That contract is about to be frozen at 1.0, and every method on it is a method
every future adapter has to implement. So:

- **A count** asks for one row and reads the total the adapter already returns.
  No `count` method.
- **A chart** is one count per bucket, run concurrently. That is a query per day
  rather than one grouped query — a deliberate trade, since there is no
  `groupBy` on the contract and thirty parallel counts against an indexed column
  come back in one round trip's worth of wall clock. Measured against the
  example's SQLite database: **88 ms** for six widgets including a thirty-bucket
  chart. Buckets are capped at 90, because this is the one place where a
  configuration value turns directly into a number of queries.

### Knowing when a record was created

The most useful question a dashboard asks is "how much of this arrived
recently", and answering it needs one column that no metadata identifies.
Prisma reports `@default(now())` and `@updatedAt` the same way — the adapter
collapses both into `isGenerated`, which is right for a form, where neither is
asked of a person, and leaves nothing to tell them apart here.

So `createdFieldFor` reads names, exactly as `displayFieldFor` does, and
explicitly refuses some: `updatedAt`, `modified`, `deleted`, `archived`,
`expires`. Being wrong here is silent — a chart of "records updated per day"
under a heading that says "new records" looks entirely correct. Where the
convention is not followed the answer is `undefined` and the widget is simply
not offered.

Against the example's eleven models this produced ten counts, a chart on `User`
and recent lists for `User` and `Product` — and correctly offered no chart for
`Post`, `Order` or `Tag`.

### The interface

Four components, no chart library. Recharts is 400 KB of source and brings
d3-scale, d3-shape and d3-array with it; what this needs is one series, one
axis, and a tooltip. Sixty lines of SVG does that, takes the design tokens
rather than a `theme` prop, and adds nothing measurable to the bundle. The same
call as the calendar in 0.8.1, and it will be the wrong call the moment the
dashboard needs a second series or a legend.

The tooltip is an SVG `<title>`, not a floating div that follows the pointer: it
is the shape's `alt`, the browser draws it, a screen reader reads it, and it
cannot be positioned wrongly at the edge of a container.

Details that matter more than they look:

- **The number is the link.** Someone who reads a count and wants the rows
  reaches for the count, so that is what is clickable — not a "view" affordance
  in the corner. The widget's filter travels with it, so the list opens on the
  same rows the number counted.
- **A zero-height bar is drawn as a stub**, so an empty day reads as a day with
  nothing in it rather than as the chart having stopped. The peak has a floor of
  1, because every value being zero is a real answer and dividing by it is not.
- **Down is not red.** Fewer cancellations is a good week. The arrow and the
  sign carry the direction; only growth takes the accent colour.
- **The grid spans are literal class names in a lookup**, because Tailwind reads
  source as text — an interpolated `col-span-${n}` produces markup pointing at
  CSS that was never generated.
- **The skeleton is the shape of what is coming** — four narrow cards and two
  wide ones — so the page does not jump when the document lands.

### Two things the work found

**The route was declared in the wrong place.** `@Get('dashboard')` sat after
`@Get(':model')`, so `/admin/dashboard` was read as a request for a model named
"dashboard" and answered 404. The comment above it claimed the opposite. Found
by the first test that asked for the document over HTTP; the fix is one block
moved, and the ordering is now asserted.

**A widget's filter was being parsed twice, differently.** The dashboard had its
own three-way split of `field:op:value`, which produced the _string_ `"true"`
where the list screen's parser produces the boolean. Against SQLite that returns
no rows — not an error, just a widget that quietly says zero. `parseFilters` is
now exported as `parseFilterExpression` and both paths go through it, so a
declared filter is coerced against the schema and an unknown operator is refused
the same way it is in a URL.

**A model was named two ways.** The sidebar said "People" because the
application labelled it so; the generated dashboard said "User". Model labels
now reach the generated titles. Declared widgets are untouched — their author
already wrote the title.

---

## Verification

Beyond the suite, this release was driven three ways against the example
application and the real Prisma adapter:

| What                                                                                       | Result                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| The declared dashboard over HTTP, with a real session                                      | 200, six widgets, 88 ms                                                         |
| The same document without a session                                                        | 401                                                                             |
| The **shipped bundle** (`dist/admin-ui/assets/*.js`) in a real DOM against the live server | 10/10 checks, including 30 drawn bars and a link that opens the rows it counted |
| The zero-config dashboard over the eleven-model schema                                     | 13 widgets, correct models chosen for charts and lists                          |

The DOM check first passed on a false positive — it waited for the text
"Dashboard", which the sidebar link supplies while the page is still loading. It
now waits for the page's own copy.

---

## Numbers

|                       | 0.9.0    | 0.10.0   |
| --------------------- | -------- | -------- |
| Tests                 | 834      | 864      |
| Test files            | 47       | 49       |
| Packed-package checks | 48/48    | 48/48    |
| Bundle (gzip)         | 135.8 KB | 138.2 KB |

The 2.4 KB covers the dashboard, the bar chart, the rows-per-page control and
the locale helper.

---

## What is not here

- **No widget the application draws itself.** Still the 0.6.0 line: no consumer
  bundles a component.
- **No time-range control.** Every widget declares its own period. A global
  range picker changes what a `stat`'s `load` means, and that needs deciding
  before it is offered rather than after.
- **No per-viewer layout.** Widget order is the application's design, not a
  preference. Dragging cards around is a feature that needs somewhere to store
  the result, and the admin has no per-account storage.
- **No auto-refresh.** A dashboard that re-queries on a timer is a dashboard
  that quietly multiplies its query count by the number of tabs left open.

Next, per the roadmap: 0.11.0, customisation.
