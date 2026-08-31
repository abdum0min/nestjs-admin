import { Monitor, Moon, Sun } from 'lucide-react'

import { cn } from '../lib/utils.js'
import { useTheme, type Appearance } from '../hooks/use-theme.js'

const OPTIONS: readonly { value: Appearance; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

/**
 * Three choices, all visible.
 *
 * "System" is a real answer and the default one. A two-state switch forces
 * everyone who has expressed no preference into having expressed one, and
 * their machine switching at dusk quietly stops working.
 *
 * A segmented control rather than a menu, and the reason is measured rather
 * than aesthetic: a dropdown for this brought in Radix's menu, floating-ui,
 * a collection, a popper and a scroll lock - over 150 KB of source to place
 * one small list. Three buttons cost nothing, take one click instead of two,
 * and show the current choice without being opened.
 */
export function ThemeToggle() {
  const { appearance, setAppearance } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="bg-muted flex items-center gap-0.5 rounded-md p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const current = appearance === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={current}
            aria-label={label}
            title={label}
            className={cn(
              'flex size-7 items-center justify-center rounded-[5px] transition-colors',
              current
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setAppearance(value)}
          >
            <Icon className="size-4" />
          </button>
        )
      })}
    </div>
  )
}
