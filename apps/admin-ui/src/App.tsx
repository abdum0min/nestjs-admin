/**
 * The admin shell.
 *
 * Everything below the metadata fetch is generic. Navigation is built from
 * `metadata.models`, so a resource hidden by the server's resource
 * authorization simply is not in the document and therefore is not in the UI -
 * no client-side filtering, and nothing to keep in sync.
 */
import { fetchMetadata } from './api/client.js'
import type { ModelDescriptor } from './api/types.js'
import { ListView } from './components/ListView.jsx'
import { RecordForm } from './components/RecordForm.jsx'
import { RecordView } from './components/RecordView.jsx'
import { Empty, ErrorState, Loading } from './components/States.jsx'
import { useAsync } from './hooks/use-async.js'
import { href, useRoute } from './hooks/use-route.js'
import { theme } from './metadata/theme.js'

export function App() {
  const route = useRoute()
  const metadata = useAsync(() => fetchMetadata(), [])

  if (metadata.loading) return <Shell>{<Loading label="Loading resources…" />}</Shell>

  if (metadata.error !== undefined) {
    return (
      <Shell>
        <ErrorState error={metadata.error} onRetry={metadata.reload} />
      </Shell>
    )
  }

  const models = metadata.data?.models ?? []

  // An empty model list is a valid, authorized response - the server returns
  // 200 with no models when resource authorization hides everything. Treating
  // it as an error would misreport a working system.
  if (models.length === 0) {
    return (
      <Shell>
        <Empty>No accessible resources.</Empty>
      </Shell>
    )
  }

  const active = route.kind === 'home' ? undefined : models.find((m) => m.name === route.model)

  return (
    <Shell models={models} activeModel={active?.name}>
      {route.kind === 'home' ? (
        <Empty>Select a resource to begin.</Empty>
      ) : active === undefined ? (
        // The hash named something metadata does not contain. It may not exist,
        // or may be hidden from this principal - the UI cannot tell them apart,
        // and must not try.
        <Empty>
          <h2>Resource not available</h2>
          <p>“{route.model}” is not one of the resources you can access.</p>
        </Empty>
      ) : (
        <Content route={route} model={active} models={models} />
      )}
    </Shell>
  )
}

function Content({
  route,
  model,
  models,
}: {
  readonly route: ReturnType<typeof useRoute>
  readonly model: ModelDescriptor
  // Every model, not just the active one: a relation names its target by name,
  // and rendering it needs that target's primary key and display field.
  readonly models: readonly ModelDescriptor[]
}) {
  switch (route.kind) {
    case 'list':
      return (
        <ListView
          model={model}
          models={models}
          {...(route.filter ? { initialFilter: route.filter } : {})}
        />
      )
    case 'create':
      return <RecordForm model={model} models={models} />
    case 'edit':
      return <RecordForm model={model} models={models} id={route.id} />
    case 'detail':
      return <RecordView model={model} models={models} id={route.id} />
    default:
      return null
  }
}

function Shell({
  models = [],
  activeModel,
  children,
}: {
  readonly models?: readonly ModelDescriptor[]
  readonly activeModel?: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="shell">
      {/* Not an `<a href="#main">`. Routing here is hash-based, so a fragment
          link would navigate as well as jump - it would leave the list and
          land on whatever "#main" parses as. Moving focus directly does the
          one thing that was wanted. */}
      <button
        type="button"
        className="skip-link"
        onClick={() => document.getElementById('admin-main')?.focus()}
      >
        Skip to content
      </button>

      <header className="shell__bar">
        <a href="#/">
          {theme.logoUrl === undefined ? null : (
            <img className="brand__logo" src={theme.logoUrl} alt="" />
          )}
          {theme.title ?? 'Admin'}
        </a>
      </header>

      <div className="shell__body">
        <nav className="shell__nav" aria-label="Resources">
          {models.length > 0 ? <h2>Resources</h2> : null}
          <ul>
            {models.map((model) => (
              <li key={model.name}>
                <a
                  href={href({ kind: 'list', model: model.name })}
                  aria-current={model.name === activeModel ? 'page' : undefined}
                >
                  {model.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* `tabIndex={-1}` so the skip link can move focus here. It makes the
            element programmatically focusable without adding it to the tab
            order, which is exactly the distinction the attribute exists for. */}
        <main className="shell__content" id="admin-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}
