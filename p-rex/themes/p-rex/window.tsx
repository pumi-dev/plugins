// P-Rex's window. Frosted glass, edge to edge: the side bar has no fill of its own (the wash shows
// through it), with the traffic lights and the window's buttons on top, the sessions and their
// tabs as a list (each tab on its program's tile), and at its foot a menu of the side bar's views
// (the tabs, and every `panel` a plugin contributes) and a card of the status bar's items. With the
// side bar hidden the tabs run across the top instead. Every pane is a dark card of its own with
// its title bar inside; the cards sit in the app's own layout
// (`Layout` and `Split` are the app's: its splits, its edges that drag, its zoom, its floats).
// Its menus are the app's actions (`useMenu`: a pane's Open With, Move To, Split…; a tab's and a
// session's Rename, Close…) drawn in this theme's `Menu`, and its questions in its `Dialog`.
// Started from the app's default window (runtime/app/app/theme/default.tsx): the behaviour is the
// default's wherever a theme can reach it, the look is this file's.
import { createContext, Fragment, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, motion, useDraggable, useDragState, useDroppable, useMetrics, useTheme } from "pumi"
import {
  call,
  commands,
  grouped,
  renderView,
  run,
  serverOf,
  shortcut,
  useApp,
  useComponents,
  useFocusedPane,
  useLayout,
  useLocal,
  useMenu,
  usePane,
  usePaneTitles,
  useRename,
  useSession,
  useSessions,
  useSidebar,
  useSlot,
  useTabStatus,
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
  type ViewItem,
} from "pumi/theme"

type Tokens = ReturnType<typeof useTheme>

const swallow = (err: unknown) => console.error(String(err))

/** The agent a tab runs, from the Agents plugin's trait: its id (`claude`), or nothing when none said. */
const agentOf = (tab: { options?: Record<string, unknown> } | undefined): string | undefined => {
  const id = tab?.options?.["@pumi_dev.agents.agent"]
  return typeof id === "string" ? id : undefined
}

/** Whether a tab runs on the terminal engine: one whose `tab_pid` the engine keeps. */
const isTerminal = (tab: { options?: Record<string, unknown> } | undefined): boolean => typeof tab?.options?.tab_pid === "number"
const stop = (e: any) => e?.stopPropagation?.()

// ── Icons ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The theme's own glyphs, by path (a theme is loaded from disk, and the module loader hands an
 * SVG back without a default export). Like the app's, each is drawn in the colour it is given.
 */
const OWN = new Set(["eye", "eye_off", "command", "laptop", "laptop_plus", "globe", "list_circle"])
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
/** The tabs' view: the sessions and their tabs. */
const TABS_VIEW = "tabs"
/** The sessions folded away in the list. */
const FOLDED = "p-rex.sessions.folded"
/** The order sessions were dragged into, in the default theme's list: kept to, not changed. */
const SESSION_ORDER = "default.agents.order"
const NONE: string[] = []

/** The command a plugin of the user's may have: the palette's toggle, the browser's new tab. */
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

// ── Names and tiles ────────────────────────────────────────────────────────────────────────────

type PaneLike = Pick<PaneInfo, "block" | "label" | "terminal_title" | "cwd" | "agent">

/** A pane by what it shows: an agent by its title first, then its name, its title, its folder, its type. */
function paneTitle(p: PaneLike): string {
  const dir = p.cwd ? p.cwd.replace(/\/+$/, "").split("/").pop() : undefined
  if (p.agent) return p.terminal_title || p.label || p.agent
  return p.label || p.terminal_title || dir || p.block
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

/** The tile a pane is shown on, and the glyph on it: an agent's mark, a terminal's prompt, a page's globe. */
function tileOf(p: { block: string; options?: Record<string, unknown> } | undefined, t: Tokens): { color: string; glyph: string } {
  if (!p) return { color: t["rex.tile.terminal"], glyph: "terminal" }
  const agent = agentOf(p)
  if (agent) {
    const name = agent.toLowerCase()
    if (name.includes("claude")) return { color: t["rex.tile.claude"], glyph: "sparkle" }
    if (name.includes("codex")) return { color: t["rex.tile.codex"], glyph: "zap" }
    if (name === "pi" || name.startsWith("pi-") || name.includes("π")) return { color: t["rex.tile.pi"], glyph: "sparkle" }
    return { color: t["rex.tile.agent"], glyph: "sparkle" }
  }
  if (isTerminal(p)) return { color: t["rex.tile.terminal"], glyph: "terminal" }
  if (p.block === "file") return { color: t["rex.tile.file"], glyph: "code" }
  if (p.block === "image" || p.block.endsWith(".image")) return { color: t["rex.tile.image"], glyph: "image" }
  if (p.block === "browser" || p.block.endsWith(".page")) return { color: t["rex.tile.browser"], glyph: "globe" }
  if (p.block === "files" || p.block.endsWith(".files")) return { color: t["rex.tile.file"], glyph: "folder" }
  return { color: t["rex.tile.plugin"], glyph: "blocks" }
}

/** A pane's glyph without its tile: the pane's title bar's. */
function glyphOf(p: { block: string; options?: Record<string, unknown> }): string {
  return tileOf(p, {} as Tokens).glyph
}

/**
 * A program's tile: a rounded square in its colour with its glyph, and, for an agent, its state as
 * a dot in the corner (a pulse while it works). What wants a look (done, blocked, error) shows;
 * an idle agent has no dot.
 */
const Tile = memo(function Tile({ color, glyph, status, size = 20 }: { color: string; glyph: string; status?: string; size?: number }) {
  const t = useTheme()
  const dot = status && status !== "idle" && status !== "unknown" ? (t[`status.${status}`] ?? t["status.unknown"]) : undefined
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: Math.round(size * 0.27),
          backgroundColor: color,
          borderWidth: 1,
          borderColor: t["rex.tile.rim"],
        }}
      >
        <Glyph name={glyph} size={Math.round(size * 0.58)} color={t["rex.tile.glyph"]} />
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
  return { position: "absolute", right: -3, bottom: -3, width: 8, height: 8, borderRadius: 8, borderWidth: 1.5, borderColor: t["rex.dotRing"], backgroundColor: color } as const
}

// ── The glass ──────────────────────────────────────────────────────────────────────────────────

/** The window's wash, over the system's blur: plum at the top, indigo at the foot, magenta in the corner. */
function wash(t: Tokens) {
  return [
    { type: "radial-gradient", center: [1, 1], radius: [900, 520], stops: [{ color: t["rex.wash.magenta"] }, { color: t["rex.wash.clear"] }] },
    { type: "radial-gradient", center: [0.3, 1.05], radius: [760, 460], stops: [{ color: t["rex.wash.blue"] }, { color: t["rex.wash.clear"] }] },
    { type: "radial-gradient", center: [0, 0.35], radius: [520, 620], stops: [{ color: t["rex.wash.plum"] }, { color: t["rex.wash.clear"] }] },
    { type: "linear-gradient", angle: 170, stops: [{ color: t["rex.wash.top"] }, { color: t["rex.wash.bottom"] }], colorSpace: "oklab" },
  ] as any
}

// ── The window ─────────────────────────────────────────────────────────────────────────────────

function Window() {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const [sidebar] = useSidebar()
  const [width, setWidth] = useLocal(SIDEBAR_WIDTH, 240)
  const overlays = useSlot("window.overlay").views
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", color: t.text, fontSize: m.fontSize, background: wash(t) }}>
      {sidebar ? null : <TopBar />}
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        {sidebar ? <Sidebar width={width} setWidth={setWidth} /> : null}
        {/* The cards' gutter round the edge; between them it is the layout's (`layout.gap`). */}
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, paddingTop: sidebar ? 8 : 0, paddingRight: 8, paddingBottom: 8, paddingLeft: sidebar ? 0 : 8 }}>
          <C.Layout />
        </div>
      </div>
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

/** The window's buttons: pane titles shown or not, the command palette, a new tab. */
function WindowButtons() {
  const window = useWindow()
  const [titles, setTitles] = usePaneTitles()
  const palette = useHasCommand(PALETTE)
  return (
    <>
      <TitlebarSlot />
      <BarButton icon={titles ? "eye" : "eye_off"} title={titles ? "Hide pane titles" : "Show pane titles"} command="toggle_pane_titles" active={!titles} onClick={() => setTitles((v) => !v)} />
      {palette ? <BarButton icon="command" title="Command Palette" command={PALETTE} onClick={() => run(PALETTE, window.id)} /> : null}
      <BarButton icon="plus" title="New Tab" command="new_tab" onClick={() => run("new_tab", window.id)} />
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
 * With the side bar hidden: its button, the window's session's tabs across a track (each on its
 * program's tile, the front one a pill with a `…` that lists its panes), and the window's buttons.
 */
function TopBar() {
  const window = useWindow()
  const { height, inset } = useTitleRow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height, flexShrink: 0, paddingLeft: inset, paddingRight: 8, appRegion: "drag" }}>
      <BarButton icon="layout_sidebar_left" title="Show Sidebar" command="toggle_sidebar" onClick={() => run("toggle_sidebar", window.id)} />
      <TabStrip />
      <div style={{ flexGrow: 1, minWidth: 8 }} />
      <WindowButtons />
    </div>
  )
}

/** The window's session's tabs, by number, on a track: a thin rule between two that are not in front. */
function TabStrip() {
  const t = useTheme()
  const session = useSession()
  const id = session?.workspace_id
  const tabs = useTabs(id)
  const sorted = useMemo(() => [...tabs].sort((a, b) => a.number - b.number), [tabs])
  const front = session?.active_tab_id
  if (!id || !sorted.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 30, flexShrink: 1, minWidth: 0, marginLeft: 8, paddingLeft: 2, paddingRight: 2, borderRadius: 15, borderWidth: 1, borderColor: t["rex.trackRim"], backgroundColor: t["rex.track"], overflow: "hidden" }}>
      {sorted.map((tab, i) => {
        const quiet = i > 0 && tab.tab_id !== front && sorted[i - 1]!.tab_id !== front
        return (
          <Fragment key={tab.tab_id}>
            {i > 0 ? <div style={{ width: 1, height: 14, flexShrink: 0, marginLeft: 1, marginRight: 1, backgroundColor: quiet ? t["rex.pillRim"] : "#00000000" }} /> : null}
            <TopTab tab={tab.tab_id} session={id} label={tab.label} front={tab.tab_id === front} />
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * A tab across the top: its program's tile and its name; the front one a pill. A click goes to it,
 * a double click renames it, a right click opens its menu, and the `…` (always on the front one,
 * on the others while hovered) lists its panes. It drags, and takes a pane dropped on it, as its
 * row in the side bar does.
 */
const TopTab = memo(function TopTab({ tab: id, session, label: named, front }: { tab: string; session: string; label: string | null; front: boolean }) {
  const t = useTheme()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const panes = usePopover()
  const { p, status, label, tile, rename, menu, draggable, drop } = useTabItem(id, named)
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
        title={p?.cwd ?? undefined}
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
        <Tile color={tile.color} glyph={tile.glyph} status={status} size={16} />
        {input ? <RenameField input={input} /> : (
          <text style={{ fontSize: 13, fontWeight: front ? 500 : 400, color: front ? t.text : t["rex.row"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label}</text>
        )}
        <div style={{ flexGrow: 1 }} />
        {(front || hovered || panes.open) && !renaming ? <RowButton icon="ellipsis" title="Panes" size={20} onPress={panes.press} onClick={panes.toggle} /> : null}
      </div>
      {panes.open ? <TabPanes tab={id} session={session} label={label} close={panes.close} /> : null}
      {menu.menu}
    </div>
  )
})

const STATUS_LABEL: Record<string, string> = { working: "Working", blocked: "Needs you", done: "Done", error: "Error" }
const HOME = process.env.HOME ?? ""
/** A folder as a shell shows it: under the home folder, from `~`. */
const tilde = (path: string) => (HOME && (path === HOME || path.startsWith(`${HOME}/`)) ? `~${path.slice(HOME.length)}` : path)

/** A tab's panes, under its `…` across the top: each by its glyph, its title, what its agent says, its folder. */
function TabPanes({ tab, session, label, close }: { tab: string; session: string; label: string; close(): void }) {
  const t = useTheme()
  const window = useWindow()
  const focused = useFocusedPane(tab)
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === tab) ?? NO_PANES)
  const status = useTabStatus(tab)
  return (
    <Popover side="bottom" width={280} close={close}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 26, flexShrink: 0, paddingLeft: 13, paddingRight: 13 }}>
        <text style={{ fontSize: 12, fontWeight: 600, color: t["rex.heading"], whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{label}</text>
      </div>
      {panes.map((p) => {
        const said = agentOf(p) && status ? STATUS_LABEL[status] : undefined
        const mine = p.pane_id === focused
        return (
          <div
            key={p.pane_id}
            onClick={() => {
              close()
              goTo(window, session, tab, p.pane_id)
            }}
            title={p.cwd ?? undefined}
            style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0, marginLeft: 5, marginRight: 5, paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, borderRadius: 7, cursor: "pointer", backgroundColor: mine ? t.selected : undefined, hover: { backgroundColor: t.hover } }}
          >
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
              <Glyph name={glyphOf(p)} size={13} color={status && status !== "idle" && status !== "unknown" ? (t[`status.${status}`] ?? t.text) : t.text} />
              <text style={{ fontSize: 13, fontWeight: 600, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{paneTitle(p)}</text>
              <div style={{ flexGrow: 1, minWidth: 8 }} />
              {said ? <text style={{ fontSize: 12, color: status === "working" ? t["status.working"] : t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{said}</text> : null}
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

const viewKey = (v: ViewItem) => `${v.plugin}/${v.id}`

/**
 * The side bar: its top, the view shown (the tabs, or a plugin's panel), and its foot. A plugin's
 * panel is the same `panel` the default theme stacks in its side bar; here each is a view of its
 * own, picked at the foot.
 */
function Sidebar({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const t = useTheme()
  const panels = useSlot("panel").views
  const [view] = useLocal<string>(SIDEBAR_VIEW, TABS_VIEW)
  const shown = panels.find((v) => viewKey(v) === view)
  return (
    <div cache style={{ display: "flex", flexDirection: "column", width, flexShrink: 0, minWidth: 0, position: "relative" }}>
      <SidebarHeader />
      {shown ? (
        <>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 26, flexShrink: 0, paddingLeft: 14, paddingRight: 10 }}>
            <text style={{ fontSize: 12, fontWeight: 600, color: t["rex.heading"], whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{shown.title ?? shown.id}</text>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingLeft: 4, paddingRight: 4 }}>{renderView(shown)}</div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
          <SessionHeaderSlot />
          <Sessions />
        </div>
      )}
      <SidebarFooter panels={panels} shown={shown ? view : TABS_VIEW} />
      <Resizer width={width} setWidth={setWidth} />
    </div>
  )
}

/** What plugins put over the session's tabs (`session.header`), given the window's session. */
function SessionHeaderSlot() {
  const C = useComponents()
  const session = useSession()
  const { views, actions } = useSlot("session.header")
  const args = useMemo(() => ({ session: session?.workspace_id }), [session?.workspace_id])
  if (!session || (!views.length && !actions.length)) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 30, flexShrink: 0, paddingLeft: 12, paddingRight: 8 }}>
      {views.map((v) => renderView(v, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
    </div>
  )
}

/**
 * The side bar's foot: on the left, under the red light, a button whose menu picks the side bar's
 * view (the tabs, or a plugin's panel) or hides it; on the right, a button whose card holds what
 * plugins put in the status bar (`status`), a new session, and a page in a new tab.
 */
function SidebarFooter({ panels, shown }: { panels: ViewItem[]; shown: string }) {
  const window = useWindow()
  const { under } = useTitleRow()
  const browser = useHasCommand(BROWSER)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height: 40, flexShrink: 0, paddingLeft: under, paddingRight: 8 }}>
      <ViewsButton panels={panels} shown={shown} />
      <div style={{ flexGrow: 1, minWidth: 4 }} />
      <StatusButton />
      <BarButton icon="laptop_plus" title="New Session" command="new_workspace" onClick={() => run("new_workspace", window.id)} />
      {browser ? <BarButton icon="globe" title="Open a Page" command={BROWSER} onClick={() => run(BROWSER, window.id)} /> : null}
    </div>
  )
}

/** The side bar's views, as a menu: the tabs, each plugin's panel (the one shown checked), and a hide. */
function ViewsButton({ panels, shown }: { panels: ViewItem[]; shown: string }) {
  const window = useWindow()
  const [, setView] = useLocal<string>(SIDEBAR_VIEW, TABS_VIEW)
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
          <MenuItem icon="list_circle" title="Tabs" checked={shown === TABS_VIEW} onClick={() => pick(TABS_VIEW)} />
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

/** What plugins put in the status bar (`status`), in a card of its own: a row each, then their actions. */
function StatusButton() {
  const { views, actions } = useSlot("status")
  const card = usePopover()
  if (!views.length && !actions.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }}>
      <BarButton icon="layout_panel_bottom" title="Status" active={card.open} onPress={card.press} onClick={card.toggle} />
      {card.open ? (
        <Popover align="end" close={card.close}>
          {views.map((v) => (
            <div key={viewKey(v)} style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 28, flexShrink: 0, paddingLeft: 7, paddingRight: 7 }}>
              {renderView(v)}
            </div>
          ))}
          {views.length && actions.length ? <MenuRule /> : null}
          {actions.map((a) => (
            <MenuItem
              key={`${a.plugin}/${a.id}`}
              icon={a.icon}
              title={a.title}
              keys={a.keys}
              disabled={a.disabled}
              onClick={() => {
                card.close()
                a.run()
              }}
            />
          ))}
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

/** A session: its heading, and its tabs while it is not folded. */
const SessionGroup = memo(function SessionGroup({ session: id, label, folded, toggle }: { session: string; label: string; folded: boolean; toggle(id: string): void }) {
  const window = useWindow()
  const session = useSession(id)
  const tabs = useTabs(id)
  const sorted = useMemo(() => [...tabs].sort((a, b) => a.number - b.number), [tabs])
  const current = window.session === id
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <SessionHeading session={id} label={label} folded={folded} toggle={toggle} tabs={sorted.length} />
      {folded
        ? null
        : sorted.map((tab) => <TabRow key={tab.tab_id} tab={tab.tab_id} session={id} label={tab.label} worktree={tab.worktree} front={current && session?.active_tab_id === tab.tab_id} />)}
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
 * a `+` opens a tab in it and a `…` its menu (a right click too: the app's `session.menu`, with a
 * fold of this list's). Folded, it says how many tabs it has and what its agents say.
 */
const SessionHeading = memo(function SessionHeading({ session: id, label, folded, toggle, tabs }: { session: string; label: string; folded: boolean; toggle(id: string): void; tabs: number }) {
  const t = useTheme()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const current = id === window.session
  const status = useApp((s) => (folded ? lead(s.snapshot?.tabs.filter((x) => x.workspace_id === id).map((x) => x.status) ?? []) : undefined))
  const { renaming, start, input } = useRename({ session: id }, label)
  const { open, show, menu, shown } = useMenu("session.menu", { session: id })
  const newTab = () => {
    call(via(id, "pane.open"), "terminal", {}, { kind: "tab", session: id })
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
            <RowButton icon="plus" title="New Tab" onClick={newTab} />
            <RowButton icon="ellipsis" title="More" onClick={show} />
          </div>
        ) : folded && !renaming ? (
          <>
            {status ? <div style={{ width: 7, height: 7, borderRadius: 7, flexShrink: 0, backgroundColor: t[`status.${status}`] ?? t["status.unknown"] }} /> : null}
            <text style={{ fontSize: 11, color: t.faint }}>{String(tabs)}</text>
          </>
        ) : null}
      </div>
      {menu}
    </>
  )
})

/**
 * What a tab's row and its place across the top both know of it: its panes, the one it shows
 * (its focused pane's tile, the most urgent agent's state), its name, and its rename, menu, drag
 * and drop.
 */
function useTabItem(id: string, named: string | null) {
  const t = useTheme()
  const focused = useFocusedPane(id)
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === id && (p.place as { kind?: string } | undefined)?.kind !== "float") ?? NO_PANES)
  const p = panes.find((x) => x.pane_id === focused) ?? panes[0]
  const status = useApp((s) => s.snapshot?.tabs.find((x) => x.tab_id === id)?.status)
  const label = named && !/^\d+$/.test(named) ? named : p ? paneTitle(p) : "Tab"
  const tile = tileOf(p, t)
  const rename = useRename({ tab: id }, label)
  // The tab's menu: the app's (Rename, Close) and what plugins add, then its focused pane's.
  const menu = useMenu(["tab.menu", "tab.actions", "pane.menu"], { tab: id, pane: p?.pane_id })
  const draggable = useDraggable({ kind: "pumi.tab", tab: id }, { disabled: rename.renaming })
  const drop = useDroppable<{ kind: "pumi.pane"; pane: string }>({
    accept: (data: any): data is { kind: "pumi.pane"; pane: string } => data?.kind === "pumi.pane" && typeof data.pane === "string" && !panes.some((x) => x.pane_id === data.pane) && serverOf(data.pane) === serverOf(id),
    onDrop: (data) => call(via(data.pane, "pane.update"), data.pane, { place: { kind: "tiled", tab: id } }).catch(swallow),
  })
  return { p, status, label, tile, rename, menu, draggable, drop }
}

/**
 * A tab, as a row: its program's tile (its focused pane's, an agent's state in the corner), its
 * name, and the front tab of the window's session as a pill with its `…`. A click goes to it, a
 * double click renames it, a right click (or the `…`) opens its menu. It drags (onto a pane, to
 * join that tab), and a pane dropped on it moves into it.
 */
const TabRow = memo(function TabRow({ tab: id, session, label: named, worktree, front }: { tab: string; session: string; label: string | null; worktree?: string; front: boolean }) {
  const t = useTheme()
  const C = useComponents()
  const window = useWindow()
  const [hovered, setHovered] = useState(false)
  const { p, status, label, tile, rename, menu: tabMenu, draggable, drop } = useTabItem(id, named)
  const { renaming, start, input } = rename
  const { open, show, menu, shown } = tabMenu
  const agentArgs = useMemo(() => ({ tab: id }), [id])
  const controls = useSlot("tab.row.controls")
  const agent = !!agentOf(p)
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
        title={p?.cwd ?? undefined}
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
        <Tile color={tile.color} glyph={tile.glyph} status={status} size={17} />
        {input ? <RenameField input={input} /> : (
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, paddingTop: 2, paddingBottom: 2 }}>
            <text style={{ fontSize: 13, fontWeight: front ? 500 : 400, color: front ? t.text : t["rex.row"], whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</text>
            {worktree ? (
              <div title={worktree} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, minWidth: 0 }}>
                <Icon name="git_worktree" size={11} color={t.faint} />
                <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{shortName(worktree)}</text>
              </div>
            ) : null}
            {agent ? <SlotRow slot="tab.row.footer" args={agentArgs} /> : null}
          </div>
        )}
        {(near || front) && !renaming ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0 }}>
            {near && agent && controls.actions.length + controls.views.length > 0 ? <C.TabRowControls tab={id} /> : null}
            <RowButton icon="ellipsis" title="More" size={20} onClick={show} />
          </div>
        ) : null}
      </div>
      {menu}
    </>
  )
})

const NO_PANES: PaneInfo[] = []

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

/** A tab row's actions (`tab.row.controls`), given the tab: on its row while hovered. */
function TabRowControls({ tab }: { tab: string }) {
  const args = useMemo(() => ({ tab }), [tab])
  return <SlotRow slot="tab.row.controls" args={args} />
}

/** What a pane or tab drag carries, by the mouse: its tile and its name. */
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
    label = tab?.label && !/^\d+$/.test(tab.label) ? tab.label : p ? paneTitle(p) : "Tab"
  }
  if (!label) return null
  const tile = tileOf(p, t)
  return (
    <anchored position={{ x: drag.x + 14, y: drag.y + 10 }} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 8, paddingRight: 12, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t["rex.pillRim"], pointerEvents: "none", boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: t["rex.shadow"] } }}>
        <Tile color={tile.color} glyph={tile.glyph} size={18} />
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
 * The `Menu` part: every menu of the app's (a pane's, a tab's, a session's), where the mouse is.
 * The actions in their groups with a rule between, a submenu for one with items, then the slot's
 * views. A press outside it (and its submenus) closes it.
 */
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

/**
 * A pane's title bar, inside its card: its glyph and its name, bold; then what plugins put at
 * `pane.toolbar`, and — on the focused pane, or while the mouse is over it — a split right and
 * down, a zoom and a close. It drags the pane (onto a side of another, or onto a tab's row in the
 * side bar); a double click zooms it; a right click opens its menu.
 */
function PaneTitle({ pane: id, focused, zoomed, over, menu }: { pane: string; focused: boolean; zoomed: boolean; over: boolean; menu(e: any): void }) {
  const t = useTheme()
  const C = useComponents()
  const p = usePane(id)
  const tree = useLayout(p?.tab_id)
  const draggable = useDraggable({ kind: "pumi.pane", pane: id })
  const toolbar = useMemo(() => ({ pane: id }), [id])
  if (!p) return null
  const zoomable = zoomed || (!!tree && "axis" in tree)
  const split = (side: "right" | "down") => call(via(id, "pane.open"), "terminal", {}, { beside: id, split: side }).catch(swallow)
  const zoom = () => call(via(id, "pane.update"), id, { zoom: !zoomed }).catch(swallow)
  const status = useTabStatus(p?.tab_id) || "unknown"
  // An agent's glyph says what it is doing; anything else's is the title's colour.
  const glyphColor = status !== "idle" && status !== "unknown" ? (t[`status.${status}`] ?? t["rex.title"]) : focused ? t["rex.title"] : t["rex.titleDim"]
  return (
    <div
      {...draggable.props}
      onDoubleClick={() => zoomable && zoom()}
      onAuxClick={(e: any) => {
        // The pane's menu, from the bar itself: the pane around it would open it again.
        stop(e)
        menu(e)
      }}
      title={p.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 30,
        flexShrink: 0,
        paddingLeft: 10,
        paddingRight: 5,
        userSelect: "none",
        opacity: draggable.dragging ? 0.55 : 1,
        cursor: draggable.dragging ? "grabbing" : "default",
      }}
    >
      <Glyph name={glyphOf(p)} size={13} color={glyphColor} />
      <text style={{ fontSize: 13, fontWeight: 600, color: focused ? t["rex.title"] : t["rex.titleDim"], whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{paneTitle(p)}</text>
      <div style={{ flexGrow: 1 }} />
      {/* A plugin's buttons sit with the pane's own, spaced as they are. */}
      <SlotRow slot="pane.toolbar" args={toolbar} gap={4} />
      {focused || over ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 0, flexShrink: 0 }}>
          <C.IconButton icon="split" title={tip("Split Right", "split_vertical")} onClick={() => split("right")} />
          <C.IconButton icon="split_down" title={tip("Split Down", "split_horizontal")} onClick={() => split("down")} />
          {zoomable ? <C.IconButton icon={zoomed ? "minimize" : "maximize"} title={tip(zoomed ? "Restore the Layout" : "Fill the Tab", "zoom")} onClick={zoom} /> : null}
          <C.IconButton icon="close" title={tip("Close Pane", "close_pane")} onClick={() => call(via(id, "pane.close"), id).catch(swallow)} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * A pane without a title bar (they are hidden): a button to fill the tab, or give the tab back its
 * layout, at its corner while the mouse is over it.
 */
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
      style={{ position: "absolute", top: 6, right: 6, display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 7, backgroundColor: t.surface, borderWidth: 1, borderColor: t["rex.pillRim"], color: t.muted, cursor: "pointer", opacity: onIt ? 1 : 0.8, hover: { backgroundColor: t.hover, color: t.text } }}
    >
      <Icon name={zoomed ? "minimize" : "maximize"} size={12} />
    </div>
  )
}

/**
 * A pane: a dark glass card with its title bar inside, its rim brighter while it is focused, and
 * its body as the app draws it (`PaneBody`: the strip, the block by its renderer, the overlays). A
 * float's frame is the app's (it draws this inside it), so a float is drawn bare. The room between
 * cards is the layout's (`layout.gap`), and a zoomed card's shadow its `lifted`.
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
  const kind = (pane?.place as { kind?: string } | undefined)?.kind
  const floating = kind === "float"
  const titled = titles && !!live && !floating
  // A terminal gets a little more room from the card's edge; a plugin's block pads its own.
  const terminal = isTerminal(pane)
  return (
    <div
      onMouseDown={() => {
        if (!focused) call(via(id, "pane.focus"), id).catch(swallow)
      }}
      onAuxClick={open}
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        position: "relative",
        ...(floating
          ? {}
          : {
              borderRadius: 10,
              borderWidth: 1,
              borderColor: focused ? t["rex.rimFocused"] : t["rex.rim"],
              backgroundColor: t["rex.card"],
            }),
      }}
    >
      {/* The glass's bevel: a faint second rim just inside the card's, under what the card holds. */}
      {floating ? null : <div style={{ position: "absolute", top: 2, left: 2, right: 2, bottom: 2, borderRadius: 8, borderWidth: 1, borderColor: t["rex.bevel"], pointerEvents: "none" }} />}
      {titled ? (
        <PaneTitle pane={id} focused={focused} zoomed={zoomed} over={over} menu={open} />
      ) : toolbar.views.length || toolbar.actions.length ? (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", height: 28, flexShrink: 0, paddingRight: 6 }}>
          <SlotRow slot="pane.toolbar" args={stripArgs} gap={4} />
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, position: "relative", ...(terminal && !floating ? { paddingLeft: 6, paddingRight: 2, paddingBottom: 4, paddingTop: titled ? 0 : 4 } : {}) }}>
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
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 8, color: t.text, background: wash(t) }}>
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
 * The parts P-Rex draws. The app's own draw the rest: the layout of a tab's panes (`Layout`,
 * `Split`, `Splitter`: its edges, its zoom, its moves), a pane's body (`PaneBody`) and a float's
 * frame (`Float`), each with this theme's `Pane` in it. There is no tab bar or status bar: the tabs are the side bar's list, and what
 * plugins put in the status bar sits at the side bar's foot.
 */
export const P_REX: Partial<Components> = {
  Window,
  Starting,
  Pane,
  TabRowControls,
  Action,
  Menu,
  Dialog,
  IconButton,
}
