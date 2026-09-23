/**
 * The accordion layout, resolved on the server.
 *
 * It is `sections` with a different starting state, and that is the whole
 * design: the interface already draws a folded group and already forces one
 * open when it holds a validation error, so an accordion needs no rendering of
 * its own. What has to be asserted is that `collapsed` arrives meaning the
 * same thing it always did, and that an application naming it explicitly still
 * wins.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { unsafeAllowAllRequests } from '../src/auth/contract.js'
import { AdminModule } from '../src/module.js'
import { BUILT_UI_ROOT } from './app.js'
import { InMemoryAdapter } from './in-memory-adapter.js'

const apps: INestApplication[] = []

type Sections = readonly { heading: string; fields: readonly string[]; collapsed?: boolean }[]

async function detailOf(
  layout: 'sections' | 'tabs' | 'accordion',
  sections: Sections,
): Promise<{ layout: string; sections: Sections }> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AdminModule.forRoot({
        adapter: new InMemoryAdapter({ User: [] }),
        auth: unsafeAllowAllRequests(),
        uiRoot: BUILT_UI_ROOT,
        models: { User: { detail: { layout, sections } } },
      }),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  apps.push(app)
  await app.init()

  const { body } = await request(app.getHttpServer()).get('/admin/meta').expect(200)
  return body.data.models.find((model: { name: string }) => model.name === 'User').detail
}

const GROUPS: Sections = [
  { heading: 'Identity', fields: ['email', 'name'] },
  { heading: 'Profile', fields: ['bio', 'age'] },
  { heading: 'Access', fields: ['role', 'active'] },
]

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

describe('an accordion', () => {
  it('folds every group but the first', async () => {
    const detail = await detailOf('accordion', GROUPS)

    expect(detail.layout).toBe('accordion')
    expect(detail.sections.map((section) => section.collapsed)).toEqual([
      false,
      true,
      true,
      // The leftovers group the server appends, folded like the rest.
      true,
    ])
  })

  /*
   * The application naming a state is a stronger statement than this default,
   * including for the first group - somebody who wrote `collapsed: true` on it
   * meant it.
   */
  it('leaves a group that said what it wanted alone', async () => {
    const detail = await detailOf('accordion', [
      { heading: 'Identity', fields: ['email'], collapsed: true },
      { heading: 'Profile', fields: ['bio'], collapsed: false },
      { heading: 'Access', fields: ['role'] },
    ])

    const collapsed = detail.sections.map((section) => section.collapsed)
    expect(collapsed[0]).toBe(true)
    expect(collapsed[1]).toBe(false)
    expect(collapsed[2]).toBe(true)
  })

  /*
   * Sections are unchanged, which is what makes this an addition rather than a
   * change: an admin that never asks for an accordion sees exactly what it saw.
   */
  it('changes nothing for the layouts that already existed', async () => {
    for (const layout of ['sections', 'tabs'] as const) {
      const detail = await detailOf(layout, GROUPS)
      expect(detail.layout).toBe(layout)
      expect(detail.sections.every((section) => section.collapsed === undefined)).toBe(true)
    }
  })
})
