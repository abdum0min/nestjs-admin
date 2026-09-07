/**
 * The sign-in screen.
 *
 * The first thing anyone sees, and often the only thing they see if something
 * is wrong - so it is a whole screen rather than a form dropped on the page,
 * and it carries the application's own name and logo. An admin that greets
 * people with an unbranded box does not look like part of their product.
 *
 * ## One message for every failure
 *
 * The server answers the same way for an unknown address, a wrong password, a
 * disabled account and one that is locked out, and this screen shows what it
 * says without elaborating. Distinguishing them is a small convenience for
 * whoever forgot their password and a list of registered addresses for
 * everybody else.
 *
 * The one thing it does add is a hint after several failures - that repeated
 * attempts are slowed down - because someone typing the right password into a
 * locked-out account otherwise has no way to understand what is happening.
 */
import { LogIn, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { signIn } from '../api/client.js'
import type { AdminAccountSummary } from '../api/types.js'
import { theme } from '../metadata/theme.js'
import { Button } from './ui/button.jsx'
import { Card, CardContent } from './ui/card.jsx'
import { Input } from './ui/input.jsx'
import { PasswordInput } from './ui/password-input.jsx'

export function LoginPage({
  onSignedIn,
}: {
  readonly onSignedIn: (account: AdminAccountSummary) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [failures, setFailures] = useState(0)

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)

    try {
      const session = await signIn(email, password)
      if (session.account) return onSignedIn(session.account)
      setError('Those details do not match an account.')
      setFailures((count) => count + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.')
      setFailures((count) => count + 1)
    } finally {
      setSubmitting(false)
      // Never the email: retyping an address you have already typed correctly
      // is the most annoying part of getting a password wrong.
      setPassword('')
    }
  }

  return (
    <div className="bg-background flex min-h-svh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* The sign-in logo where the application supplied one, and the
              header logo otherwise: a wordmark has more room here than it does
              in a header, and most applications only have the one. */}
          {(theme.loginLogoUrl ?? theme.logoUrl) === undefined ? null : (
            <img className="max-h-16 rounded-lg" src={theme.loginLogoUrl ?? theme.logoUrl} alt="" />
          )}
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{theme.title ?? 'Admin'}</h1>
            <p className="text-muted-foreground text-sm">
              {theme.welcome ?? 'Sign in to continue.'}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-5">
            <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
              {error === undefined ? null : (
                <div
                  data-slot="login-error"
                  className="border-destructive/40 bg-destructive/8 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                  role="alert"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <div className="flex flex-col gap-1">
                    <span>{error}</span>
                    {failures >= 3 ? (
                      <span className="opacity-80">
                        Repeated attempts are slowed down. Wait a few minutes before trying again.
                      </span>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="admin-login-email">
                  Email
                </label>
                <Input
                  id="admin-login-email"
                  type="email"
                  // The one field on the page that should be filled in by a
                  // password manager: here the credential really is the
                  // visitor's own, unlike a password on somebody's record.
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="admin-login-password">
                  Password
                </label>
                <PasswordInput
                  id="admin-login-password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <Button type="submit" className="mt-1 w-full" disabled={submitting}>
                <LogIn />
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-muted-foreground text-center text-xs">
          Contact an administrator if you cannot sign in.
        </p>
      </div>
    </div>
  )
}
