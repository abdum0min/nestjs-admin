/**
 * Not losing a form somebody has half filled in.
 *
 * ## Why this is worth its own file
 *
 * It is the single most painful thing a generated admin does. Twelve fields
 * typed, a click on the sidebar to check something, and all of it is gone with
 * no warning and no way back. Every hand-built admin grows a guard against
 * this eventually; a generated one has to arrive with it.
 *
 * ## Two different exits, two different mechanisms
 *
 * **Leaving the page entirely** - closing the tab, reloading, following a link
 * out - is the browser's to handle, through `beforeunload`. The dialog is the
 * browser's own and cannot be styled or worded: browsers stopped honouring
 * custom text years ago, because a page that could write that dialog could
 * write anything in it. Setting `returnValue` is the whole API.
 *
 * **Moving inside the admin** is a hash change, and the browser has no hook
 * before one. The options are to catch the click that causes it, or to let the
 * hash change and put it back. Clicks are caught here, in the capture phase,
 * so the decision happens before anything has moved - reverting afterwards
 * means the address bar flickers to a route that was refused, and the back
 * button then has a step in it that goes nowhere.
 *
 * ## What is deliberately not guarded
 *
 * A click that is not a plain left click. Opening a record in a new tab
 * (ctrl-click, middle-click) does not leave this form at all, so a question
 * about abandoning it would be nonsense.
 */
import { useEffect, useRef } from 'react'

export interface UnsavedGuard {
  /** Whether there is anything to lose. Nothing happens while this is false. */
  readonly when: boolean
  /**
   * Ask, and answer whether to continue.
   *
   * Asynchronous, which is why the click is cancelled first and replayed after:
   * a dialog cannot be awaited inside an event handler and still have its
   * answer decide whether the event proceeds.
   */
  readonly ask: () => Promise<boolean>
}

export function useUnsavedGuard({ when, ask }: UnsavedGuard): void {
  /*
   * Held in refs, read by listeners that are attached once.
   *
   * Re-attaching on every keystroke - which is what `when` in the dependency
   * list would mean - churns two document listeners per character typed. The
   * listeners never change; only what they read does.
   */
  const active = useRef(when)
  const question = useRef(ask)
  active.current = when
  question.current = ask

  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent): void => {
      if (!active.current) return
      // Both are required across browsers, and neither's text is used: the
      // dialog is the browser's own. Calling them at all is the signal.
      event.preventDefault()
      event.returnValue = ''
    }

    const onClick = (event: MouseEvent): void => {
      if (!active.current) return

      // A modified click opens elsewhere and leaves this form where it is.
      if (event.defaultPrevented) return
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }

      const link = (event.target as Element | null)?.closest?.('a')
      const href = link?.getAttribute('href')
      if (link === null || link === undefined || href === null || href === undefined) return

      // Only routes inside the admin. An absolute URL is a page exit, which
      // `beforeunload` already covers - and doing both would ask twice.
      if (!href.startsWith('#')) return
      if (link.target === '_blank') return

      // Already here. Following it changes nothing, so there is nothing to
      // warn about - and asking would be baffling.
      if (href === window.location.hash) return

      event.preventDefault()
      void question.current().then((go) => {
        if (go) {
          // The guard is off for the rest of this turn, so the replayed
          // navigation is not caught by this same listener a second time.
          active.current = false
          window.location.hash = href
        }
      })
    }

    window.addEventListener('beforeunload', onUnload)
    // Capture, so the decision is made before any handler on the link itself.
    document.addEventListener('click', onClick, true)

    return () => {
      window.removeEventListener('beforeunload', onUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [])
}

/**
 * Ctrl+S, or Cmd+S on a Mac, saves the form.
 *
 * It takes the shortcut away from "save this page as HTML", which is the
 * browser's and which nobody has ever wanted while filling in an admin form.
 * Every application people spend a day inside does this, and the muscle memory
 * arrives before the documentation does.
 *
 * Bound to the document rather than to the form, because focus is often
 * nowhere in particular - somebody who has just scrolled has no field active,
 * and a shortcut that works only while a box is focused is one that fails
 * exactly when it is reached for.
 */
export function useSaveShortcut(save: () => void): void {
  const handler = useRef(save)
  handler.current = save

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 's' && event.key !== 'S') return
      if (!event.metaKey && !event.ctrlKey) return
      // Ctrl+Shift+S and Alt are other people's shortcuts.
      if (event.shiftKey || event.altKey) return

      event.preventDefault()
      handler.current()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}
