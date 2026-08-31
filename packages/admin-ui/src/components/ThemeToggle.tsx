import { Moon, Sun } from 'lucide-react'

import { useTheme } from '../hooks/use-theme.js'
import { Button } from './ui/button.jsx'

/**
 * One button.
 *
 * It started as three - light, dark, and follow the system - on the argument
 * that "system" is a real answer and collapsing it forces a choice on people
 * who have not made one. That argument is about the *default*, and the default
 * still works exactly that way: nothing is stored until this is pressed, and
 * until then the admin follows the operating system and keeps following it as
 * it changes at dusk.
 *
 * What the three-way control got wrong was the other half. Switching is
 * something people do often and idly - to read something in bright sun, to stop
 * a white page at midnight - and asking them to pick from a list of three to do
 * it is three times the interaction for the same outcome. Pressing it once is
 * the whole feature.
 *
 * The icon shows what pressing it will do rather than what is currently on. A
 * sun on a dark page means "make it light", which is the question someone
 * looking at the button is actually asking.
 */
export function ThemeToggle() {
  const { resolved, setAppearance } = useTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setAppearance(next)}
    >
      {resolved === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}
