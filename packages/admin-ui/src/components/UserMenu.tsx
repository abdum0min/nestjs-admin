/**
 * Who you are, and the way out.
 *
 * Small, and worth getting right: an admin with no visible sign of whose
 * session it is has caught people out on a shared machine, and one with no
 * sign-out button leaves closing the tab as the only option - which does not
 * end the session.
 *
 * Shown only when the admin has a login of its own. An application using its
 * own `AdminAuth` signs people out through its own interface, and a button here
 * that cannot do it would be a lie.
 */
import { LogOut, User, Users } from 'lucide-react'
import { useState } from 'react'

import { signOut } from '../api/client.js'
import type { AdminAccountSummary } from '../api/types.js'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.jsx'

export function UserMenu({
  account,
  onSignedOut,
  canManageTeam = false,
}: {
  readonly account: AdminAccountSummary
  readonly onSignedOut: () => void
  readonly canManageTeam?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const name = account.name ?? account.email

  const leave = async (): Promise<void> => {
    setBusy(true)
    try {
      await signOut()
    } catch {
      // The cookie may already be gone, or the network may be. Either way the
      // session is over as far as this page is concerned, and refusing to sign
      // someone out because the request failed is the wrong way round.
    } finally {
      onSignedOut()
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Signed in as ${name}`}>
          <span
            className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full text-xs font-semibold"
            aria-hidden="true"
          >
            {initial(name)}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-52">
        <DropdownMenuLabel className="flex items-center gap-2 py-2 text-sm font-normal">
          <User className="size-4 shrink-0 opacity-70" />
          <span className="flex min-w-0 flex-col">
            <span className="text-foreground truncate font-medium">{name}</span>
            {account.name === undefined ? null : (
              <span className="truncate text-xs">{account.email}</span>
            )}
            {/* Only when the admin has roles at all. Someone who is the only
                administrator does not need to be told which role they hold. */}
            {account.role === undefined ? null : (
              <span className="mt-1">
                <Badge variant="secondary" className="font-normal">
                  {account.role}
                </Badge>
              </span>
            )}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Only when the server said so. The link is a convenience; the routes
            behind it refuse the request on their own. */}
        {canManageTeam ? (
          <DropdownMenuItem asChild>
            <a href="#/~team">
              <Users />
              Team
            </a>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem disabled={busy} onSelect={() => void leave()}>
          <LogOut />
          {busy ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One letter for the avatar.
 *
 * The first letter of a name, or of an email's local part - not of the whole
 * address, which for `ada@example.com` is the same `a` as for `alan@` and
 * `alex@`.
 */
function initial(name: string): string {
  const first = name.trim().charAt(0)
  return (first === '' ? '?' : first).toUpperCase()
}
