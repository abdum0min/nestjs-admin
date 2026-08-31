/**
 * Opening a Radix listbox in jsdom.
 *
 * Radix opens a select on `pointerdown`, which jsdom does not synthesise from
 * `click` - so `fireEvent.click` on the trigger does nothing and the options
 * never exist to be found. The keyboard path is both reliable here and the one
 * worth exercising: it is how someone without a mouse opens it.
 */
import { fireEvent, screen, within } from '@testing-library/react'

/** Open the listbox behind a trigger and return it. */
export async function openSelect(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.keyDown(trigger, { key: 'Enter' })
  return screen.findByRole('listbox')
}

/** The option labels a select offers, opened and read. */
export async function optionsOf(trigger: HTMLElement): Promise<string[]> {
  const list = await openSelect(trigger)
  return within(list)
    .getAllByRole('option')
    .map((option) => option.textContent ?? '')
}

/** Choose an option by its visible text. */
export async function chooseOption(trigger: HTMLElement, label: string | RegExp): Promise<void> {
  const list = await openSelect(trigger)
  fireEvent.click(within(list).getByRole('option', { name: label }))
}
