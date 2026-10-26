// P3's window, after T3 Code. Flat and quiet: the side bar is a shade lighter than the panes, with
// the traffic lights and the wordmark on top, a search row (the command palette) with a new
// session and a new tab beside it, then every tab of every session as a thread — its project's
// tag and name, its title, what is in it — and at its foot the settings, each plugin's `panel`,
// and what plugins put in the status bar. Over the panes is a breadcrumb (project / thread) with
// the window's buttons; the panes sit edge to edge in the app's own layout (`Layout`, `Split`:
// its splits, its edges that drag, its zoom, its floats), a hairline between them.
// Its menus are the app's actions (`useMenu`) drawn in this theme's `Menu`, its questions in its
// `Dialog`. Started from P-Rex's window (which started from the app's default): the behaviour is
// the default's wherever a theme can reach it, the look is this file's.
import { createContext, Fragment, memo, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, motion, useDraggable, useDragState, useDroppable, useMetrics, useTheme } from "pumi"
import {
  call,
  commands,
  grouped,
  num,
  renderView,
  run,
  serverOf,
  shortcut,
  useAgentOf,
  useApp,
  useComponents,
  useDock,
  useDockPanels,
  Dock,
  viewKey,
  type DockPanels,
  useFocusedPane,
  useLayout,
  useLocal,
  useMenu,
  usePane,
  usePaneTitles,
  useRename,
  useSession,
  useSessions,
  useSlot,
  useTab,
  useTabs,
  useWindow,
  via,
  type ActionItem,
  type Components,
  type DialogProps,
  type IconButtonProps,
  type MenuProps,
  type Pane as PaneInfo,
  type RenameInput,
} from "pumi/theme"

type Tokens = ReturnType<typeof useTheme>

const swallow = (err: unknown) => console.error(String(err))
const stop = (e: any) => e?.stopPropagation?.()

// ── Icons ──────────────────────────────────────────────────────────────────────────────────────

/** The theme's own glyphs, by path; each is drawn in the colour it is given, as the app's are. */
const OWN = new Set(["eye", "eye_off", "command", "globe", "list_circle", "edit", "folder_plus", "chart"])
const own = (name: string) => `${import.meta.dir}/icons/${name}.svg`

/** One of the theme's glyphs, or else one of the app's. */
const Glyph = memo(function Glyph({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  if (!OWN.has(name)) return <Icon name={name} size={size} color={color} />
  return <svg src={own(name)} style={{ width: size, height: size, flexShrink: 0, ...(color ? { color } : {}) }} />
})

// ── What the window keeps ──────────────────────────────────────────────────────────────────────

/** The order sessions were dragged into, in the default theme's list: kept to, not changed. */
const SESSION_ORDER = "default.agents.order"
const NONE: string[] = []

/** The commands a plugin of the user's may have: the palette's toggle, the browser's new tab. */
const PALETTE = "amresyd.palette.toggle"
const BROWSER = "amresyd.browser.openTab"

/** Whether a command exists now: a plugin's comes and goes with its plugin. */
function useHasCommand(name: string): boolean {
  return useSyncExternalStore(commands.subscribe, () => commands.commands().some((c) => c.name === name))
}

/** A tooltip: what it does, and its keys. */
const tip = (title: string, command?: string) => {
  const keys = command ? shortcut(command) : undefined
  return keys ? `${title}  ${keys}` : title
}

/** Shows a session's tab (and a pane of it) in `window`. */
function goTo(window: ReturnType<typeof useWindow>, session: string, tab?: string, pane?: string) {
  if (window.session !== session) window.show(session)
  const tabbed = tab ? call(via(tab, "tab.focus"), tab) : Promise.resolve()
  tabbed.then(() => pane && call(via(pane, "pane.focus"), pane)).catch(swallow)
}

// ── Names ──────────────────────────────────────────────────────────────────────────────────────

type PaneLike = Pick<PaneInfo, "block" | "label" | "terminal_title" | "cwd" | "agent">

/** A pane by what it shows: an agent by its title first, then its name, its title, its folder, its type. */
function paneTitle(p: PaneLike): string {
  const dir = p.cwd ? p.cwd.replace(/\/+$/, "").split("/").pop() : undefined
  if (p.agent) return p.terminal_title || p.label || p.agent
  return p.label || p.terminal_title || dir || p.block
}

/** A tab's name: the one it was given, or else its focused pane's. */
const tabTitle = (named: string | null | undefined, p: PaneLike | undefined) => (named && !/^\d+$/.test(named) ? named : p ? paneTitle(p) : "New thread")

/** A worktree's folder name (`avid-storm`). */
const shortName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path

/** A project's tag: its name's initials, as T3 Code marks a workspace (`workspace` → `WE`). */
function initials(label: string): string {
  const words = label.split(/[\s\-_./]+/).filter(Boolean)
  const tag = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? label).slice(0, 2)
  return tag.toUpperCase()
}

/** The most urgent first: what a row says of the agents in it. */
const URGENCY = ["error", "blocked", "working", "done", "idle", "unknown"]

function lead(statuses: string[]): string | undefined {
  let best: string | undefined
  for (const s of statuses) {
    const status = s || "unknown"
    if (URGENCY.indexOf(status) >= 0 && (best === undefined || URGENCY.indexOf(status) < URGENCY.indexOf(best))) best = status
  }
  return best
}

/** A pane's glyph: an agent's spark, a terminal's prompt, a page's globe. */
function glyphOf(p: Pick<PaneInfo, "block" | "agent"> | undefined): string {
  if (!p) return "terminal"
  if (p.agent) return p.agent.toLowerCase().includes("codex") ? "zap" : "sparkle"
  if (p.block === "terminal") return "terminal"
  if (p.block === "file") return "code"
  if (p.block === "image" || p.block.endsWith(".image")) return "image"
  if (p.block === "browser" || p.block.endsWith(".page")) return "globe"
  if (p.block === "files" || p.block.endsWith(".files")) return "folder"
  return "blocks"
}

/** What a status is called on a thread. */
const STATUS_WORD: Record<string, string> = { working: "Working", blocked: "Needs input", error: "Error", done: "Done" }

// ── Small parts ────────────────────────────────────────────────────────────────────────────────

/** A project's tag: its initials on a small chip; a session without a name gets a dashed box. */
const ProjectTag = memo(function ProjectTag({ label }: { label?: string | null }) {
  const t = useTheme()
  if (!label) return <div style={{ width: 13, height: 12, flexShrink: 0, borderRadius: 3, borderWidth: 1, borderStyle: "dashed", borderColor: t["p3.tagNone"] }} />
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 13, minWidth: 15, flexShrink: 0, paddingLeft: 2, paddingRight: 2, borderRadius: 3, backgroundColor: t["p3.tag"] }}>
      <text style={{ fontSize: 7, fontWeight: 800, color: t["p3.tagText"], whiteSpace: "nowrap" }}>{initials(label)}</text>
    </div>
  )
})

/** An agent's state, as a dot: a slow pulse while it works. */
const StatusDot = memo(function StatusDot({ status }: { status: string }) {
  const t = useTheme()
  const style = { width: 6, height: 6, borderRadius: 6, flexShrink: 0, backgroundColor: t[`agent.${status}`] ?? t["agent.unknown"] } as const
  if (status !== "working") return <div style={style} />
  // A few steps a second: each one draws the window again.
  return <motion.div animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", fps: 12 }} style={style} />
})

/** A button of the window's own (the side bar's top and foot, the breadcrumb's end). */
function BarButton({ icon, title, command, active, size = 15, onClick }: { icon: string; title: string; command?: string; active?: boolean; size?: number; onClick(): void }) {
  const t = useTheme()
  return (
    <div
      onClick={(e: any) => {
        stop(e)
        onClick()
      }}
      onDoubleClick={stop}
      aria-label={title}
      aria-pressed={active}
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
        color: active ? t.text : t.faint,
        backgroundColor: active ? t.active : undefined,
        hover: { backgroundColor: t.hover, color: t.text },
        active: { backgroundColor: t.active },
      }}
    >
      <Glyph name={icon} size={size} />
    </div>
  )
}

/** A small button on a row; its click is its own, not the row's. */
function RowButton({ icon, title, onClick }: { icon: string; title: string; onClick(e: any): void }) {
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
      style={{ display: "flex", width: 20, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 5, color: t.faint, cursor: "pointer", hover: { backgroundColor: t.active, color: t.text } }}
    >
      <Glyph name={icon} size={12} />
    </div>
  )
}

/** A name being edited in place (`useRename`'s field). */
function RenameField({ input }: { input: RenameInput }) {
  const t = useTheme()
  return <input {...input} style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: t.text, paddingLeft: 4, paddingRight: 4, borderRadius: 5, borderWidth: 1, borderColor: t.accent, backgroundColor: t.editor }} />
}

/** A slot's views, given `args`, and its actions as buttons, in a row. */
const SlotRow = memo(function SlotRow({ slot, args, gap = 2 }: { slot: string; args?: Record<string, unknown>; gap?: number }) {
  const C = useComponents()
  const { views, actions } = useSlot(slot)
  if (!views.length && !actions.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap, flexShrink: 0 }}>
      {views.map((v) => renderView(v, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
    </div>
  )
})

// ── The window ─────────────────────────────────────────────────────────────────────────────────

/**
 * The window: the threads' dock on the left (the window's own side bar, ⌘B), the breadcrumb and
 * the panes in the middle, the surfaces' dock on the right (⌘⌥B). The docks are the theme's
 * `docks`: the app keeps whether each shows and how wide the user dragged it.
 */
function Window() {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const sidebar = useDock("sidebar")
  const overlays = useSlot("window.overlay").views
  const handle = { hover: { backgroundColor: t.border } }
  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100%", height: "100%", position: "relative", color: t.text, fontSize: m.fontSize, backgroundColor: t.editor }}>
      <Dock name="sidebar" edge="left" handle={handle} style={{ backgroundColor: t["p3.sidebar"], borderRightWidth: 1, borderColor: t["p3.sidebarEdge"] }}>
        <SidebarHeader />
        <SearchRow />
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
          <SessionHeaderSlot />
          <Threads />
        </div>
        <SidebarFooter />
      </Dock>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
        <Breadcrumb sidebar={sidebar.open} />
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
          <C.Layout />
        </div>
      </div>
      <Dock name="surfaces" edge="right" handle={handle} style={{ backgroundColor: t.editor, borderLeftWidth: 1, borderColor: t.border }}>
        <Surfaces />
      </Dock>
      <DragGhost />
      {overlays.map((v) => (
        <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
          {renderView(v)}
        </div>
      ))}
    </div>
  )
}

/** The window's top row's height and where its buttons start: past the traffic lights, centred on them. */
function useTitleRow() {
  const window = useWindow()
  const lights = window.trafficLights
  return {
    height: lights ? Math.max(44, Math.round(lights.y * 2 + lights.height)) : 44,
    inset: lights ? lights.x + lights.width + 14 : 12,
  }
}

/** What plugins put in the title bar (`window.titlebar`): their buttons beside the window's. */
function TitlebarSlot() {
  const C = useComponents()
  const { views, actions } = useSlot("window.titlebar")
  if (!views.length && !actions.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
      {views.map((v) => renderView(v))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} />
      ))}
    </div>
  )
}

/**
 * Over the panes: the project's tag and name, a slash, the thread (the front tab); at the far end
 * what plugins put in the title bar, the panes' title bars shown or not, a split, and the
 * surfaces' dock. With the side bar hidden it starts past the traffic lights, with the button
 * that shows it.
 */
function Breadcrumb({ sidebar }: { sidebar: boolean }) {
  const t = useTheme()
  const window = useWindow()
  const { height, inset } = useTitleRow()
  const session = useSession()
  const tab = useTab()
  const focused = useFocusedPane(tab?.tab_id)
  const pane = usePane(focused)
  const [titles, setTitles] = usePaneTitles()
  const surfaces = useDock("surfaces")
  return (
    <div cache style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height, flexShrink: 0, paddingLeft: sidebar ? 18 : inset, paddingRight: 10, appRegion: "drag" }}>
      {sidebar ? null : <BarButton icon="layout_sidebar_left" title="Show Threads" command="toggle_sidebar" onClick={() => run("toggle_sidebar", window.id)} />}
      {session ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 }}>
          <ProjectTag label={session.label} />
          <text style={{ fontSize: 13, color: t.muted, whiteSpace: "nowrap", flexShrink: 0 }}>{session.label || session.workspace_id}</text>
          <text style={{ fontSize: 13, color: t.faint, flexShrink: 0, paddingLeft: 4, paddingRight: 4 }}>/</text>
          <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{tabTitle(tab?.label, pane)}</text>
        </div>
      ) : null}
      <div style={{ flexGrow: 1 }} />
      <TitlebarSlot />
      <BarButton icon={titles ? "eye" : "eye_off"} title={titles ? "Hide pane titles" : "Show pane titles"} command="toggle_pane_titles" active={!titles} onClick={() => setTitles((v) => !v)} />
      <BarButton icon="split" title="Split Right" command="split_vertical" onClick={() => run("split_vertical", window.id)} />
      <BarButton icon="layout_sidebar_right" title={surfaces.open ? `Hide ${surfaces.title}` : `Show ${surfaces.title}`} command={surfaces.command} active={surfaces.open} onClick={surfaces.toggle} />
    </div>
  )
}

// ── The side bar ───────────────────────────────────────────────────────────────────────────────

/** The side bar's top: the traffic lights' room, the button that hides it, the wordmark. */
function SidebarHeader() {
  const t = useTheme()
  const window = useWindow()
  const { height, inset } = useTitleRow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height, flexShrink: 0, paddingLeft: inset, paddingRight: 10, appRegion: "drag" }}>
      <BarButton icon="layout_sidebar_left" title="Hide Threads" command="toggle_sidebar" onClick={() => run("toggle_sidebar", window.id)} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 4, flexShrink: 0 }}>
        <text style={{ fontSize: 14, fontWeight: 700, color: t.text }}>P3</text>
        <text style={{ fontSize: 14, color: t.muted }}>Code</text>
      </div>
    </div>
  )
}

/** Search (the command palette, when it is installed), a new session and a new tab. */
function SearchRow() {
  const t = useTheme()
  const window = useWindow()
  const palette = useHasCommand(PALETTE)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height: 36, flexShrink: 0, marginBottom: 6, paddingLeft: 10, paddingRight: 10 }}>
      <div
        onClick={() => palette && run(PALETTE, window.id)}
        title={palette ? tip("Search", PALETTE) : undefined}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 28, flexGrow: 1, minWidth: 0, paddingLeft: 8, borderRadius: 6, cursor: palette ? "pointer" : "default", ...(palette ? { hover: { backgroundColor: t.hover } } : {}) }}
      >
        <Glyph name="magnifying_glass" size={14} color={t.faint} />
        <text style={{ fontSize: 13, color: t.muted }}>Search</text>
      </div>
      <BarButton icon="folder_plus" title="New Session" command="new_workspace" onClick={() => run("new_workspace", window.id)} />
      <BarButton icon="edit" title="New Thread" command="new_tab" onClick={() => run("new_tab", window.id)} />
    </div>
  )
}

/** What plugins put over the session's threads (`session.header`), given the window's session. */
function SessionHeaderSlot() {
  const C = useComponents()
  const session = useSession()
  const { views, actions } = useSlot("session.header")
  const args = useMemo(() => ({ session: session?.workspace_id }), [session?.workspace_id])
  if (!session || (!views.length && !actions.length)) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 30, flexShrink: 0, paddingLeft: 16, paddingRight: 8 }}>
      {views.map((v) => renderView(v, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
    </div>
  )
}

/** The side bar's foot: the settings, and on the right what plugins put in the status bar. */
function SidebarFooter() {
  const window = useWindow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 44, flexShrink: 0, paddingLeft: 10, paddingRight: 10 }}>
      <BarButton icon="settings" title="Settings" command="settings" onClick={() => run("settings", window.id)} />
      <div style={{ flexGrow: 1, minWidth: 4 }} />
      <SlotRow slot="status" />
    </div>
  )
}

// ── The surfaces ───────────────────────────────────────────────────────────────────────────────

/**
 * The right dock, as T3 Code's: with nothing in front, "Open a surface" — a page, a terminal
 * beside the focused pane, and every plugin's `panel` view (the dock's `panels: ["*"]`); with one
 * in front, that view under a bar whose arrow goes back to the list.
 */
function Surfaces() {
  const t = useTheme()
  const { height } = useTitleRow()
  const dock = useDock("surfaces")
  const panels = useDockPanels("surfaces")
  const { shown } = panels
  return (
    <>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height, flexShrink: 0, paddingLeft: 10, paddingRight: 10, appRegion: "drag" }}>
        {shown ? <BarButton icon="arrow_left" title="All Surfaces" onClick={panels.hide} /> : null}
        {shown ? <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{shown.title ?? shown.id}</text> : null}
        <div style={{ flexGrow: 1 }} />
        <BarButton icon="close" title={`Hide ${dock.title}`} command={dock.command} onClick={dock.toggle} />
      </div>
      {shown ? (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingLeft: 6, paddingRight: 6 }}>{renderView(shown)}</div>
      ) : (
        <SurfaceList panels={panels} />
      )}
    </>
  )
}

/** A surface the list offers: its glyph, its name, its keys, what opens it. */
interface Surface {
  key: string
  icon: string
  title: string
  command?: string
  open(): void
}

/** "Open a surface": the things the dock can show, each a row with its keys in a chip. */
function SurfaceList({ panels }: { panels: DockPanels }) {
  const t = useTheme()
  const window = useWindow()
  const browser = useHasCommand(BROWSER)
  const surfaces: Surface[] = [
    ...(browser ? [{ key: "browser", icon: "globe", title: "Browser", command: BROWSER, open: () => run(BROWSER, window.id) }] : []),
    { key: "terminal", icon: "terminal", title: "Terminal", command: "split_vertical", open: () => run("split_vertical", window.id) },
    ...panels.views.map((v) => ({ key: viewKey(v), icon: v.icon ?? "blocks", title: v.title ?? v.id, open: () => panels.show(v) })),
  ]
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, minHeight: 0, paddingLeft: 24, paddingRight: 24, paddingBottom: 44 }}>
      <text style={{ fontSize: 14, fontWeight: 500, color: t.text, marginBottom: 14 }}>Open a surface</text>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", maxWidth: 340 }}>
        {surfaces.map((s) => (
          <SurfaceRow key={s.key} surface={s} />
        ))}
      </div>
    </div>
  )
}

function SurfaceRow({ surface: s }: { surface: Surface }) {
  const t = useTheme()
  const keys = s.command ? shortcut(s.command) : undefined
  return (
    <div
      onClick={s.open}
      aria-label={s.title}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: 34, flexShrink: 0, paddingLeft: 8, paddingRight: 6, borderRadius: 7, cursor: "pointer", hover: { backgroundColor: t.hover } }}
    >
      <Glyph name={s.icon} size={15} color={t.muted} />
      <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{s.title}</text>
      <div style={{ flexGrow: 1, minWidth: 12 }} />
      {keys ? <Keys keys={keys} /> : null}
    </div>
  )
}

// ── The threads ────────────────────────────────────────────────────────────────────────────────

/** Every session's tabs, one list: in the order the default theme's list was dragged into. */
function Threads() {
  const t = useTheme()
  const sessions = useSessions()
  const [order] = useLocal<string[]>(SESSION_ORDER, NONE)
  if (!sessions.length) return <text style={{ paddingLeft: 18, paddingTop: 8, fontSize: 12, color: t.faint }}>No threads</text>
  const rank = (id: string) => (order.indexOf(id) < 0 ? order.length : order.indexOf(id))
  const sorted = sessions.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.workspace_id) - rank(b.s.workspace_id) || a.i - b.i).map(({ s }) => s)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 8 }}>
      {sorted.map((s) => (
        <SessionThreads key={s.workspace_id} session={s.workspace_id} label={s.label} />
      ))}
    </div>
  )
}

/** A session's tabs, each a thread under the session's name. */
const SessionThreads = memo(function SessionThreads({ session: id, label }: { session: string; label: string }) {
  const window = useWindow()
  const session = useSession(id)
  const tabs = useTabs(id)
  const sorted = useMemo(() => [...tabs].sort((a, b) => a.number - b.number), [tabs])
  const current = window.session === id
  const server = serverOf(id)
  const project = server ? `${label || id} · ${server}` : label
  return (
    <>
      {sorted.map((tab) => (
        <ThreadRow key={tab.tab_id} tab={tab.tab_id} session={id} project={project} label={tab.label} worktree={tab.worktree} front={current && session?.active_tab_id === tab.tab_id} />
      ))}
    </>
  )
})

const NO_PANES: PaneInfo[] = []

/**
 * A tab, as a thread: its project's tag and name, and an agent's state, on top; its title; what is
 * in it (each pane's glyph) at the foot, with its worktree. The front tab of the window's session
 * is lit. A click goes to it, a double click renames it, a right click (or the `…` on hover) opens
 * its menu: the tab's, its focused pane's, its session's. It drags (onto a pane, to join that
 * tab), and a pane dropped on it moves into it.
 */
const ThreadRow = memo(function ThreadRow({ tab: id, session, project, label: named, worktree, front }: { tab: string; session: string; project: string; label: string | null; worktree?: string; front: boolean }) {
  const t = useTheme()
  const C = useComponents()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const focused = useFocusedPane(id)
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === id && (p.place as { kind?: string } | undefined)?.kind !== "float") ?? NO_PANES)
  const p = panes.find((x) => x.pane_id === focused) ?? panes[0]
  const status = lead(panes.filter((x) => x.agent).map((x) => x.agent_status))
  const label = tabTitle(named, p)
  const loud = status === "done" || status === "blocked" || status === "error"
  const { renaming, start, input } = useRename({ tab: id }, label)
  const { open, show, menu, shown } = useMenu(["tab.menu", "tab.actions", "pane.menu", "session.menu"], { tab: id, pane: p?.pane_id, session })
  const draggable = useDraggable({ kind: "pumi.tab", tab: id }, { disabled: renaming })
  const drop = useDroppable<{ kind: "pumi.pane"; pane: string }>({
    accept: (data: any): data is { kind: "pumi.pane"; pane: string } => data?.kind === "pumi.pane" && typeof data.pane === "string" && !panes.some((x) => x.pane_id === data.pane) && serverOf(data.pane) === serverOf(id),
    onDrop: (data) => call(via(data.pane, "pane.update"), data.pane, { place: { kind: "tiled", tab: id } }).catch(swallow),
  })
  const controls = useSlot("agent.controls")
  const agent = !!p?.agent
  const word = status ? STATUS_WORD[status] : undefined
  const glyphs = [...new Set(panes.map((x) => glyphOf(x)))].slice(0, 4)
  const lit = drop.isOver ? t.active : front ? t.selected : undefined
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
        title={p?.cwd ?? undefined}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flexShrink: 0,
          marginLeft: 8,
          marginRight: 8,
          paddingTop: 9,
          paddingBottom: 7,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: 8,
          backgroundColor: lit,
          cursor: "pointer",
          userSelect: "none",
          opacity: draggable.dragging ? 0.5 : 1,
          hover: { backgroundColor: lit ?? t.hover },
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 16, minWidth: 0 }}>
          <ProjectTag label={project} />
          <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{project || "No project"}</text>
          <div style={{ flexGrow: 1 }} />
          {(hovered || shown) && !renaming ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0 }}>
              {agent && controls.actions.length + controls.views.length > 0 ? <C.AgentControls pane={p!.pane_id} /> : null}
              <RowButton icon="ellipsis" title="More" onClick={show} />
            </div>
          ) : word && status ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 }}>
              <StatusDot status={status} />
              <text style={{ fontSize: 11, color: t[`agent.${status}`] ?? t.faint, whiteSpace: "nowrap" }}>{word}</text>
            </div>
          ) : null}
        </div>
        {input ? (
          <RenameField input={input} />
        ) : (
          <text style={{ fontSize: 13, fontWeight: loud ? 600 : 400, color: front || loud ? t.text : t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{label}</text>
        )}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 16, minWidth: 0 }}>
          {worktree ? (
            <div title={worktree} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1, minWidth: 0 }}>
              <Icon name="git_worktree" size={11} color={t.faint} />
              <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{shortName(worktree)}</text>
            </div>
          ) : null}
          <div style={{ flexGrow: 1 }} />
          {agent ? <SlotRow slot="agent.footer" args={{ pane: p!.pane_id }} /> : null}
          {glyphs.map((g) => (
            <Glyph key={g} name={g} size={12} color={t.faint} />
          ))}
        </div>
      </div>
      {menu}
    </>
  )
})

/** An agent's actions (`agent.controls`), given the agent: on its thread while hovered. */
function AgentControls({ pane }: { pane: string }) {
  const args = useMemo(() => ({ pane }), [pane])
  return <SlotRow slot="agent.controls" args={args} />
}

/** What a pane or tab drag carries, by the mouse: its glyph and its name. */
function DragGhost() {
  const t = useTheme()
  const drag = useDragState()
  const it = drag?.data as { kind?: string; pane?: string; tab?: string } | undefined
  const snapshot = useApp((s) => (it?.kind === "pumi.pane" || it?.kind === "pumi.tab" ? s.snapshot : undefined))
  if (!drag || !snapshot || !it) return null
  let p: PaneInfo | undefined
  let label: string | undefined
  if (it.kind === "pumi.pane") {
    p = snapshot.panes.find((x) => x.pane_id === it.pane)
    label = p && paneTitle(p)
  } else {
    const tab = snapshot.tabs.find((x) => x.tab_id === it.tab)
    const focused = snapshot.layouts.find((l) => l.tab_id === it.tab)?.focused_pane_id
    p = snapshot.panes.find((x) => x.pane_id === focused) ?? snapshot.panes.find((x) => x.tab_id === it.tab)
    label = tabTitle(tab?.label, p)
  }
  if (!label) return null
  return (
    <anchored position={{ x: drag.x + 14, y: drag.y + 10 }} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 30, paddingLeft: 10, paddingRight: 12, borderRadius: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, pointerEvents: "none", boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: t["p3.shadow"] } }}>
        <Glyph name={glyphOf(p)} size={13} color={t.muted} />
        <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap" }}>{label}</text>
      </div>
    </anchored>
  )
}

// ── Menus ──────────────────────────────────────────────────────────────────────────────────────

/** A menu's card, and a submenu's: the composer's surface, rounded, a hairline round it. */
function menuCard(t: Tokens) {
  return { display: "flex", flexDirection: "column", minWidth: 220, paddingTop: 5, paddingBottom: 5, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 28, spreadRadius: 0, color: t["p3.shadow"] } } as const
}

/** How long a submenu stays once the mouse leaves it and its row: time to cross to it at a slant. */
const SUBMENU_GRACE = 200

/** Which of a card's submenus is open, as the default's menus keep it. */
interface MenuState {
  sub?: string
  enter(sub?: string): void
  leave(): void
  over(inside: boolean): void
  inSub(): boolean
}

const MenuContext = createContext<MenuState | undefined>(undefined)

function useMenuState(parent?: MenuState): MenuState {
  const [sub, setSub] = useState<string | undefined>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inside = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  return useMemo(() => {
    const later = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setSub(undefined), SUBMENU_GRACE)
    }
    return {
      sub,
      enter(next) {
        clearTimeout(timer.current)
        if (next) setSub(next)
        else if (sub) later()
      },
      leave: later,
      over(now) {
        inside.current = now
        if (now) clearTimeout(timer.current)
        else later()
        parent?.over(now)
      },
      inSub: () => inside.current,
    }
  }, [sub, parent])
}

/** The `Menu` part: every menu of the app's, where the mouse is. A press outside it closes it. */
function Menu({ at, actions, views, args, close }: MenuProps) {
  const t = useTheme()
  const state = useMenuState()
  return (
    <anchored position={at} fit="snap" snapMargin={8} deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <MenuContext.Provider value={state}>
        <div onMouseDownOutside={() => state.inSub() || close()} style={menuCard(t)}>
          <MenuRows actions={actions} close={close} />
          {views?.length && actions.length ? <MenuRule /> : null}
          {views?.map((v) => renderView(v, { ...args, close }))}
        </div>
      </MenuContext.Provider>
    </anchored>
  )
}

/** Actions as rows, in their groups; one with `items` opens a submenu beside it. */
function MenuRows({ actions, close }: { actions: ActionItem[]; close(): void }) {
  return (
    <>
      {grouped(actions).map((group, i) => (
        <Fragment key={`${i}:${group[0]!.group ?? ""}`}>
          {i > 0 ? <MenuRule /> : null}
          {group.map((a) =>
            a.items ? (
              <SubMenu key={`${a.plugin}/${a.id}`} title={a.title} icon={a.icon}>
                <MenuRows actions={a.items} close={close} />
              </SubMenu>
            ) : (
              <MenuItem key={`${a.plugin}/${a.id}`} title={a.title} icon={a.icon} keys={a.keys} checked={a.checked} danger={a.danger} disabled={a.disabled} onClick={() => (close(), a.run())} />
            ),
          )}
        </Fragment>
      ))}
    </>
  )
}

/** A row that opens a card of `children` beside it, on hover or on a click. */
function SubMenu({ title, icon, children }: { title: string; icon?: string; children: ReactNode }) {
  const t = useTheme()
  const menu = useContext(MenuContext)
  const mine = useMenuState(menu)
  const open = menu?.sub === title
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }}>
      <MenuItem title={title} icon={icon} more active={open} onEnter={() => menu?.enter(title)} onLeave={() => menu?.leave()} onClick={() => menu?.enter(title)} />
      {open ? (
        <anchored side="right" align="start" gap={6} offset={{ x: 0, y: -6 }} fit="snap" snapMargin={8} deferred occlude priority={2} style={{ backgroundColor: "transparent" }}>
          <MenuContext.Provider value={mine}>
            <div onMouseEnter={() => menu?.over(true)} onMouseLeave={() => menu?.over(false)} style={menuCard(t)}>
              {children}
            </div>
          </MenuContext.Provider>
        </anchored>
      ) : null}
    </div>
  )
}

/** A key's chip, as T3 Code shows a surface's shortcut. */
function Keys({ keys }: { keys: string }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 18, minWidth: 18, flexShrink: 0, paddingLeft: 5, paddingRight: 5, borderRadius: 4, backgroundColor: t["p3.kbd"] }}>
      <text style={{ fontSize: 11, color: t["p3.kbdText"], whiteSpace: "nowrap" }}>{keys}</text>
    </div>
  )
}

/** A menu's row: its icon and title, and at the far end its keys, a check, or a submenu's chevron. */
function MenuItem({ title, icon, keys, checked, danger, disabled, more, active, onEnter, onLeave, onClick }: { title: string; icon?: string; keys?: string; checked?: boolean; danger?: boolean; disabled?: boolean; more?: boolean; active?: boolean; onEnter?(): void; onLeave?(): void; onClick(): void }) {
  const t = useTheme()
  const menu = useContext(MenuContext)
  const color = danger ? t.error : t.text
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => (onEnter ? onEnter() : menu?.enter())}
      onMouseLeave={onLeave}
      aria-disabled={disabled}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 9, height: 28, flexShrink: 0, marginLeft: 5, marginRight: 5, paddingLeft: 8, paddingRight: 6, borderRadius: 6, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, ...(active ? { backgroundColor: t.hover } : {}), ...(disabled ? {} : { hover: { backgroundColor: t.hover } }) }}
    >
      {icon ? <Glyph name={icon} size={14} color={danger ? t.error : t.muted} /> : null}
      <text style={{ fontSize: 13, color, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
      {keys || checked !== undefined || more ? <div style={{ flexGrow: 1, minWidth: 16 }} /> : null}
      {keys ? <Keys keys={keys} /> : null}
      {checked ? <Icon name="check" size={12} color={t.accent} /> : null}
      {more ? <Icon name="chevron_right" size={12} color={t.faint} /> : null}
    </div>
  )
}

/** A line between a menu's groups. */
function MenuRule() {
  const t = useTheme()
  return <div style={{ height: 1, flexShrink: 0, marginTop: 5, marginBottom: 5, marginLeft: 10, marginRight: 10, backgroundColor: t.border }} />
}

/**
 * The `Dialog` part: a question in the middle of the window, over everything. Escape, a press
 * outside it or Cancel gives up; Enter goes ahead.
 */
function Dialog({ title, detail, confirm: yes, cancel, danger, input, onConfirm, onCancel }: DialogProps) {
  const t = useTheme()
  return (
    <anchored fill="window" occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", padding: 20 }}>
        <div
          autoFocus={!input}
          tabIndex={0}
          onMouseDownOutside={onCancel}
          onKeyDown={(e: any) => {
            if (e.key === "escape") {
              e.preventDefault?.()
              onCancel()
            } else if (e.key === "enter" && !input) {
              e.preventDefault?.()
              onConfirm()
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 380, padding: 18, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, keyboardFocusDim: false, boxShadow: { offsetX: 0, offsetY: 14, blurRadius: 36, spreadRadius: 0, color: t["p3.shadow"] } }}
        >
          <text style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{title}</text>
          {detail ? <text style={{ fontSize: 12, color: t.muted }}>{detail}</text> : null}
          {input ? (
            <input
              autoFocus
              value={input.value}
              placeholder={input.placeholder}
              onChange={(e: any) => input.onChange(e.value ?? "")}
              onSubmit={onConfirm}
              onKeyDown={(e) => {
                if (e.key !== "escape") return
                e.preventDefault()
                e.stopPropagation()
                onCancel()
              }}
              style={{ height: 30, fontSize: 13, color: t.text, paddingLeft: 10, paddingRight: 10, borderRadius: 8, borderWidth: 1, borderColor: t.border, backgroundColor: t.editor }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <DialogButton title={cancel} onClick={onCancel} />
            <DialogButton title={yes} fill={danger ? t.error : t.accent} text={danger ? "#ffffff" : t.accentText} onClick={onConfirm} />
          </div>
        </div>
      </div>
    </anchored>
  )
}

function DialogButton({ title, fill, text, onClick }: { title: string; fill?: string; text?: string; onClick(): void }) {
  const t = useTheme()
  return (
    <div
      aria-label={title}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e: any) => {
        if (e.key !== "enter" && e.key !== " ") return
        e.preventDefault?.()
        onClick()
      }}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", height: 28, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderRadius: 14, cursor: "pointer", backgroundColor: fill ?? t.active, keyboardFocusDim: false, hover: { backgroundColor: fill ?? t.hover, opacity: fill ? 0.9 : 1 } }}
    >
      <text style={{ fontSize: 12, fontWeight: 500, color: text ?? t.text, whiteSpace: "nowrap" }}>{title}</text>
    </div>
  )
}

// ── A pane ─────────────────────────────────────────────────────────────────────────────────────

/** The window's small button (`IconButton`): a pane's split and close, a plugin's toolbar buttons. */
function IconButton({ icon, onClick, title, active, color }: IconButtonProps) {
  const t = useTheme()
  return (
    <div
      onClick={(e: any) => {
        // The press is the button's, not the title bar's (which selects and drags its pane).
        e?.stopPropagation?.()
        onClick()
      }}
      onMouseDown={stop}
      onDoubleClick={stop}
      aria-label={title}
      aria-pressed={active}
      title={title}
      style={{
        display: "flex",
        width: 22,
        height: 22,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 5,
        color: color ?? (active ? t.text : t.faint),
        cursor: "pointer",
        hover: { backgroundColor: t.hover, color: t.text },
        active: { backgroundColor: t.active },
      }}
    >
      <Glyph name={icon} size={13} />
    </div>
  )
}

/** One contributed action, as a button. */
function Action({ action, args }: { action: ActionItem; args?: unknown }) {
  const C = useComponents()
  return <C.IconButton icon={action.icon ?? "ellipsis"} title={action.title} onClick={() => action.run(args)} />
}

/**
 * A pane's title bar, flat on the pane: its glyph and name (lit while it is focused), what plugins
 * put at `pane.toolbar`, and — on the focused pane, or while the mouse is over it — a split right
 * and down, a zoom and a close. It drags the pane; a double click zooms it; a right click opens
 * its menu.
 */
function PaneTitle({ pane: id, focused, zoomed, over, menu }: { pane: string; focused: boolean; zoomed: boolean; over: boolean; menu(e: any): void }) {
  const t = useTheme()
  const C = useComponents()
  const p = usePane(id)
  const agent = useAgentOf(id)
  const tree = useLayout(p?.tab_id)
  const draggable = useDraggable({ kind: "pumi.pane", pane: id })
  const toolbar = useMemo(() => ({ pane: id }), [id])
  if (!p) return null
  const zoomable = zoomed || (!!tree && "axis" in tree)
  const split = (side: "right" | "down") => call(via(id, "pane.open"), "terminal", {}, { beside: num(id), split: side }).catch(swallow)
  const zoom = () => call(via(id, "pane.update"), id, { zoom: !zoomed }).catch(swallow)
  const status = agent?.agent_status || "unknown"
  const busy = !!agent && status !== "idle" && status !== "unknown"
  return (
    <div
      {...draggable.props}
      onDoubleClick={() => zoomable && zoom()}
      onAuxClick={(e: any) => {
        stop(e)
        menu(e)
      }}
      title={p.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        height: 30,
        flexShrink: 0,
        paddingLeft: 14,
        paddingRight: 8,
        userSelect: "none",
        opacity: draggable.dragging ? 0.55 : 1,
        cursor: draggable.dragging ? "grabbing" : "default",
      }}
    >
      {busy ? <StatusDot status={status} /> : <Glyph name={glyphOf(p)} size={13} color={focused ? t.muted : t.faint} />}
      <text style={{ fontSize: 12, color: focused ? t.text : t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{paneTitle(p)}</text>
      <div style={{ flexGrow: 1 }} />
      <SlotRow slot="pane.toolbar" args={toolbar} gap={4} />
      {focused || over ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <C.IconButton icon="split" title={tip("Split Right", "split_vertical")} onClick={() => split("right")} />
          <C.IconButton icon="split_down" title={tip("Split Down", "split_horizontal")} onClick={() => split("down")} />
          {zoomable ? <C.IconButton icon={zoomed ? "minimize" : "maximize"} title={tip(zoomed ? "Restore the Layout" : "Fill the Tab", "zoom")} onClick={zoom} /> : null}
          <C.IconButton icon="close" title={tip("Close Pane", "close_pane")} onClick={() => call(via(id, "pane.close"), num(id)).catch(swallow)} />
        </div>
      ) : null}
    </div>
  )
}

/** A pane without a title bar: a button to fill the tab, or give it back its layout, while hovered. */
function ZoomButton({ pane: id, zoomed, over }: { pane: string; zoomed: boolean; over: boolean }) {
  const t = useTheme()
  const pane = usePane(id)
  const tree = useLayout(pane?.tab_id)
  // The button covers the pane, so the pane is not under the mouse while the button is.
  const [onIt, setOnIt] = useState(false)
  if (!pane || !(zoomed || (tree && "axis" in tree)) || !(over || onIt)) return null
  const title = zoomed ? "Restore the Layout" : "Fill the Tab"
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
      style={{ position: "absolute", top: 6, right: 6, display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, color: t.muted, cursor: "pointer", opacity: onIt ? 1 : 0.8, hover: { backgroundColor: t.hover, color: t.text } }}
    >
      <Icon name={zoomed ? "minimize" : "maximize"} size={12} />
    </div>
  )
}

/**
 * A pane: flat on the window, no frame of its own (the layout draws a hairline where two touch),
 * its title bar on top while titles show, its body as the app draws it (`PaneBody`). A float's
 * frame is the app's, so a float is drawn bare.
 */
function Pane({ pane: id, focused, zoomed }: { pane: string; focused: boolean; zoomed: boolean; lifted?: boolean }) {
  const t = useTheme()
  const C = useComponents()
  // A closed pane is still drawn while it shrinks away: as what it was, not as a terminal.
  const live = usePane(id)
  const last = useRef(live)
  if (live) last.current = live
  const pane = live ?? last.current
  const [over, setOver] = useState(false)
  const [titles] = usePaneTitles()
  const toolbar = useSlot("pane.toolbar")
  const { open, menu } = useMenu("pane.menu", { pane: id })
  const stripArgs = useMemo(() => ({ pane: id }), [id])
  const floating = (pane?.place as { kind?: string } | undefined)?.kind === "float"
  const titled = titles && !!live && !floating
  const terminal = pane?.block === "terminal"
  return (
    <div
      onMouseDown={() => {
        if (!focused) call(via(id, "pane.focus"), id).catch(swallow)
      }}
      onAuxClick={open}
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "hidden", ...(floating ? {} : { backgroundColor: t.editor }) }}
    >
      {titled ? (
        <PaneTitle pane={id} focused={focused} zoomed={zoomed} over={over} menu={open} />
      ) : toolbar.views.length || toolbar.actions.length ? (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", height: 28, flexShrink: 0, paddingRight: 6 }}>
          <SlotRow slot="pane.toolbar" args={stripArgs} gap={4} />
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, position: "relative", ...(terminal && !floating ? { paddingLeft: 12, paddingRight: 4, paddingBottom: 6, paddingTop: titled ? 0 : 6 } : {}) }}>
        <C.PaneBody pane={id} focused={focused} />
        {titled || floating ? null : <ZoomButton pane={id} zoomed={zoomed} over={over} />}
      </div>
      {menu}
    </div>
  )
}

// ── Before the server answers ──────────────────────────────────────────────────────────────────

function Starting({ title, detail, gaveUp, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 10, color: t.text, backgroundColor: t.editor }}>
      <text style={{ fontSize: 24, color: gaveUp ? t.error : t.text }}>{title || "What should we build?"}</text>
      {detail ? <text style={{ fontSize: 13, color: t.muted, maxWidth: 520 }}>{detail}</text> : null}
      {lines.length ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, maxWidth: 620 }}>
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
 * The parts P3 draws. The app's own draw the rest: the layout of a tab's panes (`Layout`, `Split`,
 * `Splitter`), a pane's body (`PaneBody`) and a float's frame (`Float`), each with this theme's
 * `Pane` in it. There is no tab bar or status bar: the tabs are the side bar's threads, and what
 * plugins put in the status bar sits at the side bar's foot.
 */
export const P3: Partial<Components> = {
  Window,
  Starting,
  Pane,
  AgentControls,
  Action,
  Menu,
  Dialog,
  IconButton,
}
