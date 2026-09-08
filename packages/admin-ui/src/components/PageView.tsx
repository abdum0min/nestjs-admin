/**
 * A page the application added.
 *
 * Three bodies, one heading, and one rule above all of them: **whatever the
 * page does, the admin around it keeps working.** A module that throws on
 * import, a component that throws on render, an embedded document that never
 * loads - each of those is drawn as a failure inside the content area, with
 * the navigation, the theme and every other screen untouched.
 *
 * That is not politeness. Custom pages are the one place where code this
 * package did not write runs inside its shell, and an extension mechanism that
 * can take the host down with it is one nobody can afford to use.
 */
import * as React from 'react'

import { fetchPage } from '../api/client.js'
import type { PageDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { installPageRuntime, type AdminPageComponent } from '../pages/runtime.js'
import { WidgetGrid } from './DashboardView.js'
import { Empty, ErrorState, Loading } from './States.js'

export function PageView({ page }: { readonly page: PageDescriptor }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
        {page.description === undefined ? null : (
          <p className="text-muted-foreground text-sm">{page.description}</p>
        )}
      </div>

      <PageBoundary path={page.path}>
        {page.kind === 'widgets' ? (
          <WidgetPage path={page.path} />
        ) : page.kind === 'module' ? (
          <ModulePage source={page.module} />
        ) : (
          <EmbedPage url={page.url} title={page.title} />
        )}
      </PageBoundary>
    </div>
  )
}

/**
 * The same grid the dashboard draws, with this page's widgets in it.
 *
 * Fetched when the page opens rather than carried in the metadata document, so
 * an admin with twenty pages does not query twenty pages' worth of counts to
 * draw its sidebar.
 */
function WidgetPage({ path }: { readonly path: string }) {
  const page = useAsync(() => fetchPage(path), [path])

  if (page.loading) return <Loading label="Loading…" />
  if (page.error !== undefined) return <ErrorState error={page.error} onRetry={page.reload} />
  if (page.data === undefined || page.data.widgets.length === 0) {
    return (
      <Empty>
        <p>Nothing to show here.</p>
      </Empty>
    )
  }

  return <WidgetGrid widgets={page.data.widgets} />
}

/**
 * The application's own component, imported when the route is opened.
 *
 * Dynamically, and only here - so a page nobody visits costs nothing, and a
 * module that fails to load takes this area of the screen rather than the
 * bundle. The runtime is installed before the import so that a module reading
 * `window.NestAdmin` at its top level finds it there.
 *
 * `@vite-ignore` because the specifier is not known at build time and must not
 * be: it is the consuming application's file, and Vite trying to resolve it in
 * this repository is exactly the coupling this design avoids.
 */
function ModulePage({ source }: { readonly source: string }) {
  const loaded = useAsync(async () => {
    installPageRuntime()
    const module = (await import(/* @vite-ignore */ source)) as {
      default?: AdminPageComponent
    }

    if (typeof module.default !== 'function') {
      throw new Error(
        `The page module at ${source} has no default export. ` +
          `Export the component as \`export default function MyPage() { … }\`.`,
      )
    }

    return module.default
  }, [source])

  if (loaded.loading) return <Loading label="Loading…" />
  if (loaded.error !== undefined) return <ErrorState error={loaded.error} onRetry={loaded.reload} />
  if (loaded.data === undefined) return null

  const Component = loaded.data
  return <Component />
}

/**
 * Somebody else's document, in a sandbox.
 *
 * `allow-same-origin` is granted only for a same-origin URL. An external page
 * given it could reach this document, and this document is holding a session
 * that can write to every table - so an https embed runs without it, which
 * costs that page its own cookies and storage. A reporting tool that needs a
 * session of its own should be served from your origin.
 */
function EmbedPage({ url, title }: { readonly url: string; readonly title: string }) {
  const sameOrigin = url.startsWith('/')

  return (
    <iframe
      src={url}
      title={title}
      className="bg-background h-[calc(100svh-12rem)] w-full rounded-lg border"
      sandbox={
        sameOrigin
          ? 'allow-scripts allow-forms allow-popups allow-same-origin'
          : 'allow-scripts allow-forms allow-popups'
      }
      referrerPolicy="no-referrer"
    />
  )
}

interface BoundaryProps {
  readonly path: string
  readonly children: React.ReactNode
}

/**
 * The containment, and the reason it is a class.
 *
 * `componentDidCatch` has no hook equivalent - React has never shipped one -
 * so this is the one class component in the interface, and it earns it: it is
 * what stops a page somebody else wrote from blanking the admin.
 *
 * Keyed by path in the caller, so navigating from a page that threw to one
 * that works resets it. Without that, one bad page would poison every page
 * after it until a reload.
 */
class PageBoundary extends React.Component<BoundaryProps, { readonly error?: Error }> {
  constructor(props: BoundaryProps) {
    super(props)
    this.state = {}
  }

  static getDerivedStateFromError(error: unknown): { readonly error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (previous.path !== this.props.path && this.state.error !== undefined) {
      this.setState({})
    }
  }

  override render(): React.ReactNode {
    const { error } = this.state
    if (error === undefined) return this.props.children

    return (
      <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-4">
        <p className="text-foreground text-sm font-medium">This page failed to render.</p>
        <p className="text-muted-foreground mt-1 text-sm">
          The rest of the admin is unaffected. The error came from the page at{' '}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
            #/~{this.props.path}
          </code>
          , not from Nest Admin.
        </p>
        <pre className="text-muted-foreground mt-3 overflow-x-auto text-xs">{error.message}</pre>
      </div>
    )
  }
}
