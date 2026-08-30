# 0.6.0 — Extension Points

Status: **complete.** No custom React pages, no plugin system, no transactional
hooks, nothing published.

---

## 1. Executive Summary

Everything before this release made the admin _correct_. This release is about
what happens in the third month.

An admin that knows a schema and nothing else covers the first afternoon well
and then hits the same wall in every project: hashing a password, refusing a
deletion that would orphan something, publishing a draft. None of it can be
inferred from a column type, and without somewhere to put it the usual answer
is a second internal tool built beside the admin.

Delivered:

- **Hooks** around every write, per model.
- **Actions** — buttons the application declares and the interface draws from
  metadata.
- **`ValidationError`** — the way application code refuses an input and has the
  reason reach the person who typed it.
- **Theming** without a rebuild, and **dark mode**.

**562 tests** (was 525), 40/40 packed-consumer checks.

---

## 2. Hooks

```ts
hooks: {
  User: {
    beforeCreate: ({ data, context }) => ({ ...data, slug: slugify(data.name) }),
    beforeDelete: async ({ id }) => {
      if (await hasInvoices(id)) throw new ValidationError('This account has unsettled invoices.')
    },
  },
}
```

Three decisions worth stating.

**They run after authorization and after validation**, immediately around the
adapter call. A hook is therefore never reached by a request that would have
been refused, and never sees a payload naming a hidden or read-only field.

**What a `before` hook returns is validated again.** A hook is application code,
and the rule that a read-only field cannot be written is not one it should be
able to step around by accident. There is a test: a hook that adds `id` to the
data gets a 400, not a record with a chosen primary key.

**Nothing is transactional**, and the documentation says so rather than
implying otherwise. An `after` hook that throws leaves the write already done.
Work that must be atomic belongs in the application's own transaction; this is
for work whose failure is not worse than its absence.

Hooks receive the `ExecutionContext`, the same accessor `AdminAuth` and
`AdminResourceAuth` already take, so one helper for reaching the principal works
for all three.

---

## 3. Actions

```ts
actions: {
  Post: [
    { name: 'publish', label: 'Publish', scope: 'record',
      confirm: 'Publish this post?', run: async ({ id }) => ({ message: 'Published.' }) },
  ],
}
```

Declared on the server and **drawn by the interface from metadata**, so adding
one is a server-side change and the UI never learns what any of them do. That is
the difference between this and the usual answer, which is a custom React
component and a bundler.

### Authorization

Actions are their own operation, `'action'`, rather than folded into `update`.
An action can do anything — including things no CRUD route offers — so a policy
should be able to decide about it separately. There is a second benefit: a
policy written before actions existed does not recognise the value and denies
it, which is the direction a security decision should fail in.

Actions the principal may not run are **absent from the metadata**, so the
interface has nothing to draw. Same pattern as the permissions in 0.5.0.

### Routing

```
POST /admin/actions/:model/:action        list-scoped
POST /admin/actions/:model/:action/:id    record-scoped
```

Under a reserved first segment, declared before every `:model` route so
`actions` is matched literally. The same arrangement already reserves `meta`
here and `assets` in the UI controller. The cost is that a model called
`actions` would be unreachable — documented rather than guarded against, and
there is a test asserting the ordinary routes still work beside it.

A request whose shape does not match the declared scope — an id on a list
action, or none on a record action — is a 400 rather than a guess.

---

## 4. Refusing an Input

`ValidationError` was added to a taxonomy whose own documentation says to resist
growing it. The justification is that a caller genuinely needs to branch, and
neither existing option is right:

|                     | Why not                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `InvalidQueryError` | Claims the _query_ was malformed. A rejected password is not a malformed query.        |
| Anything else       | Becomes a 500 with the message withheld — correct for a bug, useless for an objection. |

So the distinction being drawn is **broke** versus **objected**, and it decides
whether the message is published. A hook that throws `ValidationError` gets its
message forwarded verbatim; a hook that throws anything else gets
`INTERNAL_ERROR` and the message logged, not sent. There is a test that a
`connect ECONNREFUSED 10.0.0.5:5432` never reaches the response body.

---

## 5. Theming

An accent colour, a title and a logo, injected into the served shell — the same
mechanism that already injects the mount path.

The values come from the application's configuration rather than from a request,
so this is not the usual cross-site scripting boundary. It is still treated as
one: a template that interpolates unchecked strings into a page is a mistake
waiting for the first configuration read from a database or an environment
variable. Each value is validated to a shape that cannot carry markup —
hex-only colours, plain text titles, `http(s)` or `data:image` URLs — and a
value that does not fit is a **boot failure**, not a broken page.

Three tests push a stylesheet escape, a `</title><script>`, and a
`javascript:` URL at it; all three are refused at `forRoot`.

The title is _replaced_ in the shell rather than appended. Appending left two
`<title>` elements in the document — caught by running it against the
playground, where the browser kept the original.

Dark mode redefines only the design tokens under `prefers-color-scheme`, so
every component follows without knowing a second palette exists, and a
configured brand colour still wins in both.

---

## 6. Verified in a Real Consumer

The playground gained a hook that trims titles, one that refuses to delete a
pinned post, two actions, and a theme.

```
Post actions in metadata     publish (record, confirm), unpublish-all (list, danger)
User actions                 []           — declared for Post only
beforeCreate trimmed a title "   Bo'shliqli sarlavha   " → "Bo'shliqli sarlavha"
POST /actions/Post/publish/<id>   201 {"message":"Published."}
  published now               true
POST /actions/Post/unpublish-all  201 {"message":"Unpublished 6 posts."}
scope mismatch                    400 INVALID_QUERY
unknown action                    400 FIELD_NOT_FOUND
as readonly                       403 FORBIDDEN, and [] in the metadata

beforeDelete on a pinned post     400 VALIDATION_ERROR
  message                         "Pinned posts cannot be deleted. Unpin it first."
  record still there              200
ordinary delete                   200

served page  <title>Playground Admin</title>   (one, not two)
             --brand:#0b6e6e present
```

Through the real UI bundle:

```
as admin      title and header read "Playground Admin"
              list shows "Unpublish everything"; detail shows "Publish"
              pressing Publish → "Published."
as readonly   no actions, no write controls
console       no errors in either
```

---

## 7. A Flaky Check, Fixed

`pnpm verify:package` reported **40/40 passed** and then exited non-zero — once.
A killed child server can still emit on its way out, and the script's exit code
was picking that up.

Worth fixing rather than ignoring, because a check that fails occasionally for
reasons unrelated to what it checks is worse than a slow one: people learn to
re-run it rather than read it, and then miss the run where it was right. The
verdict is now the checks and nothing else, asserted by running it twice.

---

## 8. Verification

| Check                 | Result                   |
| --------------------- | ------------------------ |
| `pnpm build`          | 0                        |
| `pnpm typecheck`      | 0                        |
| `pnpm format:check`   | 0                        |
| `pnpm test`           | **562 passed**, 28 files |
| `pnpm verify:package` | **40/40**, twice         |

New tests: 37.

| File                                           | Covers                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/nestjs/test/extensions.test.ts` (24) | Hooks rewriting, refusing, running after authorization, and unable to write a refused field; actions in metadata, both scopes, scope mismatch, their own operation; theme injection and three rejected values |
| `apps/admin-ui/test/actions.test.tsx` (13)     | Which button appears where, the confirmation, the result message, re-reading afterwards, a refusal shown                                                                                                      |

The in-memory adapter gained an `authorId` scalar on `Post`. The relation
declared `from: 'authorId'` but no such field existed, so writes naming it were
rejected — a fixture that did not match what a real adapter reports, found by a
hook test creating a Post.

---

## 9. Known Limitations

- **Hooks are not transactional.** An `after` hook that throws leaves the write
  done, and a `before` hook cannot roll back a later failure.
- **No hooks around reads.** There is no `beforeList` to inject a row-level
  filter, which is the shape row-level permissions would need.
- **Actions receive no input.** A "change owner" action cannot ask for the new
  owner; only the record's id is passed. A form for an action is a bigger piece
  of design than this release.
- **No bulk actions.** A list action applies to the model, not to a selection —
  nothing is selectable yet. That goes with bulk delete in 0.7.0.
- **A model named `actions` is unreachable**, as one named `assets` already was.
- **Theming reaches a colour, a title and a logo.** Fonts, spacing and a full
  palette are not configurable, and the accent is the only colour a brand can
  set.
- **Dark mode follows the system only.** There is no toggle, so a viewer whose
  operating system disagrees with them has no recourse.

---

## 10. Result

```
hooks around create, update and delete:        PASS
hooks run after authorization and validation:  PASS
a hook cannot write a refused field:           PASS
a hook can refuse, with a readable reason:     PASS
a broken hook withholds its message:           PASS
actions in metadata, filtered by policy:       PASS
actions on both scopes, mismatch refused:      PASS
actions authorized as their own operation:     PASS
theme applied without a rebuild:               PASS
unsafe theme values refused at startup:        PASS
dark mode:                                     PASS
verified against a real consumer:              PASS
bulk actions, action inputs:                   NOT IN SCOPE — §9
```

|               | Before | After   |
| ------------- | ------ | ------- |
| Tests         | 525    | **562** |
| Packed checks | 40/40  | 40/40   |
| Version       | 0.5.0  | 0.6.0   |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.7.0 — UX and hardening.** Validation errors under the field they
belong to, bulk selection and delete, deliberate empty and error states,
keyboard navigation and contrast, and a list profiled at fifty thousand rows.
