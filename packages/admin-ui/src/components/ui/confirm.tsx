/**
 * Asking before something irreversible happens.
 *
 * Replaces `window.confirm`, which cannot be styled, cannot say which record
 * it means without stuffing the detail into one line, and looks like the
 * browser rather than like the product. What it *did* get right is that it
 * returns an answer to the caller, so the call site reads as a question rather
 * than as a state machine - and that is kept:
 *
 *     if (!(await confirm({ title: 'Delete 12 records?' }))) return
 *
 * Built on Radix's AlertDialog rather than Dialog. The difference is not
 * cosmetic: an alert dialog is announced with `role="alertdialog"`, traps
 * focus, cannot be dismissed by clicking away, and starts with focus on the
 * safe choice. A confirmation people can dismiss by missing is not one.
 */
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

import { cn } from '../../lib/utils.js'
import { buttonVariants } from './button.jsx'

export interface ConfirmOptions {
  readonly title: string
  readonly description?: string
  /** What the confirming button says. Name the action, not "OK". */
  readonly confirmLabel?: string
  readonly cancelLabel?: string
  /** Draw the confirming button as destructive. */
  readonly destructive?: boolean
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Ask | undefined>(undefined)

/** The question, as a function. Throws if no provider is mounted. */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext)
  if (!ask) throw new Error('useConfirm() requires <ConfirmProvider> above it.')
  return ask
}

export function ConfirmProvider({ children }: { readonly children: React.ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | undefined>(undefined)
  // Held in a ref rather than in state: resolving is not a render.
  const answer = useRef<((agreed: boolean) => void) | undefined>(undefined)

  /**
   * Where focus was when the question was asked.
   *
   * Radix returns focus to its own `Trigger`, and this dialog has none - it is
   * opened by a promise from wherever the call site happens to be. Without
   * this, cancelling drops a keyboard user at the top of the document, several
   * dozen tab stops from the button they just pressed. Found by walking the
   * interface with no mouse.
   */
  const opener = useRef<HTMLElement | undefined>(undefined)

  const ask = useCallback<Ask>((options) => {
    opener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setPending(options)
    return new Promise<boolean>((resolve) => {
      answer.current = resolve
    })
  }, [])

  const settle = (agreed: boolean): void => {
    answer.current?.(agreed)
    answer.current = undefined
    setPending(undefined)

    // After the dialog has gone, so Radix's own teardown cannot move focus
    // again afterwards.
    const returnTo = opener.current
    opener.current = undefined
    if (returnTo?.isConnected) queueMicrotask(() => returnTo.focus())
  }

  const value = useMemo(() => ask, [ask])

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      <AlertDialogPrimitive.Root
        open={pending !== undefined}
        // Escape and the cancel button both arrive here. Anything that closes
        // the dialog without an answer is an answer of "no".
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
      >
        <AlertDialogPrimitive.Portal>
          <AlertDialogPrimitive.Overlay
            data-slot="alert-overlay"
            className="fixed inset-0 z-50 bg-black/50"
          />
          <AlertDialogPrimitive.Content
            data-slot="alert-content"
            className="bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border p-6 shadow-lg"
          >
            <div className="flex flex-col gap-2">
              <AlertDialogPrimitive.Title className="text-lg leading-none font-semibold">
                {pending?.title}
              </AlertDialogPrimitive.Title>
              {pending?.description ? (
                <AlertDialogPrimitive.Description className="text-muted-foreground text-sm">
                  {pending.description}
                </AlertDialogPrimitive.Description>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogPrimitive.Cancel
                className={cn(buttonVariants({ variant: 'outline' }))}
                onClick={() => settle(false)}
              >
                {pending?.cancelLabel ?? 'Cancel'}
              </AlertDialogPrimitive.Cancel>
              <AlertDialogPrimitive.Action
                className={cn(
                  buttonVariants({ variant: pending?.destructive ? 'destructive' : 'default' }),
                )}
                onClick={() => settle(true)}
              >
                {pending?.confirmLabel ?? 'Confirm'}
              </AlertDialogPrimitive.Action>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Portal>
      </AlertDialogPrimitive.Root>
    </ConfirmContext.Provider>
  )
}
