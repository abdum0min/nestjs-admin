/**
 * The admin shell.
 *
 * Everything below the metadata fetch is generic. Navigation is built from
 * `metadata.models`, so a resource hidden by the server's resource
 * authorization simply is not in the document and therefore is not in the UI -
 * no client-side filtering, and nothing to keep in sync.
 */
import { FlaskConical, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'

import { fetchMetadata, fetchSession, onUnauthorized } from './api/client.js'
import type { AdminAccountSummary, ModelDescriptor } from './api/types.js'
import { CommandPalette, useCommandPalette } from './components/CommandPalette.jsx'
import { DashboardView } from './components/DashboardView.jsx'
import { DevToolsView } from './components/DevToolsView.jsx'
import { TeamView } from './components/TeamView.jsx'
import { ListView } from './components/ListView.jsx'
import { LoginPage } from './components/LoginPage.jsx'
import { RecordForm } from './components/RecordForm.jsx'
import { RecordView } from './components/RecordView.jsx'
import { Empty, ErrorState, Loading } from './components/States.jsx'
import { ThemeToggle } from './components/ThemeToggle.jsx'
import { UserMenu } from './components/UserMenu.jsx'
import { Button } from './components/ui/button.jsx'
import { ConfirmProvider } from './components/ui/confirm.jsx'
import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog.jsx'
import { useAsync } from './hooks/use-async.js'
import { href, useRoute } from './hooks/use-route.js'
import { cn } from './lib/utils.js'
import { modelLabel } from './metadata/fields.js'
import { modelIcon } from './metadata/icons.jsx'
import { theme } from './metadata/theme.js'

/**
 * The gate in front of everything.
 *
 * Three situations, not two, and collapsing them is how an application that
 * brought its own authentication ends up being shown a sign-in form from a
 * package it asked to stay out of authentication:
 *
 *   'external'  the admin has no login routes - the host handles identity, and
 *               a 401 from any request is the host's business to explain
 *   'signed-in' the built-in login, with somebody signed in
 *   'signed-out' the built-in login, with nobody signed in
 *
 * The session is read once at start-up. After that the only thing that changes
 * it is signing in, signing out, or a request coming back unauthenticated -
 * which the client announces centrally, because otherwise whichever screen
 * happened to be making a request shows "not signed in" in its own corner while
 * the rest of the page carries on pretending to be an admin.
 */
export function App() {
  const route = useRoute()
  const session = useAsync(() => fetchSession(), [])
  const [account, setAccount] = useState<AdminAccountSummary | null | undefined>(undefined)

  /*
   * "No session document" is an answer, not the absence of one.
   *
   * `fetchSession` turns the 404 from an admin with no login routes into
   * `undefined`, so `data` being undefined once the request has settled is how
   * the external case is recognised. Treating it as "not known yet" left the
   * interface on its loading screen forever for every application that brought
   * its own authentication - which is most of them.
   */
  const current = account !== undefined ? account : (session.data?.account ?? null)
  const external = !session.loading && session.data === undefined

  useEffect(() => onUnauthorized(() => setAccount(null)), [])

  if (session.loading) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center">
        <Loading label="Loading…" />
      </div>
    )
  }

  // A login the admin owns, with nobody signed in. Nothing below this line
  // renders, which is what "protected" means here - not a redirect that a
  // determined URL can skip past.
  if (!external && current === null) {
    return <LoginPage onSignedIn={setAccount} />
  }

  return (
    <Admin
      route={route}
      account={external ? undefined : (current ?? undefined)}
      onSignedOut={() => setAccount(null)}
    />
  )
}

function Admin({
  route,
  account,
  onSignedOut,
}: {
  readonly route: ReturnType<typeof useRoute>
  readonly account: AdminAccountSummary | undefined
  readonly onSignedOut: () => void
}) {
  const metadata = useAsync(() => fetchMetadata(), [])

  const shellProps = { account, onSignedOut }

  if (metadata.loading) {
    return <Shell {...shellProps}>{<Loading label="Loading resources…" />}</Shell>
  }

  if (metadata.error !== undefined) {
    return (
      <Shell {...shellProps}>
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
      <Shell {...shellProps}>
        <Empty>
          <p>No accessible resources.</p>
        </Empty>
      </Shell>
    )
  }

  const active =
    route.kind === 'home' || route.kind === 'team' || route.kind === 'dev'
      ? undefined
      : models.find((m) => m.name === route.model)

  return (
    <Shell
      models={models}
      activeModel={active?.name}
      canManageTeam={metadata.data?.capabilities?.manageTeam === true}
      canUseDevTools={metadata.data?.capabilities?.useDevTools === true}
      activeDev={route.kind === 'dev'}
      {...shellProps}
    >
      {route.kind === 'home' ? (
        <DashboardView />
      ) : route.kind === 'dev' ? (
        <DevToolsView />
      ) : route.kind === 'team' ? (
        // Rendered only when the metadata says so. Reaching the URL without the
        // capability still gets a page - one whose first request is refused,
        // which is the same shape every other unauthorized screen has.
        <TeamView />
      ) : active === undefined ? (
        // The hash named something metadata does not contain. It may not exist,
        // or may be hidden from this principal - the UI cannot tell them apart,
        // and must not try.
        <Empty>
          <p className="text-foreground font-medium">Resource not available</p>
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

const SIDEBAR_KEY = 'nest-admin.sidebar'

function Shell({
  models = [],
  activeModel,
  account,
  onSignedOut,
  canManageTeam = false,
  canUseDevTools = false,
  activeDev = false,
  children,
}: {
  readonly models?: readonly ModelDescriptor[]
  readonly activeModel?: string
  /** Absent when the application brought its own authentication. */
  readonly account?: AdminAccountSummary | undefined
  /** Whether to offer the team screen. Decided by the server, not here. */
  readonly canManageTeam?: boolean
  /**
   * Whether to offer the developer tools. Decided by the server, and it means
   * both halves at once: the build has them, and this role may use them.
   */
  readonly canUseDevTools?: boolean
  /** Whether the developer tools are the page being shown. */
  readonly activeDev?: boolean
  readonly onSignedOut?: () => void
  readonly children: React.ReactNode
}) {
  const palette = useCommandPalette()
  const [drawer, setDrawer] = useState(false)

  /**
   * Collapsed to a rail, not to nothing.
   *
   * A table with a dozen columns wants the width, and the resource list is not
   * what someone reading it is looking at. But hiding the navigation outright
   * takes it out of the page, out of the tab order, and out of reach - and
   * makes the collapse an all-or-nothing choice nobody makes twice.
   *
   * A rail keeps every link where it was, one click away, and lets the change
   * be a width transition rather than an element appearing and disappearing.
   */
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded')
    } catch {
      // A preference that cannot be remembered still applies to this page.
    }
  }, [collapsed])

  // Following a link should not leave the drawer open over the thing it opened.
  useEffect(() => setDrawer(false), [activeModel])

  return (
    <ConfirmProvider>
      <div className="bg-background flex min-h-svh flex-col">
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

        <header className="bg-background/85 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur-sm sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open navigation"
            onClick={() => setDrawer(true)}
          >
            <PanelLeftOpen />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            aria-controls="admin-nav"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>

          <a
            href="#/"
            className="hover:text-link flex items-center gap-2 font-semibold transition-colors"
          >
            {theme.logoUrl === undefined ? null : (
              <img className="size-6 rounded" src={theme.logoUrl} alt="" />
            )}
            <span className="truncate">{theme.title ?? 'Admin'}</span>
          </a>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground gap-2 font-normal"
              onClick={() => palette.setOpen(true)}
            >
              <Search />
              <span className="hidden sm:inline">Search resources</span>
            </Button>
            <ThemeToggle />
            {/* Only when the admin owns the login. An application signing
                people out through its own interface should not be offered a
                button here that cannot do it. */}
            {account && onSignedOut ? (
              <UserMenu account={account} onSignedOut={onSignedOut} canManageTeam={canManageTeam} />
            ) : null}
          </div>
        </header>

        <div className="flex flex-1">
          {/*
           * Its own scroll, and it stays put.
           *
           * Without `sticky` the navigation is part of the page and scrolls
           * away with it: on a long table the links end up somewhere above the
           * viewport and getting back to them means scrolling to the top first.
           * `top-14` parks it under the header, and `h-[calc(100svh-3.5rem)]`
           * with `overflow-y-auto` gives it a scrollbar of its own for a schema
           * with more models than fit.
           */}
          <nav
            id="admin-nav"
            aria-label="Resources"
            className={cn(
              'bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-14 hidden h-[calc(100svh-3.5rem)] shrink-0 overflow-x-hidden overflow-y-auto border-r p-2 md:block',
              'transition-[width] duration-200 ease-out',
              collapsed ? 'w-14' : 'w-56',
            )}
          >
            <ResourceNav
              models={models}
              activeModel={activeModel}
              collapsed={collapsed}
              canUseDevTools={canUseDevTools}
              activeDev={activeDev}
            />
          </nav>

          {/* `tabIndex={-1}` so the skip link can move focus here. It makes the
              element programmatically focusable without adding it to the tab
              order, which is exactly the distinction the attribute exists for. */}
          <main
            className="min-w-0 flex-1 p-4 focus-visible:outline-none sm:p-6"
            id="admin-main"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>

        <Dialog open={drawer} onOpenChange={setDrawer}>
          <DialogContent
            data-slot="nav-drawer"
            className="top-0 left-0 h-svh max-w-64 translate-x-0 translate-y-0 gap-3 overflow-y-auto rounded-none border-y-0 border-l-0 p-3"
          >
            <DialogTitle className="px-2 text-sm font-semibold">Resources</DialogTitle>
            <nav aria-label="Resources">
              <ResourceNav
                models={models}
                activeModel={activeModel}
                collapsed={false}
                canUseDevTools={canUseDevTools}
                activeDev={activeDev}
              />
            </nav>
          </DialogContent>
        </Dialog>

        <CommandPalette models={models} open={palette.open} onOpenChange={palette.setOpen} />
      </div>
    </ConfirmProvider>
  )
}

/**
 * The resource list.
 *
 * An icon only where the application chose one - it is a `ModelIcon` in the
 * configuration, from a closed set. The same icon on every entry would be
 * decoration rather than information, so the fallback is the resource's initial
 * rather than a generic shape: on the collapsed rail something has to
 * distinguish one row from the next, and a letter does that while a repeated
 * symbol does not.
 */
function ResourceNav({
  models,
  activeModel,
  collapsed,
  canUseDevTools = false,
  activeDev = false,
}: {
  readonly models: readonly ModelDescriptor[]
  readonly activeModel?: string
  readonly collapsed: boolean
  readonly canUseDevTools?: boolean
  readonly activeDev?: boolean
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {/*
       * Above the resources, and separated from them.
       *
       * The dashboard is not one of the models - it is the page they are all
       * on - and putting it in the same list would make it look like a
       * resource called "Dashboard". It is also the only navigation that
       * exists before any model does, which is why this list no longer
       * returns null for an empty schema.
       */}
      <li className={models.length === 0 ? undefined : 'mb-1 border-b pb-1'}>
        <NavLink
          href="#/"
          label="Dashboard"
          icon={LayoutDashboard}
          current={activeModel === undefined}
          collapsed={collapsed}
        />
      </li>
      {models.map((model) => {
        const label = modelLabel(model)

        return (
          <li key={model.name}>
            <NavLink
              href={href({ kind: 'list', model: model.name })}
              label={label}
              icon={modelIcon(model.icon)}
              current={model.name === activeModel}
              collapsed={collapsed}
            />
          </li>
        )
      })}

      {/*
       * Below the resources and separated from them, because it is not one.
       *
       * Deliberately not in the user menu, where the team screen lives: this is
       * used while building, over and over, and a menu is one click of friction
       * per use. Deliberately not among the models either - a tool that can
       * empty a table must never look like a table.
       */}
      {canUseDevTools ? (
        <li className="mt-1 border-t pt-1">
          <NavLink
            href={href({ kind: 'dev' })}
            label="Developer tools"
            icon={FlaskConical}
            current={activeDev}
            collapsed={collapsed}
            marker="Dev"
          />
        </li>
      ) : null}
    </ul>
  )
}

/**
 * One entry in the navigation.
 *
 * The fallback for a model with no configured icon is its initial rather than a
 * generic shape: on the collapsed rail something has to distinguish one row
 * from the next, and a letter does that while a repeated symbol does not.
 */
function NavLink({
  href: to,
  label,
  icon: Icon,
  current,
  collapsed,
  marker,
}: {
  readonly href: string
  readonly label: string
  readonly icon: ComponentType<{ className?: string }> | undefined
  readonly current: boolean
  readonly collapsed: boolean
  /**
   * A word beside the label, for an entry that is not a resource.
   *
   * The developer tools sit in the same list as the data, and something has to
   * say that they are not part of it - the sort of thing that matters most on
   * the day somebody demonstrates the admin to a room.
   */
  readonly marker?: string
}) {
  return (
    <a
      href={to}
      aria-current={current ? 'page' : undefined}
      // The label is the accessible name whether or not it is drawn, so a rail
      // is not a column of unlabelled letters to a reader.
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
        collapsed && 'justify-center px-0',
        current
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'hover:bg-sidebar-accent/60',
      )}
    >
      {Icon ? (
        <Icon className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <span
          className="flex size-4 shrink-0 items-center justify-center text-xs font-semibold opacity-70"
          aria-hidden="true"
        >
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
      {collapsed ? null : <span className="truncate">{label}</span>}
      {collapsed || marker === undefined ? null : (
        <span className="ml-auto rounded border border-amber-500/40 px-1 text-[10px] font-medium tracking-wide text-amber-600 uppercase dark:text-amber-400">
          {marker}
        </span>
      )}
    </a>
  )
}
