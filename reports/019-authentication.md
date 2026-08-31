# 0.9.0 — Authentication

Status: **complete.** No RBAC, no roles, no password reset, no OAuth, no 2FA,
nothing published.

---

## 1. Executive Summary

An application without an identity system of its own could not put this admin
behind a login. `AdminAuth` is required and host-owned, which is right for a
team that already has sessions and a wall for everybody else: they had to write
a password hash, a session cookie and a form before the admin could go anywhere
near production.

This release ships all three, and **does not move the boundary to do it**.

```ts
auth: unsafeAllowAllRequests()   // development only, warns at startup
auth: myOwnAuth                  // an application that already has identity
auth: builtInAuth({ ... })       // a login page, sessions and a store
```

`AdminAuth` is unchanged. `builtInAuth` is one thing that satisfies it, and an
application using its own implementation sees an admin with no login routes at
all — not a sign-in form it cannot use.

**826 tests** (was 770), 48/48 packed-consumer checks. The interface bundle grew
by 1.7 KB gzipped for the login screen and the user menu.

---

## 2. The Accounts Are Not the Application's Users

The requirement that shaped everything else. The people who administer a system
are usually not rows in the table they administer, and conflating the two means
a customer record carrying a password that opens the admin — a decision nobody
makes on purpose and several people make by accident.

So the store is a **contract over separate storage**, and the default is a model
of its own:

```prisma
model AdminAccount {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String?
  passwordHash String
  disabled     Boolean   @default(false)
  lastLoginAt  DateTime?
}
```

The admin never reads the application's `User` table to decide who may sign in.
Adding a customer never adds an administrator.

**A contract rather than a table**, for the same reason `OrmAdapter` is one: an
admin whose accounts can only live in Prisma has learned about Prisma, and the
second ORM would find out the hard way. `AdminAccountStore` is four async
methods over plain data and lives in Core, which still knows nothing about
databases. `prismaAccountStore` implements it.

**Read-only.** No create, no update, no delete. Seeding an account is the
application's job — an admin that can mint its own administrators is an
escalation waiting for its first mistake in a policy.

---

## 3. The Security Work Is the Release

Not a section of it. Each of these is a specific way a login route leaks, and
each has a test.

### Nothing distinguishes one failure from another

An unknown address, a wrong password, a disabled account and a locked-out one
all answer `401` with the same code and the same words. Telling them apart is a
convenience for whoever forgot their password twice a year, and a list of which
addresses are registered for everybody else.

Including the timing. When the email is unknown the password is still verified —
against `NO_SUCH_ACCOUNT`, a hash of a random string nobody kept:

```ts
const stored = account?.passwordHash ?? (await NO_SUCH_ACCOUNT)
const correct = await verifyAdminPassword(password, stored)
```

Returning early instead would answer in microseconds for an unknown address and
a hundred milliseconds for a real one, and that difference is the same list.

### scrypt, and why not bcrypt

Both bcrypt and argon2 are better-known and both are **native modules**. This
package has one runtime dependency and no compiled code, which is why it
installs identically on every platform — and a password hash is a poor reason to
give that up. `node:crypto` ships scrypt, which is memory-hard and designed for
exactly this.

`N = 2^15`, a step above Node's default, putting one derivation near a hundred
milliseconds. The parameters travel _with_ the hash:

```
scrypt$32768$8$1$<salt>$<key>
```

That is what makes them changeable. Raising the cost later leaves every existing
password verifiable with the parameters it was made with; the alternative is a
migration nobody can run, because the plaintext is gone.

### The session, and what stateless costs

A signed cookie carrying `{ sub, exp }` and nothing else — not the email, not a
role. A cookie is readable by whoever holds it, and none of that is worth
putting in front of them to save a lookup.

**A session cannot be revoked before it expires.** Stated rather than
discovered. Two things soften it: lifetimes are short and renew at the halfway
point, and **the account is loaded on every request**, so disabling or deleting
one stops it working immediately. What remains is one specific stolen cookie,
until it expires or the secret is rotated.

### The rest of the list

|                            | How                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Cookie theft by script     | `HttpOnly`                                                                                                               |
| CSRF                       | `SameSite=Lax` — a cross-site write does not carry the cookie at all — plus an `Origin` check when the header is present |
| Session fixation           | A new token on every sign-in; whatever arrived is discarded                                                              |
| Signature forgery          | HMAC-SHA256, compared with `timingSafeEqual` rather than `===`                                                           |
| Brute force                | Ten attempts per address per client, then fifteen minutes                                                                |
| A weak secret              | Refused at construction: under 32 characters throws                                                                      |
| Logout by a link elsewhere | It is a `POST`                                                                                                           |

The `Origin` check is deliberately skipped when the header is absent: a script
or a curl command sends neither `Origin` nor a cookie by accident, and refusing
those would break using the API from a terminal for no security gain.

---

## 4. Two Bugs the Tests Found

**The rate limiter rate-limited nothing.** `lockedOut` deleted the counter
whenever there was no _active_ lockout — which is every call before the tenth —
so the count reset on every attempt and the lockout never triggered. Found by
the test that tries the right password after ten wrong ones and expected to be
refused.

The fix also made failures decay: attempts older than the lockout window no
longer count towards the next one, so a typo in March and nine more in September
do not add up to a lockout nobody can explain.

**The gate hung for every application that brought its own auth.** The interface
distinguishes "no session document" from "not read yet", and the first version
conflated them: `fetchSession` returns `undefined` for the 404 an admin without
login routes answers, and the loading condition treated that as "still
loading" — so the admin never rendered. Found by eleven existing test files
failing at once.

---

## 5. The Interface

**A gate, not a banner.** When nobody is signed in the admin does not render:
no table, no sidebar, no metadata request. Not a redirect a determined URL can
skip past — the components are not mounted.

**Three situations, not two.** The third is the one that is easy to get wrong:
an application that brought its own authentication is never shown a sign-in
form, and is never offered a sign-out button that cannot work.

**A whole screen**, carrying the application's own name and logo — an admin that
greets people with an unbranded box does not look like part of their product.
The password is masked with a reveal, the address survives a wrong password
(retyping one you already typed correctly is the most annoying part of getting a
password wrong), and after three failures it mentions that attempts are slowed
down — because someone typing the right password into a locked-out account
otherwise has no way to understand what is happening.

**A session that expires while the admin is open** returns to the login screen.
The client announces a `401` centrally rather than leaving whichever screen
happened to be making a request to show "not signed in" in its own corner while
the rest of the page carries on pretending to be an admin.

**A user menu** with the name, the address and Sign out.

---

## 6. Two Warnings at Startup

Warnings rather than boot failures, and the line is deliberate: both describe a
_deployment_ that is wrong rather than a configuration that cannot work — and an
admin that refuses to start because its account table is empty is an admin
nobody can seed, since the seed script imports the module.

- **The account model is also an editable resource.** Anyone who may edit it can
  set another account's password hash, or clear `disabled` on their own — every
  permission the admin has, reachable from a table that looks like any other.
  The warning names the model and the fix: `resources: { exclude: [...] }`.
- **The store is empty.** Otherwise the symptom is a login form that rejects
  every correct password, which reads as a broken build rather than an empty
  table.

---

## 7. What the Example Now Shows

```ts
AdminModule.forRootAsync({
  useFactory: (prisma: PrismaService) => ({
    adapter: new PrismaAdapter({ client: prisma }),
    auth: builtInAuth({
      store: prismaAccountStore({ client: prisma }),
      session: { secret: process.env.ADMIN_SESSION_SECRET },
    }),
    resources: { exclude: ['AdminAccount'] },
  }),
})
```

The secret is read from the environment and the example **refuses to start
without it** rather than falling back to a development default — a default is a
secret that ships, and a shipped secret mints a session for any account.

`node create-admin.mjs <email> <password>` seeds the first account. Re-running it
updates the password, which is also how you reset one.

The old `x-admin-token` header auth is gone. It was a stand-in for the identity
system a real application has, and now that there is a real one, keeping a fake
beside it would only be confusing.

---

## 8. Verified in a Real Consumer

```
meta without a session       401
session probe                200  account=null
wrong password               401  "Those details do not match an account."
unknown address              401  "Those details do not match an account."   (identical)
correct password             200  {"id":"cmth…","email":"admin@example.com","name":"admin"}
cookie flags                 Path=/ HttpOnly SameSite=Lax Max-Age=43200
meta with the session        200, 10 models
AdminAccount exposed?        no
logout                       200, Max-Age=0
```

Through the real bundle, in a real DOM:

```
login form shown             yes          admin hidden      yes
branded                      Nest Admin Example              sidebar hidden    yes
wrong password               message shown, email kept, password cleared
right password               admin rendered, 10 resources, AdminAccount not listed
user button                  "Signed in as admin", menu shows the address
sign out                     back to the login form, admin gone
console                      no errors
```

---

## 9. Verification

| Check                 | Result                              |
| --------------------- | ----------------------------------- |
| `pnpm build`          | 0                                   |
| `pnpm typecheck`      | 0                                   |
| `pnpm format:check`   | 0                                   |
| `pnpm test`           | **826 passed**, 46 files, run twice |
| `pnpm verify:package` | **48/48**                           |

New tests: 56.

| File                           | Covers                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `built-in-auth.test.ts` (30)   | The whole HTTP surface, and mostly what it does _not_ say: identical answers for four different failures, cookie flags, session fixation, lockout, the `Origin` check, a disabled or deleted account losing its session immediately, 404 when the admin is not using it, both startup warnings |
| `auth-primitives.test.ts` (14) | Salting, parameters travelling with the hash, malformed hashes answering `false` rather than throwing, forged and expired tokens, the renewal window                                                                                                                                           |
| `login.test.tsx` (12)          | The gate rendering nothing behind it, not fetching the schema before it knows who is asking, the sign-out flow, the 401-while-open path, and the external case being left alone                                                                                                                |

---

## 10. Known Limitations

- **A session cannot be revoked before it expires** — §3. Disabling the account
  is the revocation that works.
- **The lockout counter is in memory**, so behind several instances an attacker
  gets the allowance once per instance. It is not a substitute for a rate
  limiter at the edge and does not pretend to be one.
- **No password reset, no email, no 2FA, no OAuth.** Resetting a password is
  `create-admin.mjs` or the application's own tooling.
- **No roles.** `resourceAuth` already decides what a principal may do; this
  release only decides who they are.
- **The admin cannot manage its own accounts.** Deliberate — §2 — and it does
  mean creating the second administrator is a script rather than a screen.
- **A model named `auth` is unreachable**, as one named `actions` or `assets`
  already was.

---

## 11. Result

```
a login page shipped in the box:                    PASS
AdminAuth unchanged, three answers not one:         PASS
accounts separate from the application's users:     PASS
a contract, not a Prisma table:                     PASS
scrypt with no native dependency:                   PASS
every failure answers identically, timing included: PASS
HttpOnly, SameSite, Secure, fixation, CSRF:         PASS
brute force slowed, per address:                    PASS
a weak secret refused at startup:                   PASS
disabling an account ends its session now:          PASS
every page behind the gate:                         PASS
logout and a user menu:                             PASS
an application with its own auth left alone:        PASS
roles, password reset, 2FA:                         NOT IN SCOPE — §10
```

|               | Before   | After    |
| ------------- | -------- | -------- |
| Tests         | 770      | **826**  |
| Packed checks | 48/48    | 48/48    |
| Bundle (gzip) | 134.1 KB | 135.8 KB |
| Version       | 0.8.2    | 0.9.0    |

Working tree clean, explicit paths, no AI co-author trailer.

**Next: 0.10.0 — Dashboard**, unchanged from the roadmap.
