# 0.8.1 — Interface Polish

Status: **complete.** Fifteen items from a review of the running interface. No
dashboard, no authentication, nothing published.

---

## 1. What This Was

0.8.0 rebuilt the interface on a design system and called it done. Using it for
an afternoon produced a list of fifteen things wrong with it — most of them the
kind that only appear when you actually work in a screen rather than look at a
screenshot of it.

Two of the fifteen are reversals of decisions made in 0.8.0 on bundle grounds.
They were the right calls on the evidence available and the wrong calls on the
evidence of using the thing, and §3 says so plainly rather than quietly
swapping them out.

**750 tests** (was 713), 48/48 packed-consumer checks. The bundle went from
**104 KB to 134 KB gzipped** — §7 accounts for it, including the 20 KB given
back by not installing a calendar.

---

## 2. The List

|                                                       | Fixed                                                |
| ----------------------------------------------------- | ---------------------------------------------------- |
| The sidebar scrolled away with the page               | Sticky under the header, with its own scrollbar      |
| Native selects everywhere                             | Radix listboxes; **zero** native `<select>` left     |
| "View" as a word in every row                         | Icons, named after the record                        |
| No way to give a resource an icon                     | A `ModelIcon` option, closed set, server-side        |
| No edit or delete without opening the record          | Both in the row                                      |
| Pagination was Previous/Next only                     | Numbered, with a steady-width window                 |
| The filter dropped to its own line beside empty space | One wrapping row                                     |
| Buttons showed the arrow cursor                       | `cursor: pointer`, and hovers that move              |
| Native date inputs                                    | A calendar in a popover, drawn by this design system |
| No breadcrumbs                                        | Home / Resource / Record, on every screen            |
| Forms stopped at half the page                        | Full width, two columns where it helps               |
| A three-way theme control                             | One button                                           |
| No home for a growing set of row actions              | An overflow menu                                     |
| Loading was three grey bars                           | Table and form skeletons shaped like what is coming  |
| The sidebar snapped open and shut                     | An eased width transition, and a drawer that slides  |

---

## 3. Two Reversals, Named

0.8.0 refused Radix's Select and removed its DropdownMenu, on measurements:
about 40 KB for the first, 17 KB gzipped for the second. The reasoning was
about _capability_ — a native `<select>` is accessible, keyboard-operable, and
opens the platform picker on a phone — and all of that is still true.

What it did not account for is that **a native `<select>` cannot be styled**.
Its popup is drawn by the operating system: system font, system metrics, and
the system's light palette even when the admin is in dark mode. One control
that ignores the theme is enough to make everything around it look like a skin
over something else, and there were eight of them.

The dropdown came back for a case three buttons cannot cover: a row's actions.
View, edit, delete and however many an application declared do not fit in a
cell, and five icons in a line is worse than a menu even when they do.

The marginal cost is lower than the sum suggests. Radix's positioning engine is
one dependency shared by the select, the menu and the popover — what was 150 KB
of source for a single theme toggle is now that same engine serving three
consumers that each need it.

**The measurement discipline did not change; the thing being measured did.**

---

## 4. The Sidebar

The complaint was that it scrolled away with the page: on a long table the
links ended up above the viewport, and getting back to them meant scrolling to
the top first. It is now `sticky` under the header with `overflow-y-auto` and a
height of `calc(100svh - 3.5rem)`, so it stays put and scrolls independently
when a schema has more models than fit.

**Collapsing changed shape.** 0.8.0 removed the navigation from the page
entirely, which took every link out of reach and out of the tab order and made
the collapse an all-or-nothing choice nobody makes twice. It now narrows to a
rail: the links stay, still reachable, still named — `aria-label` carries the
name whether or not it is drawn — and the change is a width transition rather
than an element appearing and disappearing.

That is a deliberate behaviour change, and the test that asserted the old
behaviour was rewritten to assert the new one. It says so, in the test.

**Icons are a configuration option**, not a decoration applied to everything:

```ts
models: {
  User: { label: 'People', icon: 'users' },
  Order: { icon: 'receipt' },
}
```

A closed list of 33 names, for the same reason `FieldWidget` is closed — the
interface has to know how to draw each one, so an open string would render
nothing and give no way to notice. It is also what keeps the bundle honest:
`lucide-react` has about fifteen hundred icons and only the named ones ship.

A model without an icon is drawn without one, which is a real answer rather
than a lesser state: the same symbol repeated down a column is decoration. On
the collapsed rail the resource's initial stands in, because there something
has to tell one row from the next.

---

## 5. Rows, and Where Danger Lives

The split is by frequency and by risk:

- **View and Edit** are one click, as icon buttons named after the record —
  `View Ada Lovelace`, not `View`. Forty rows of the word "View" tells a screen
  reader forty times that there is a link and never which record it opens.
- **Delete, and anything the application declared**, are one click further,
  behind an overflow menu.

That second part is not only about space. A destructive control sitting under
the cursor of a control people click all day is how records go missing by
muscle memory. The confirmation names the record, because "Delete this record?"
on a table of forty is a question about which one.

The menu is absent when there is nothing to put in it, and a `list`-scoped
action never appears on a row — it applies to the model, and offering it there
would imply otherwise.

---

## 6. A Calendar, Written Rather Than Installed

The date picker was first built on `react-day-picker`, which is the obvious
choice. Measuring afterwards:

```
react-day-picker   155.7 KB source
date-fns           129.3 KB   (a dependency of it)
@date-fns/tz        24.3 KB   (a dependency of that)
                   ─────────
                   309.3 KB   for one control
```

More than every other dependency in the interface put together. What it buys is
ranges, multiple months, disabled-day predicates and a plugin surface; what is
needed here is one date, one month at a time.

The replacement is about a hundred lines with no dependencies, and it does not
skimp on the parts a date library is actually for:

- Month names, weekday names and day labels from `Intl.DateTimeFormat`, in the
  viewer's locale.
- **The week starts where their locale starts it.** `Intl.Locale.getWeekInfo`
  where available, Monday otherwise. Hard-coding Sunday is a thing that looks
  correct to whoever wrote it and is wrong for most of the world.
- One tab stop for the whole grid, with arrows moving a day and rolling into
  the next month, PageUp/PageDown a month, Home/End the ends of the week.
  Forty-two buttons in the tab order would mean forty-two presses to get past a
  calendar.
- Moving is not choosing: arrows explore, only Enter or a click commits.
- **Local dates, not UTC.** `toISOString` moves the day by one for anyone far
  enough east or west, which is the classic off-by-a-day in every date field.
  There is a test for it.

The text box beside it is not a display for the calendar — it still accepts a
typed date, because someone who knows the date should not have to click through
a month to enter it.

**20 KB gzipped, recovered.**

---

## 7. The Bundle

|             |        0.8.0 |        0.8.1 |
| ----------- | -----------: | -----------: |
| JavaScript  |     325.0 KB |     407.7 KB |
| CSS         |      30.8 KB |      35.9 KB |
| **gzipped** | **104.1 KB** | **134.1 KB** |

Where the 30 KB went:

```
@radix-ui/react-select   52.3 KB source   §3 - the styleable listbox
@radix-ui/react-menu     36.0 KB          §3 - row actions
@floating-ui/core        35.4 KB   ┐ one positioning engine, three consumers:
@floating-ui/dom         27.3 KB   ┘ select, menu, popover
@radix-ui/react-collection 17.7 KB
lucide-react             42.6 KB          was 19.5 - more icons are now used
(the calendar)            ~4 KB           written here; see §6
```

Not spent: `react-day-picker` and its two dependencies, 309 KB of source.

---

## 8. What the Work Found

**A real bug in the pager, caught by its own test.** `pageSlots(1, 5)` returned
`[1, 2, 'gap', 5]` — an ellipsis standing for two pages, in a set of five that
would have fitted whole. Worse, it broke the property the shape exists for: the
number of slots changed as you moved through the pages, so the buttons moved
under the cursor and the next click landed on a different number than the one
it was aimed at. Fixed by listing every page when the total is no wider than
the widest window.

**A test that was about the machine running it.** The calendar's assertions
used labels like `14 March 2026`; in `en-US` the label is `March 14, 2026`, so
they passed or failed by locale. The locale is now pinned in the test — to
`en-GB` rather than the default, deliberately, because it starts the week on
Monday and so exercises the week-start handling instead of assuming it.

**The cursor was never set.** A `<button>` inherits `cursor: default` from the
user agent — the same arrow the page background has. It is the cheapest signal
an interface has that something responds, and its absence is most of what makes
one feel dead before anyone can say why. Now a base rule covering buttons,
links, `summary`, `label[for]`, and the ARIA roles that are pressable, with
disabled controls excluded because there the arrow is honest.

---

## 9. Verified in a Real Consumer

Against the packed tarball, driving the real bundle in a real DOM:

```
sidebar        sticky top-14 overflow-y-auto transition-[width] w-56
               collapse -> w-14, links still present (4), expand -> w-56
breadcrumb     Home / People
toolbar        search, sort and filter as three children of one wrapping row
row actions    "View Ada Lovelace", "Edit Ada Lovelace",
               "More actions for Ada Lovelace" -> menu: Delete
pagination     Previous page · 1 · Next page, current marked aria-current
selects        0 native <select> left; sort is role=combobox, 15 options
theme          one button: "Switch to dark mode" -> .dark -> "Switch to light mode"
stylesheet     cursor:pointer rule present, @keyframes na-* present
console        no errors
```

And against the example application, which is the one that configures icons:

```
nav links              10
icons drawn            10
brand colour           --primary:#3f6212 applied
date picker            present, with the typed field beside it
form                   w-full, lg:grid-cols-2
enum                   a combobox, not a <select>
breadcrumb             Home / Post / Create new
console                no errors
```

---

## 10. Verification

| Check                 | Result                   |
| --------------------- | ------------------------ |
| `pnpm build`          | 0                        |
| `pnpm typecheck`      | 0                        |
| `pnpm format:check`   | 0                        |
| `pnpm test`           | **750 passed**, 41 files |
| `pnpm verify:package` | **48/48**                |

New tests: 37.

| File                               | Covers                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar.test.tsx` (13)           | Six-week grid, month paging, arrow keys rolling into the next month, one tab stop, moving-is-not-choosing, local dates, typing still working |
| `row-actions.test.tsx` (9)         | Named links, the menu's contents, the confirmation naming the record, declared actions, the menu's absence when empty                        |
| `pagination.test.ts` (9)           | The window's shape and its steady width — found the bug in §8                                                                                |
| `breadcrumb.test.tsx` (5)          | Every step but the last is a link; the last is the current page                                                                              |
| `shell.test.tsx` (+1, 5 rewritten) | The single-button toggle, following the system by default, collapsing to a rail, icons where configured                                      |

Four existing tests were rewritten. Two for markup — an actions column that now
has a screen-reader heading, and selects that are listboxes whose options exist
only when open. Two for behaviour that changed on purpose: the theme control and
the sidebar collapse. Both say so, in the test, next to the assertion.

---

## 11. Known Limitations

- **The sidebar's stickiness is not covered by a test.** jsdom has no layout,
  so a test could only assert the class name — which is testing the
  implementation rather than the behaviour. Verified in a real DOM instead, and
  recorded here rather than faked.
- **No column sorting from table headers.** Sorting is still a toolbar control.
- **The overflow menu does not report a failed action in place.** A failed row
  action shows "Failed" beside the row; there is no room for the message, and
  the detail page is where it can be read.
- **The calendar has no time picker.** A datetime field keeps its time and the
  text box edits it; the calendar changes only the day.
- **`ModelIcon` is 33 names.** Adding one is a change in two files — Core and
  the interface's own copy of the contract — and `satisfies` makes forgetting
  either a compile error.

---

## 12. Result

```
sidebar stays put, scrolls on its own:            PASS
sidebar collapses smoothly, keeps its links:      PASS
icons on resources, where configured:             PASS
every select is ours, none is the platform's:     PASS
row actions as icons, named after the record:     PASS
edit and delete without opening the record:       PASS
overflow menu for the rest:                       PASS
numbered pagination:                              PASS
search, sort and filter on one row:               PASS
pointer cursor and real hover states:             PASS
a calendar that belongs to this design system:    PASS
breadcrumbs on every screen:                      PASS
forms use the whole page:                         PASS
one theme button:                                 PASS
skeletons shaped like what is coming:             PASS
mobile drawer that slides:                        PASS
column sorting from headers:                      NOT IN SCOPE — §11
```

|               | Before   | After    |
| ------------- | -------- | -------- |
| Tests         | 713      | **750**  |
| Packed checks | 48/48    | 48/48    |
| Bundle (gzip) | 104.1 KB | 134.1 KB |
| Version       | 0.8.0    | 0.8.1    |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.9.0 — Authentication**, unchanged from the roadmap.
