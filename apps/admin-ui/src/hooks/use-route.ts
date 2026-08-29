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
  | { readonly kind: 'list'; readonly model: string }
  | { readonly kind: 'create'; readonly model: string }
  | { readonly kind: 'detail'; readonly model: string; readonly id: string }
  | { readonly kind: 'edit'; readonly model: string; readonly id: string }

export function parseHash(hash: string): Route {
  const segments = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter((segment) => segment !== '')
    .map(decodeURIComponent)

  const [model, second, third] = segments

  if (model === undefined) return { kind: 'home' }
  if (second === undefined) return { kind: 'list', model }
  if (second === 'new') return { kind: 'create', model }
  if (third === 'edit') return { kind: 'edit', model, id: second }
  return { kind: 'detail', model, id: second }
}

export function href(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/'
    case 'list':
      return `#/${encodeURIComponent(route.model)}`
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
