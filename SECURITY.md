# Security

Nest Admin puts a web interface in front of a database. That makes it a security
product whether or not it is described as one, so this page says plainly what it
guarantees, what it does not, and where the boundaries are.

## Reporting a vulnerability

Open a [security advisory](https://github.com/abdum0min/nestjs-admin/security/advisories/new)
rather than a public issue. If that is not possible, open an issue saying only
that you have found something and how to reach you — no details.

The project is maintained by one person, so an acknowledgement may take a few
days. A fix ships as a patch release with the defect described in the changelog.

## What the admin guarantees

These are enforced on the server, and each has tests that try to defeat them.

**Nothing is public.** `auth` is a required option. There is no default that
admits anonymous requests; the only way to get one is
`unsafeAllowAllRequests()`, which is named that way, warns on every startup, and
exists so a new install can be seen working before identity is wired up.

**Invisible means absent, not hidden.** A model a principal may not see is not
in `GET /admin/meta`, so the interface never learns it exists. Relations
_pointing at_ it are stripped from the models that remain, so its name cannot
leak through `relation.targetModel`. There is no client-side filtering anywhere
in the admin — hiding a control in a browser is not a permission.

**A hidden field never leaves the server.** `hidden` and `writeOnly` fields are
removed from every response and refused in every write, including through hooks,
actions and export.

**A scope reaches the database.** Row-level filters are merged into the query
rather than applied to the result, so `total` cannot count rows the reader may
not know about. Addressing a row outside the scope answers 404, not 403 — a 403
would confirm the record exists.

**Errors do not leak.** Only a fixed list of error codes has its message
forwarded. Everything else becomes a generic 500 and is logged: an ORM's own
message carries file paths, query fragments and sometimes the submitted data.

**Passwords are hashed with scrypt**, per-password salt, with a dummy hash on
the missing-account path so sign-in takes the same time whether or not the
account exists. Sessions are HMAC-signed, compared with `timingSafeEqual`,
`HttpOnly`, `SameSite=Lax`, and `Secure` behind HTTPS. Sign-in is rate limited
per email and per address, and failures decay.

**Admin accounts are separate from your users.** `builtInAuth` reads its own
table. Pointing it at the table the admin manages would put a credential that
opens the admin on every customer record.

**The account table is never a resource.** It stays excluded from `resources`,
because as an ordinary model anyone with `update` on it could write another
account's password hash — a complete takeover from a form, with no password
typed. The team screen is a purpose-built page instead: it never accepts a hash,
only a password it derives one from; it sits behind the `manageTeam` capability;
and it refuses to let you delete, disable or demote your own account. A store
that does not implement the optional write methods has no team screen at all.

## What it does not guarantee

Stated so nobody discovers them the hard way.

- **No field-level permissions per principal.** `hidden` and `readOnly` are the
  same for everyone who can see the model.
- **No audit log.** Nothing records who changed what.
- **No protection against two people overwriting each other, by default.**
  `concurrency: 'optimistic'` adds it, and names the models it cannot cover.
- **No CSRF token.** The session cookie is `SameSite=Lax` and the login route
  checks the origin, which covers the browser cases. An application with
  stricter requirements should put its own protection in front.
- **No rate limiting outside sign-in.** A principal who is allowed to list can
  list as often as they like.
- **No protection against a compromised administrator.** An account with
  permission to delete can delete. One holding `manageTeam` can also create
  another account that holds it, which is persistence rather than escalation —
  withhold the capability from roles that do not need it.

## Things you have to get right

The admin cannot check these for you.

**Set `ADMIN_SESSION_SECRET` to something random and keep it out of the
repository.** There is no development default, deliberately: a shipped secret
mints a session for any account. Generate one with

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

**Exclude the admin account table from `resources`.** Anyone who could edit it
could set another account's password hash, which is every permission the admin
has, reachable from a form. The module warns at startup if you have not.

**Do not deploy `unsafeAllowAllRequests()`.** It is not a fallback; it is a
development aid with a deliberately alarming name.

**Put the admin behind whatever your application already requires** — a VPN, an
IP allowlist, an identity provider. This is defence in depth, not a substitute
for the above.

## Supported versions

While the major version is `0`, only the latest release receives fixes. After
1.0 that becomes a stated support policy.
