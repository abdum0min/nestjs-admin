import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { Button } from './button.jsx'
import { Input } from './input.jsx'

/**
 * A password box you can check.
 *
 * Masking exists so someone behind you cannot read it. It also stops *you*
 * reading it, which is why people paste a password into the wrong field, do not
 * notice a capital letter, and end up locked out of an account they just
 * created. The reveal is the standard answer: masked by default, visible while
 * you look.
 *
 * ## What it does not do
 *
 * It does not remember being revealed. Every render starts masked, so a form
 * left open on a shared screen does not sit there with the password showing.
 *
 * And it does not offer itself to a password manager. `autoComplete` is
 * `new-password`: this is a password for someone else's record, not the
 * visitor's own, and a manager filling in its own credentials here would put
 * the wrong secret on somebody's account.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="relative">
      <Input
        type={revealed ? 'text' : 'password'}
        autoComplete="new-password"
        className={className ? `${className} pr-10` : 'pr-10'}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-1 -translate-y-1/2"
        // The label says what pressing it does, which is the question someone
        // looking at it is asking - not what state it is currently in.
        aria-label={revealed ? 'Hide password' : 'Show password'}
        aria-pressed={revealed}
        onClick={() => setRevealed((value) => !value)}
      >
        {revealed ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  )
}
