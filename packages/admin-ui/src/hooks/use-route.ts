/**
 * Hash-based routing.
 *
 * Deliberately hash rather than path routing. The API owns the same path space
 * the SPA is mounted in: `GET /admin/User` is a real endpoint, so a browser
 * route at `/admin/User` would be served by the record controller instead of
 * the app, and a deep link would return JSON. `#/User` cannot collide with
 * anything the server routes, and needs no SPA fallback on the server - which
 * matters because serving the SPA is not implemented yet.
 *
 * Routes:
 *   #/                      no model selected
 *   #/:model                list
 *   #/:model/new            create
 *   #/:model/:id            record detail
 *   #/:model/:id/edit       edit
 */
import { useEffect, useState } from 'react'

export type Route =
  | { readonly kind: 'home' }
  /**
   * The team screen.
   *
   * `~team` rather than `team`, because every other route in this space is a
   * model name and a schema is free to contain one called `Team`. The tilde is
   * not a legal first character for a model in any ORM this supports, so the
   * two can never collide - the same problem the server solves by declaring
   * literal segments before `:model`, solved the same way.
   */
  | { readonly kind: 'team' }
  /** The developer tools. `~dev` for the same reason `~team` is. */
  | { readonly kind: 'dev' }
  | {
      readonly kind: 'list'
      readonly model: string
      /**
       * A filter to open the list with, in the API's own `field:op:value` form.
       *
       * Carried in the hash so a filtered list can be linked to - which is what
       * "all the posts by this author" is - and so reloading the page does not
       * silently drop the constraint the reader is looking at.
       */
      readonly filter?: string
    }
  | { readonly kind: 'create'; readonly model: string }
  | { readonly kind: 'detail'; readonly model: string; readonly id: string }
  | { readonly kind: 'edit'; readonly model: string; readonly id: string }

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const filter = new URLSearchParams(query).get('filter') ?? undefined

  const segments = path
    .split('/')
    .filter((segment) => segment !== '')
    .map(decodeURIComponent)

  const [model, second, third] = segments

  if (model === undefined) return { kind: 'home' }
  if (model === '~team') return { kind: 'team' }
  if (model === '~dev') return { kind: 'dev' }
  if (second === undefined) return { kind: 'list', model, ...(filter ? { filter } : {}) }
  if (second === 'new') return { kind: 'create', model }
  if (third === 'edit') return { kind: 'edit', model, id: second }
  return { kind: 'detail', model, id: second }
}

export function href(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/'
    case 'team':
      return '#/~team'
    case 'dev':
      return '#/~dev'
    case 'list':
      return (
        `#/${encodeURIComponent(route.model)}` +
        (route.filter ? `?filter=${encodeURIComponent(route.filter)}` : '')
      )
    case 'create':
      return `#/${encodeURIComponent(route.model)}/new`
    case 'detail':
      return `#/${encodeURIComponent(route.model)}/${encodeURIComponent(route.id)}`
    case 'edit':
      return `#/${encodeURIComponent(route.model)}/${encodeURIComponent(route.id)}/edit`
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}
