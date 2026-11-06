// Deno's window, after the Rex app: one graphite sheet (`theme.tsx` has the colours) with the side
// bar on it and the panes beside it as cards. The side bar has the traffic lights and the window's
// buttons on top (the side bar's toggle, the pane titles' toggle, the command palette, a new view),
// the sessions and their views as a list (each view on its front tab's dark tile, the front view a
// pill), and at its foot a menu of the side bar's views (the list, and every `panel` a plugin
// contributes), a new session and a page. With the side bar hidden, the window's session's views
// run across the top instead. The panes sit in the app's own layout (`Layout`, `Split`: its splits,
// its edges that drag, its zoom, its floats); each is a card with a dark rim and a light bevel, its
// title and its buttons on top (`PaneTitle`; a strip of its tabs, each a `PaneTab`, when it holds
// several). The menus and dialogs are the app's own, in Deno's colours. Started from P-Rex, which
// follows the same app; the behaviour is the default theme's wherever a theme can reach it.
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, IconImage, motion, useDraggable, useDragState, useMetrics, useTabMeta, useTheme } from "pumi"
import {
  call,
  carried,
  commands,
  leafOf,
  renderComponent,
  rowDrop,
  run,
  runMove,
  serverOf,
  shortcut,
  stripDrop,
  useApp,
  useComponents,
  useDropBox,
  useFocusedTab,
  useFocusOnHover,
  useLayout,
  useLocal,
  useMenu,
  useOutlineFocused,
  usePaneTabs,
  usePaneTitles,
  useRename,
  useSession,
  useSessions,
  useSidebar,
  useSidebarSwipe,
  useSlot,
  useTab,
  useThemeOption,
  useViewIcons,
  useViews,
  useWindow,
  via,
  whereIn,
  within,
  type Carried,
  type ComponentItem,
  type Components,
  type IconButtonProps,
  type PaneLeaf,
  type RenameInput,
  type Row,
  type Tab as TabInfo,
} from "pumi/theme"

type Tokens = ReturnType<typeof useTheme>

const swallow = (err: unknown) => console.error(String(err))
const stop = (e: any) => e?.stopPropagation?.()

// ── Icons ──────────────────────────────────────────────────────────────────────────────────────

/** The theme's own glyphs, by path; like the app's, each is drawn in the colour it is given. */
const OWN = new Set(["laptop", "session_plus", "globe_plus", "list_circle", "sidebar", "eye", "command", "float", "split_columns", "split_rows"])
const own = (name: string) => `${import.meta.dir}/icons/${name}.svg`

/** One of the theme's glyphs, or else one of the app's. */
const Glyph = memo(function Glyph({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  if (!OWN.has(name)) return <Icon name={name} size={size} color={color} />
  return <svg src={own(name)} style={{ width: size, height: size, flexShrink: 0, ...(color ? { color } : {}) }} />
})

// ── What the window keeps ──────────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH = "deno.sidebar.width"
const SIDEBAR_VIEW = "deno.sidebar.view"
/** The list's view: the sessions and their views. */
const LIST_VIEW = "list"
const FOLDED = "deno.sessions.folded"
/** The order sessions were dragged into, in the default theme's list: kept to, not changed. */
const SESSION_ORDER = "default.agents.order"
const NONE: string[] = []
const NO_TABS: TabInfo[] = []

/** A page in a new view, from whichever browser plugin is installed. */
const BROWSERS = ["pumi_dev.browser.openView", "pumi.browser.openTab"]
/** The command palette, from whichever plugin brings one. */
const PALETTES = ["amresyd.palette.toggle", "pumi_dev.palette.toggle", "pumi.palette.toggle"]

/** The first of `names` that is a command now: a plugin's comes and goes with its plugin. */
function useFirstCommand(names: string[]): string | undefined {
  return useSyncExternalStore(commands.subscribe, () => {
    const have = new Set(commands.commands().map((c) => c.name))
    return names.find((n) => have.has(n))
  })
}

/** A tooltip: what it does, and its keys. */
const tip = (title: string, command?: string) => {
  const keys = command ? shortcut(command) : undefined
  return keys ? `${title}  ${keys}` : title
}

/** Shows a session's view (and a tab of it) in `window`. */
function goTo(window: ReturnType<typeof useWindow>, session: string, view?: string, tab?: string) {
  if (window.session !== session) window.show(session, view)
  const viewed = view ? call(via(view, "view.focus"), view) : Promise.resolve()
  viewed.then(() => tab && call(via(tab, "tab.focus"), tab)).catch(swallow)
}

// ── Names ──────────────────────────────────────────────────────────────────────────────────────

type TabLike = Pick<TabInfo, "block" | "label" | "terminal_title" | "cwd">

const HOME = process.env.HOME ?? ""
/** A folder as a shell shows it: under the home folder, from `~`. */
const tilde = (path: string) => (HOME && (path === HOME || path.startsWith(`${HOME}/`)) ? `~${path.slice(HOME.length)}` : path)
/** A path's last folder (`avid-storm`). */
const shortName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path

/** A tab's name, as the app's own: its label, its title, its folder, its block. */
function tabTitle(t: TabLike): string {
  return t.label || t.terminal_title || (t.cwd ? shortName(t.cwd) : "") || t.block
}

/** Where a tab is, after its name (`zsh ~`): its folder, unless its name already says it. */
function tabWhere(t: TabLike, title: string): string | undefined {
  if (!t.cwd) return undefined
  const where = tilde(t.cwd)
  return title !== shortName(t.cwd) && where !== title ? where : undefined
}

/** The most urgent first: what a row says of its tabs. */
const URGENCY = ["error", "blocked", "working", "done"]
function lead(statuses: (string | undefined)[]): string | undefined {
  let best: string | undefined
  for (const s of statuses) {
    if (s && URGENCY.includes(s) && (best === undefined || URGENCY.indexOf(s) < URGENCY.indexOf(best))) best = s
  }
  return best
}

// ── Tiles ──────────────────────────────────────────────────────────────────────────────────────

/** A terminal's mark: its tab shows the app's terminal glyph (its own or its block's). */
const isTerminalIcon = (src: string) => /\/terminal\.svg$/.test(src)

/** What a tab is drawn as on a tile and in its title: a terminal's `>_`, or its icon. */
const TabMark = memo(function TabMark({ tab, size, color, prompt }: { tab?: string; size: number; color: string; prompt?: string }) {
  const { icon } = useTabMeta(tab)
  if (!icon.src || isTerminalIcon(icon.src)) {
    return <text style={{ fontSize: Math.round(size * 0.8), fontWeight: 500, lineHeight: size, color: prompt ?? color, fontFamily: "Menlo" }}>{">_"}</text>
  }
  return <IconImage icon={icon} size={size} color={color} />
})

/**
 * A tab's tile: a dark rounded square with its mark (a terminal's green prompt), a near-black rim
 * and a hair of light inside it; for a view of several tabs a deck behind it, as many cards as
 * Settings' "Tab icons per view" says. A status that wants a look (working, done, blocked, error)
 * is a dot in its corner, pulsing while it works.
 */
const Tile = memo(function Tile({ tab, status, size = 20, stack = 1 }: { tab?: string; status?: string; size?: number; stack?: number }) {
  const t = useTheme()
  const dot = status ? (t[`status.${status}`] ?? t["status.unknown"]) : undefined
  const depth = Math.min(Math.max(stack, 1), 3) - 1
  const step = Math.max(2, Math.round(size * 0.16))
  const radius = Math.round(size * 0.3)
  const height = size + depth * step
  return (
    <div style={{ position: "relative", width: size, height, flexShrink: 0 }}>
      {Array.from({ length: depth }, (_, i) => {
        const back = depth - i
        return (
          <div
            key={i}
            style={{ position: "absolute", left: back, width: size - back * 2, top: (depth - back) * step, height: size, borderRadius: radius, backgroundColor: t["deno.tileBack"], borderWidth: 1, borderColor: t["deno.tileRim"] }}
          />
        )
      })}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: height - size,
          display: "flex",
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius,
          backgroundColor: t["deno.tile"],
          borderWidth: 1,
          borderColor: t["deno.tileRim"],
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: radius - 1, borderWidth: 1, borderColor: t["deno.tileBevel"], pointerEvents: "none" }} />
        <TabMark tab={tab} size={Math.round(size * 0.6)} color={t["deno.tileGlyph"]} prompt={t["deno.tilePrompt"]} />
      </div>
      {dot ? (
        status === "working" ? (
          <motion.div animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", fps: 12 }} style={dotStyle(dot, t)} />
        ) : (
          <div style={dotStyle(dot, t)} />
        )
      ) : null}
    </div>
  )
})

function dotStyle(color: string, t: Tokens) {
  return { position: "absolute", right: -2, bottom: -2, width: 7, height: 7, borderRadius: 7, borderWidth: 1.5, borderColor: t["deno.dotRing"], backgroundColor: color } as const
}

/** A view's tile: its focused tab's, the most urgent status of its tabs, and a deck for the rest. */
const ViewTile = memo(function ViewTile({ tabs, focused, size }: { tabs: TabInfo[]; focused?: TabInfo; size: number }) {
  const [most] = useViewIcons()
  if (most <= 0) return null
  const front = focused ?? tabs[0]
  return <Tile tab={front?.tab_id} status={lead(tabs.map((x) => x.status))} size={size} stack={Math.min(tabs.length, most)} />
})

// ── The window ─────────────────────────────────────────────────────────────────────────────────

/** Room round the cards at the window's edges (between them it is the layout's `gap`). */
const GUTTER = 6

/** A setting of Deno's as a number in `[min, max]`, or its default. */
function useNumberOption(key: string, fallback: number, min: number, max: number): number {
  const given = Number(useThemeOption(key, fallback))
  return Number.isFinite(given) ? Math.min(Math.max(given, min), max) : fallback
}

/**
 * Deno's Background opacity and blur, applied to the window as they change: at 100% the window is
 * opaque; under it every background lets the desktop through by as much (each keeps its own
 * colour, text stays opaque), blurred by the blur's px. The app sets the theme's defaults
 * (`theme.tsx`: 95%, 40 px) as it starts drawing it; this runs after, with the user's.
 */
function useGlass() {
  const window = useWindow()
  const opacity = useNumberOption("opacity", 95, 20, 100) / 100
  const blur = useNumberOption("blur", 40, 0, 60)
  useEffect(() => {
    const apply = () => {
      try {
        window.setBackground(opacity < 1 ? "transparent" : "opaque")
        window.setBlur(opacity < 1 ? blur : 0)
        window.setGlass(opacity)
      } catch (err) {
        swallow(err)
      }
    }
    // After the app's own effect, which sets the theme's defaults when the window first draws it.
    const later = setTimeout(apply, 0)
    return () => clearTimeout(later)
  }, [window, opacity, blur])
}

function Window() {
  useGlass()
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const [sidebar] = useSidebar()
  const [width, setWidth] = useLocal(SIDEBAR_WIDTH, 228)
  const overlays = useSlot("window.overlay").components
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", color: t.text, fontSize: m.fontSize, backgroundColor: t.window }}>
      {sidebar ? null : <TopBar />}
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        {sidebar ? <Sidebar width={width} setWidth={setWidth} /> : null}
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, paddingTop: sidebar ? GUTTER : 0, paddingRight: GUTTER, paddingBottom: GUTTER, paddingLeft: sidebar ? 0 : GUTTER }}>
          <C.Layout />
        </div>
      </div>
      <DragGhost />
      {overlays.map((v) => (
        <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {renderComponent(v)}
        </div>
      ))}
    </div>
  )
}

/** The window's top row: as tall as the traffic lights centred in it, its buttons past them. */
function useTitleRow() {
  const window = useWindow()
  const lights = window.trafficLights
  return {
    height: lights ? Math.max(40, Math.round(lights.y * 2 + lights.height)) : 40,
    inset: lights ? lights.x + lights.width + 14 : 12,
    // Where a button sits to stand under the red light (the side bar's foot).
    under: lights ? Math.max(4, Math.round(lights.x + lights.height / 2 - 12)) : 8,
  }
}

/** A button of the window's own (the side bar's top and foot): a glyph, its tooltip, a hover. */
function BarButton({ icon, title, command, onPress, onClick }: { icon: string; title: string; command?: string; onPress?(): void; onClick(): void }) {
  const t = useTheme()
  return (
    <div
      onMouseDown={onPress}
      onClick={(e: any) => {
        stop(e)
        onClick()
      }}
      onDoubleClick={stop}
      aria-label={title}
      title={tip(title, command)}
      style={{
        display: "flex",
        width: 26,
        height: 26,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        cursor: "pointer",
        color: t["deno.chrome"],
        hover: { backgroundColor: t.hover, color: t.text },
        active: { backgroundColor: t.active },
      }}
    >
      <Glyph name={icon} size={16} />
    </div>
  )
}

/** The window's buttons: the pane titles' toggle, the command palette (when a plugin has one), a new view. */
function WindowButtons() {
  const window = useWindow()
  const [titles] = usePaneTitles()
  const palette = useFirstCommand(PALETTES)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <BarButton icon="eye" title={titles ? "Hide Pane Title Bars" : "Show Pane Title Bars"} command="toggle_pane_titles" onClick={() => run("toggle_pane_titles", window.id)} />
      {palette ? <BarButton icon="command" title="Command Palette" command={palette} onClick={() => run(palette, window.id)} /> : null}
      <BarButton icon="plus" title="New View" command="new_view" onClick={() => run("new_view", window.id)} />
    </div>
  )
}

/** The side bar's top: the traffic lights' room, the side bar's button, and the window's. */
function SidebarHeader() {
  const window = useWindow()
  const { height, inset } = useTitleRow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height, flexShrink: 0, paddingLeft: inset, paddingRight: 10, appRegion: "drag" }}>
      <BarButton icon="sidebar" title="Hide Sidebar" command="toggle_sidebar" onClick={() => run("toggle_sidebar", window.id)} />
      <div style={{ flexGrow: 1 }} />
      <WindowButtons />
    </div>
  )
}

/** With the side bar hidden: its button, the window's session's views across the top, and the window's buttons. */
function TopBar() {
  const window = useWindow()
  const session = useSession()
  const id = session?.workspace_id
  const views = useViews(id)
  const sorted = useMemo(() => [...views].sort((a, b) => a.number - b.number), [views])
  const { height, inset } = useTitleRow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height, flexShrink: 0, paddingLeft: inset, paddingRight: 10, appRegion: "drag" }}>
      <BarButton icon="sidebar" title="Show Sidebar" command="toggle_sidebar" onClick={() => run("toggle_sidebar", window.id)} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1, minWidth: 0, marginLeft: 8, overflow: "hidden" }}>
        {id ? sorted.map((v) => <TopView key={v.view_id} view={v.view_id} session={id} label={v.label} front={window.view === v.view_id} />) : null}
      </div>
      <div style={{ flexGrow: 1, minWidth: 8 }} />
      <WindowButtons />
    </div>
  )
}

/** A view across the top: its tile and its name, the front one a pill. It clicks, renames, drags and takes drops as its row does. */
const TopView = memo(function TopView({ view: id, session, label: named, front }: { view: string; session: string; label: string | null; front: boolean }) {
  const t = useTheme()
  const window = useWindow()
  const { tab, tabs, label, rename, menu, draggable, drop } = useViewItem(id, named, session)
  const { renaming, start, input } = rename
  return (
    <div
      ref={drop.ref}
      {...(renaming ? {} : draggable.props)}
      onClick={() => renaming || draggable.wasDragged() || goTo(window, session, id)}
      onDoubleClick={() => renaming || start()}
      onAuxClick={menu.open}
      title={tab?.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        height: 28,
        flexShrink: 1,
        minWidth: 44,
        maxWidth: 220,
        paddingLeft: 5,
        paddingRight: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: drop.isOver ? t.accent : front ? t["deno.pillRim"] : "#00000000",
        backgroundColor: drop.isOver ? `${t.accent}26` : front ? t["deno.pill"] : undefined,
        cursor: "pointer",
        userSelect: "none",
        opacity: draggable.dragging ? 0.5 : 1,
        hover: { backgroundColor: drop.isOver ? `${t.accent}26` : front ? t["deno.pill"] : t.hover },
      }}
    >
      <ViewTile tabs={tabs} focused={tab} size={18} />
      {input ? <RenameField input={input} /> : <text style={{ fontSize: 13, color: front ? t.text : t["deno.row"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label}</text>}
      {menu.menu}
    </div>
  )
})

// ── The side bar ───────────────────────────────────────────────────────────────────────────────

const viewKey = (v: ComponentItem) => `${v.plugin}/${v.id}`

/** The side bar: its top, the view shown (the sessions, or a plugin's panel), and its foot. */
function Sidebar({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const t = useTheme()
  const panels = useSlot("panel").components
  const [view] = useLocal<string>(SIDEBAR_VIEW, LIST_VIEW)
  const shown = panels.find((v) => viewKey(v) === view)
  const [, setOpen] = useSidebar()
  const swipe = useSidebarSwipe(() => setOpen(false))
  return (
    <div cache onScroll={swipe} style={{ display: "flex", flexDirection: "column", width, flexShrink: 0, minWidth: 0, position: "relative" }}>
      <SidebarHeader />
      {shown ? (
        <>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 28, flexShrink: 0, paddingLeft: 21, paddingRight: 10 }}>
            <text style={{ fontSize: 12, fontWeight: 600, color: t["deno.heading"], whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{shown.title ?? shown.id}</text>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingLeft: 4, paddingRight: 4 }}>{renderComponent(shown)}</div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
          <SessionHeaderSlot />
          <Sessions />
        </div>
      )}
      <SidebarFooter panels={panels} shown={shown ? view : LIST_VIEW} />
      <Resizer width={width} setWidth={setWidth} />
    </div>
  )
}

/** What plugins put over the sessions (`session.header`), given the window's session. */
function SessionHeaderSlot() {
  const C = useComponents()
  const session = useSession()
  const { components, actions } = useSlot("session.header")
  const args = useMemo(() => ({ session: session?.workspace_id }), [session?.workspace_id])
  if (!session || (!components.length && !actions.length)) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 30, flexShrink: 0, paddingLeft: 14, paddingRight: 10 }}>
      {components.map((v) => renderComponent(v, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
    </div>
  )
}

/** The side bar's foot: under the red light the side bar's views; on the right a new session and a page. */
function SidebarFooter({ panels, shown }: { panels: ComponentItem[]; shown: string }) {
  const window = useWindow()
  const { under } = useTitleRow()
  const browser = useFirstCommand(BROWSERS)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 46, flexShrink: 0, paddingLeft: under, paddingRight: 10 }}>
      <ViewsButton panels={panels} shown={shown} />
      <div style={{ flexGrow: 1, minWidth: 4 }} />
      <BarButton icon="session_plus" title="New Session" command="new_workspace" onClick={() => run("new_workspace", window.id)} />
      {browser ? <BarButton icon="globe_plus" title="Open a Page" command={browser} onClick={() => run(browser, window.id)} /> : null}
    </div>
  )
}

/** A card that opens from a button: a press outside it closes it, and its own button's press does not open it again. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const pressedOpen = useRef(false)
  return {
    open,
    close: () => setOpen(false),
    press: () => {
      pressedOpen.current = open
    },
    toggle: () => {
      if (pressedOpen.current) pressedOpen.current = false
      else setOpen(true)
    },
  }
}

function Popover({ close, children }: { close(): void; children: ReactNode }) {
  const t = useTheme()
  return (
    <anchored side="top" align="start" gap={6} fit="snap" snapMargin={8} deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <div
        onMouseDownOutside={close}
        style={{ display: "flex", flexDirection: "column", minWidth: 210, paddingTop: 5, paddingBottom: 5, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t["deno.pillRim"], boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 28, spreadRadius: 0, color: t["deno.shadow"] } }}
      >
        {children}
      </div>
    </anchored>
  )
}

function PopoverItem({ icon, title, keys, checked, onClick }: { icon?: string; title: string; keys?: string; checked?: boolean; onClick(): void }) {
  const t = useTheme()
  return (
    <div
      onClick={onClick}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 26, flexShrink: 0, marginLeft: 5, marginRight: 5, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: "pointer", hover: { backgroundColor: t.hover } }}
    >
      {icon ? <Glyph name={icon} size={14} color={t.muted} /> : null}
      <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
      {keys || checked ? <div style={{ flexGrow: 1, minWidth: 16 }} /> : null}
      {keys ? <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{keys}</text> : null}
      {checked ? <Icon name="check" size={12} color={t.accent} /> : null}
    </div>
  )
}

/** The side bar's views, as a menu: the list, each plugin's panel (the one shown checked), and a hide. */
function ViewsButton({ panels, shown }: { panels: ComponentItem[]; shown: string }) {
  const t = useTheme()
  const window = useWindow()
  const [, setView] = useLocal<string>(SIDEBAR_VIEW, LIST_VIEW)
  const menu = usePopover()
  const current = panels.find((v) => viewKey(v) === shown)
  const pick = (key: string) => {
    menu.close()
    setView(key)
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }}>
      <BarButton icon={current?.icon ?? "list_circle"} title={current ? `${current.title ?? current.id} — Views` : "Views"} onPress={menu.press} onClick={menu.toggle} />
      {menu.open ? (
        <Popover close={menu.close}>
          <PopoverItem icon="list_circle" title="Views" checked={shown === LIST_VIEW} onClick={() => pick(LIST_VIEW)} />
          {panels.map((v) => (
            <PopoverItem key={viewKey(v)} icon={v.icon ?? "blocks"} title={v.title ?? v.id} checked={shown === viewKey(v)} onClick={() => pick(viewKey(v))} />
          ))}
          <div style={{ height: 1, flexShrink: 0, marginTop: 5, marginBottom: 5, marginLeft: 10, marginRight: 10, backgroundColor: t["deno.pillRim"] }} />
          <PopoverItem
            title="Hide Sidebar"
            keys={shortcut("toggle_sidebar")}
            onClick={() => {
              menu.close()
              run("toggle_sidebar", window.id)
            }}
          />
        </Popover>
      ) : null}
    </div>
  )
}

/** The side bar's edge: drag it to size the bar. */
function Resizer({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const t = useTheme()
  const [from, setFrom] = useState<{ x: number; width: number } | undefined>()
  return (
    <div
      onMouseDown={(e) => setFrom({ x: e.x ?? 0, width })}
      onMouseMove={(e) => from && setWidth(Math.min(520, Math.max(180, from.width + (e.x ?? 0) - from.x)))}
      onMouseUp={() => setFrom(undefined)}
      title="Drag to resize"
      style={{ position: "absolute", top: 0, right: -2, width: 6, height: "100%", cursor: "col-resize", backgroundColor: from ? `${t.accent}55` : undefined, hover: { backgroundColor: `${t.accent}40` } }}
    />
  )
}

// ── The sessions and their views ───────────────────────────────────────────────────────────────

/** Every session, its views under it: in the default theme's dragged order, and under their machine when any is elsewhere. */
function Sessions() {
  const t = useTheme()
  const sessions = useSessions()
  const [order] = useLocal<string[]>(SESSION_ORDER, NONE)
  const [folded, setFolded] = useLocal<string[]>(FOLDED, NONE)
  const toggle = useCallback((id: string) => setFolded((now) => (now.includes(id) ? now.filter((k) => k !== id) : [...now, id])), [setFolded])
  if (!sessions.length) return <text style={{ paddingLeft: 21, paddingTop: 8, fontSize: 12, color: t.faint }}>No sessions</text>
  const rank = (id: string) => (order.indexOf(id) < 0 ? order.length : order.indexOf(id))
  const sorted = sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.workspace_id) - rank(b.s.workspace_id) || a.i - b.i)
    .map(({ s }) => s)
  const machines = new Map<string, typeof sorted>()
  for (const s of sorted) {
    const server = serverOf(s.workspace_id) ?? ""
    if (!machines.has(server)) machines.set(server, [])
    machines.get(server)!.push(s)
  }
  const servers = [...machines.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0))
  const named = servers.some((s) => s !== "")
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 8 }}>
      {servers.map((server) => (
        <div key={server || "here"} style={{ display: "flex", flexDirection: "column" }}>
          {named ? <MachineHeading name={server || "This Mac"} /> : null}
          {machines.get(server)!.map((s) => (
            <SessionGroup key={s.workspace_id} session={s.workspace_id} label={s.label || s.workspace_id} folded={folded.includes(s.workspace_id)} toggle={toggle} />
          ))}
        </div>
      ))}
    </div>
  )
}

function MachineHeading({ name }: { name: string }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 9, height: 32, flexShrink: 0, marginTop: 4, paddingLeft: 19, paddingRight: 10 }}>
      <Glyph name="laptop" size={16} color={t.muted} />
      <text style={{ fontSize: 13, fontWeight: 600, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{name}</text>
    </div>
  )
}

/** A session: its heading, and its views while it is not folded. */
const SessionGroup = memo(function SessionGroup({ session: id, label, folded, toggle }: { session: string; label: string; folded: boolean; toggle(id: string): void }) {
  const window = useWindow()
  const views = useViews(id)
  const sorted = useMemo(() => [...views].sort((a, b) => a.number - b.number), [views])
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <SessionHeading session={id} label={label} folded={folded} toggle={toggle} views={sorted.length} />
      {folded
        ? null
        : sorted.map((view) => <ViewRow key={view.view_id} view={view.view_id} session={id} label={view.label} worktree={view.worktree} front={window.session === id && window.view === view.view_id} />)}
    </div>
  )
})

/** A small button on a row; its click is its own, not the row's. */
function RowButton({ icon, title, size = 22, onClick }: { icon: string; title: string; size?: number; onClick(e: any): void }) {
  const t = useTheme()
  return (
    <div
      aria-label={title}
      title={title}
      onClick={(e: any) => {
        stop(e)
        onClick(e)
      }}
      onDoubleClick={stop}
      onAuxClick={stop}
      onMouseDown={stop}
      style={{ display: "flex", width: size, height: size, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: size / 2, color: t.muted, cursor: "pointer", hover: { backgroundColor: t.active, color: t.text } }}
    >
      <Glyph name={icon} size={13} />
    </div>
  )
}

/** A name being edited in place (`useRename`'s field). */
function RenameField({ input }: { input: RenameInput }) {
  const t = useTheme()
  return <input {...input} style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: t.text, paddingLeft: 4, paddingRight: 4, borderRadius: 5, borderWidth: 1, borderColor: t.accent, backgroundColor: t.editor }} />
}

/**
 * A session's heading: its name, small and quiet. A click shows it, a double click renames it; on
 * hover a chevron folds it, a `+` opens a view in it and a `…` its menu (a right click too).
 * Folded, it says how many views it has and the most urgent status in them.
 */
const SessionHeading = memo(function SessionHeading({ session: id, label, folded, toggle, views }: { session: string; label: string; folded: boolean; toggle(id: string): void; views: number }) {
  const t = useTheme()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const current = id === window.session
  const status = useApp((s) => (folded ? lead(s.snapshot?.tabs.filter((p) => p.workspace_id === id).map((p) => p.status) ?? []) : undefined))
  const { renaming, start, input } = useRename({ session: id }, label)
  const { open, show, menu, shown } = useMenu("session.menu", { session: id })
  const newView = () => {
    call(via(id, "tab.open"), null, {}, { kind: "view", session: id })
      .then(() => current || window.show(id))
      .catch(swallow)
  }
  const buttons = (hovered || shown) && !renaming
  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => renaming || current || window.show(id)}
        onDoubleClick={() => renaming || start()}
        onAuxClick={open}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 28, flexShrink: 0, marginTop: 4, paddingLeft: 21, paddingRight: 12, cursor: "pointer", userSelect: "none" }}
      >
        {input ? (
          <RenameField input={input} />
        ) : (
          <text style={{ fontSize: 12, fontWeight: 600, color: t["deno.heading"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label}</text>
        )}
        {folded && !buttons && !renaming ? <Glyph name="chevron_right" size={11} color={t.faint} /> : null}
        {renaming ? null : <div style={{ flexGrow: 1 }} />}
        {buttons ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <RowButton icon={folded ? "chevron_right" : "chevron_down"} title={folded ? "Unfold" : "Fold"} onClick={() => toggle(id)} />
            <RowButton icon="plus" title="New View" onClick={newView} />
            <RowButton icon="ellipsis" title="More" onClick={show} />
          </div>
        ) : folded && !renaming ? (
          <>
            {status ? <div style={{ width: 7, height: 7, borderRadius: 7, flexShrink: 0, backgroundColor: t[`status.${status}`] ?? t["status.unknown"] }} /> : null}
            <text style={{ fontSize: 11, color: t.faint }}>{String(views)}</text>
          </>
        ) : null}
      </div>
      {menu}
    </>
  )
})

/**
 * What a view's row and its place across the top both know of it: its tabs, its front one, its
 * name, and its rename, menu, drag and drop. A tab dropped on the row joins the view; a view
 * dropped on it goes beside it.
 */
function useViewItem(id: string, named: string | null, session: string) {
  const focused = useFocusedTab(id)
  const snapshot = useApp((s) => s.snapshot)
  const tabs = useMemo(() => snapshot?.tabs.filter((p) => p.view_id === id && (p.place as { kind?: string } | undefined)?.kind !== "float") ?? NO_TABS, [snapshot, id])
  const tab = tabs.find((x) => x.tab_id === focused) ?? tabs[0]
  const label = named && !/^\d+$/.test(named) ? named : tab ? tabTitle(tab) : "View"
  const rename = useRename({ view: id }, label)
  // The view's menu: the app's (Rename, Close) and what plugins add, then its front tab's.
  const menu = useMenu(["view.menu", "view.actions", "tab.menu"], { view: id, tab: tab?.tab_id })
  const draggable = useDraggable({ kind: "pumi.view", view: id }, { disabled: rename.renaming })
  const row: Row = { kind: "view", session, view: id }
  const move = (it: Carried, fy: number) => rowDrop(it, row, fy, whereIn(snapshot))
  const drop = useDropBox(
    (data): data is Carried => {
      const it = carried(data)
      return !!it && move(it, 0.5) !== undefined
    },
    (it, at, box) => {
      const m = move(it, within(at, box).fy)
      if (m) runMove(m)
    },
  )
  return { tab, tabs, label, rename, menu, draggable, drop }
}

/**
 * A view, as a row: its front tab's tile, its name and where it is (`zsh ~`), its worktree; the
 * window's front view a pill. A click goes to it, a double click renames it, a right click (or the
 * `…` on hover) opens its menu. It drags beside another view, and a tab dropped on it joins it.
 */
const ViewRow = memo(function ViewRow({ view: id, session, label: named, worktree, front }: { view: string; session: string; label: string | null; worktree?: string; front: boolean }) {
  const t = useTheme()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const { tab, tabs, label, rename, menu: viewMenu, draggable, drop } = useViewItem(id, named, session)
  const { renaming, start, input } = rename
  const { open, show, menu, shown } = viewMenu
  // A view named by its front tab says where that tab is (`zsh ~`), when that is short enough to read beside it.
  const where = tab && !(named && !/^\d+$/.test(named)) ? tabWhere(tab, label) : undefined
  const short = where && where.length <= 16 ? where : undefined
  const near = (hovered || shown) && !renaming
  return (
    <>
      <div
        ref={drop.ref}
        {...(renaming ? {} : draggable.props)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => renaming || draggable.wasDragged() || goTo(window, session, id)}
        onDoubleClick={() => renaming || start()}
        onAuxClick={open}
        title={tab?.cwd ?? undefined}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 30,
          flexShrink: 0,
          marginLeft: 9,
          marginRight: 10,
          marginTop: 1,
          marginBottom: 1,
          paddingLeft: 9,
          paddingRight: 4,
          borderRadius: 15,
          borderWidth: 1,
          borderColor: drop.isOver ? t.accent : front ? t["deno.pillRim"] : "#00000000",
          backgroundColor: drop.isOver ? `${t.accent}26` : front ? t["deno.pill"] : undefined,
          cursor: "pointer",
          userSelect: "none",
          opacity: draggable.dragging ? 0.5 : 1,
          hover: { backgroundColor: drop.isOver ? `${t.accent}26` : front ? t["deno.pill"] : t.hover },
        }}
      >
        <ViewTile tabs={tabs} focused={tab} size={20} />
        {input ? (
          <RenameField input={input} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, paddingTop: 3, paddingBottom: 3 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
              <text style={{ fontSize: 13, color: front ? t.text : t["deno.row"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label}</text>
              {short ? <text style={{ fontSize: 13, color: t["deno.titleDim"], whiteSpace: "nowrap", flexShrink: 0 }}>{short}</text> : null}
            </div>
            {worktree ? (
              <div title={worktree} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, minWidth: 0 }}>
                <Icon name="git_worktree" size={11} color={t.faint} />
                <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{shortName(worktree)}</text>
              </div>
            ) : null}
          </div>
        )}
        {near ? <RowButton icon="ellipsis" title="More" size={22} onClick={show} /> : null}
      </div>
      {menu}
    </>
  )
})

/** What a tab's or a view's drag carries, by the mouse: its tile and its name. */
function DragGhost() {
  const t = useTheme()
  const drag = useDragState()
  const it = carried(drag?.data)
  const snapshot = useApp((s) => (it?.kind === "pumi.tab" || it?.kind === "pumi.view" ? s.snapshot : undefined))
  if (!drag || !snapshot || !it) return null
  let tab: TabInfo | undefined
  let label: string | undefined
  if (it.kind === "pumi.tab") {
    tab = snapshot.tabs.find((x) => x.tab_id === it.tab)
    label = tab && tabTitle(tab)
  } else if (it.kind === "pumi.view") {
    const view = snapshot.views.find((x) => x.view_id === it.view)
    const focused = snapshot.layouts.find((l) => l.view_id === it.view)?.focused_tab_id
    tab = snapshot.tabs.find((x) => x.tab_id === focused) ?? snapshot.tabs.find((x) => x.view_id === it.view)
    label = view?.label && !/^\d+$/.test(view.label) ? view.label : tab ? tabTitle(tab) : "View"
  }
  if (!label) return null
  return (
    <anchored position={{ x: drag.x + 14, y: drag.y + 10 }} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 8, paddingRight: 12, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t["deno.pillRim"], pointerEvents: "none", boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: t["deno.shadow"] } }}>
        <Tile tab={tab?.tab_id} size={18} />
        <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap" }}>{label}</text>
      </div>
    </anchored>
  )
}

// ── A pane ─────────────────────────────────────────────────────────────────────────────────────

/** The window's small button (`IconButton`): a plugin's toolbar buttons, and the app's where it uses them. */
function IconButton({ icon, onClick, title, active, color }: IconButtonProps) {
  return <PaneButton icon={icon} title={title ?? icon} active={active} color={color} onClick={onClick} />
}

/** A pane's button: quiet until the mouse is on it; `off` (dimmer, and inert) when it would do nothing here. */
function PaneButton({ icon, title, active, color, off, onClick }: { icon: string; title: string; active?: boolean; color?: string; off?: boolean; onClick(): void }) {
  const t = useTheme()
  return (
    <div
      onClick={(e: any) => {
        // The press is the button's, not the title bar's (which selects and drags its pane).
        stop(e)
        if (!off) onClick()
      }}
      onMouseDown={stop}
      onDoubleClick={stop}
      aria-label={title}
      aria-pressed={active}
      aria-disabled={off}
      title={title}
      style={{
        display: "flex",
        width: 24,
        height: 24,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        color: off ? t["deno.paneButtonOff"] : (color ?? (active ? t.text : t["deno.paneButton"])),
        cursor: off ? "default" : "pointer",
        ...(off ? {} : { hover: { backgroundColor: t.hover, color: t.text }, active: { backgroundColor: t.active } }),
      }}
    >
      <Glyph name={icon} size={14} />
    </div>
  )
}

/** A slot's components, given `args`, and its actions as buttons, in a row. */
const SlotRow = memo(function SlotRow({ slot, args, gap = 2 }: { slot: string; args?: Record<string, unknown>; gap?: number }) {
  const C = useComponents()
  const { components, actions } = useSlot(slot)
  if (!components.length && !actions.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap, flexShrink: 0 }}>
      {components.map((v) => renderComponent(v, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
    </div>
  )
})

/** Whether a drag carries a tab that could go into `pane`'s strip at some index. */
const intoStrip = (pane: string, tabs: string[]) => (data: unknown): data is Carried => {
  const it = carried(data)
  if (!it) return false
  const leaf: PaneLeaf = { pane, tabs }
  return [...tabs.keys(), tabs.length].some((index) => stripDrop(it, leaf, index) !== undefined)
}

/** The rest of a pane's bar after its tabs: a tab dropped there goes last. */
function StripEnd({ pane, tabs }: { pane: string; tabs: string[] }) {
  const t = useTheme()
  const zone = useDropBox(intoStrip(pane, tabs), (it) => {
    const m = stripDrop(it, { pane, tabs }, tabs.length)
    if (m) runMove(m)
  })
  const it = zone.drag ? carried(zone.drag.data) : undefined
  const lit = zone.isOver && !!it && stripDrop(it, { pane, tabs }, tabs.length) !== undefined
  return <div ref={zone.ref} style={{ display: "flex", flexGrow: 1, alignSelf: "stretch", minWidth: 8, borderLeftWidth: lit ? 2 : 0, borderColor: t.accent }} />
}

/**
 * The `PaneTab` part: one tab in a pane's strip (a pane of several tabs). Its mark, its name, and a
 * close on the front tab and the one under the mouse. A press brings it to the front; a right
 * press opens its menu. It drags along its strip, into another pane's, or onto a side of a pane;
 * a tab dropped on it goes before it, or after it past its middle. The front tab is a pill.
 */
function PaneTab({ tab: id, pane, index, active, focused }: { tab: string; pane: string; index: number; active: boolean; focused: boolean }) {
  const t = useTheme()
  const [hovered, setHovered] = useState(false)
  const info = useTab(id)
  const { status } = useTabMeta(id)
  const tree = useLayout(info?.view_id)
  const leaf: PaneLeaf = { pane, tabs: leafOf(tree, pane)?.tabs ?? [id] }
  const zone = useDropBox(intoStrip(pane, leaf.tabs), (it, at, box) => {
    const m = stripDrop(it, leaf, within(at, box).fx < 0.5 ? index : index + 1)
    if (m) runMove(m)
  })
  const draggable = useDraggable<Carried>({ kind: "pumi.tab", tab: id })
  const { open, menu } = useMenu("tab.menu", { tab: id })
  if (!info) return null
  const title = tabTitle(info)
  const loud = status && URGENCY.includes(status) ? t[`status.${status}`] : undefined
  return (
    <div
      ref={zone.ref}
      {...draggable.props}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={(e: any) => {
        draggable.props.onMouseDown(e)
        if ((e?.button ?? 0) !== 0) return
        if (!active || !focused) call(via(id, "tab.focus"), id).catch(swallow)
      }}
      onAuxClick={(e: any) => {
        stop(e)
        open(e)
      }}
      title={info.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 24,
        alignSelf: "center",
        flexShrink: 0,
        maxWidth: 220,
        minWidth: 36,
        paddingLeft: 8,
        paddingRight: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: active ? t["deno.pillRim"] : "#00000000",
        backgroundColor: active ? t["deno.pill"] : undefined,
        cursor: draggable.dragging ? "grabbing" : "pointer",
        userSelect: "none",
        opacity: draggable.dragging ? 0.55 : 1,
        hover: { backgroundColor: active ? t["deno.pill"] : t.hover },
      }}
    >
      <TabMark tab={id} size={13} color={loud ?? (active ? t.text : t["deno.titleDim"])} />
      <text style={{ fontSize: 12, fontWeight: active ? 500 : 400, color: active ? t.text : t["deno.titleDim"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
      <div
        aria-label="Close Tab"
        title="Close Tab"
        onMouseDown={stop}
        onClick={(e: any) => {
          stop(e)
          call(via(id, "tab.close"), id).catch(swallow)
        }}
        style={{ display: "flex", width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 4, opacity: active || hovered ? 1 : 0, hover: { backgroundColor: t.active, opacity: 1 } }}
      >
        <Icon name="close" size={9} />
      </div>
      {menu}
    </div>
  )
}

/** A pane's title bar is this tall: its title in line with the traffic lights for the top panes. */
const TITLE_BAR = 36

/**
 * A pane's title bar, inside its card: its front tab's mark, name and folder (a strip of its tabs,
 * each a `PaneTab`, when it holds several), what plugins put at `tab.toolbar`, and — on the focused
 * pane, or while the mouse is over it — split right, split down, float, zoom and close. With the
 * view's only pane, float and zoom are dimmed and do nothing, and close is dimmed (it closes the
 * view). The bar drags its tab; a double click zooms; a right click opens the front tab's menu.
 */
function PaneTitle({ pane: id, tabs, active, focused, zoomed, over, menu }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean; over?: boolean; menu(e: { x?: number; y?: number }): void }) {
  const t = useTheme()
  const C = useComponents()
  const strip = usePaneTabs()
  const front = active ?? tabs[0]
  const info = useTab(front)
  const { status } = useTabMeta(front)
  const tree = useLayout(info?.view_id)
  const draggable = useDraggable<Carried>({ kind: "pumi.tab", tab: front ?? "" })
  const toolbar = useMemo(() => ({ tab: front }), [front])
  if (!info || !front) return null
  const split = !!tree && "axis" in tree
  const alone = !split && tabs.length <= 1
  const zoomable = zoomed || split
  const open = (side: "right" | "down") => call(via(id, "tab.open"), null, {}, { kind: "tiled", pane: id, split: side }).catch(swallow)
  const zoom = () => call(via(id, "pane.update"), id, { zoom: !zoomed }).catch(swallow)
  const float = () => call(via(front, "tab.update"), front, { place: { kind: "float", view: info.view_id } }).catch(swallow)
  const buttons = (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
      <PaneButton icon="split_columns" title={tip("Split Right", "split_vertical")} onClick={() => open("right")} />
      <PaneButton icon="split_rows" title={tip("Split Down", "split_horizontal")} onClick={() => open("down")} />
      <PaneButton icon="float" title="Float" off={alone} onClick={float} />
      <PaneButton icon={zoomed ? "minimize" : "maximize"} title={tip(zoomed ? "Restore the Layout" : "Fill the View", "zoom")} off={!zoomable} onClick={zoom} />
      <PaneButton icon="close" title={tip("Close Pane", "close_pane")} color={alone ? t["deno.paneButtonOff"] : undefined} onClick={() => call(via(id, "pane.close"), id).catch(swallow)} />
    </div>
  )
  const shown = focused || !!over
  if (strip && tabs.length > 1) {
    return (
      <div
        onAuxClick={(e: any) => {
          stop(e)
          menu(e)
        }}
        style={{ display: "flex", flexDirection: "row", alignItems: "stretch", height: TITLE_BAR, flexShrink: 0, userSelect: "none" }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0, flexShrink: 1, overflowX: "scroll", paddingLeft: 6, paddingRight: 4 }}>
          {tabs.map((tab, index) => (
            <C.PaneTab key={tab} tab={tab} pane={id} index={index} active={tab === front} focused={focused} />
          ))}
        </div>
        <StripEnd pane={id} tabs={tabs} />
        {shown ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0, paddingRight: 6 }}>
            <SlotRow slot="tab.toolbar" args={toolbar} gap={4} />
            {buttons}
          </div>
        ) : null}
      </div>
    )
  }
  const title = tabTitle(info)
  const where = tabWhere(info, title)
  const loud = status && URGENCY.includes(status) ? t[`status.${status}`] : undefined
  return (
    <div
      {...draggable.props}
      onDoubleClick={() => zoomable && zoom()}
      onAuxClick={(e: any) => {
        stop(e)
        menu(e)
      }}
      title={info.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        height: TITLE_BAR,
        flexShrink: 0,
        paddingLeft: 12,
        paddingRight: 6,
        userSelect: "none",
        opacity: draggable.dragging ? 0.55 : 1,
        cursor: draggable.dragging ? "grabbing" : "default",
      }}
    >
      <TabMark tab={front} size={14} color={loud ?? (focused ? t["deno.title"] : t["deno.titleDim"])} />
      <text style={{ fontSize: 13, color: focused ? t["deno.title"] : t["deno.titleDim"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
      {where ? <text style={{ fontSize: 13, color: t["deno.titleDim"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 2, minWidth: 0 }}>{where}</text> : null}
      <div style={{ flexGrow: 1 }} />
      <SlotRow slot="tab.toolbar" args={toolbar} gap={4} />
      {shown ? buttons : null}
    </div>
  )
}

/** A pane without a title bar: a button to fill the view (or give it back) at its corner, while the mouse is over it. */
function ZoomButton({ pane: id, view, zoomed, over }: { pane: string; view?: string; zoomed: boolean; over: boolean }) {
  const t = useTheme()
  const tree = useLayout(view)
  const [onIt, setOnIt] = useState(false)
  if (!view || !(zoomed || (tree && "axis" in tree)) || !(over || onIt)) return null
  const title = zoomed ? "Restore the Layout" : "Fill the View"
  return (
    <div
      aria-label={title}
      title={tip(title, "zoom")}
      onMouseEnter={() => setOnIt(true)}
      onMouseLeave={() => setOnIt(false)}
      onClick={() => {
        setOnIt(false)
        call(via(id, "pane.update"), id, { zoom: !zoomed }).catch(swallow)
      }}
      style={{ position: "absolute", top: 6, right: 6, display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 7, backgroundColor: t.surface, borderWidth: 1, borderColor: t["deno.pillRim"], color: t.muted, cursor: "pointer", opacity: onIt ? 1 : 0.8, hover: { backgroundColor: t.hover, color: t.text } }}
    >
      <Icon name={zoomed ? "minimize" : "maximize"} size={12} />
    </div>
  )
}

/** Whether a snapshot's tab runs on the core's terminal engine (the core sets `tab_pid` on those). */
const runsTerminal = (tab: TabInfo | undefined) => typeof tab?.options?.tab_pid === "number"

/**
 * A pane: a card a shade off the sheet, with a dark rim and a light bevel just inside it, its title
 * bar on top and its front tab's body under it (`TabBody`, the app's). While Settings outlines the
 * focused pane (and its view has others), the focused card's rim is the accent. A float's frame is
 * the app's (it draws this inside it), so a float is drawn bare.
 */
function Pane({ pane: id, tabs, active, focused, zoomed }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean; lifted?: boolean }) {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const front = active ?? tabs[0] ?? ""
  // A closed tab is still drawn while its pane shrinks away: as what it was, not as a terminal.
  const live = useTab(front)
  const last = useRef(live)
  if (live) last.current = live
  const tab = live ?? last.current
  const [over, setOver] = useState(false)
  const [titles] = usePaneTitles()
  const strip = usePaneTabs()
  const [outline] = useOutlineFocused()
  const followMouse = useFocusOnHover(live ? front : undefined, focused)
  const tree = useLayout(tab?.view_id)
  const toolbar = useSlot("tab.toolbar")
  const { open, menu } = useMenu("tab.menu", { tab: front })
  const stripArgs = useMemo(() => ({ tab: front }), [front])
  const floating = (tab?.place as { kind?: string } | undefined)?.kind === "float"
  // A pane of several tabs shows its strip whatever the setting: it is the way to its other tabs.
  const titled = !!live && !floating && (titles || (strip && tabs.length > 1))
  const outlined = outline && focused && !!live && !floating && !!tree && "axis" in tree
  // A terminal gets room from the card's edge; a plugin's block pads its own.
  const terminal = runsTerminal(tab)
  const card = !floating
  return (
    <div
      onMouseDown={() => {
        if (!focused && live) call(via(front, "tab.focus"), front).catch(swallow)
      }}
      onAuxClick={open}
      onMouseEnter={() => {
        setOver(true)
        followMouse()
      }}
      onMouseLeave={() => setOver(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        position: "relative",
        userSelect: "contain",
        ...(card ? { borderRadius: m.radius, borderWidth: 1, borderColor: outlined ? t["deno.rimFocused"] : t["deno.rim"], backgroundColor: t["deno.card"] } : {}),
      }}
    >
      {titled ? (
        <C.PaneTitle pane={id} tabs={tabs} active={front} focused={focused} zoomed={zoomed} over={over} menu={open} />
      ) : toolbar.components.length || toolbar.actions.length ? (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", height: 28, flexShrink: 0, paddingRight: 6 }}>
          <SlotRow slot="tab.toolbar" args={stripArgs} gap={4} />
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, position: "relative", ...(terminal && card ? { paddingLeft: 10, paddingRight: 4, paddingBottom: 6, paddingTop: titled ? 2 : 10 } : {}) }}>
        {/* Keyed by the tab: another tab's body is drawn as itself, not as this one's. */}
        <C.TabBody key={front} tab={front} focused={focused} />
        {titled || floating || !front ? null : <ZoomButton pane={id} view={tab?.view_id} zoomed={zoomed} over={over} />}
      </div>
      {/* The bevel: a hair of light just inside the rim, over everything the card holds. */}
      {card ? <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: Math.max(m.radius - 1, 0), borderWidth: 1, borderColor: t["deno.bevel"], pointerEvents: "none" }} /> : null}
      {menu}
    </div>
  )
}

// ── Before the server answers ──────────────────────────────────────────────────────────────────

function Starting({ title, detail, gaveUp, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 8, color: t.text, backgroundColor: t.window }}>
      {title ? <text style={{ fontSize: 15, fontWeight: 600, color: gaveUp ? t.error : t.text }}>{title}</text> : null}
      {detail ? <text style={{ fontSize: 12, color: t.muted, maxWidth: 520 }}>{detail}</text> : null}
      {lines.length ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: t["deno.card"], borderWidth: 1, borderColor: t["deno.rim"], maxWidth: 620 }}>
          {lines.map((line, i) => (
            <text key={i} style={{ fontSize: 11, color: t.faint, fontFamily: "Menlo" }}>
              {line}
            </text>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The parts Deno draws. The app's own draw the rest, in Deno's colours: the layout of a view's
 * panes (`Layout`, `Split`, `Splitter`), a tab's body (`TabBody`), a float's frame (`Float`), the
 * menus and dialogs.
 */
export const DENO: Partial<Components> = {
  Window,
  Starting,
  Pane,
  PaneTitle,
  PaneTab,
  IconButton,
}
