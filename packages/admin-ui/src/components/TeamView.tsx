/**
 * Who can open this admin.
 *
 * The one screen that is not generated from metadata, because it is not about a
 * model: the account table is deliberately not a resource, for the reason the
 * server states - as an ordinary resource, anyone able to edit it could write
 * another account's password hash.
 *
 * So this is hand-written, small, and offers exactly four things: add somebody,
 * change their name or role, suspend them, remove them. There is no password
 * field on the list and no hash anywhere: a password is typed once, sent once,
 * and never comes back.
 *
 * Everything it withholds, the server refuses again. A disabled button here is
 * a courtesy; the rule is the 400 behind it.
 */
import { Ban, Pencil, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { createTeamMember, deleteTeamMember, fetchTeam, updateTeamMember } from '../api/client.js'
import type { TeamMember } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { Empty, ErrorState, Loading } from './States.jsx'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'
import { useConfirm } from './ui/confirm.jsx'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './ui/dialog.jsx'
import { Input } from './ui/input.jsx'
import { PasswordInput } from './ui/password-input.jsx'
import { SimpleSelect } from './ui/select.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.jsx'

/** What the dialog is doing, and to whom. */
type Editing = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly member: TeamMember }

export function TeamView() {
  const team = useAsync(() => fetchTeam(), [])
  const [editing, setEditing] = useState<Editing | undefined>(undefined)
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)

  const data = team.data
  const writable = data?.writable === true

  const act = async (id: string, run: () => Promise<unknown>): Promise<void> => {
    setBusy(id)
    setFailure(undefined)
    try {
      await run()
      team.reload()
    } catch (error) {
      setFailure(error)
    } finally {
      setBusy(undefined)
    }
  }

  const remove = async (member: TeamMember): Promise<void> => {
    const agreed = await confirm({
      title: `Remove ${member.name ?? member.email}?`,
      description: 'They will not be able to sign in to the admin again.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (agreed) await act(member.id, () => deleteTeamMember(member.id))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-muted-foreground text-sm">
            The accounts that can sign in to this admin. Separate from the people in your data.
          </p>
        </div>

        {writable ? (
          <Button onClick={() => setEditing({ mode: 'create' })}>
            <UserPlus />
            Add someone
          </Button>
        ) : null}
      </div>

      {failure === undefined ? null : <ErrorState error={failure} />}

      {team.loading ? (
        <Loading label="Loading the team…" />
      ) : team.error !== undefined ? (
        <ErrorState error={team.error} onRetry={team.reload} />
      ) : data === undefined || data.members.length === 0 ? (
        <Empty>
          <p>No accounts yet.</p>
        </Empty>
      ) : (
        <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                {data.roles.length > 0 ? <TableHead>Role</TableHead> : null}
                <TableHead>Status</TableHead>
                {writable ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>

            <TableBody>
              {data.members.map((member) => (
                <TableRow key={member.id} className={member.disabled ? 'opacity-60' : undefined}>
                  <TableCell className="font-medium">
                    {member.name ?? '—'}
                    {/* Named, because every rule below is about this row being
                        yours: you cannot suspend, demote or remove yourself. */}
                    {member.isYou ? (
                      <Badge variant="secondary" className="ml-2 font-normal">
                        you
                      </Badge>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-muted-foreground">{member.email}</TableCell>

                  {data.roles.length > 0 ? (
                    <TableCell>
                      {member.role === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge variant="outline" className="font-normal">
                          {member.role}
                        </Badge>
                      )}
                    </TableCell>
                  ) : null}

                  <TableCell>
                    {member.disabled ? (
                      <Badge variant="secondary">Suspended</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">Active</span>
                    )}
                  </TableCell>

                  {writable ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${member.email}`}
                          disabled={busy !== undefined}
                          onClick={() => setEditing({ mode: 'edit', member })}
                        >
                          <Pencil />
                        </Button>

                        {/* Absent rather than disabled for your own row: there
                            is no version of these that applies to you. */}
                        {member.isYou ? null : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={
                                member.disabled
                                  ? `Restore ${member.email}`
                                  : `Suspend ${member.email}`
                              }
                              disabled={busy !== undefined}
                              onClick={() =>
                                void act(member.id, () =>
                                  updateTeamMember(member.id, { disabled: !member.disabled }),
                                )
                              }
                            >
                              <Ban />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              aria-label={`Remove ${member.email}`}
                              disabled={busy !== undefined}
                              onClick={() => void remove(member)}
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {writable ? null : (
        <p className="text-muted-foreground text-xs">
          This account store is read-only, so the team can be seen but not changed.
        </p>
      )}

      {editing === undefined ? null : (
        <MemberDialog
          editing={editing}
          roles={data?.roles ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            team.reload()
          }}
        />
      )}
    </div>
  )
}

/**
 * Add or edit one account.
 *
 * A password is optional when editing - leaving it empty changes nothing - and
 * required when adding, because an account with no password could not sign in.
 * The role selector is absent for your own row, because the server refuses it
 * and offering a control that always fails is worse than not offering it.
 */
function MemberDialog({
  editing,
  roles,
  onClose,
  onSaved,
}: {
  readonly editing: Editing
  readonly roles: readonly string[]
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const member = editing.mode === 'edit' ? editing.member : undefined

  const [name, setName] = useState(member?.name ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [role, setRole] = useState(member?.role ?? roles[0] ?? '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<unknown>(undefined)

  const save = async (): Promise<void> => {
    setSaving(true)
    setFailure(undefined)
    try {
      if (editing.mode === 'create') {
        await createTeamMember({
          email,
          ...(name !== '' ? { name } : {}),
          ...(role !== '' ? { role } : {}),
          password,
        })
      } else {
        await updateTeamMember(editing.member.id, {
          name,
          // Only what changed, and never your own role - the server refuses it.
          ...(role !== '' && role !== member?.role && !editing.member.isYou ? { role } : {}),
          ...(password !== '' ? { password } : {}),
        })
      }
      onSaved()
    } catch (error) {
      setFailure(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogTitle>{editing.mode === 'create' ? 'Add someone' : 'Edit account'}</DialogTitle>

        <div className="flex flex-col gap-4">
          {failure === undefined ? null : <ErrorState error={failure} />}

          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>

          <Field label="Email">
            <Input
              type="email"
              value={email}
              // An email is what the session is keyed on, so changing it is a
              // different operation than editing an account. Not offered here.
              disabled={editing.mode === 'edit'}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          {roles.length === 0 || member?.isYou === true ? null : (
            <Field label="Role">
              <SimpleSelect
                value={role}
                onValueChange={setRole}
                placeholder="Choose a role"
                options={roles.map((value) => ({ value, label: value }))}
              />
            </Field>
          )}

          <Field
            label={editing.mode === 'create' ? 'Password' : 'New password'}
            hint={editing.mode === 'edit' ? 'Leave empty to keep the current one.' : undefined}
          >
            <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string
  readonly hint?: string | undefined
  readonly children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint === undefined ? null : <span className="text-muted-foreground text-xs">{hint}</span>}
    </label>
  )
}
