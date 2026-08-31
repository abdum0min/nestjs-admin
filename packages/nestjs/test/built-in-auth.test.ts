/**
 * The login, over HTTP.
 *
 * Most of what is asserted here is what the endpoint does *not* say. A login
 * route is the one place an anonymous stranger can talk to the admin, and the
 * things it can be made to reveal - which addresses are registered, whether an
 * account is disabled, how far a guess got - are worth more to an attacker than
 * to anyone signing in.
 */
import type { AdminAccount, AdminAccountStore } from '@nest-admin/core'
import { Logger, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { builtInAuth } from '../src/auth/built-in.js'
import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { hashAdminPassword } from '../src/auth/password.js'
import { MIN_SECRET_LENGTH } from '../src/auth/session.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

const SECRET = 'x'.repeat(MIN_SECRET_LENGTH)

let app: INestApplication | undefined
let hash: string

beforeEach(async () => {
  hash ??= await hashAdminPassword('hunter2')
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** A store held in an array, so a test can disable or remove an account. */
function store(accounts: AdminAccount[]): AdminAccountStore & { accounts: AdminAccount[] } {
  return {
    accounts,
    describes: 'AdminAccount',
    async findByEmail(email) {
      return accounts.find((a) => a.email === email.toLowerCase()) ?? null
    },
    async findById(id) {
      return accounts.find((a) => a.id === id) ?? null
    },
    async count() {
      return accounts.length
    },
  }
}

const seed = () => ({ User: [{ id: 'u1', email: 'ada@example.com', name: 'Ada' }], Post: [] })

const boot = async (accounts: AdminAccount[]) => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter(seed()),
        auth: builtInAuth({ store: store(accounts), session: { secret: SECRET } }),
        uiRoot: BUILT_UI_ROOT,
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
  return app.getHttpServer()
}

const account = (over: Partial<AdminAccount> = {}): AdminAccount => ({
  id: 'acc_1',
  email: 'admin@example.com',
  name: 'Admin',
  passwordHash: hash,
  ...over,
})

const cookieOf = (response: { headers: Record<string, unknown> }): string => {
  const header = response.headers['set-cookie']
  return Array.isArray(header) ? String(header[0]) : String(header ?? '')
}

describe('configuring it', () => {
  it('refuses a secret short enough to guess', () => {
    // Silent when it is wrong: everything works, and anybody can mint a
    // session for any account.
    expect(() => builtInAuth({ store: store([]), session: { secret: 'short' } })).toThrow(
      /at least 32 characters/,
    )
  })

  it('refuses to run without a store', () => {
    expect(() => builtInAuth({ store: undefined as never, session: { secret: SECRET } })).toThrow(
      /requires a `store`/,
    )
  })
})

describe('signing in', () => {
  it('answers with the account and a cookie', async () => {
    const http = await boot([account()])

    const response = await request(http)
      .post('/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(200)

    expect(response.body.data.account).toEqual({
      id: 'acc_1',
      email: 'admin@example.com',
      name: 'Admin',
    })
    expect(cookieOf(response)).toMatch(/^nest_admin_session=/)
  })

  it('never sends the password hash', async () => {
    const http = await boot([account()])
    const response = await request(http)
      .post('/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(200)

    expect(JSON.stringify(response.body)).not.toContain('scrypt')
    expect(response.body.data.account).not.toHaveProperty('passwordHash')
  })

  it('protects the cookie', async () => {
    // HttpOnly so a scripting bug cannot read it. SameSite=Lax so a
    // cross-site write does not carry it, which is the CSRF defence for the
    // whole API. Secure is off here only because the request came from
    // localhost - see the next test.
    const http = await boot([account()])
    const cookie = cookieOf(
      await request(http)
        .post('/admin/auth/login')
        .send({ email: 'admin@example.com', password: 'hunter2' })
        .expect(200),
    )

    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toMatch(/Max-Age=\d+/)
  })

  it('requires HTTPS everywhere except localhost', async () => {
    const http = await boot([account()])
    const cookie = cookieOf(
      await request(http)
        .post('/admin/auth/login')
        .set('Host', 'admin.example.com')
        .send({ email: 'admin@example.com', password: 'hunter2' })
        .expect(200),
    )

    expect(cookie).toContain('Secure')
  })

  it('issues a new token rather than keeping the one that arrived', async () => {
    // Session fixation: an attacker who can plant a cookie before someone
    // signs in must not still hold a valid one afterwards.
    const http = await boot([account()])

    const planted = 'nest_admin_session=v1.planted.signature'
    const response = await request(http)
      .post('/admin/auth/login')
      .set('Cookie', planted)
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(200)

    expect(cookieOf(response)).not.toContain('planted')
  })

  it('matches the address whatever case it was typed in', async () => {
    const http = await boot([account()])
    await request(http)
      .post('/admin/auth/login')
      .send({ email: '  ADMIN@Example.com ', password: 'hunter2' })
      .expect(200)
  })
})

describe('what a failure gives away', () => {
  it('answers identically for a wrong password and an unknown address', async () => {
    const http = await boot([account()])

    const wrong = await request(http)
      .post('/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'nope' })
      .expect(401)

    const unknown = await request(http)
      .post('/admin/auth/login')
      .send({ email: 'nobody@example.com', password: 'nope' })
      .expect(401)

    // Same status, same code, same words. Anything that differs is a way to
    // ask which addresses are registered.
    expect(unknown.body).toEqual(wrong.body)
    expect(wrong.headers['set-cookie']).toBeUndefined()
  })

  it('answers the same way for a disabled account', async () => {
    const http = await boot([account({ disabled: true })])

    const disabled = await request(http)
      .post('/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(401)

    const unknown = await request(http)
      .post('/admin/auth/login')
      .send({ email: 'nobody@example.com', password: 'hunter2' })
      .expect(401)

    expect(disabled.body).toEqual(unknown.body)
  })

  it('slows down after repeated failures, and says nothing extra about it', async () => {
    const http = await boot([account()])

    for (let attempt = 0; attempt < 10; attempt++) {
      await request(http)
        .post('/admin/auth/login')
        .send({ email: 'admin@example.com', password: 'nope' })
        .expect(401)
    }

    // Now even the right password is refused - and refused the same way, so
    // being locked out is not something an attacker can detect either.
    const locked = await request(http)
      .post('/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(401)

    expect(locked.headers['set-cookie']).toBeUndefined()
  })

  it('locks out one address at a time, not the whole admin', async () => {
    const http = await boot([account(), account({ id: 'acc_2', email: 'other@example.com' })])

    for (let attempt = 0; attempt < 10; attempt++) {
      await request(http)
        .post('/admin/auth/login')
        .send({ email: 'admin@example.com', password: 'nope' })
        .expect(401)
    }

    await request(http)
      .post('/admin/auth/login')
      .send({ email: 'other@example.com', password: 'hunter2' })
      .expect(200)
  })

  it('refuses a body that is not an email and a password', async () => {
    const http = await boot([account()])
    for (const body of [{}, { email: 'a@b.c' }, { email: 1, password: 2 }]) {
      await request(http).post('/admin/auth/login').send(body).expect(400)
    }
  })
})

describe('the session it establishes', () => {
  const signedIn = async (http: unknown) => {
    const response = await request(http as never)
      .post('/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(200)
    return cookieOf(response).split(';')[0]!
  }

  it('opens the rest of the admin', async () => {
    const http = await boot([account()])
    const cookie = await signedIn(http)

    await request(http).get('/admin/meta').set('Cookie', cookie).expect(200)
    await request(http).get('/admin/User').set('Cookie', cookie).expect(200)
  })

  it('is the only thing that does', async () => {
    const http = await boot([account()])

    await request(http).get('/admin/meta').expect(401)
    await request(http).get('/admin/User').expect(401)
    await request(http).get('/admin/User/u1').expect(401)
    await request(http).post('/admin/User').send({ name: 'x' }).expect(401)
  })

  it('stops working the moment the account is disabled', async () => {
    // The account is read on every request rather than trusted from the
    // cookie, which is the difference between "sessions expire eventually" and
    // "disabling an account works now".
    const accounts = [account()]
    const backing = store(accounts)

    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(seed()),
          auth: builtInAuth({ store: backing, session: { secret: SECRET } }),
          uiRoot: BUILT_UI_ROOT,
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    const http = app.getHttpServer()

    const cookie = await signedIn(http)
    await request(http).get('/admin/meta').set('Cookie', cookie).expect(200)

    backing.accounts[0] = account({ disabled: true })
    await request(http).get('/admin/meta').set('Cookie', cookie).expect(401)
  })

  it('stops working when the account is deleted', async () => {
    const accounts = [account()]
    const backing = store(accounts)

    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(seed()),
          auth: builtInAuth({ store: backing, session: { secret: SECRET } }),
          uiRoot: BUILT_UI_ROOT,
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    const http = app.getHttpServer()

    const cookie = await signedIn(http)
    backing.accounts.length = 0
    await request(http).get('/admin/meta').set('Cookie', cookie).expect(401)
  })

  it('is refused when it was signed with something else', async () => {
    const http = await boot([account()])
    await request(http)
      .get('/admin/meta')
      .set('Cookie', 'nest_admin_session=v1.eyJzdWIiOiJhY2NfMSJ9.forged')
      .expect(401)
  })
})

describe('asking who is signed in', () => {
  it('says nobody, without calling that an error', async () => {
    // The interface asks before it has any reason to think anyone is signed
    // in. A 401 here would put a failure in the console on every visit to the
    // login page.
    const http = await boot([account()])
    const { body } = await request(http).get('/admin/auth/session').expect(200)
    expect(body.data.account).toBeNull()
  })

  it('says who, once they are', async () => {
    const http = await boot([account()])
    const cookie = cookieOf(
      await request(http)
        .post('/admin/auth/login')
        .send({ email: 'admin@example.com', password: 'hunter2' })
        .expect(200),
    ).split(';')[0]!

    const { body } = await request(http)
      .get('/admin/auth/session')
      .set('Cookie', cookie)
      .expect(200)
    expect(body.data.account.email).toBe('admin@example.com')
    expect(body.data.account).not.toHaveProperty('passwordHash')
  })
})

describe('signing out', () => {
  it('clears the cookie and closes the admin again', async () => {
    const http = await boot([account()])
    const cookie = cookieOf(
      await request(http)
        .post('/admin/auth/login')
        .send({ email: 'admin@example.com', password: 'hunter2' })
        .expect(200),
    ).split(';')[0]!

    const out = await request(http).post('/admin/auth/logout').set('Cookie', cookie).expect(200)
    expect(cookieOf(out)).toMatch(/nest_admin_session=;/)
    expect(cookieOf(out)).toContain('Max-Age=0')
  })

  it('succeeds even when nobody was signed in', async () => {
    // Signing out when you were not signed in is not a failure; it is the
    // state you asked for.
    const http = await boot([account()])
    await request(http).post('/admin/auth/logout').expect(200)
  })
})

describe('a request from somewhere else', () => {
  it('is refused when its Origin is not this admin', async () => {
    // The cookie is already SameSite=Lax, which is the real defence. This is
    // the second lock, and it costs one comparison.
    const http = await boot([account()])

    await request(http)
      .post('/admin/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(401)
  })

  it('is allowed when the Origin is this admin', async () => {
    const http = await boot([account()])
    await request(http)
      .post('/admin/auth/login')
      .set('Host', 'admin.example.com')
      .set('Origin', 'https://admin.example.com')
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(200)
  })

  it('is allowed when there is no Origin at all', async () => {
    // A script or a curl command sends neither Origin nor a cookie by
    // accident. Refusing them would break using the API from a terminal for no
    // security gain - a program that can set headers can set this one.
    const http = await boot([account()])
    await request(http)
      .post('/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'hunter2' })
      .expect(200)
  })
})

describe('an admin that brought its own authentication', () => {
  it('has no login routes at all', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(seed()),
          auth: unsafeAllowAllRequests(),
          uiRoot: BUILT_UI_ROOT,
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    const http = app.getHttpServer()

    // 404 rather than 500: this endpoint genuinely does not exist here, and
    // the interface reads it as "the host owns identity" rather than as a
    // failure.
    await request(http).get('/admin/auth/session').expect(404)
    await request(http).post('/admin/auth/login').send({}).expect(404)
    await request(http).post('/admin/auth/logout').expect(404)
  })
})

describe('what it says at startup', () => {
  /**
   * Warnings rather than boot failures, and the line is deliberate: both
   * describe a deployment that is wrong rather than a configuration that
   * cannot work. An admin that refuses to start because its account table is
   * empty is an admin nobody can seed - the seed script imports the module.
   */
  const warnings: string[] = []

  const bootWith = async (options: {
    accounts: AdminAccount[]
    resources?: { exclude?: string[] }
  }) => {
    warnings.length = 0
    const spy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(((message: unknown) => {
      warnings.push(String(message))
    }) as never)

    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(seed()),
          auth: builtInAuth({ store: store(options.accounts), session: { secret: SECRET } }),
          uiRoot: BUILT_UI_ROOT,
          ...(options.resources ? { resources: options.resources } : {}),
        }),
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()
    spy.mockRestore()
    return warnings
  }

  it('says so when nobody can sign in', async () => {
    // Otherwise the symptom is a login form that rejects every correct
    // password, which reads as a broken build rather than an empty table.
    const said = await bootWith({ accounts: [] })
    expect(said.join('\n')).toMatch(/account store is empty/i)
  })

  it('says nothing when there is an account', async () => {
    const said = await bootWith({ accounts: [account()] })
    expect(said.join('\n')).not.toMatch(/account store is empty/i)
  })

  it('says so when the account model is also an editable resource', async () => {
    /*
     * The escalation this exists to catch: anyone who may edit that table can
     * set another account's password hash, or clear `disabled` on their own -
     * which is every permission the admin has, reachable from a form that
     * looks like any other.
     *
     * The in-memory adapter's models are `User` and `Post`, so the store is
     * pointed at `User` to make the collision real.
     */
    warnings.length = 0
    const spy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(((message: unknown) => {
      warnings.push(String(message))
    }) as never)

    const collides = { ...store([account()]), describes: 'User' }
    const moduleRef = await Test.createTestingModule({
      imports: [
        AdminModule.forRoot({
          adapter: new InMemoryAdapter(seed()),
          auth: builtInAuth({ store: collides, session: { secret: SECRET } }),
          uiRoot: BUILT_UI_ROOT,
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    spy.mockRestore()

    expect(warnings.join('\n')).toMatch(/exposes "User" as a resource/)
    expect(warnings.join('\n')).toMatch(/exclude/)
  })

  it('says nothing once it is excluded', async () => {
    const said = await bootWith({
      accounts: [account()],
      resources: { exclude: ['Post'] },
    })
    expect(said.join('\n')).not.toMatch(/as a resource/)
  })
})
