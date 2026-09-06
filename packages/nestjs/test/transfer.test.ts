/**
 * Import and export, over HTTP.
 *
 * The two things worth proving are that an export cannot be used to reach
 * further than the screen it was started from, and that an import cannot write
 * anything a form could not - because both are ways to move a lot of data at
 * once, which is exactly when a missing check matters most.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import type { AdminHooksByModel } from '../src/hooks/contract.js'
import type { AdminResourceAuth } from '../src/auth/resource.js'
import type { AdminRoles, RoleResolver } from '../src/auth/roles.js'
import { AdminModule } from '../src/module.js'
import { parseCsv } from '../src/transfer/csv.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

let app: INestApplication | undefined
let adapter: InMemoryAdapter | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  adapter = undefined
})

const users = [
  { id: 'u1', email: 'ada@example.com', name: 'Ada', age: 36, active: true, role: 'ADMIN' },
  { id: 'u2', email: 'grace@example.com', name: 'Grace', age: 45, active: true, role: 'USER' },
  { id: 'u3', email: 'alan@example.com', name: 'Alan', age: 41, active: false, role: 'USER' },
]

const posts = [
  { id: 'p1', title: 'First', body: 'one', authorId: 'u1', author: { id: 'u1', name: 'Ada' } },
  { id: 'p2', title: 'Second', body: 'two', authorId: 'u2', author: { id: 'u2', name: 'Grace' } },
]

const boot = async (
  options: {
    hooks?: AdminHooksByModel
    resourceAuth?: AdminResourceAuth
    roles?: AdminRoles
    roleOf?: RoleResolver
    models?: Record<string, unknown>
  } = {},
) => {
  adapter = new InMemoryAdapter({ User: users, Post: posts })

  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter,
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        ...(options as Record<string, never>),
      }),
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
  return app.getHttpServer()
}

/** Post a file the way the interface does: text, so no JSON parser touches it. */
const send = (http: unknown, path: string, body: string) =>
  request(http as never)
    .post(path)
    .set('Content-Type', 'text/plain')
    .send(body)

describe('export', () => {
  it('writes every column, with the relation as both a key and a name', async () => {
    const http = await boot()

    const response = await request(http).get('/admin/export/Post?format=csv').expect(200)
    const rows = parseCsv(response.text)

    expect(rows[0]).toContain('authorId')
    expect(rows[0]).toContain('author')

    const author = (rows[0] as string[]).indexOf('author')
    const authorId = (rows[0] as string[]).indexOf('authorId')

    expect(rows[1]?.[authorId]).toBe('u1')
    expect(rows[1]?.[author]).toBe('Ada')
  })

  it('offers the file as a download, named after the model', async () => {
    const http = await boot()

    const response = await request(http).get('/admin/export/User?format=csv').expect(200)

    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="User-\d{4}-/)
  })

  it('exports what the view is showing, not the whole table', async () => {
    const http = await boot()

    const response = await request(http)
      .get('/admin/export/User?format=csv&filter=role:eq:USER')
      .expect(200)

    const rows = parseCsv(response.text)
    expect(rows).toHaveLength(3)
    expect(response.text).not.toContain('ada@example.com')
  })

  it('takes only the columns asked for, in the order asked for', async () => {
    const http = await boot()

    const response = await request(http)
      .get('/admin/export/User?format=csv&columns=name,email')
      .expect(200)

    expect(parseCsv(response.text)[0]).toEqual(['name', 'email'])
  })

  it('writes JSON as an array of objects, which is what it will read back', async () => {
    const http = await boot()

    const response = await request(http)
      .get('/admin/export/User?format=json&columns=id,name')
      .expect(200)

    expect(JSON.parse(response.text)).toEqual([
      { id: 'u1', name: 'Ada' },
      { id: 'u2', name: 'Grace' },
      { id: 'u3', name: 'Alan' },
    ])
  })

  it('refuses a column the model does not have', async () => {
    const http = await boot()

    await request(http).get('/admin/export/User?format=csv&columns=salary').expect(400)
  })

  /*
   * The point of the capability. Reading a page at a time and downloading the
   * whole table are not the same act, so a role can be allowed the first
   * without the second.
   */
  it('refuses a role without the capability, while its lists keep working', async () => {
    const http = await boot({
      roles: { viewer: { models: { User: ['metadata', 'list', 'read'] } } },
      roleOf: () => 'viewer',
    })

    await request(http).get('/admin/User').expect(200)
    await request(http).get('/admin/export/User?format=csv').expect(403)
  })

  it('lets a role that was granted it export', async () => {
    const http = await boot({
      roles: {
        analyst: { models: { User: ['metadata', 'list', 'read'] }, capabilities: ['exportData'] },
      },
      roleOf: () => 'analyst',
    })

    await request(http).get('/admin/export/User?format=csv').expect(200)
  })

  /*
   * A scope is a promise about which rows exist for this principal, and an
   * export that ignored it would be the widest possible way to break it.
   */
  it('cannot reach past the policy row scope', async () => {
    const http = await boot({
      resourceAuth: {
        authorize: ({ model }) =>
          model === 'User' ? { filters: [{ field: 'role', operator: 'eq', value: 'USER' }] } : true,
      },
    })

    const response = await request(http).get('/admin/export/User?format=csv').expect(200)

    expect(response.text).not.toContain('ada@example.com')
    expect(response.text).toContain('grace@example.com')
  })

  it('never writes a write-only column', async () => {
    const http = await boot({ models: { User: { fields: { bio: { writeOnly: true } } } } })

    const response = await request(http).get('/admin/export/User?format=csv').expect(200)

    expect(parseCsv(response.text)[0]).not.toContain('bio')
  })
})

describe('reading a file', () => {
  it('reports the columns and guesses the mapping', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/User/columns',
      'Email,Full Name,age\r\nnew@example.com,New Person,20\r\n',
    ).expect(201)

    expect(body.data.columns).toEqual(['Email', 'Full Name', 'age'])
    expect(body.data.rows).toBe(1)
    expect(body.data.mapping['email']).toBe('Email')
    expect(body.data.mapping['age']).toBe('age')
    expect(body.data.matchable).toContain('email')
  })

  it('reads a JSON array as well as a CSV', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/User/columns',
      JSON.stringify([{ email: 'new@example.com', name: 'New' }]),
    ).expect(201)

    expect(body.data.columns).toEqual(['email', 'name'])
    expect(body.data.rows).toBe(1)
  })

  /*
   * Generated columns, the soft-delete marker and anything marked read-only are
   * not offered at all, so the screen cannot present a mapping that could only
   * fail.
   */
  it('does not offer a read-only field as somewhere to import into', async () => {
    const http = await boot({ models: { User: { fields: { name: { readOnly: true } } } } })

    const { body } = await send(http, '/admin/import/User/columns', 'name\r\nx\r\n').expect(201)
    const fields = body.data.targets.map((target: { field: string }) => target.field)

    expect(fields).not.toContain('name')
    expect(fields).not.toContain('id')
    expect(fields).toContain('email')
  })
})

describe('the dry run', () => {
  it('says what it would do and writes nothing', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/User/plan?mapping=email:email,name:name',
      'email,name\r\nnew@example.com,New\r\nada@example.com,Ada Again\r\n',
    ).expect(201)

    expect(body.data.create).toBe(2)
    expect(body.data.update).toBe(0)

    const { body: after } = await request(http).get('/admin/User').expect(200)
    expect(after.data).toHaveLength(3)
  })

  it('turns a row into an update when the match column already exists', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/User/plan?mapping=name:name&matchBy=email',
      'email,name\r\nada@example.com,Ada L\r\nnew@example.com,New\r\n',
    ).expect(201)

    expect(body.data.create).toBe(1)
    expect(body.data.update).toBe(1)
  })

  it('refuses a row rather than coercing a value into something plausible', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/User/plan?mapping=email:email,age:age,role:role',
      'email,age,role\r\na@example.com,forty,USER\r\nb@example.com,20,WIZARD\r\n',
    ).expect(201)

    expect(body.data.refused).toBe(2)
    expect(body.data.rows[0].problems[0]).toContain('not a number')
    expect(body.data.rows[1].problems[0]).toContain('USER, ADMIN')
  })

  it('refuses a required column left empty', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/User/plan?mapping=email:email,name:name',
      'email,name\r\n,Nobody\r\n',
    ).expect(201)

    expect(body.data.rows[0].problems[0]).toContain('required')
  })

  it('reports the line a person would see in their spreadsheet', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/User/plan?mapping=email:email,age:age',
      'email,age\r\nok@example.com,1\r\nbad@example.com,x\r\n',
    ).expect(201)

    // Line 3: the header is line 1, and the good row is line 2.
    expect(body.data.rows.find((row: { action: string }) => row.action === 'refused').line).toBe(3)
  })

  it('refuses a match column the file does not carry', async () => {
    const http = await boot()

    await send(
      http,
      '/admin/import/User/plan?mapping=name:name&matchBy=email',
      'name\r\nNobody\r\n',
    ).expect(400)
  })

  it('refuses a mapping onto a field this import cannot write', async () => {
    const http = await boot()

    await send(http, '/admin/import/User/plan?mapping=id:x', 'x\r\n1\r\n').expect(400)
  })

  it('refuses a file longer than one import may carry', async () => {
    const http = await boot()

    const rows = Array.from({ length: 1001 }, (_, index) => `u${index}@example.com`).join('\r\n')

    await send(http, '/admin/import/User/plan?mapping=email:email', `email\r\n${rows}\r\n`).expect(
      400,
    )
  })
})

describe('a model that keeps its deleted rows', () => {
  /*
   * Found live rather than here: the lookup filters out marked rows, and a
   * filter on a column left out of the field scope is refused by the adapter
   * rather than ignored. Nothing in the suite matched on a soft-deleted model
   * until this test did.
   */
  it('matches on a unique column without tripping over the marker', async () => {
    const http = await boot({ models: { Post: { softDelete: 'deletedAt' } } })

    const { body } = await send(
      http,
      '/admin/import/Post/plan?mapping=title:title,authorId:author&matchBy=id',
      'id,title,author\r\np1,First edited,Ada\r\n',
    ).expect(201)

    expect(body.data.update).toBe(1)
    expect(body.data.rows[0].problems).toEqual([])
  })

  it('does not update a record somebody deleted', async () => {
    const http = await boot({ models: { Post: { softDelete: 'deletedAt' } } })
    await request(http).delete('/admin/Post/p1').expect(200)

    const { body } = await send(
      http,
      '/admin/import/Post/plan?mapping=title:title,authorId:author&matchBy=id',
      'id,title,author\r\np1,First edited,Ada\r\n',
    ).expect(201)

    // A create, not an update: the marked row is not one this import can see,
    // and resurrecting it by writing to it is not what a spreadsheet meant.
    expect(body.data.create).toBe(1)
  })
})

describe('relations by name', () => {
  it('resolves a cell holding a name into the foreign key', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/Post/plan?mapping=title:title,authorId:author',
      'title,author\r\nThird,Grace\r\n',
    ).expect(201)

    expect(body.data.rows[0].values.authorId).toBe('u2')
  })

  it('takes a key as a key, without a lookup by name', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/Post/plan?mapping=title:title,authorId:author',
      'title,author\r\nThird,u3\r\n',
    ).expect(201)

    expect(body.data.rows[0].values.authorId).toBe('u3')
  })

  /*
   * The row is refused rather than attached to whichever record came back
   * first. Guessing here writes the post to the wrong person, and nothing about
   * the result would look wrong afterwards.
   */
  it('refuses a name that two records share', async () => {
    const http = await boot()
    await request(http).post('/admin/User').send({ email: 'ada2@example.com', name: 'Ada' })

    const { body } = await send(
      http,
      '/admin/import/Post/plan?mapping=title:title,authorId:author',
      'title,author\r\nThird,Ada\r\n',
    ).expect(201)

    expect(body.data.rows[0].action).toBe('refused')
    expect(body.data.rows[0].problems[0]).toContain('2 User records are called "Ada"')
  })

  it('refuses a name that matches nothing', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/Post/plan?mapping=title:title,authorId:author',
      'title,author\r\nThird,Nobody\r\n',
    ).expect(201)

    expect(body.data.rows[0].problems[0]).toContain('no User with')
  })
})

describe('applying', () => {
  it('creates and updates, and reports both', async () => {
    const http = await boot()

    const { body } = await send(
      http,
      '/admin/import/User?mapping=name:name&matchBy=email',
      'email,name\r\nada@example.com,Ada Lovelace\r\nnew@example.com,New Person\r\n',
    ).expect(201)

    expect(body.data).toEqual({ created: 1, updated: 1, failed: [] })

    const { body: after } = await request(http).get('/admin/User?perPage=50').expect(200)
    expect(after.data).toHaveLength(4)
    expect(after.data.find((row: { id: string }) => row.id === 'u1').name).toBe('Ada Lovelace')
  })

  /*
   * The opposite of the mock-data generator, which writes through the adapter
   * so a seeder does not send two hundred emails. An import is a person
   * entering real records, and their rules are what decide what a record means.
   */
  it('runs the application hooks, so an import is not a way around them', async () => {
    const seen: string[] = []
    const http = await boot({
      hooks: {
        User: {
          beforeCreate: ({ data }) => {
            seen.push(String(data['email']))
            return { ...data, name: `${String(data['name'])} (imported)` }
          },
        },
      },
    })

    await send(
      http,
      '/admin/import/User?mapping=email:email,name:name',
      'email,name\r\nnew@example.com,New\r\n',
    ).expect(201)

    expect(seen).toEqual(['new@example.com'])

    const { body } = await request(http).get('/admin/User?search=New').expect(200)
    expect(body.data[0].name).toBe('New (imported)')
  })

  it('keeps the rows that worked when one fails, and names the line', async () => {
    const http = await boot({
      hooks: {
        User: {
          beforeCreate: ({ data }) => {
            if (String(data['email']).startsWith('bad')) throw new Error('nope')
            return data
          },
        },
      },
    })

    const { body } = await send(
      http,
      '/admin/import/User?mapping=email:email,name:name',
      'email,name\r\ngood@example.com,Good\r\nbad@example.com,Bad\r\n',
    ).expect(201)

    expect(body.data.created).toBe(1)
    expect(body.data.failed).toHaveLength(1)
    expect(body.data.failed[0].line).toBe(3)
  })

  it('refuses a principal who may neither create nor update', async () => {
    const http = await boot({
      roles: { viewer: { models: { User: ['metadata', 'list', 'read'] } } },
      roleOf: () => 'viewer',
    })

    await send(http, '/admin/import/User/columns', 'email\r\na@example.com\r\n').expect(403)
  })

  it('cannot write a field the application marked read-only', async () => {
    const http = await boot({ models: { User: { fields: { name: { readOnly: true } } } } })

    await send(http, '/admin/import/User?mapping=name:name', 'name\r\nSomething\r\n').expect(400)
  })

  it('survives a file this admin exported, unchanged', async () => {
    const http = await boot()

    const exported = (await request(http).get('/admin/export/User?format=csv').expect(200)).text

    const { body } = await send(
      http,
      '/admin/import/User?mapping=email:email,name:name,age:age,active:active,role:role&matchBy=email',
      exported,
    ).expect(201)

    expect(body.data).toEqual({ created: 0, updated: 3, failed: [] })
  })
})
