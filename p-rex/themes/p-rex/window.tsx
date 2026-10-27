// P-Rex's window, in the terminals' own colours (`theme.tsx` makes every token from their palette)
// and a little see-through: the whole window is one sheet of the terminals' background at the
// theme's Background opacity, the side bar has no fill of its own, with the traffic lights and the
// window's buttons on top, the sessions and their views as a list (each view on its front tab's
// tile), and at its foot a menu of the side bar's views (the list, and every `panel` a plugin
// contributes). With the side bar hidden the views run across the top instead. The panes are
// Comfortable (each a card of its own, its tabs' strip inside, room round it) or Compact (edge to
// edge, a line between), as the theme's Pane style says; either way they sit in the app's own
// layout (`Layout` and `Split` are the app's: its splits, its edges that drag, its zoom, its
// floats). A pane holds its tabs in a strip along its bar (`PaneTitle`, each a `PaneTab`), the one
// in front opening into its body (`TabBody`); a tab drags along its strip, into another pane's, or
// onto a side of a pane for one of its own. The window's preferences in Settings → Appearance
// (pane title bars, the focused pane's outline, focus following the mouse, the side bar's swipe,
// the tab icons per view) are drawn here too. Its menus are the app's actions (`useMenu`: a tab's
// Open With, Move To, Split…; a view's and a session's Rename, Close…) drawn in this theme's
// `Menu`, and its questions in its `Dialog`. Started from the app's default window
// (runtime/app/app/theme/default.tsx): the behaviour is the default's wherever a theme can reach
// it, the look is this file's.
import { createContext, Fragment, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, motion, useDraggable, useDragState, useMetrics, useTheme } from "pumi"
import {
  call,
  carried,
  commands,
  grouped,
  leafOf,
  renderComponent,
  rowDrop,
  run,
  runMove,
  serverOf,
  shortcut,
  stripDrop,
  useAgentOf,
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
  type ActionItem,
  type Carried,
  type ComponentItem,
  type Components,
  type DialogProps,
  type IconButtonProps,
  type MenuProps,
  type PaneLeaf,
  type RenameInput,
  type Row,
  type Tab as TabInfo,
} from "pumi/theme"

type Tokens = ReturnType<typeof useTheme>

const swallow = (err: unknown) => console.error(String(err))
const stop = (e: any) => e?.stopPropagation?.()

// ── Icons ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The theme's own glyphs, by path (a theme is loaded from disk, and the module loader hands an
 * SVG back without a default export). Like the app's, each is drawn in the colour it is given.
 */
const OWN = new Set(["laptop", "laptop_plus", "globe", "list_circle"])
const own = (name: string) => `${import.meta.dir}/icons/${name}.svg`

/** One of the theme's glyphs, or else one of the app's. */
const Glyph = memo(function Glyph({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  if (!OWN.has(name)) return <Icon name={name} size={size} color={color} />
  return <svg src={own(name)} style={{ width: size, height: size, flexShrink: 0, ...(color ? { color } : {}) }} />
})

// ── What the window keeps ──────────────────────────────────────────────────────────────────────

/** How wide the side bar is, and which of its views shows (whether it shows is the app's: `useSidebar`). */
const SIDEBAR_WIDTH = "p-rex.sidebar.width"
const SIDEBAR_VIEW = "p-rex.sidebar.view"
/** The list's view: the sessions and their views. */
const LIST_VIEW = "list"
/** The sessions folded away in the list. */
const FOLDED = "p-rex.sessions.folded"
/** The order sessions were dragged into, in the default theme's list: kept to, not changed. */
const SESSION_ORDER = "default.agents.order"
const NONE: string[] = []

/** The command a plugin of the user's may have: the browser's new tab. */
const BROWSER = "pumi.browser.openTab"

/** Whether a command exists now: a plugin's comes and goes with its plugin. */
function useHasCommand(name: string): boolean {
  return useSyncExternalStore(commands.subscribe, () => commands.commands().some((c) => c.name === name))
}

/** A tooltip: what it does, and its keys. */
const tip = (title: string, command?: string) => {
  const keys = command ? shortcut(command) : undefined
  return keys ? `${title}  ${keys}` : title
}

/** Shows a session's view (and a tab of it) in `window`. */
function goTo(window: ReturnType<typeof useWindow>, session: string, view?: string, tab?: string) {
  if (window.session !== session) window.show(session)
  const viewed = view ? call(via(view, "view.focus"), view) : Promise.resolve()
  viewed.then(() => tab && call(via(tab, "tab.focus"), tab)).catch(swallow)
}

// ── Names and tiles ────────────────────────────────────────────────────────────────────────────

type TabLike = Pick<TabInfo, "block" | "label" | "terminal_title" | "cwd" | "agent">

/** A tab by what it holds: an agent by its title first, then its name, its title, its folder, its block. */
function tabTitle(t: TabLike): string {
  const dir = t.cwd ? t.cwd.replace(/\/+$/, "").split("/").pop() : undefined
  if (t.agent) return t.terminal_title || t.label || t.agent || t.block
  return t.label || t.terminal_title || dir || t.block
}

/** A worktree's folder name (`avid-storm`). */
const shortName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path

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

/** A mark on a tile: an app glyph, or a letter drawn in it (a terminal's prompt, an agent's own mark). */
type Mark = { icon: string } | { text: string; mono?: boolean }

/** The tile a tab is shown on: its colour, the colour of its mark, and the mark itself. */
interface Look {
  color: string
  ink: string
  mark: Mark
}

/** The mark of an agent, by what it says it is: `π` for pi, else its app glyph. */
function agentMark(agent: string): Mark {
  const name = agent.toLowerCase()
  if (name === "pi" || name.startsWith("pi-") || name.includes("π")) return { text: "π" }
  if (name.includes("claude")) return { text: "✳" }
  if (name.includes("codex")) return { text: "◆" }
  if (name.includes("cursor")) return { text: "▲" }
  return { icon: "sparkle" }
}

/** The tile a tab is shown on: an agent's mark on cream, a terminal's green prompt, a page's globe. */
function tileOf(t: Pick<TabLike, "block" | "agent"> | undefined, tokens: Tokens): Look {
  const terminal: Look = { color: tokens["rex.tile.terminal"], ink: tokens["rex.tile.terminal.ink"], mark: { text: ">_", mono: true } }
  const on = (color: string, mark: Mark): Look => ({ color, ink: tokens["rex.tile.ink"], mark })
  if (!t) return terminal
  if (t.agent) return on(tokens["rex.tile.agent"], agentMark(t.agent))
  if (t.block === "terminal") return terminal
  if (t.block === "file") return on(tokens["rex.tile.file"], { icon: "code" })
  if (t.block === "image" || t.block.endsWith(".image")) return on(tokens["rex.tile.image"], { icon: "image" })
  if (t.block === "browser" || t.block.endsWith(".page")) return on(tokens["rex.tile.browser"], { icon: "globe" })
  if (t.block === "files" || t.block.endsWith(".files")) return on(tokens["rex.tile.file"], { icon: "folder" })
  return on(tokens["rex.tile.plugin"], { icon: "blocks" })
}

/** A tab's mark without its tile: its strip's, and its menu's. */
function markOf(t: Pick<TabLike, "block" | "agent">): Mark {
  return tileOf(t, {} as Tokens).mark
}

/** A mark as it is drawn: an app glyph, or a letter (`>_`, `π`) in the tile's ink. */
const MarkGlyph = memo(function MarkGlyph({ mark, size, color }: { mark: Mark; size: number; color: string }) {
  if ("icon" in mark) return <Glyph name={mark.icon} size={size} color={color} />
  const letter = mark.text.length > 1
  return (
    <text
      style={{
        fontSize: Math.round(size * (letter ? 0.72 : 0.95)),
        fontWeight: letter ? 500 : 600,
        lineHeight: size,
        color,
        fontFamily: mark.mono ? "Menlo" : undefined,
      }}
    >
      {mark.text}
    </text>
  )
})

/**
 * A program's tile: a rounded square in its colour with its mark, a hair of shadow under it, and —
 * for a view of several tabs — a deck: the cards behind it, each peeking above the one in front, as
 * many as Settings' "Tab icons per view" says. An agent's state is a dot in the corner (a pulse
 * while it works); what wants a look (done, blocked, error) shows, and an idle agent has none.
 */
const Tile = memo(function Tile({ look, status, size = 20, stack = 1 }: { look: Look; status?: string; size?: number; stack?: number }) {
  const t = useTheme()
  const dot = status && status !== "idle" && status !== "unknown" ? (t[`agent.${status}`] ?? t["agent.unknown"]) : undefined
  const depth = Math.min(Math.max(stack, 1), 3) - 1
  const step = Math.max(2, Math.round(size * 0.16))
  const radius = Math.round(size * 0.3)
  const height = size + depth * step
  return (
    <div style={{ position: "relative", width: size, height, flexShrink: 0 }}>
      {/* The deck, back to front: each card a shade darker than the one before, a step higher and
          a hair narrower, so each shows as a line above the front one. */}
      {Array.from({ length: depth }, (_, i) => {
        const back = depth - i
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: back,
              width: size - back * 2,
              top: (depth - back) * step,
              height: size,
              borderRadius: radius,
              backgroundColor: mixHex(look.color, t["rex.tile.ink"], 0.12 + back * 0.05),
              // A ring of the glass: the dark line between one card and the next.
              borderWidth: 1,
              borderColor: t["rex.glass"],
            }}
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
          backgroundColor: look.color,
          borderWidth: 1,
          borderColor: t["rex.tile.rim"],
          boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 3, spreadRadius: 0, color: t["rex.tile.shadow"] },
        }}
      >
        <MarkGlyph mark={look.mark} size={Math.round(size * 0.62)} color={look.ink} />
      </div>
      {dot ? (
        status === "working" ? (
          <motion.div
            animate={{ opacity: [1, 0.35, 1] }}
            // A few steps a second: each one draws the window again.
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", fps: 12 }}
            style={dotStyle(dot, t)}
          />
        ) : (
          <div style={dotStyle(dot, t)} />
        )
      ) : null}
    </div>
  )
})

function dotStyle(color: string, t: Tokens) {
  return { position: "absolute", right: -2, bottom: -2, width: 7, height: 7, borderRadius: 7, borderWidth: 1.5, borderColor: t["rex.dotRing"], backgroundColor: color } as const
}

// ── The glass ──────────────────────────────────────────────────────────────────────────────────

/**
 * A view's tile: its focused tab's mark, with the most urgent agent's state of all its tabs, and a
 * deck behind it for its other tabs — as many cards as Settings' "Tab icons per view" says (none
 * at 0, one for a view of one tab).
 */
const ViewTiles = memo(function ViewTiles({ tabs, focused, size }: { tabs: TabInfo[]; focused?: TabInfo; size: number }) {
  const t = useTheme()
  const [most] = useViewIcons()
  if (most <= 0) return null
  const stack = Math.min(tabs.length, most)
  return <Tile look={tileOf(focused ?? tabs[0], t)} status={lead(tabs.filter((x) => x.agent).map((x) => x.agent_status))} size={size} stack={stack} />
})

/** `from` taken `by` (0–1) of the way to `to`, as `#rrggbb`: for a card behind another, a shade darker. */
function mixHex(from: string, to: string, by: number): string {
  const of = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))
  if (!/^#[0-9a-f]{6}$/i.test(from) || !/^#[0-9a-f]{6}$/i.test(to)) return from
  const [a, b] = [of(from), of(to)]
  return `#${a.map((v, i) => Math.round(v! + (b[i]! - v!) * by).toString(16).padStart(2, "0")).join("")}`
}

/** `#rrggbb` at `opacity` (0–1), as `#rrggbbaa`; opaque at 1. */
function withAlpha(color: string, opacity: number): string {
  if (opacity >= 1 || !/^#[0-9a-f]{6}$/i.test(color)) return color
  return `${color}${Math.round(Math.max(opacity, 0) * 255).toString(16).padStart(2, "0")}`
}

/** The window's sheet: the terminals' background at the theme's Background opacity. */
function useGlass(): string {
  const t = useTheme()
  const given = Number(useThemeOption("opacity", 88))
  const opacity = Number.isFinite(given) ? Math.min(Math.max(given, 0), 100) / 100 : 0.88
  return withAlpha(t["rex.glass"], opacity)
}

/** Whether the panes are Compact (edge to edge, a line between) rather than Comfortable (cards). */
function useCompact(): boolean {
  return useThemeOption<string>("pane_style", "comfortable") === "compact"
}

// ── The window ─────────────────────────────────────────────────────────────────────────────────

function Window() {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const glass = useGlass()
  const compact = useCompact()
  const [sidebar] = useSidebar()
  const [width, setWidth] = useLocal(SIDEBAR_WIDTH, 240)
  const overlays = useSlot("window.overlay").components
  // Comfortable, the cards have a gutter of glass round the window's edge (between them it is the
  // layout's, `layout.gap`); Compact, the panes run to the edges.
  const gutter = compact ? 0 : 8
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", color: t.text, fontSize: m.fontSize, backgroundColor: glass }}>
      {sidebar ? null : <TopBar />}
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        {sidebar ? <Sidebar width={width} setWidth={setWidth} /> : null}
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, paddingTop: sidebar ? gutter : 0, paddingRight: gutter, paddingBottom: gutter, paddingLeft: sidebar ? 0 : gutter }}>
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

/** The window's top row's height and where its buttons start: past the traffic lights, centred on them. */
function useTitleRow() {
  const window = useWindow()
  const lights = window.trafficLights
  return {
    height: lights ? Math.max(40, Math.round(lights.y * 2 + lights.height)) : 40,
    inset: lights ? lights.x + lights.width + 12 : 12,
    // Where a button sits to stand under the red light (the side bar's foot).
    under: lights ? Math.max(4, Math.round(lights.x + lights.height / 2 - 12)) : 8,
  }
}

/** A button of the window's own (the side bar's top and foot): a glyph, its tooltip, a hover. */
function BarButton({ icon, title, command, active, onPress, onClick }: { icon: string; title: string; command?: string; active?: boolean; onPress?(): void; onClick(): void }) {
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
      aria-pressed={active}
      title={tip(title, command)}
      style={{
        display: "flex",
        width: 24,
        height: 24,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        cursor: "pointer",
        color: t["rex.chrome"],
        backgroundColor: active ? t.selected : undefined,
        hover: { backgroundColor: t.hover, color: t.text },
        active: { backgroundColor: t.active },
      }}
    >
      <Glyph name={icon} size={16} />
    </div>
  )
}

/** The window's button: a new view. (Pane title bars and the command palette are the menu's and their keys'.) */
function WindowButtons() {
  const window = useWindow()
  return (
    <>
      <BarButton icon="plus" title="New View" command="new_view" onClick={() => run("new_view", window.id)} />
    </>
  )
}

/** The side bar's top: the traffic lights' room, the side bar's button, and the window's. */
function SidebarHeader() {
  const window = useWindow()
  const { height, inset } = useTitleRow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height, flexShrink: 0, paddingLeft: inset, paddingRight: 8, appRegion: "drag" }}>
      <BarButton icon="layout_sidebar_left" title="Hide Sidebar" command="toggle_sidebar" onClick={() => run("toggle_sidebar", window.id)} />
      <div style={{ flexGrow: 1 }} />
      <WindowButtons />
    </div>
  )
}

/**
 * With the side bar hidden: its button, the window's session's views across a track (each on its
 * front tab's tile, the front one a pill with a `…` that lists its tabs), and the window's buttons.
 */
function TopBar() {
  const t = useTheme()
  const window = useWindow()
  const compact = useCompact()
  const { height, inset } = useTitleRow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height, flexShrink: 0, paddingLeft: inset, paddingRight: 8, appRegion: "drag", ...(compact ? { borderBottomWidth: 1, borderColor: t["rex.divider"] } : {}) }}>
      <BarButton icon="layout_sidebar_left" title="Show Sidebar" command="toggle_sidebar" onClick={() => run("toggle_sidebar", window.id)} />
      <ViewTrack />
      <div style={{ flexGrow: 1, minWidth: 8 }} />
      <WindowButtons />
    </div>
  )
}

/** The window's session's views, by number, on a track: a thin rule between two that are not in front. */
function ViewTrack() {
  const t = useTheme()
  const session = useSession()
  const id = session?.workspace_id
  const views = useViews(id)
  const sorted = useMemo(() => [...views].sort((a, b) => a.number - b.number), [views])
  const front = session?.active_view_id
  if (!id || !sorted.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 30, flexShrink: 1, minWidth: 0, marginLeft: 8, paddingLeft: 2, paddingRight: 2, borderRadius: 15, borderWidth: 1, borderColor: t["rex.trackRim"], backgroundColor: t["rex.track"], overflow: "hidden" }}>
      {sorted.map((view, i) => {
        const quiet = i > 0 && view.view_id !== front && sorted[i - 1]!.view_id !== front
        return (
          <Fragment key={view.view_id}>
            {i > 0 ? <div style={{ width: 1, height: 14, flexShrink: 0, marginLeft: 1, marginRight: 1, backgroundColor: quiet ? t["rex.pillRim"] : "#00000000" }} /> : null}
            <TopView view={view.view_id} session={id} label={view.label} front={view.view_id === front} />
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * A view across the top: its front tab's tile and its name; the front one a pill. A click goes to
 * it, a double click renames it, a right click opens its menu, and the `…` (always on the front
 * one, on the others while hovered) lists its tabs. It drags, and takes a tab dropped on it, as
 * its row in the side bar does.
 */
const TopView = memo(function TopView({ view: id, session, label: named, front }: { view: string; session: string; label: string | null; front: boolean }) {
  const t = useTheme()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const tabs = usePopover()
  const { tab, tabs: held, label, rename, menu, draggable, drop } = useViewItem(id, named, session)
  const { renaming, start, input } = rename
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexBasis: 180, flexShrink: 1, minWidth: 44, maxWidth: 220 }}>
      <div
        ref={drop.ref}
        {...(renaming ? {} : draggable.props)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => renaming || draggable.wasDragged() || goTo(window, session, id)}
        onDoubleClick={() => renaming || start()}
        onAuxClick={menu.open}
        title={tab?.cwd ?? undefined}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          height: 24,
          minWidth: 0,
          paddingLeft: 5,
          paddingRight: 3,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: drop.isOver ? t.accent : front ? t["rex.pillRim"] : "#00000000",
          backgroundColor: drop.isOver ? `${t.accent}26` : front ? t["rex.tabFront"] : undefined,
          cursor: "pointer",
          userSelect: "none",
          opacity: draggable.dragging ? 0.5 : 1,
          hover: { backgroundColor: drop.isOver ? `${t.accent}26` : front ? t["rex.tabFront"] : t.hover },
        }}
      >
        <ViewTiles tabs={held} focused={tab} size={16} />
        {input ? <RenameField input={input} /> : (
          <text style={{ fontSize: 13, fontWeight: front ? 500 : 400, color: front ? t.text : t["rex.row"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label}</text>
        )}
        <div style={{ flexGrow: 1 }} />
        {(front || hovered || tabs.open) && !renaming ? <RowButton icon="ellipsis" title="Tabs" size={20} onPress={tabs.press} onClick={tabs.toggle} /> : null}
      </div>
      {tabs.open ? <ViewTabs view={id} session={session} label={label} close={tabs.close} /> : null}
      {menu.menu}
    </div>
  )
})

const STATUS_LABEL: Record<string, string> = { working: "Working", blocked: "Needs you", done: "Done", error: "Error" }
const HOME = process.env.HOME ?? ""
/** A folder as a shell shows it: under the home folder, from `~`. */
const tilde = (path: string) => (HOME && (path === HOME || path.startsWith(`${HOME}/`)) ? `~${path.slice(HOME.length)}` : path)

/** A view's tabs, under its `…` across the top: each by its glyph, its title, what its agent says, its folder. */
function ViewTabs({ view, session, label, close }: { view: string; session: string; label: string; close(): void }) {
  const t = useTheme()
  const window = useWindow()
  const focused = useFocusedTab(view)
  const tabs = useApp((s) => s.snapshot?.tabs.filter((p) => p.view_id === view) ?? NO_TABS)
  return (
    <Popover side="bottom" width={280} close={close}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 26, flexShrink: 0, paddingLeft: 13, paddingRight: 13 }}>
        <text style={{ fontSize: 12, fontWeight: 600, color: t["rex.heading"], whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{label}</text>
      </div>
      {tabs.map((p) => {
        const status = p.agent ? p.agent_status : undefined
        const said = status ? STATUS_LABEL[status] : undefined
        const mine = p.tab_id === focused
        return (
          <div
            key={p.tab_id}
            onClick={() => {
              close()
              goTo(window, session, view, p.tab_id)
            }}
            title={p.cwd ?? undefined}
            style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0, marginLeft: 5, marginRight: 5, paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, borderRadius: 7, cursor: "pointer", backgroundColor: mine ? t.selected : undefined, hover: { backgroundColor: t.hover } }}
          >
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
              <MarkGlyph mark={markOf(p)} size={13} color={status && status !== "idle" && status !== "unknown" ? (t[`agent.${status}`] ?? t.text) : t.text} />
              <text style={{ fontSize: 13, fontWeight: 600, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{tabTitle(p)}</text>
              <div style={{ flexGrow: 1, minWidth: 8 }} />
              {said ? <text style={{ fontSize: 12, color: status === "working" ? t["agent.working"] : t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{said}</text> : null}
            </div>
            {p.cwd ? <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0, paddingLeft: 20 }}>{tilde(p.cwd)}</text> : null}
          </div>
        )
      })}
    </Popover>
  )
}

/**
 * A card that opens from a button (`press` on its mouse-down, `toggle` on its click): a press
 * outside it closes it, and a press on its own button while it is open does not open it again.
 */
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

/** The card `usePopover` opens, beside what holds it: a menu's card, above or below. */
function Popover({ side = "top", align = "start", width, close, children }: { side?: "top" | "bottom"; align?: "start" | "end"; width?: number; close(): void; children: ReactNode }) {
  const t = useTheme()
  return (
    <anchored side={side} align={align} gap={6} fit="snap" snapMargin={8} deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <div onMouseDownOutside={close} style={{ ...menuCard(t), ...(width ? { width } : {}) }}>
        {children}
      </div>
    </anchored>
  )
}

// ── The side bar ───────────────────────────────────────────────────────────────────────────────

const viewKey = (v: ComponentItem) => `${v.plugin}/${v.id}`

/**
 * The side bar: its top, the view shown (the tabs, or a plugin's panel), and its foot. A plugin's
 * panel is the same `panel` the default theme stacks in its side bar; here each is a view of its
 * own, picked at the foot.
 */
function Sidebar({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const t = useTheme()
  const panels = useSlot("panel").components
  const [view] = useLocal<string>(SIDEBAR_VIEW, LIST_VIEW)
  const shown = panels.find((v) => viewKey(v) === view)
  const [, setOpen] = useSidebar()
  // Two fingers swept left over it hide it (Settings → Appearance), and Compact draws its edge.
  const swipe = useSidebarSwipe(() => setOpen(false))
  const compact = useCompact()
  return (
    <div cache onScroll={swipe} style={{ display: "flex", flexDirection: "column", width, flexShrink: 0, minWidth: 0, position: "relative", ...(compact ? { borderRightWidth: 1, borderColor: t["rex.divider"], backgroundColor: t["rex.sidebar"] } : {}) }}>
      <SidebarHeader />
      {shown ? (
        <>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 26, flexShrink: 0, paddingLeft: 14, paddingRight: 10 }}>
            <text style={{ fontSize: 12, fontWeight: 600, color: t["rex.heading"], whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{shown.title ?? shown.id}</text>
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

/** What plugins put over the session's views (`session.header`), given the window's session. */
function SessionHeaderSlot() {
  const C = useComponents()
  const session = useSession()
  const { components, actions } = useSlot("session.header")
  const args = useMemo(() => ({ session: session?.workspace_id }), [session?.workspace_id])
  if (!session || (!components.length && !actions.length)) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 30, flexShrink: 0, paddingLeft: 12, paddingRight: 8 }}>
      {components.map((v) => renderComponent(v, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
    </div>
  )
}

/**
 * The side bar's foot: on the left, under the red light, a button whose menu picks the side bar's
 * view (the list, or a plugin's panel) or hides it; on the right, a new session and a page in a new
 * view.
 */
function SidebarFooter({ panels, shown }: { panels: ComponentItem[]; shown: string }) {
  const window = useWindow()
  const { under } = useTitleRow()
  const browser = useHasCommand(BROWSER)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height: 40, flexShrink: 0, paddingLeft: under, paddingRight: 8 }}>
      <ViewsButton panels={panels} shown={shown} />
      <div style={{ flexGrow: 1, minWidth: 4 }} />
      <BarButton icon="laptop_plus" title="New Session" command="new_workspace" onClick={() => run("new_workspace", window.id)} />
      {browser ? <BarButton icon="globe" title="Open a Page" command={BROWSER} onClick={() => run(BROWSER, window.id)} /> : null}
    </div>
  )
}

/** The side bar's views, as a menu: the list, each plugin's panel (the one shown checked), and a hide. */
function ViewsButton({ panels, shown }: { panels: ComponentItem[]; shown: string }) {
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
      <BarButton icon={current?.icon ?? "list_circle"} title={current ? `${current.title ?? current.id} — Views` : "Views"} active={menu.open} onPress={menu.press} onClick={menu.toggle} />
      {menu.open ? (
        <Popover close={menu.close}>
          <MenuItem icon="list_circle" title="Views" checked={shown === LIST_VIEW} onClick={() => pick(LIST_VIEW)} />
          {panels.map((v) => (
            <MenuItem key={viewKey(v)} icon={v.icon ?? "blocks"} title={v.title ?? v.id} checked={shown === viewKey(v)} onClick={() => pick(viewKey(v))} />
          ))}
          <MenuRule />
          <MenuItem
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

// ── The sessions and their tabs ────────────────────────────────────────────────────────────────

/**
 * Every session, its tabs under it: in the order the default theme's list was dragged into, and,
 * when any is on another machine, under the machine it is on.
 */
function Sessions() {
  const t = useTheme()
  const sessions = useSessions()
  const [order] = useLocal<string[]>(SESSION_ORDER, NONE)
  const [folded, setFolded] = useLocal<string[]>(FOLDED, NONE)
  const toggle = useCallback((id: string) => setFolded((now) => (now.includes(id) ? now.filter((k) => k !== id) : [...now, id])), [setFolded])
  if (!sessions.length) return <text style={{ paddingLeft: 14, paddingTop: 8, fontSize: 12, color: t.faint }}>No sessions</text>
  const rank = (id: string) => (order.indexOf(id) < 0 ? order.length : order.indexOf(id))
  const sorted = sessions.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.workspace_id) - rank(b.s.workspace_id) || a.i - b.i).map(({ s }) => s)
  // This machine's first, then each other's, as they come.
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

/** A machine's heading: this Mac, or a server sessions are on. */
function MachineHeading({ name }: { name: string }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 9, height: 34, flexShrink: 0, marginTop: 4, paddingLeft: 16, paddingRight: 10 }}>
      <Glyph name="laptop" size={16} color={t.muted} />
      <text style={{ fontSize: 13, fontWeight: 600, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{name}</text>
    </div>
  )
}

/** A session: its heading, and its views while it is not folded. */
const SessionGroup = memo(function SessionGroup({ session: id, label, folded, toggle }: { session: string; label: string; folded: boolean; toggle(id: string): void }) {
  const window = useWindow()
  const session = useSession(id)
  const views = useViews(id)
  const sorted = useMemo(() => [...views].sort((a, b) => a.number - b.number), [views])
  const current = window.session === id
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <SessionHeading session={id} label={label} folded={folded} toggle={toggle} views={sorted.length} />
      {folded
        ? null
        : sorted.map((view) => <ViewRow key={view.view_id} view={view.view_id} session={id} label={view.label} worktree={view.worktree} front={current && session?.active_view_id === view.view_id} />)}
    </div>
  )
})

/** A small button on a row; its click is its own, not the row's. */
function RowButton({ icon, title, size = 22, onPress, onClick }: { icon: string; title: string; size?: number; onPress?(): void; onClick(e: any): void }) {
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
      onMouseDown={(e: any) => {
        stop(e)
        onPress?.()
      }}
      style={{ display: "flex", width: size, height: size, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: size / 2, color: t.muted, cursor: "pointer", hover: { backgroundColor: t.active, color: t.text } }}
    >
      <Glyph name={icon} size={13} />
    </div>
  )
}

/** A name being edited in place (`useRename`'s field), as the list's rows draw it. */
function RenameField({ input }: { input: RenameInput }) {
  const t = useTheme()
  return <input {...input} style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: t.text, paddingLeft: 4, paddingRight: 4, borderRadius: 5, borderWidth: 1, borderColor: t.accent, backgroundColor: t.editor }} />
}

/**
 * A session's heading: its name, small and quiet. A click shows it; on hover a chevron folds it,
 * a `+` opens a view in it and a `…` its menu (a right click too: the app's `session.menu`, with a
 * fold of this list's). Folded, it says how many views it has and what its agents say.
 */
const SessionHeading = memo(function SessionHeading({ session: id, label, folded, toggle, views }: { session: string; label: string; folded: boolean; toggle(id: string): void; views: number }) {
  const t = useTheme()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const current = id === window.session
  const status = useApp((s) => (folded ? lead(s.snapshot?.tabs.filter((p) => p.workspace_id === id && p.agent).map((p) => p.agent_status) ?? []) : undefined))
  const { renaming, start, input } = useRename({ session: id }, label)
  const { open, show, menu, shown } = useMenu("session.menu", { session: id })
  const newView = () => {
    call(via(id, "tab.open"), "terminal", {}, { kind: "view", session: id })
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
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 26, flexShrink: 0, marginTop: 2, paddingLeft: 17, paddingRight: 12, cursor: "pointer", userSelect: "none" }}
      >
        {input ? <RenameField input={input} /> : (
          <text style={{ fontSize: 12, fontWeight: 600, color: current ? t.text : t["rex.heading"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label}</text>
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
            {status ? <div style={{ width: 7, height: 7, borderRadius: 7, flexShrink: 0, backgroundColor: t[`agent.${status}`] ?? t["agent.unknown"] }} /> : null}
            <text style={{ fontSize: 11, color: t.faint }}>{String(views)}</text>
          </>
        ) : null}
      </div>
      {menu}
    </>
  )
})

/**
 * What a view's row and its place across the top both know of it: its tabs, the one it shows (its
 * focused tab's tile, the most urgent agent's state), its name, and its rename, menu, drag and
 * drop. A tab dropped on the row joins the view; a view dropped on it goes beside it.
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
 * A view, as a row: its front tab's tile (an agent's state in the corner), its name, and the front
 * view of the window's session as a pill with its `…`. A click goes to it, a double click renames
 * it, a right click (or the `…`) opens its menu. It drags (beside another view), and a tab dropped
 * on it joins it.
 */
const ViewRow = memo(function ViewRow({ view: id, session, label: named, worktree, front }: { view: string; session: string; label: string | null; worktree?: string; front: boolean }) {
  const t = useTheme()
  const C = useComponents()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const { tab, tabs, label, rename, menu: viewMenu, draggable, drop } = useViewItem(id, named, session)
  const { renaming, start, input } = rename
  const { open, show, menu, shown } = viewMenu
  const agentArgs = useMemo(() => ({ tab: tab?.tab_id }), [tab?.tab_id])
  const controls = useSlot("agent.controls")
  const agent = !!tab?.agent
  const near = hovered || shown
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
          gap: 7,
          minHeight: 26,
          flexShrink: 0,
          marginLeft: 7,
          marginRight: 9,
          marginTop: 1,
          paddingLeft: 7,
          paddingRight: 3,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: drop.isOver ? t.accent : front ? t["rex.pillRim"] : "#00000000",
          backgroundColor: drop.isOver ? `${t.accent}26` : front ? t["rex.pill"] : undefined,
          cursor: "pointer",
          userSelect: "none",
          opacity: draggable.dragging ? 0.5 : 1,
          hover: { backgroundColor: drop.isOver ? `${t.accent}26` : front ? t["rex.pill"] : t.hover },
        }}
      >
        <ViewTiles tabs={tabs} focused={tab} size={17} />
        {input ? <RenameField input={input} /> : (
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, paddingTop: 2, paddingBottom: 2 }}>
            <text style={{ fontSize: 13, fontWeight: front ? 500 : 400, color: front ? t.text : t["rex.row"], whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</text>
            {worktree ? (
              <div title={worktree} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, minWidth: 0 }}>
                <Icon name="git_worktree" size={11} color={t.faint} />
                <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{shortName(worktree)}</text>
              </div>
            ) : null}
            {agent ? <SlotRow slot="agent.footer" args={agentArgs} /> : null}
          </div>
        )}
        {(near || front) && !renaming ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0 }}>
            {near && agent && controls.components.length + controls.actions.length > 0 ? <C.AgentControls tab={tab!.tab_id} /> : null}
            <RowButton icon="ellipsis" title="More" size={20} onClick={show} />
          </div>
        ) : null}
      </div>
      {menu}
    </>
  )
})

const NO_TABS: TabInfo[] = []

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

/** An agent's actions (`agent.controls`), given the agent's tab: on its view's row while hovered. */
function AgentControls({ tab }: { tab: string }) {
  const args = useMemo(() => ({ tab }), [tab])
  return <SlotRow slot="agent.controls" args={args} />
}

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
  const tile = tileOf(tab, t)
  return (
    <anchored position={{ x: drag.x + 14, y: drag.y + 10 }} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 8, paddingRight: 12, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t["rex.pillRim"], pointerEvents: "none", boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: t["rex.shadow"] } }}>
        <Tile look={tile} size={18} />
        <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap" }}>{label}</text>
      </div>
    </anchored>
  )
}

// ── Menus ──────────────────────────────────────────────────────────────────────────────────────

/** A menu's card, and a submenu's: the glass's surface, rounder than the default's. */
function menuCard(t: Tokens) {
  return { display: "flex", flexDirection: "column", minWidth: 210, paddingTop: 5, paddingBottom: 5, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t["rex.pillRim"], boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 28, spreadRadius: 0, color: t["rex.shadow"] } } as const
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

/**
 * The `Menu` part: every menu of the app's (a tab's, a view's, a session's), where the mouse is.
 * The actions in their groups with a rule between, a submenu for one with items, then the slot's
 * components. A press outside it (and its submenus) closes it.
 */
function Menu({ at, actions, components, args, close }: MenuProps) {
  const t = useTheme()
  const state = useMenuState()
  return (
    <anchored position={at} fit="snap" snapMargin={8} deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <MenuContext.Provider value={state}>
        <div onMouseDownOutside={() => state.inSub() || close()} style={menuCard(t)}>
          <MenuRows actions={actions} close={close} />
          {components?.length && actions.length ? <MenuRule /> : null}
          {components?.map((v) => renderComponent(v, { ...args, close }))}
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
              <SubMenu key={`${a.plugin}/${a.id}`} title={a.title}>
                <MenuRows actions={a.items} close={close} />
              </SubMenu>
            ) : (
              <MenuItem key={`${a.plugin}/${a.id}`} title={a.title} keys={a.keys} checked={a.checked} danger={a.danger} disabled={a.disabled} onClick={() => (close(), a.run())} />
            ),
          )}
        </Fragment>
      ))}
    </>
  )
}

/** A row that opens a card of `children` beside it, on hover or on a click. */
function SubMenu({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme()
  const menu = useContext(MenuContext)
  const mine = useMenuState(menu)
  const open = menu?.sub === title
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }}>
      <MenuItem title={title} more active={open} onEnter={() => menu?.enter(title)} onLeave={() => menu?.leave()} onClick={() => menu?.enter(title)} />
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

/** A menu's row: its glyph if it has one, its title, and at the far end its keys, a check, or a submenu's chevron. */
function MenuItem({ icon, title, keys, checked, danger, disabled, more, active, onEnter, onLeave, onClick }: { icon?: string; title: string; keys?: string; checked?: boolean; danger?: boolean; disabled?: boolean; more?: boolean; active?: boolean; onEnter?(): void; onLeave?(): void; onClick(): void }) {
  const t = useTheme()
  const menu = useContext(MenuContext)
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => (onEnter ? onEnter() : menu?.enter())}
      onMouseLeave={onLeave}
      aria-disabled={disabled}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 26, flexShrink: 0, marginLeft: 5, marginRight: 5, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, ...(active ? { backgroundColor: t.hover } : {}), ...(disabled ? {} : { hover: { backgroundColor: t.hover } }) }}
    >
      {icon ? <Glyph name={icon} size={14} color={danger ? t.error : t.muted} /> : null}
      <text style={{ fontSize: 13, color: danger ? t.error : t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
      {keys || checked !== undefined || more ? <div style={{ flexGrow: 1, minWidth: 16 }} /> : null}
      {keys ? <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{keys}</text> : null}
      {checked ? <Icon name="check" size={12} color={t.accent} /> : null}
      {more ? <Icon name="chevron_right" size={12} color={t.muted} /> : null}
    </div>
  )
}

/** A line between a menu's groups. */
function MenuRule() {
  const t = useTheme()
  return <div style={{ height: 1, flexShrink: 0, marginTop: 5, marginBottom: 5, marginLeft: 10, marginRight: 10, backgroundColor: t["rex.pillRim"] }} />
}

/**
 * The `Dialog` part: a question in the middle of the window, over everything (`confirm`,
 * `prompt`): what ends a whole session asks first, a rename with nowhere to edit in place asks
 * for the name. Escape, a press outside it or Cancel gives up; Enter goes ahead.
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
          style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 360, padding: 18, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t["rex.pillRim"], keyboardFocusDim: false, boxShadow: { offsetX: 0, offsetY: 14, blurRadius: 36, spreadRadius: 0, color: t["rex.shadow"] } }}
        >
          <text style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{title}</text>
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
              style={{ height: 28, fontSize: 13, color: t.text, paddingLeft: 8, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: t.accent, backgroundColor: t.editor }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <DialogButton title={cancel} onClick={onCancel} />
            <DialogButton title={yes} fill={danger ? t.error : t.accent} onClick={onConfirm} />
          </div>
        </div>
      </div>
    </anchored>
  )
}

function DialogButton({ title, fill, onClick }: { title: string; fill?: string; onClick(): void }) {
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
      style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", height: 28, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderRadius: 8, cursor: "pointer", backgroundColor: fill ?? t.active, keyboardFocusDim: false, hover: { backgroundColor: fill ?? t.hover, opacity: fill ? 0.9 : 1 } }}
    >
      <text style={{ fontSize: 12, fontWeight: 500, color: fill ? "#ffffff" : t.text, whiteSpace: "nowrap" }}>{title}</text>
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
        width: 24,
        height: 24,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        color: color ?? (active ? t.text : t["rex.paneButton"]),
        cursor: "pointer",
        hover: { backgroundColor: t.hover, color: t.text },
        active: { backgroundColor: t.active },
      }}
    >
      <Glyph name={icon} size={14} />
    </div>
  )
}

/** One contributed action, as a button. */
function Action({ action, args }: { action: ActionItem; args?: unknown }) {
  const C = useComponents()
  return <C.IconButton icon={action.icon ?? "ellipsis"} title={action.title} onClick={() => action.run(args)} />
}

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
 * The `PaneTab` part: one tab in a pane's strip. Its mark, its name, and a close shown on the tab
 * in front and the one under the mouse (its room kept, so the tab does not change width). A press
 * brings it to the front and gives its pane the focus; a right press opens its menu. It drags:
 * along its strip, into another pane's (or onto a side of a pane, for a pane of its own). A tab
 * dropped on it goes before it, or after it past its middle. The front tab is a pill of its own.
 */
function PaneTab({ tab: id, pane, index, active, focused }: { tab: string; pane: string; index: number; active: boolean; focused: boolean }) {
  const t = useTheme()
  const [hovered, setHovered] = useState(false)
  const info = useTab(id)
  const tree = useLayout(info?.view_id)
  const leaf: PaneLeaf = { pane, tabs: leafOf(tree, pane)?.tabs ?? [id] }
  const zone = useDropBox(intoStrip(pane, leaf.tabs), (it, at, box) => {
    const m = stripDrop(it, leaf, within(at, box).fx < 0.5 ? index : index + 1)
    if (m) runMove(m)
  })
  const draggable = useDraggable<Carried>({ kind: "pumi.tab", tab: id })
  const { open, menu } = useMenu("tab.menu", { tab: id })
  if (!info) return null
  const status = info.agent ? info.agent_status || "unknown" : undefined
  const mark = markOf(info)
  const title = tabTitle(info)
  // A mark its title already starts with ("π - me", ">_ zsh") is not drawn again before it.
  const showsMark = !("text" in mark && title.startsWith(mark.text))
  // An agent's glyph says what it is doing; anything else's is the title's colour.
  const glyph = status && status !== "idle" && status !== "unknown" ? (t[`agent.${status}`] ?? t.text) : active ? t.text : t["rex.titleDim"]
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
        gap: 5,
        height: 22,
        alignSelf: "center",
        flexShrink: 0,
        maxWidth: 220,
        minWidth: 36,
        paddingLeft: 7,
        paddingRight: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: active ? t["rex.pillRim"] : "#00000000",
        backgroundColor: active ? t["rex.pill"] : undefined,
        cursor: draggable.dragging ? "grabbing" : "pointer",
        userSelect: "none",
        opacity: draggable.dragging ? 0.55 : 1,
        hover: { backgroundColor: active ? t["rex.pill"] : t.hover },
      }}
    >
      {showsMark ? <MarkGlyph mark={mark} size={12} color={glyph} /> : null}
      <text style={{ fontSize: 12, fontWeight: active ? 500 : 400, color: active ? t.text : t["rex.titleDim"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
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

/**
 * A pane's title bar, inside its card: its tabs' strip (each a `PaneTab`; while panes hold tabs) or
 * its one tab's mark and name; then what plugins put at `tab.toolbar` (the front tab's), and — on
 * the focused pane, or while the mouse is over it — a split right and down, a zoom and a close.
 * With one tab to a pane the bar drags it (onto a side of another, or onto a view's row in the side
 * bar); a double click zooms it; a right click opens the front tab's menu.
 */
function PaneTitle({ pane: id, tabs, active, focused, zoomed, over, menu }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean; over?: boolean; menu(e: { x?: number; y?: number }): void }) {
  const t = useTheme()
  const C = useComponents()
  const strip = usePaneTabs()
  const front = active ?? tabs[0]
  const info = useTab(front)
  const agent = useAgentOf(front)
  const tree = useLayout(info?.view_id)
  const draggable = useDraggable<Carried>({ kind: "pumi.tab", tab: front ?? "" })
  const toolbar = useMemo(() => ({ tab: front }), [front])
  // Compact, the top panes' bars run in the traffic lights' row: as tall as it.
  const compact = useCompact()
  const row = useTitleRow().height
  if (!info || !front) return null
  const zoomable = zoomed || (!!tree && "axis" in tree)
  const split = (side: "right" | "down") => call(via(id, "tab.open"), "terminal", {}, { kind: "tiled", pane: id, split: side }).catch(swallow)
  const zoom = () => call(via(id, "pane.update"), id, { zoom: !zoomed }).catch(swallow)
  const status = agent?.agent_status || "unknown"
  // A mark its title already starts with ("π - me", ">_ zsh") is not drawn again before it.
  const mark = markOf(info)
  const title = tabTitle(info)
  const showsMark = !("text" in mark && title.startsWith(mark.text))
  // An agent's glyph says what it is doing; anything else's is the title's colour.
  const glyphColor = agent && status !== "idle" && status !== "unknown" ? (t[`agent.${status}`] ?? t["rex.title"]) : focused ? t["rex.title"] : t["rex.titleDim"]
  const buttons = (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 0, flexShrink: 0 }}>
      <C.IconButton icon="split" title={tip("Split Right", "split_vertical")} onClick={() => split("right")} />
      <C.IconButton icon="split_down" title={tip("Split Down", "split_horizontal")} onClick={() => split("down")} />
      {zoomable ? <C.IconButton icon={zoomed ? "minimize" : "maximize"} title={tip(zoomed ? "Restore the Layout" : "Fill the View", "zoom")} onClick={zoom} /> : null}
      <C.IconButton icon="close" title={tip("Close Pane", "close_pane")} onClick={() => call(via(id, "pane.close"), id).catch(swallow)} />
    </div>
  )
  const own = focused || !!over
  if (strip) {
    return (
      <div
        onAuxClick={(e: any) => {
          // The front tab's menu, from the bar itself: the pane around it would open it again.
          stop(e)
          menu(e)
        }}
        style={{ display: "flex", flexDirection: "row", alignItems: "stretch", height: compact ? row : 32, flexShrink: 0, userSelect: "none" }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0, flexShrink: 1, overflowX: "scroll", paddingLeft: 6, paddingRight: 4 }}>
          {tabs.map((tab, index) => (
            <C.PaneTab key={tab} tab={tab} pane={id} index={index} active={tab === front} focused={focused} />
          ))}
        </div>
        <StripEnd pane={id} tabs={tabs} />
        {own ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0, paddingRight: 5 }}>
            {/* A plugin's buttons sit with the pane's own, spaced as they are. */}
            <SlotRow slot="tab.toolbar" args={toolbar} gap={4} />
            {buttons}
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div
      {...draggable.props}
      onDoubleClick={() => zoomable && zoom()}
      onAuxClick={(e: any) => {
        // The tab's menu, from the bar itself: the pane around it would open it again.
        stop(e)
        menu(e)
      }}
      title={info.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: compact ? row : 32,
        flexShrink: 0,
        paddingLeft: 10,
        paddingRight: 5,
        userSelect: "none",
        opacity: draggable.dragging ? 0.55 : 1,
        cursor: draggable.dragging ? "grabbing" : "default",
      }}
    >
      {showsMark ? <MarkGlyph mark={mark} size={13} color={glyphColor} /> : null}
      <text style={{ fontSize: 13, fontWeight: focused ? 500 : 400, color: focused ? t["rex.title"] : t["rex.titleDim"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
      <div style={{ flexGrow: 1 }} />
      {/* A plugin's buttons sit with the pane's own, spaced as they are. */}
      <SlotRow slot="tab.toolbar" args={toolbar} gap={4} />
      {own ? buttons : null}
    </div>
  )
}

/**
 * A pane without a title bar (they are hidden): a button to fill the view, or give the view back
 * its layout, at its corner while the mouse is over it.
 */
function ZoomButton({ pane: id, view, zoomed, over }: { pane: string; view?: string; zoomed: boolean; over: boolean }) {
  const t = useTheme()
  const tree = useLayout(view)
  // The button covers the pane, so the pane is not under the mouse while the button is.
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
      style={{ position: "absolute", top: 6, right: 6, display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 7, backgroundColor: t.surface, borderWidth: 1, borderColor: t["rex.pillRim"], color: t.muted, cursor: "pointer", opacity: onIt ? 1 : 0.8, hover: { backgroundColor: t.hover, color: t.text } }}
    >
      <Icon name={zoomed ? "minimize" : "maximize"} size={12} />
    </div>
  )
}

/**
 * A pane: Comfortable, a card with its tabs' strip inside and a faint rim; Compact, bare, the
 * layout's line between it and the next. Either way only the front tab's body is drawn, as the app
 * draws it (`TabBody`: the strip, the block by its renderer, the overlays), and while Settings
 * outlines the focused pane (and its view has others) the focused one has an accent rim. A float's
 * frame is the app's (it draws this inside it), so a float is drawn bare. The room between cards is
 * the layout's (`layout.gap`), and a zoomed one's shadow its `lifted`.
 */
function Pane({ pane: id, tabs, active, focused, zoomed }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean; lifted?: boolean }) {
  const t = useTheme()
  const C = useComponents()
  const compact = useCompact()
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
  const kind = (tab?.place as { kind?: string } | undefined)?.kind
  const floating = kind === "float"
  // A pane of several tabs shows its strip whatever the setting: it is the way to its other tabs.
  const titled = !!live && !floating && (titles || (strip && tabs.length > 1))
  const outlined = outline && focused && !!live && !floating && !!tree && "axis" in tree
  // A terminal gets a little more room from the card's edge; a plugin's block pads its own.
  const terminal = tab?.block === "terminal"
  const card = !floating && !compact
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
        ...(card
          ? {
              borderRadius: 10,
              borderWidth: 1,
              borderColor: outlined ? t["rex.rimFocused"] : t["rex.rim"],
              backgroundColor: t["rex.card"],
            }
          : {}),
      }}
    >
      {titled ? (
        <C.PaneTitle pane={id} tabs={tabs} active={front} focused={focused} zoomed={zoomed} over={over} menu={open} />
      ) : toolbar.components.length || toolbar.actions.length ? (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", height: 28, flexShrink: 0, paddingRight: 6 }}>
          <SlotRow slot="tab.toolbar" args={stripArgs} gap={4} />
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, position: "relative", ...(terminal && !floating ? { paddingLeft: 8, paddingRight: 2, paddingBottom: 4, paddingTop: titled ? 0 : 6 } : {}) }}>
        {/* Keyed by the tab: another tab's body is drawn as itself, not as this one's. */}
        <C.TabBody key={front} tab={front} focused={focused} />
        {titled || floating || !front ? null : <ZoomButton pane={id} view={tab?.view_id} zoomed={zoomed} over={over} />}
      </div>
      {/* Compact, the outline is drawn over the pane: it has no rim of its own to colour. */}
      {outlined && !card ? <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderWidth: 1, borderColor: t["rex.rimFocused"], pointerEvents: "none" }} /> : null}
      {menu}
    </div>
  )
}

// ── Before the server answers ──────────────────────────────────────────────────────────────────

function Starting({ title, detail, gaveUp, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  const t = useTheme()
  const glass = useGlass()
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 8, color: t.text, backgroundColor: glass }}>
      {title ? <text style={{ fontSize: 15, fontWeight: 600, color: gaveUp ? t.error : t.text }}>{title}</text> : null}
      {detail ? <text style={{ fontSize: 12, color: t.muted, maxWidth: 520 }}>{detail}</text> : null}
      {lines.length ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: t["rex.card"], borderWidth: 1, borderColor: t["rex.rim"], maxWidth: 620 }}>
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
 * The parts P-Rex draws. The app's own draw the rest: the layout of a view's panes (`Layout`,
 * `Split`, `Splitter`: its edges, its zoom, its moves), a tab's body (`TabBody`) and a float's
 * frame (`Float`), each with this theme's `Pane` in it. There is no view bar or status bar: the
 * views are the side bar's list, and what plugins put in the panel's slots sit in its pages.
 */
export const P_REX: Partial<Components> = {
  Window,
  Starting,
  Pane,
  PaneTitle,
  PaneTab,
  AgentControls,
  Action,
  Menu,
  Dialog,
  IconButton,
}
