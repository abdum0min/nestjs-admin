/**
 * Loading / data / error state for one asynchronous read.
 *
 * No state library. The repository has none, and this app's server state is a
 * handful of independent reads with no cross-screen sharing - adding a cache
 * layer would be more machinery than the problem has.
 *
 * Results from a superseded request are discarded, so a slow first response
 * cannot overwrite a fast second one when the user retypes a search term.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  readonly data: T | undefined
  readonly error: unknown
  readonly loading: boolean
  /** Re-run the operation, e.g. after a delete. */
  readonly reload: () => void
}

export function useAsync<T>(operation: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  // Identifies the newest request; older ones resolve into the void.
  const latest = useRef(0)

  useEffect(() => {
    const ticket = ++latest.current
    setLoading(true)
    setError(undefined)

    operation().then(
      (result) => {
        if (ticket !== latest.current) return
        setData(result)
        setLoading(false)
      },
      (cause: unknown) => {
        if (ticket !== latest.current) return
        setError(cause)
        setData(undefined)
        setLoading(false)
      },
    )
    // `operation` is intentionally not a dependency: callers pass an inline
    // closure, so it is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, error, loading, reload }
}
