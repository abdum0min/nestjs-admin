/**
 * The trail at the top of every screen.
 *
 * A back link offers the step behind; a trail offers every step and says what
 * the current page belongs to without being read. The one thing worth guarding
 * is the last crumb: it is the page you are on, so it is not a link, and it
 * says so in a way a screen reader can act on rather than only by being
 * unclickable.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Breadcrumb } from '../src/components/ui/breadcrumb.jsx'

const trail = [
  { label: 'Home', href: '#/' },
  { label: 'People', href: '#/User' },
  { label: 'Ada Lovelace' },
]

describe('the trail', () => {
  it('links every step except the one you are on', () => {
    render(<Breadcrumb trail={trail} />)

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Home', 'People'])
    expect(within(nav).queryByRole('link', { name: 'Ada Lovelace' })).toBeNull()
  })

  it('marks the last crumb as the current page', () => {
    render(<Breadcrumb trail={trail} />)
    expect(screen.getByText('Ada Lovelace').getAttribute('aria-current')).toBe('page')
  })

  it('points each step where it says it does', () => {
    render(<Breadcrumb trail={trail} />)
    expect(screen.getByRole('link', { name: 'People' }).getAttribute('href')).toBe('#/User')
  })

  it('is a list, so a reader can be told how many steps there are', () => {
    render(<Breadcrumb trail={trail} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('draws nothing rather than an empty bar', () => {
    const { container } = render(<Breadcrumb trail={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
