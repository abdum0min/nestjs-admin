import { readFileSync, writeFileSync } from 'node:fs'

const F = 'packages/nestjs/test/team.test.ts'
let s = readFileSync(F, 'utf8')
const edit = (from, to) => {
  if (!s.includes(from)) throw new Error('no match: ' + JSON.stringify(from.slice(0, 70)))
  s = s.replace(from, to)
}

/* The login route refuses a cross-origin post; supertest's host is not the one
 * this header claimed, so every sign-in was answering 401. */
edit(
  `  const res = await request(app.getHttpServer())
    .post('/admin/auth/login')
    .set('origin', 'http://127.0.0.1')
    .send({ email, password: PASSWORD })
    .expect(200)`,
  `  const res = await request(app.getHttpServer())
    .post('/admin/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200)`,
)

edit(
  `    return (res.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? ''`,
  `    return (res.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? ''`,
)

/* Two tests were written against a guard that turned out to be unreachable.
 * Replaced with what actually holds, including why the guard could not fire. */
const start = s.indexOf(`  it('refuses to remove the last account that can manage the team', async () => {`)
const endMarker = `describe('editing', () => {`
const end = s.indexOf(endMarker)
if (start < 0 || end < 0) throw new Error('cannot find the block to replace')

const REPLACEMENT = `  it('lets one manager remove another, because the remover is still there', async () => {
    // Worth stating, because a guard against "removing the last manager" was
    // written for this file and then deleted: it could never fire. The account
    // making the request is signed in, so it is enabled and holds the
    // capability, and the three self-rules above mean it is never the account
    // being removed - it always survives its own check.
    //
    // The self-rules are therefore the whole protection, and this is what makes
    // that safe: after removing every other manager, one still remains.
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

`

s = s.slice(0, start) + REPLACEMENT + s.slice(end)

writeFileSync(F, s)
console.log('team tests corrected')
