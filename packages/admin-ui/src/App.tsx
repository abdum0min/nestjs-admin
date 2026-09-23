/**
 * The admin shell.
 *
 * Everything below the metadata fetch is generic. Navigation is built from
 * `metadata.models`, so a resource hidden by the server's resource
 * authorization simply is not in the document and therefore is not in the UI -
 * no client-side filtering, and nothing to keep in sync.
 */
import {
  ChevronRight,
  FlaskConical,
  History,
  LayoutDashboard,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'

import { devDoctor, fetchMetadata, fetchSession, onUnauthorized } from './api/client.js'
import type {
  AdminAccountSummary,
  ModelDescriptor,
  NavigationEntry,
  PageDescriptor,
} from './api/types.js'
import { CommandPalette, useCommandPalette } from './components/CommandPalette.jsx'
import { DashboardView } from './components/DashboardView.jsx'
import { AuditView } from './components/AuditView.jsx'
import { DevToolsView } from './components/DevToolsView.jsx'
import { PageView } from './components/PageView.jsx'
import { SchemaView } from './components/SchemaView.jsx'
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
import { theme, type HeaderLink } from './metadata/theme.js'

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

  /*
   * The schema report, for the count beside the developer tools.
   *
   * Asked for only where the tools exist, and cheap when they do: the route
   * makes no database queries. A failure is not surfaced - the badge is a
   * convenience, and a broken banner about a diagnosis nobody asked for would
   * be worse than a missing number.
   */
  const canUseDevTools = metadata.data?.capabilities?.useDevTools === true
  const report = useAsync(async () => (canUseDevTools ? devDoctor() : []), [canUseDevTools])
  const broken = (report.data ?? []).filter((finding) => finding.severity === 'broken').length

  const shellProps = { account, onSignedOut, activeHome: route.kind === 'home' }

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
  const pages = metadata.data?.pages ?? []

  // An empty model list is a valid, authorized response - the server returns
  // 200 with no models when resource authorization hides everything. Treating
  // it as an error would misreport a working system.
  //
  // Pages are checked too, because a page is not a resource: a role that can
  // see no table but has one screen built for it would otherwise be told this
  // admin has nothing in it, with the screen it exists for not even drawn.
  if (models.length === 0 && pages.length === 0) {
    return (
      <Shell {...shellProps}>
        <Empty>
          <p>No accessible resources.</p>
        </Empty>
      </Shell>
    )
  }

  const active =
    route.kind === 'home' ||
    route.kind === 'team' ||
    route.kind === 'dev' ||
    route.kind === 'schema' ||
    route.kind === 'audit' ||
    route.kind === 'page'
      ? undefined
      : models.find((m) => m.name === route.model)

  // The hash names a page; the metadata says whether there is one. A path with
  // no page is not distinguishable here from one this principal may not open,
  // and must not be - see the resource case below, which has the same shape.
  const openPage =
    route.kind === 'page' ? pages.find((page) => page.path === route.path) : undefined

  return (
    <Shell
      models={models}
      {...(metadata.data?.navigation ? { navigation: metadata.data.navigation } : {})}
      pages={pages}
      activeModel={active?.name}
      {...(openPage === undefined ? {} : { activePage: openPage.path })}
      canManageTeam={metadata.data?.capabilities?.manageTeam === true}
      canUseDevTools={canUseDevTools}
      brokenCount={broken}
      activeDev={route.kind === 'dev'}
      activeSchema={route.kind === 'schema'}
      activeAudit={route.kind === 'audit'}
      canViewAuditLog={metadata.data?.capabilities?.viewAuditLog === true}
      {...shellProps}
    >
      {route.kind === 'home' ? (
        <DashboardView models={models} />
      ) : route.kind === 'dev' ? (
        <DevToolsView />
      ) : route.kind === 'schema' ? (
        <SchemaView />
      ) : route.kind === 'audit' ? (
        <AuditView
          models={models}
          {...(route.model === undefined ? {} : { model: route.model })}
          {...(route.record === undefined ? {} : { record: route.record })}
        />
      ) : route.kind === 'page' ? (
        openPage === undefined ? (
          // Same wording and same reason as an unavailable resource: the page
          // may not exist or may be closed to this principal, and the interface
          // cannot tell the two apart. Guessing would leak which it is.
          <Empty>
            <p className="text-foreground font-medium">Page not available</p>
            <p>“{route.path}” is not one of the pages you can open.</p>
          </Empty>
        ) : (
          // Keyed by path so the error boundary inside resets when the reader
          // moves from a page that threw to one that works.
          <PageView key={openPage.path} page={openPage} models={models} />
        )
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
        <Content
          route={route}
          model={active}
          models={models}
          canFill={canUseDevTools}
          canExport={metadata.data?.capabilities?.exportData !== false}
          canViewAuditLog={metadata.data?.capabilities?.viewAuditLog === true}
        />
      )}
    </Shell>
  )
}

function Content({
  route,
  model,
  models,
  canFill = false,
  canExport = false,
  canViewAuditLog = false,
}: {
  readonly route: ReturnType<typeof useRoute>
  readonly model: ModelDescriptor
  /** Whether the developer tools are available to fill a form in one press. */
  readonly canFill?: boolean
  /**
   * Whether this role may export.
   *
   * Absent from a server older than this feature, and read as yes: that server
   * has no capability to withhold, and hiding a working button because a field
   * is missing would be the wrong way round.
   */
  readonly canExport?: boolean
  /** Whether a record should offer a History button. Decided by the server. */
  readonly canViewAuditLog?: boolean
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
          canExport={canExport}
          {...(route.filter ? { initialFilter: route.filter } : {})}
        />
      )
    case 'create':
      return (
        <RecordForm
          model={model}
          models={models}
          canFill={canFill}
          {...(route.from ? { from: route.from } : {})}
        />
      )
    case 'edit':
      return <RecordForm model={model} models={models} id={route.id} />
    case 'detail':
      return (
        <RecordView model={model} models={models} id={route.id} canViewAuditLog={canViewAuditLog} />
      )
    default:
      return null
  }
}

const SIDEBAR_KEY = 'nest-admin.sidebar'

function Shell({
  models = [],
  navigation,
  pages = [],
  activeModel,
  activePage,
  account,
  onSignedOut,
  canManageTeam = false,
  canUseDevTools = false,
  brokenCount = 0,
  activeHome = false,
  activeDev = false,
  activeSchema = false,
  activeAudit = false,
  canViewAuditLog = false,
  children,
}: {
  readonly models?: readonly ModelDescriptor[]
  /** How to group them, when the application said. Resolved by the server. */
  readonly navigation?: readonly NavigationEntry[]
  /** Pages the application added, already filtered by the server. */
  readonly pages?: readonly PageDescriptor[]
  readonly activeModel?: string
  /** The open page, when one is. */
  readonly activePage?: string
  /** Absent when the application brought its own authentication. */
  readonly account?: AdminAccountSummary | undefined
  /** Whether to offer the team screen. Decided by the server, not here. */
  readonly canManageTeam?: boolean
  /**
   * Whether to offer the developer tools. Decided by the server, and it means
   * both halves at once: the build has them, and this role may use them.
   */
  readonly canUseDevTools?: boolean
  /**
   * How many things about this schema do not work.
   *
   * Only the broken ones. Counting the guesses too would put a permanent badge
   * on most schemas - a warning that never goes out is one people stop seeing.
   */
  readonly brokenCount?: number
  /** Whether there is a history to read and this role may read it. */
  readonly canViewAuditLog?: boolean
  /**
   * Whether the dashboard is the page being shown.
   *
   * Its own signal rather than "no model is selected", which was the bug this
   * replaces: the developer pages, the team screen and the loading state all
   * have no model, so all of them lit the dashboard up beside whatever was
   * actually open.
   */
  readonly activeHome?: boolean
  /** Whether the developer tools are the page being shown. */
  readonly activeDev?: boolean
  /** Whether the schema screen is the page being shown. */
  readonly activeAudit?: boolean
  readonly activeSchema?: boolean
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

          {/*
            Beside the name, because that is where "somewhere else in this
            product" belongs - the right-hand cluster is controls for this page.
            Hidden below a tablet, where they would push the search button off
            the edge; the drawer carries them there instead, so nothing is lost.
          */}
          {(theme.links ?? []).length === 0 ? null : (
            <nav aria-label="Shortcuts" className="hidden items-center gap-0.5 lg:flex">
              {(theme.links ?? []).map((link) => (
                <HeaderLinkItem key={link.href} link={link} />
              ))}
            </nav>
          )}

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
              {...(navigation ? { navigation } : {})}
              pages={pages}
              activeModel={activeModel}
              activePage={activePage}
              collapsed={collapsed}
              activeHome={activeHome}
              canUseDevTools={canUseDevTools}
              canViewAuditLog={canViewAuditLog}
              brokenCount={brokenCount}
              activeDev={activeDev}
              activeSchema={activeSchema}
              activeAudit={activeAudit}
            />
          </nav>

          {/* `tabIndex={-1}` so the skip link can move focus here. It makes the
              element programmatically focusable without adding it to the tab
              order, which is exactly the distinction the attribute exists for. */}
          {/* A column, so the footer sits under the content rather than
              beside the navigation - and at the bottom of a short page rather
              than halfway up it. */}
          <div className="flex min-w-0 flex-1 flex-col">
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

            {theme.copyright === undefined ? null : (
              <footer className="text-muted-foreground border-t px-4 py-3 text-xs sm:px-6">
                {theme.copyright}
              </footer>
            )}
          </div>
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
                {...(navigation ? { navigation } : {})}
                pages={pages}
                activeModel={activeModel}
                activePage={activePage}
                collapsed={false}
                activeHome={activeHome}
                canUseDevTools={canUseDevTools}
                canViewAuditLog={canViewAuditLog}
                brokenCount={brokenCount}
                activeDev={activeDev}
                activeSchema={activeSchema}
                activeAudit={activeAudit}
              />
            </nav>

            {/* Where the header's shortcuts go on a phone. They are separated
                by a rule rather than mixed in, because they leave the admin
                and the entries above them do not. */}
            {(theme.links ?? []).length === 0 ? null : (
              <nav aria-label="Shortcuts" className="mt-1 flex flex-col gap-0.5 border-t pt-2">
                {(theme.links ?? []).map((link) => (
                  <HeaderLinkItem key={link.href} link={link} />
                ))}
              </nav>
            )}
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
  navigation,
  pages = [],
  activeModel,
  activePage,
  collapsed,
  canUseDevTools = false,
  canViewAuditLog = false,
  brokenCount = 0,
  activeHome = false,
  activeDev = false,
  activeSchema = false,
  activeAudit = false,
}: {
  readonly models: readonly ModelDescriptor[]
  /**
   * How to group them, when the application said.
   *
   * Already resolved by the server: every model named here is one this
   * principal can see, and anything no group claimed is in a final group. So
   * there is no filtering to do and no risk of drawing an empty heading.
   */
  readonly navigation?: readonly NavigationEntry[]
  /** Pages the application added, already filtered by the server. */
  readonly pages?: readonly PageDescriptor[]
  readonly activeModel?: string
  readonly activePage?: string
  readonly collapsed: boolean
  readonly canUseDevTools?: boolean
  readonly canViewAuditLog?: boolean
  readonly brokenCount?: number
  readonly activeHome?: boolean
  readonly activeDev?: boolean
  readonly activeSchema?: boolean
  readonly activeAudit?: boolean
}) {
  const [filter, setFilter] = useState('')
  const query = filter.trim().toLowerCase()

  /*
   * Offered only where the list is long enough to be worth searching.
   *
   * A filter box above six entries is a control that costs a line of the
   * sidebar and saves nothing - the eye is faster. Above about a dozen that
   * reverses, and a real schema is usually well past it.
   *
   * Never on the collapsed rail, where there is no room and no labels to match
   * against anyway.
   */
  const searchable = !collapsed && models.length + pages.length >= 12

  /*
   * While filtering, the groups are set aside.
   *
   * Somebody typing is looking for one thing, not browsing a structure, and
   * keeping the headings would mean the match they want can still be hidden
   * inside a folded group. So it becomes a flat list of what matches, and
   * emptying the box puts the structure back.
   */
  const matching =
    query === ''
      ? undefined
      : {
          models: models.filter((model) => modelLabel(model).toLowerCase().includes(query)),
          pages: pages.filter((page) => page.title.toLowerCase().includes(query)),
        }

  return (
    <ul className="flex flex-col gap-0.5">
      {searchable ? (
        <li className="mb-1">
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter resources…"
            aria-label="Filter resources"
            className="border-input bg-background focus-visible:ring-ring h-8 w-full rounded-md border px-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
        </li>
      ) : null}
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
          current={activeHome}
          collapsed={collapsed}
        />
      </li>
      {matching !== undefined ? (
        matching.models.length + matching.pages.length === 0 ? (
          <li className="text-muted-foreground px-2.5 py-2 text-sm">Nothing matches.</li>
        ) : (
          [
            ...matching.models.map((model) => (
              <ModelLink
                key={`model:${model.name}`}
                model={model}
                activeModel={activeModel}
                collapsed={collapsed}
              />
            )),
            ...matching.pages.map((page) => (
              <PageLink
                key={`page:${page.path}`}
                page={page}
                activePage={activePage}
                collapsed={collapsed}
              />
            )),
          ]
        )
      ) : navigation === undefined ? (
        [
          ...models.map((model) => (
            <ModelLink
              key={`model:${model.name}`}
              model={model}
              activeModel={activeModel}
              collapsed={collapsed}
            />
          )),
          // With no navigation declared, pages follow the models in the order
          // they were configured - the same flat list the resources have
          // always been, with the added screens at the end of it.
          ...pages.map((page) => (
            <PageLink
              key={`page:${page.path}`}
              page={page}
              activePage={activePage}
              collapsed={collapsed}
            />
          )),
        ]
      ) : (
        navigation.map((entry, index) => (
          <NavigationEntryItem
            // Position, because nothing else identifies a divider and two
            // groups may legitimately share a heading of none.
            key={index}
            entry={entry}
            models={models}
            pages={pages}
            activeModel={activeModel}
            activePage={activePage}
            collapsed={collapsed}
          />
        ))
      )}

      {/*
       * Below the resources, and above the developer tools.
       *
       * The history is not a resource - it is what happened to them - but it is
       * an ordinary part of running an admin rather than a tool for building
       * one, so it sits with the data and not under the Developer heading.
       */}
      {canViewAuditLog ? (
        <li className={collapsed ? 'mt-1 border-t pt-1' : 'mt-1 border-t pt-1'}>
          <NavLink
            href={href({ kind: 'audit' })}
            label="History"
            icon={History}
            current={activeAudit}
            collapsed={collapsed}
          />
        </li>
      ) : null}

      {/*
       * Below the resources and separated from them, because it is not one.
       *
       * Deliberately not in the user menu, where the team screen lives: this is
       * used while building, over and over, and a menu is one click of friction
       * per use. Deliberately not among the models either - a tool that can
       * empty a table must never look like a table.
       */}
      {canUseDevTools ? (
        <>
          {collapsed ? (
            <li className="mt-1 border-t pt-1" aria-hidden="true" />
          ) : (
            <li className="text-muted-foreground mt-2 border-t px-2.5 pt-2 pb-0.5 text-[10px] font-medium tracking-wider uppercase">
              Developer
            </li>
          )}
          <li>
            <NavLink
              href={href({ kind: 'schema' })}
              label="Schema"
              icon={Network}
              current={activeSchema}
              collapsed={collapsed}
              {...(brokenCount > 0 ? { marker: String(brokenCount), alarming: true } : {})}
            />
          </li>
          <li>
            <NavLink
              href={href({ kind: 'dev' })}
              label="Data tools"
              icon={FlaskConical}
              current={activeDev}
              collapsed={collapsed}
              // Kept even though the group heading says "Developer": on the
              // collapsed rail there is no heading, and this is the entry that
              // can empty a table.
              marker="Dev"
            />
          </li>
        </>
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
/**
 * One model in the sidebar.
 *
 * Its own component because it is now drawn from two places - the flat list and
 * the inside of a group - and a second copy is a second place for the active
 * state to be got wrong.
 */
function ModelLink({
  model,
  activeModel,
  collapsed,
}: {
  readonly model: ModelDescriptor
  readonly activeModel?: string
  readonly collapsed: boolean
}) {
  return (
    <li>
      <NavLink
        href={href({ kind: 'list', model: model.name })}
        label={modelLabel(model)}
        icon={modelIcon(model.icon)}
        current={model.name === activeModel}
        collapsed={collapsed}
      />
    </li>
  )
}

/**
 * One header shortcut.
 *
 * `external` defaults to whether the href leaves this application, which is
 * the answer almost every configuration wants and the one nobody remembers to
 * write. Setting it explicitly wins either way.
 *
 * `rel="noreferrer"` on a new tab, because `window.opener` on the far side is
 * a handle on a page holding an admin session.
 */
function HeaderLinkItem({ link }: { readonly link: HeaderLink }) {
  const Icon = modelIcon(link.icon)
  const external = link.external ?? /^https?:/.test(link.href)

  return (
    <a
      href={link.href}
      className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors"
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
      {link.label}
    </a>
  )
}

/**
 * A page the application added.
 *
 * Drawn exactly like a model, because from the sidebar's side of things it is
 * one: a name, an icon, and somewhere it goes. A page that announced itself as
 * different would be asking the reader to care about how the admin is built.
 */
function PageLink({
  page,
  activePage,
  collapsed,
}: {
  readonly page: PageDescriptor
  readonly activePage?: string
  readonly collapsed: boolean
}) {
  return (
    <li>
      <NavLink
        href={href({ kind: 'page', path: page.path })}
        label={page.title}
        icon={modelIcon(page.icon)}
        current={page.path === activePage}
        collapsed={collapsed}
      />
    </li>
  )
}

/**
 * A group, a link, or a rule.
 *
 * A group with a heading folds, and remembers whether it was folded - by
 * heading rather than by position, so adding a group above does not shuffle
 * everybody's folded state onto different headings.
 *
 * **A group holding the open model never folds.** Hiding the page somebody is
 * looking at, because they folded that heading last week, is worse than an
 * open group: they lose the only thing on the screen telling them where they
 * are.
 */
function NavigationEntryItem({
  entry,
  models,
  pages = [],
  activeModel,
  activePage,
  collapsed,
}: {
  readonly entry: NavigationEntry
  readonly models: readonly ModelDescriptor[]
  readonly pages?: readonly PageDescriptor[]
  readonly activeModel?: string
  readonly activePage?: string
  readonly collapsed: boolean
}) {
  const heading = entry.kind === 'group' ? entry.heading : undefined
  const [folded, setFolded] = useGroupFolded(heading, entry.kind === 'group' && entry.collapsed)

  if (entry.kind === 'divider') {
    return <li className="border-sidebar-border my-1.5 border-t" aria-hidden="true" />
  }

  if (entry.kind === 'link') {
    return (
      <li>
        <NavLink
          href={entry.href}
          label={entry.label}
          icon={modelIcon(entry.icon)}
          current={false}
          collapsed={collapsed}
          {...(entry.external ? { external: true } : {})}
        />
      </li>
    )
  }

  const shown = entry.models
    .map((name) => models.find((model) => model.name === name))
    .filter((model): model is ModelDescriptor => model !== undefined)

  const shownPages = (entry.pages ?? [])
    .map((path) => pages.find((page) => page.path === path))
    .filter((page): page is PageDescriptor => page !== undefined)

  const holdsActive =
    (activeModel !== undefined && entry.models.includes(activeModel)) ||
    (activePage !== undefined && (entry.pages ?? []).includes(activePage))
  // A rail has no room for a heading, so a collapsed sidebar shows the icons
  // in group order and nothing else. Folding there would hide them for good.
  const open = collapsed || holdsActive || !folded

  return (
    <>
      {heading === undefined || collapsed ? null : (
        <li className="mt-2 first:mt-0">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-2.5 py-1 text-[10px] font-medium tracking-wider uppercase transition-colors"
            aria-expanded={open}
            onClick={() => setFolded(!folded)}
          >
            <ChevronRight
              className={cn('size-3 transition-transform', open && 'rotate-90')}
              aria-hidden="true"
            />
            <span className="truncate">{heading}</span>
          </button>
        </li>
      )}

      {open
        ? shown.map((model) => (
            <ModelLink
              key={model.name}
              model={model}
              activeModel={activeModel}
              collapsed={collapsed}
            />
          ))
        : null}

      {/* After the models, which is where the server put them. */}
      {open
        ? shownPages.map((page) => (
            <PageLink key={page.path} page={page} activePage={activePage} collapsed={collapsed} />
          ))
        : null}
    </>
  )
}

/**
 * Whether a group is folded, remembered across visits.
 *
 * Per browser, like the appearance and the page size: it is how one person
 * likes their sidebar, not a decision the application made for everybody. The
 * application's `collapsed` is the starting point, and the person's own choice
 * wins from then on.
 */
function useGroupFolded(
  heading: string | undefined,
  initial: boolean | undefined,
): [boolean, (value: boolean) => void] {
  const key = heading === undefined ? undefined : `nest-admin.nav.${heading}`

  const [folded, setFolded] = useState(() => {
    if (key === undefined) return false
    try {
      const stored = window.localStorage.getItem(key)
      if (stored !== null) return stored === 'folded'
    } catch {
      // A browser refusing storage is not a reason to fail to draw a sidebar.
    }
    return initial === true
  })

  return [
    folded,
    (value: boolean) => {
      setFolded(value)
      if (key === undefined) return
      try {
        window.localStorage.setItem(key, value ? 'folded' : 'open')
      } catch {
        // As above.
      }
    },
  ]
}

function NavLink({
  href: to,
  label,
  icon: Icon,
  current,
  collapsed,
  marker,
  alarming = false,
  /*
   * Defaulted rather than left out, and the default is the point.
   *
   * It was declared in the type below and never destructured here, so the body
   * read the *global* `external` - `window.external`, a legacy object every
   * browser still exposes and which is therefore truthy. Every link in the
   * sidebar got `target="_blank"`, so every click opened a new tab and loaded
   * the whole admin again.
   *
   * TypeScript accepted it because `lib.dom` declares `external` as a global,
   * which is exactly why the test below this file asserts on the attribute
   * rather than trusting the types.
   */
  external = false,
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
  /** Draw the marker as a problem rather than as a label. */
  readonly alarming?: boolean
  /** A link out of the admin. Opens in a new tab, and says so to a reader. */
  readonly external?: boolean
}) {
  return (
    <a
      href={to}
      data-slot="nav-link"
      {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
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
        <span
          className={cn(
            'ml-auto rounded border px-1 text-[10px] font-medium tracking-wide uppercase',
            alarming
              ? 'border-destructive/50 text-destructive'
              : 'border-amber-500/40 text-amber-600 dark:text-amber-400',
          )}
        >
          {marker}
        </span>
      )}
    </a>
  )
}
