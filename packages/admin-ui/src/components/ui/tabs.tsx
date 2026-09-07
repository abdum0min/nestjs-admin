/**
 * Tabs, for a record with more fields than a page.
 *
 * Written here rather than taken from Radix, unlike most of this directory:
 * the record screen needs to *drive* the selection - a form that fails
 * validation has to open the tab holding the first error, or the person is
 * looking at a Save button that does nothing and a panel with nothing wrong on
 * it. A controlled component is three lines here and a wrapper there.
 *
 * The keyboard behaviour is the one the WAI-ARIA pattern specifies: arrows
 * move between tabs, Home and End jump to the ends, and only the selected tab
 * is in the tab order - so Tab moves out of the strip and into the panel
 * rather than through every heading.
 */
import { useRef } from 'react'

import { cn } from '../../lib/utils.js'

export interface TabDescriptor {
  readonly id: string
  readonly label: string
  /** Drawn after the label - a count, or a mark that this tab holds an error. */
  readonly marker?: string
  readonly alarming?: boolean
}

export function Tabs({
  tabs,
  active,
  onSelect,
  children,
}: {
  readonly tabs: readonly TabDescriptor[]
  readonly active: string
  readonly onSelect: (id: string) => void
  /** The panel for the active tab. Only one is rendered. */
  readonly children: React.ReactNode
}) {
  const strip = useRef<HTMLDivElement>(null)

  const move = (event: React.KeyboardEvent): void => {
    const keys: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 }
    const at = tabs.findIndex((tab) => tab.id === active)

    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : keys[event.key] === undefined
            ? undefined
            : (at + (keys[event.key] as number) + tabs.length) % tabs.length

    if (next === undefined) return
    event.preventDefault()

    const chosen = tabs[next]
    if (chosen === undefined) return

    onSelect(chosen.id)
    // Focus follows selection, which is what the pattern calls automatic
    // activation: with one panel per tab and nothing expensive behind them,
    // arrowing to a tab and having to press Enter is friction with no payoff.
    strip.current?.querySelector<HTMLElement>(`[data-tab="${chosen.id}"]`)?.focus()
  }

  return (
    <div className="flex flex-col">
      <div
        ref={strip}
        role="tablist"
        className="border-border -mx-1 flex gap-1 overflow-x-auto border-b px-1"
        onKeyDown={move}
      >
        {tabs.map((tab) => {
          const selected = tab.id === active

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab={tab.id}
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              className={cn(
                'focus-visible:ring-ring/50 -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
                selected
                  ? 'border-primary text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {tab.label}
              {tab.marker === undefined ? null : (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                    tab.alarming
                      ? 'bg-destructive text-destructive-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {tab.marker}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  )
}
