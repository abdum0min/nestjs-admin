/**
 * The team screen, over real HTTP.
 *
 * This is the one part of the admin that can write to the table deciding who
 * may open the admin, so every rule it holds is asserted by trying to break it
 * rather than by reading the code.
 *
 * The rules exist because of one failure that cannot be repaired from inside
 * the product: an administrator removing their own access. A second guard - for
 * the last account that could restore anyone else's - was written and then
 * removed once it turned out it could never fire; the test below records why.
 *
 * And one that would make the whole screen pointless: accepting a password
 * hash instead of a password, which would let whoever reached the route install
 * a credential they already knew.
 */
import type { AdminAccount, AdminAccountStore } from '@nest-admin/core'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { builtInAuth, builtInRoleOf } from '../src/auth/built-in.js'
import { verifyAdminPassword } from '../src/auth/password.js'
import type { AdminRoles } from '../src/auth/roles.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

const SECRET = 'a-secret-long-enough-to-be-accepted-by-the-session-signer'

/**
 * An account store held in memory.
 *
 * Plain fields rather than `#private` ones: two of the tests build a variant of
 * a store by spreading it, and a private field does not survive that.
 */
class MemoryAccounts implements AdminAccountStore {
  readonly describes = 'AdminAccount'
  rows: AdminAccount[]
  next = 100

  constructor(rows: readonly AdminAccount[]) {
    this.rows = [...rows]
  }

  findByEmail = async (email: string): Promise<AdminAccount | null> =>
    this.rows.find((row) => row.email === email) ?? null

  findById = async (id: string): Promise<AdminAccount | null> =>
    this.rows.find((row) => row.id === id) ?? null

  count = async (): Promise<number> => this.rows.length

  listAccounts = async (): Promise<readonly AdminAccount[]> => [...this.rows]

  createAccount = async (account: {
    email: string
    name?: string | undefined
    role?: string | undefined
    passwordHash: string
  }): Promise<AdminAccount> => {
    if (this.rows.some((row) => row.email === account.email)) {
      throw new Error('duplicate email')
    }
    const created: AdminAccount = { id: `a${this.next++}`, ...account }
    this.rows.push(created)
    return created
  }

  updateAccount = async (id: string, changes: Record<string, unknown>): Promise<AdminAccount> => {
    const index = this.rows.findIndex((row) => row.id === id)
    if (index < 0) throw new Error('no such account')
    const updated = { ...this.rows[index]!, ...changes } as AdminAccount
    this.rows[index] = updated
    return updated
  }

  deleteAccount = async (id: string): Promise<void> => {
    this.rows = this.rows.filter((row) => row.id !== id)
  }
}

/** The same store with the write methods taken away, for the read-only path. */
function readOnly(store: MemoryAccounts): AdminAccountStore {
  return {
    describes: store.describes,
    findByEmail: store.findByEmail,
    findById: store.findById,
    count: store.count,
    listAccounts: store.listAccounts,
  }
}

/** The same store that cannot even list, so the routes are absent entirely. */
function withoutListing(store: MemoryAccounts): AdminAccountStore {
  return {
    describes: store.describes,
    findByEmail: store.findByEmail,
    findById: store.findById,
    count: store.count,
  }
}

const ROLES: AdminRoles = {
  owner: '*',
  manager: { models: { User: ['metadata', 'list'] }, capabilities: ['manageTeam'] },
  editor: { models: { User: ['metadata', 'list'] } },
}

const PASSWORD = 'correct-horse-battery'

async function accounts(): Promise<MemoryAccounts> {
  const { hashAdminPassword } = await import('../src/auth/password.js')
  const hash = await hashAdminPassword(PASSWORD)

  return new MemoryAccounts([
    { id: 'a1', email: 'owner@test', name: 'Owner', role: 'owner', passwordHash: hash },
    { id: 'a2', email: 'manager@test', name: 'Manager', role: 'manager', passwordHash: hash },
    { id: 'a3', email: 'editor@test', name: 'Editor', role: 'editor', passwordHash: hash },
  ])
}

const apps: INestApplication[] = []

async function appWith(store: AdminAccountStore, roles: AdminRoles | null = ROLES) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter({ User: [], Post: [] }),
        auth: builtInAuth({ store, session: { secret: SECRET } }),
        uiRoot: BUILT_UI_ROOT,
        ...(roles ? { roles, roleOf: builtInRoleOf() } : {}),
      }),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  apps.push(app)
  return app
}

async function signIn(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/admin/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200)

  return (res.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? ''
}

const team = (app: INestApplication, cookie: string) => ({
  list: () => request(app.getHttpServer()).get('/admin/team').set('cookie', cookie),
  create: (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/admin/team').set('cookie', cookie).send(body),
  update: (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).patch(`/admin/team/${id}`).set('cookie', cookie).send(body),
  remove: (id: string) =>
    request(app.getHttpServer()).delete(`/admin/team/${id}`).set('cookie', cookie),
})

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

describe('who may open it', () => {
  it('lets a role holding manageTeam list the accounts', async () => {
    const app = await appWith(await accounts())
    const { body } = await team(app, await signIn(app, 'manager@test'))
      .list()
      .expect(200)

    expect(body.data.members.map((m: { email: string }) => m.email).sort()).toEqual([
      'editor@test',
      'manager@test',
      'owner@test',
    ])
    expect(body.data.writable).toBe(true)
  })

  it('refuses a role that does not hold it', async () => {
    const app = await appWith(await accounts())
    await team(app, await signIn(app, 'editor@test'))
      .list()
      .expect(403)
  })

  it('refuses every write to that role too, not only the read', async () => {
    // The screen being hidden is not the defence; each route is.
    const app = await appWith(await accounts())
    const asEditor = team(app, await signIn(app, 'editor@test'))

    await asEditor.create({ email: 'x@test', password: 'a-long-enough-one' }).expect(403)
    await asEditor.update('a1', { name: 'x' }).expect(403)
    await asEditor.remove('a1').expect(403)
  })

  it('answers 404 when the store cannot list accounts', async () => {
    // Not 403: for this deployment the feature is not part of the admin.
    const app = await appWith(withoutListing(await accounts()))
    await team(app, await signIn(app, 'owner@test'))
      .list()
      .expect(404)
  })

  it('is read-only when the store can list but not write', async () => {
    const app = await appWith(readOnly(await accounts()))
    const asOwner = team(app, await signIn(app, 'owner@test'))

    expect((await asOwner.list().expect(200)).body.data.writable).toBe(false)
    await asOwner.create({ email: 'x@test', password: 'a-long-enough-one' }).expect(403)
  })
})

describe('adding somebody', () => {
  it('creates an account that can then sign in', async () => {
    const app = await appWith(await accounts())
    const asOwner = team(app, await signIn(app, 'owner@test'))

    const { body } = await asOwner
      .create({ email: 'New@Test', name: 'New', role: 'editor', password: PASSWORD })
      .expect(201)

    // Lower-cased on the way in, because that is how the store looks it up.
    expect(body.data.email).toBe('new@test')
    expect(body.data.role).toBe('editor')

    await signIn(app, 'new@test').then((cookie) => expect(cookie).not.toBe(''))
  })

  it('never returns the password hash', async () => {
    const app = await appWith(await accounts())
    const asOwner = team(app, await signIn(app, 'owner@test'))

    const created = await asOwner
      .create({ email: 'new@test', password: 'another-long-one' })
      .expect(201)
    const listed = await asOwner.list().expect(200)

    expect(JSON.stringify(created.body)).not.toMatch(/scrypt|passwordHash/)
    expect(JSON.stringify(listed.body)).not.toMatch(/scrypt|passwordHash/)
  })

  it('ignores a hash somebody tries to supply', async () => {
    // The whole reason this is not a CRUD model. Accepting a hash would let
    // anyone who reached the route install a credential they already knew.
    const store = await accounts()
    const app = await appWith(store)

    await team(app, await signIn(app, 'owner@test'))
      .create({
        email: 'sneaky@test',
        password: 'a-long-enough-one',
        passwordHash: 'scrypt$1$2$3$deadbeef$deadbeef',
      })
      .expect(201)

    const created = await store.findByEmail('sneaky@test')
    expect(created?.passwordHash).not.toContain('deadbeef')
    expect(await verifyAdminPassword('a-long-enough-one', created!.passwordHash)).toBe(true)
  })

  it('refuses a role the admin does not declare', async () => {
    // Storing one would produce an account that signs in and sees nothing,
    // with no clue why.
    const app = await appWith(await accounts())
    const { body } = await team(app, await signIn(app, 'owner@test'))
      .create({ email: 'x@test', password: 'a-long-enough-one', role: 'wizard' })
      .expect(400)

    expect(body.error.details.fields).toEqual(['role'])
  })

  it('refuses a short password and a bad email', async () => {
    const app = await appWith(await accounts())
    const asOwner = team(app, await signIn(app, 'owner@test'))

    await asOwner.create({ email: 'x@test', password: 'short' }).expect(400)
    await asOwner.create({ email: 'not-an-email', password: 'a-long-enough-one' }).expect(400)
  })
})

describe('the rules that stop a lockout', () => {
  it('refuses to let you change your own role', async () => {
    // How an administrator demotes themselves and then cannot undo it.
    const app = await appWith(await accounts())
    const { body } = await team(app, await signIn(app, 'owner@test'))
      .update('a1', { role: 'editor' })
      .expect(400)

    expect(body.error.message).toMatch(/your own role/i)
  })

  it('refuses to let you disable yourself', async () => {
    const app = await appWith(await accounts())
    await team(app, await signIn(app, 'owner@test'))
      .update('a1', { disabled: true })
      .expect(400)
  })

  it('refuses to let you delete yourself', async () => {
    const app = await appWith(await accounts())
    await team(app, await signIn(app, 'owner@test'))
      .remove('a1')
      .expect(400)
  })

  it('lets one manager remove another, because the remover is still there', async () => {
    // Worth stating, because a guard against "removing the last manager" was
    // written for this file and then deleted: it could never fire. The account
    // making the request is signed in, so it is enabled and holds the
    // capability, and the three self-rules mean it is never the account being
    // removed - it always survives its own check.
    //
    // The self-rules are therefore the whole protection, and this is what makes
    // that safe: whoever does the removing is still there afterwards.
    const store = await accounts()
    const app = await appWith(store)
    const asOwner = team(app, await signIn(app, 'owner@test'))

    await asOwner.remove('a2').expect(200)

    const left = await store.listAccounts()
    expect(left.some((account) => account.id === 'a1')).toBe(true)

    // And the one who did it still cannot remove themselves, so the admin
    // cannot be emptied from this screen.
    await asOwner.remove('a1').expect(400)
  })
})

describe('editing', () => {
  it('changes a name and a role on somebody else', async () => {
    const app = await appWith(await accounts())
    const { body } = await team(app, await signIn(app, 'owner@test'))
      .update('a3', { name: 'Edited', role: 'manager' })
      .expect(200)

    expect(body.data).toMatchObject({ name: 'Edited', role: 'manager' })
  })

  it('sets a new password without ever seeing the old one', async () => {
    const store = await accounts()
    const app = await appWith(store)

    await team(app, await signIn(app, 'owner@test'))
      .update('a3', { password: 'a-brand-new-password' })
      .expect(200)

    const updated = await store.findById('a3')
    expect(await verifyAdminPassword('a-brand-new-password', updated!.passwordHash)).toBe(true)
  })

  it('leaves untouched fields alone', async () => {
    // An absent key is not a request to clear a column.
    const store = await accounts()
    const app = await appWith(store)

    await team(app, await signIn(app, 'owner@test'))
      .update('a3', { disabled: true })
      .expect(200)

    const updated = await store.findById('a3')
    expect(updated).toMatchObject({ name: 'Editor', role: 'editor', disabled: true })
  })

  it('answers 404 for an account that does not exist', async () => {
    const app = await appWith(await accounts())
    await team(app, await signIn(app, 'owner@test'))
      .update('nobody', { name: 'x' })
      .expect(404)
  })
})

describe('with no roles configured', () => {
  it('lets any administrator manage the team, as they already could', async () => {
    // Without roles every account is a superuser, which is what an admin with
    // one administrator has always been.
    const app = await appWith(await accounts(), null)
    const { body } = await team(app, await signIn(app, 'editor@test'))
      .list()
      .expect(200)

    expect(body.data.roles).toEqual([])
    expect(body.data.members).toHaveLength(3)
  })
})
