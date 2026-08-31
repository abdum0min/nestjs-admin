# 0.8.0 — Design System

Status: **complete.** No dashboard, no authentication, no new HTTP endpoint,
nothing published.

---

## 1. Executive Summary

Every capability was already there — relations, permissions, actions, hooks,
theming, accessibility — and none of it read as a product someone would choose
on sight. The interface was 680 lines of hand-written CSS and looked it. For a
package whose whole pitch is "you do not build an admin", the admin has to look
like one you would have paid for.

This release rebuilds the interface on Tailwind and shadcn/ui without adding a
single capability, and takes the theming system from three CSS variables to a
role-based token set the server can brand correctly in both palettes.

Delivered:

- **A token system** — every colour a role, defined once, light and dark.
- **A dark mode toggle**, three-state and remembered. Closes a limitation
  carried since 0.6.0.
- **A shell** — collapsible sidebar, mobile drawer, command palette on Ctrl+K.
- **Real dialogs** replacing `window.confirm`, focus-trapped and announced.
- **Server-side colour arithmetic**, so a brand colour is readable in both
  palettes by construction rather than by luck.
- **Contrast held by a test** that reads the stylesheet and measures it.

**713 tests** (was 627), 48/48 packed-consumer checks. The interface bundle
grew from **68 KB to 104 KB gzipped**; §7 accounts for every kilobyte and for
the 17 KB that were given back.

Four defects surfaced, three of them by rebuilding rather than by reading — §6.

---

## 2. What Was Taken, and What Was Not

shadcn/ui is not a dependency: the components are copied into
`apps/admin-ui/src/components/ui/` and we own them. That is the point of it —
no component library's release cycle, no version to chase, and any of them can
be changed the day a screen needs something different.

What it _does_ bring is Radix, as real runtime dependencies bundled into the
SPA. Those were chosen one at a time, and three of the obvious ones were
refused:

| Component           | Taken?      | Why                                                                                                                                                                                                                                                             |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dialog, AlertDialog | **yes**     | Focus trap, escape, correct roles. Used by the palette, the mobile drawer and every confirmation — three call sites, one dependency                                                                                                                             |
| Slot                | **yes**     | A few hundred bytes; makes `<Button asChild>` a link without duplicating styles                                                                                                                                                                                 |
| cmdk                | **yes**     | 12 KB for the command palette, and it brings Dialog which was already in                                                                                                                                                                                        |
| **Select**          | **no**      | Radix Select exists to render options as arbitrary markup. Nothing here needs that. The native element is already accessible, already keyboard-operable, and on a phone it opens the platform picker — better than any listbox reimplementation. ~40 KB saved   |
| **Checkbox**        | **no**      | Same reasoning, plus one specific to this codebase: the header checkbox has three states, and `indeterminate` is a property the native element already supports. Reimplementing it on `<button role="checkbox">` means reimplementing the part that was correct |
| **DropdownMenu**    | **removed** | See below                                                                                                                                                                                                                                                       |

### The dropdown that cost 17 KB

The theme toggle was first written as a dropdown menu. Measuring the bundle
afterwards showed what it had pulled in:

```
@radix-ui/react-menu        36.0 KB source
@floating-ui/core           35.4 KB
@floating-ui/dom            27.3 KB
@radix-ui/react-collection  17.7 KB
react-remove-scroll         15.6 KB
@radix-ui/react-popper      13.5 KB
```

Over 150 KB of source, to place one small list of three items. It is now a
segmented control: three buttons, always visible, zero dependencies — and one
click instead of two, showing the current choice without being opened.

**17 KB gzipped, recovered by deleting a component.** The lesson is not that
Radix is expensive; it is that a bundle is only measurable after it is built,
and "this seems small" is not a measurement.

### tailwind-merge, kept deliberately

103 KB of source, **8.6 KB gzipped** — measured by building without it. It buys
one thing: when a caller passes `className`, the caller wins, deterministically.
Without it the winner depends on the order Tailwind happened to emit the two
classes, which is not something a call site can reason about. The mobile drawer
alone overrides six of `DialogContent`'s own utilities. Worth 8.6 KB.

---

## 3. The Token System

Every colour is a role — `bg-background`, `text-muted-foreground`,
`border-border` — defined once in `index.css` and again under `.dark`. No
component names a colour. Three things follow, and all three are the point:

1. Dark mode needs no second palette in any component.
2. The server brands the admin by overriding one variable, because that
   variable is what every component actually reads.
3. **A contrast failure is fixed in one place rather than forty.**

Two implementation notes worth keeping:

**`@theme inline`, not `@theme`.** Inline maps `bg-card` to `var(--card)`
rather than compiling the current value into the class. Without it the server's
override would arrive too late to matter — Tailwind would already have baked
the default in.

**Values in oklch.** Perceptual lightness: `oklch(0.55 0.2 265)` and
`oklch(0.55 0.2 25)` are the same apparent brightness in blue and in red, which
hex cannot promise. A palette whose steps drift in brightness is how a theme
ends up legible in one hue and not another. The server still injects hex,
because hex is what a brand guide gives you, and CSS takes both.

---

## 4. A Brand Colour the Server Can Reason About

An application sets one hex value. The interface has to answer three questions
from it: what text can be read on top of it, and whether it is visible against
a light page and against a dark one.

0.7.0 answered one of those by hand and got it wrong — the active navigation
item was white on the accent, at **2.52:1**, on the one element whose job is to
say where you are. This release does the arithmetic instead:

```
theme.brandColor: '#0b6e6e'
  →  :root { --primary: #0b6e6e; --primary-foreground: #fbfbfc }
     .dark { --primary: #428f8f; --primary-foreground: #171a1f }
```

The dark teal is unchanged on a light page and **lifted** for a dark one, where
it would otherwise sit at 2.4:1 against near-black. The ink is whichever of the
palette's near-white and near-black contrasts better — never a fixed choice.

CSS cannot do this. `oklch(from …)` comes close, but "pick whichever of two
contrasts better" is a branch, and a stylesheet has no branches. The server has
the value and can simply look.

**The floor is 4.5:1, not 3:1**, and that is a deliberate call. 3:1 would be
enough if `--primary` were only ever a filled button, where the label carries
the contrast. It is not: the same token is the focus ring, the active
navigation item, and the colour of every link in a table. One token used in
four roles has to satisfy the strictest of them. The cost is stated plainly —
a very light or very dark brand comes out shifted, and the hue, which is the
part people recognise, is what survives.

---

## 5. Contrast, Measured Rather Than Looked At

The palette was rebuilt from nothing, so every pairing was new. Measuring it
found two failures immediately:

|                                          | Measured                  | Now                 |
| ---------------------------------------- | ------------------------- | ------------------- |
| `--warning` against its own text (light) | 4.05:1 — below the floor  | **5.58:1**          |
| `--input`, the edge of a text field      | 1.41:1 light, 1.63:1 dark | **3.06:1 / 3.47:1** |

The second is worth dwelling on. WCAG 1.4.11 asks for 3:1 on anything whose
boundary is what identifies it as a control, and a text field's border is
exactly that — there is nothing else to say "you can type here". The pale
hairline most component libraries use, including the one this was copied from,
measures about 1.4:1 and fails it.

A table's row rule is _not_ such a boundary — the text does that work — so
`--border` stays quiet and is held to a different bar. `contrast.test.ts`
encodes the distinction: 41 assertions across both palettes, reading the
stylesheet rather than a duplicate table, because a test with its own copy of
the colours passes forever after someone edits the real ones.

That file is the actual deliverable here. 0.7.0 found two contrast failures by
hand and fixed them by hand; the third appeared the moment the palette changed.

---

## 6. What the Rebuild Found

Four defects, three of which no amount of reading would have surfaced.

### `theme` was silently ignored in `forRootAsync`

`path`, `uiRoot` and `theme` are structural — routes are registered and the
shell rendered before any provider exists — so they belong beside `imports`,
not in `useFactory`. `AdminModuleFactoryOptions` omits all three, which looks
like something the compiler prevents.

It does not. Excess property checking runs on an object literal assigned to a
typed target; a factory's return reaches that target through a **function**
type, where the check does not run. The option is accepted and dropped.

Found because the reference consumer written the previous day put `theme`
inside the factory, typechecked clean, and served an unbranded page. Now a boot
failure that names the option and says where it belongs.

### An unknown `theme` key did nothing, quietly

The same consumer also wrote `accent` where the option is called `brandColor`.
Nothing read it, nothing said so, and the only symptom was a colour that never
arrived. Every other part of the configuration — `resources`, `models`, the
field overrides — refuses an unrecognised name at startup. Theming now does too.

### The sidebar called resources by their column name

Every screen said "People"; the sidebar said `User`. Only a screen reader user
would have noticed the mismatch being read out.

### Cancelling a dialog dropped focus to the top of the page

Radix returns focus to its own `Trigger`, and this confirmation has none — it
is opened by a promise from wherever the call site happens to be. So cancelling
left a keyboard user at `<body>`, dozens of tab stops from the button they had
just pressed.

Found by walking the whole interface with no mouse, not by reading the code.
The provider now records what had focus and restores it.

---

## 7. The Bundle, Accounted For

|             |       0.7.0 |        0.8.0 |
| ----------- | ----------: | -----------: |
| JavaScript  |    215.1 KB |     317.4 KB |
| CSS         |      6.7 KB |      30.4 KB |
| **gzipped** | **68.0 KB** | **104.1 KB** |
| brotli      |     58.7 KB |      89.8 KB |
| tarball     |      543 KB |       677 KB |

Where it went, by source size:

```
react-dom            532.6 KB   unchanged - the floor
(the application)    131.4 KB
tailwind-merge       103.1 KB   §2 - measured at 8.6 KB gzipped
lucide-react          19.5 KB   tree-shaken; verified by grepping the output
                                for icons we never import - none present
react-remove-scroll   15.6 KB   ┐
@radix-ui/dismissable 14.6 KB   ├ Radix Dialog and its parts: ~52 KB
@radix-ui/dialog      12.7 KB   │
@radix-ui/slot        10.0 KB   ┘
cmdk                  12.0 KB   the command palette
```

Nothing here is a consumer dependency: it is bundled into the SPA the package
serves, so an application installing `@nest-admin/nestjs` still installs one
runtime dependency.

36 KB gzipped, once, cached thereafter, for an internal tool. Stated rather
than hidden, and the 17 KB in §2 shows the budget was actually spent rather
than assumed.

---

## 8. jsdom, and the Gap the Roadmap Named

The roadmap predicted this: _"Radix uses portals, ResizeObserver and pointer
events, none of which jsdom implements fully."_

Portals and focus traps worked immediately — the first failing test dump showed
`data-scroll-locked` and Radix's focus guards already in the document, so no
work was needed there. `ResizeObserver` was the one that bit: cmdk constructs
one, jsdom has none, and the command palette **silently failed to open** with a
`ReferenceError` swallowed into a console handler. Three stubs in the test
setup fixed it, and the palette now has 6 tests of its own.

Worth stating precisely: those stubs are in the **test** environment, not in
the product. Every browser the admin targets has all three.

### The rule held

Eight tests failed after the rewrite. Every one was a changed mechanism or
changed markup, and none was a changed behaviour:

| Failure                             | Cause                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `window.confirm` not called (×3)    | The confirmation is a real dialog. The assertion — nothing is sent until it is answered — is unchanged, and is now stronger: two tests were added for escape-to-decline and the alert role |
| "Found multiple elements: Ada" (×2) | The detail page names the record in its heading as well as its field list                                                                                                                  |
| `.form__row`, `.state--error`       | Styling classes used as test handles. Replaced with `data-slot`, which is what the element _is_ rather than how it looks                                                                   |
| `(1)` in a relation heading         | The count is a badge                                                                                                                                                                       |

Two rewrites went too far and were caught by the tests failing again: a blanket
"find the heading" replacement was applied to list pages, where the record name
is a table cell.

---

## 9. Housekeeping That Blocked Publishing

Folded in because it is an hour of work and is exactly the sort of thing that
gets skipped again:

- **The peer range now matches the code.** It said `@prisma/client >=6.0.0 <9`
  while the version gate accepts major 7 only and `@prisma/get-dmmf` is pinned
  to 7.10.0 — so a consumer on Prisma 6 installed with no warning and failed at
  startup. Narrowed to `^7.0.0`, which is what is actually true.
- **`engines` is declared in the published manifest.** The CI matrix describes
  itself as testing "the floor declared in `engines`"; that floor existed only
  in the root manifest, which is never published.
- **`keywords`** added, for a project whose goal is to be found.
- **The README's banner** said "no MVP functionality is implemented yet" and
  offered a placeholder install name, at 0.7.0. Corrected — the full rewrite is
  still 0.12.0. `docs/project-state.md` had asserted the README was current;
  that claim was wrong, made without reading past its first section, and is
  now corrected in place.

`repository`, `homepage`, `bugs` and `author` are **not** added: there is no
git remote and no URL anywhere in the repository, and inventing one would be
worse than leaving the field out. They need a decision, not a guess.

---

## 10. Verified in a Real Consumer

Against the packed tarball, driving the real bundle in a real DOM:

```
brand colour, from the server
  light primary / ink        #0b6e6e / #fbfbfc
  dark primary / ink         #428f8f / #171a1f      (lifted for the dark page)

shell
  sidebar names the label    People                 (not "User")
  search button              yes

appearance
  choosing Dark              html class "dark", colorScheme dark, remembered
  choosing Light             back to light

command palette
  Ctrl+K                     opened, 8 entries, closed again
  focus                      in the search box
  typing "Prod"              Product | New Product

confirm dialog
  role                       alertdialog
  names the count            6 records?
  focus                      inside it
  cancel                     closes it, selection kept

console                      no errors
```

Keyboard only, no mouse events dispatched:

```
skip link           stop 1 -> admin-main
New button          stop 13 -> form -> Save at stop 3 -> record created
Delete              stop 15 -> dialog, focus inside, Escape closes it
palette             Ctrl+K -> focus in the box -> filters as you type
```

---

## 11. Verification

| Check                 | Result                   |
| --------------------- | ------------------------ |
| `pnpm build`          | 0                        |
| `pnpm typecheck`      | 0                        |
| `pnpm format:check`   | 0                        |
| `pnpm test`           | **713 passed**, 37 files |
| `pnpm verify:package` | **48/48**                |

New tests: 86.

| File                                               | Covers                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/admin-ui/test/contrast.test.ts` (41)         | Every text and surface pairing in both palettes, read from the stylesheet                                |
| `packages/nestjs/test/theme-colour.test.ts` (21)   | The colour arithmetic, asserted as a guarantee across eight awkward brands rather than as literal output |
| `apps/admin-ui/test/shell.test.tsx` (13)           | Appearance, the resource list, the command palette                                                       |
| `packages/nestjs/test/for-root-async.test.ts` (+4) | Structural options refused, with a message that says where they belong                                   |
| `packages/nestjs/test/extensions.test.ts` (+4)     | The emitted pairing, the appearance, unknown keys, bad appearances                                       |
| `apps/admin-ui/test/bulk-select.test.tsx` (+3)     | The alert role, escape-to-decline, focus returned to the opener                                          |

---

## 12. Known Limitations

- **No per-model icons in the sidebar.** Every entry would get the same one,
  and a symbol repeated down a column is decoration rather than information.
  Icons need the application to choose them, which is 0.11.0.
- **No sortable table headers.** Sorting is still a toolbar control.
- **The command palette lists resources only** — not records, not actions.
  Searching records across models needs a server endpoint that does not exist.
- **Still no automated accessibility audit.** The contrast test is real and
  covers the palette, but nothing runs axe or Lighthouse over a rendered page.
- **The theme reaches a colour, a title, a logo and an appearance.** Fonts,
  radius, density and a full palette are 0.11.0, as planned.
- **`repository` and friends are still missing** from the published manifest —
  §9.

---

## 13. Result

```
Tailwind, compiled at our build time, no consumer build step:  PASS
shadcn components vendored, not depended on:                   PASS
every colour a role, defined once per palette:                 PASS
dark mode with a three-state toggle, remembered:               PASS
shell, collapsible sidebar, mobile drawer, command palette:    PASS
real dialogs replacing window.confirm:                         PASS
brand colour readable in both palettes by construction:        PASS
contrast measured and held by a test:                          PASS
bundle growth measured, itemised and partly given back:        PASS
every screen still works, keyboard included:                   PASS
peer range, engines and keywords reconciled:                   PASS
repository URL in the manifest:                                NOT DONE — §9
per-model icons, sortable headers:                             NOT IN SCOPE — §12
```

|               | Before  | After    |
| ------------- | ------- | -------- |
| Tests         | 627     | **713**  |
| Packed checks | 48/48   | 48/48    |
| Bundle (gzip) | 68.0 KB | 104.1 KB |
| Version       | 0.7.0   | 0.8.0    |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.9.0 — Authentication.** A login page, sessions and a user store,
shipped in the box as an optional implementation of the `AdminAuth` contract
that already exists. The contract does not change.
