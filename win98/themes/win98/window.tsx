// Windows 98 on pumi: a teal desktop, a window for every tab, a taskbar along the foot and a Start
// menu of your sessions and tabs.
//
// Every bevel is two nested boxes with a colour a side (`.raised` outside `.raised-in`, and
// `.sunken` the other way round), as the system drew them; the caption is the title bar's
// gradient. From this package's `theme.lua`, which extended the default theme for its panes: those
// are drawn here, in full — a strip with the pane's title, an inset body, and edges that drag.
import { useEffect, useRef, useState } from "react"
import {
  Icon,
  call,
  commands,
  num,
  renderView,
  useApp,
  useComponents,
  useFocusedPane,
  usePaneView,
  useContributions,
  useLocal,
  useNow,
  usePane,
  useSession,
  useSessions,
  useTabs,
  useTheme,
  useBinding,
  useWindow,
  useWindowSize,
  windowContext,
  type Tree,
  type WindowPane,
  type WindowSession,
  type WindowTab,
} from "pumi"

const swallow = (err: unknown) => console.error(String(err))
const NO_PANES: WindowPane[] = []



// ── The pieces every part is made of ─────────────────────────────────

interface BevelProps {
  children?: React.ReactNode
  style?: Record<string, unknown>
  /** Pushed in, as a field or a held button. */
  sunken?: boolean
  onClick?(event: unknown): void
  onMouseDown?(event: unknown): void
  onDoubleClick?(event: unknown): void
  title?: string
  /** A wash of the theme's checker, as a held button has. */
  pressed?: boolean
}

/** The outer half of a bevel: light on the top and the left, dark on the other two. */
function face(sunken?: boolean): Record<string, unknown> {
  return sunken
    ? { borderTopColor: "#808080", borderLeftColor: "#808080", borderRightColor: "#ffffff", borderBottomColor: "#ffffff" }
    : { borderTopColor: "#dfdfdf", borderLeftColor: "#dfdfdf", borderRightColor: "#0a0a0a", borderBottomColor: "#0a0a0a" }
}

/** The inner half: the reverse, one step softer. */
function inner(sunken?: boolean): Record<string, unknown> {
  return sunken
    ? { borderTopColor: "#0a0a0a", borderLeftColor: "#0a0a0a", borderRightColor: "#dfdfdf", borderBottomColor: "#dfdfdf" }
    : { borderTopColor: "#ffffff", borderLeftColor: "#ffffff", borderRightColor: "#808080", borderBottomColor: "#808080" }
}

/** A Windows 98 box: two bevels around what it holds. */
function Bevel({ children, style, sunken, onClick, onMouseDown, onDoubleClick, title, pressed }: BevelProps) {
  return (
    <div
      title={title}
      onClick={onClick as any}
      onMouseDown={onMouseDown as any}
      onDoubleClick={onDoubleClick as any}
      style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderWidth: 1, backgroundColor: pressed ? "#e8e8e8" : "#c0c0c0", ...face(pressed ? true : sunken), ...style }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, borderWidth: 1, ...inner(pressed ? true : sunken) }}>{children}</div>
    </div>
  )
}

/** A push button: its label centred, its second bevel a shade off when held. */
function Button({ label, icon, onClick, pressed, style, title }: { label?: string; icon?: string; onClick(): void; pressed?: boolean; style?: Record<string, unknown>; title?: string }) {
  return (
    <Bevel sunken={pressed} onClick={onClick} title={title ?? label} style={style}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          flexGrow: 1,
          minWidth: 0,
          paddingLeft: 4,
          paddingRight: 4,
          // Held, the label moves a pixel down and right, as the system's did.
          ...(pressed ? { paddingTop: 1, paddingLeft: 5, paddingBottom: 0 } : {}),
        }}
      >
        {icon ? <Icon name={icon} size={12} color="#000000" /> : null}
        {label ? <text style={{ fontSize: 11, color: "#000000", whiteSpace: "nowrap", ...(pressed ? {} : {}) }}>{label}</text> : null}
      </div>
    </Bevel>
  )
}

/** The caption's button: 16 by 14, its glyph a pixel down when held. */
function CaptionButton({ glyph, title, onClick }: { glyph: string; title: string; onClick(): void }) {
  return (
    <Bevel onClick={onClick} title={title} style={{ width: 16, height: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexGrow: 1 }}>
        <text style={{ fontSize: 9, fontWeight: "bold", color: "#000000", lineHeight: 9 }}>{glyph}</text>
      </div>
    </Bevel>
  )
}

// ── Panes, and the edges between them ────────────────────────────────

/** One pane: its strip (a state dot, its title), then an inset body on black. */
export function Pane({ pane: id, focused }: { pane: string; focused: boolean; zoomed: boolean }) {
  const pane = usePane(id)
  const view = usePaneView(pane?.kind)
  const { views: strips } = useContributions("pane.strip")
  const { views: toolbar, actions } = useContributions("pane.toolbar")
  const { views: overlays } = useContributions("pane.overlay")
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === pane?.tab_id) ?? NO_PANES)
  const title = pane?.terminal_title || pane?.label || pane?.kind || ""
  const status = pane?.agent_status ?? "unknown"
  const color: Record<string, string> = { working: "#ffc400", blocked: "#ff8000", error: "#ff0000", done: "#00a000", idle: "#808080", unknown: "#808080" }
  const body =
    pane?.kind === "terminal" || !pane ? (
      <terminal pane={id} autoFocus={focused} style={{ flexGrow: 1, minWidth: 0, minHeight: 0 }} />
    ) : view ? (
      renderView(view, { pane: id })
    ) : (
      <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text style={{ fontSize: 11, color: "#000000" }}>{`Nothing draws ${pane.kind} panes`}</text>
      </div>
    )
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, padding: 1 }}>
      <div
        title={title}
        onDoubleClick={() => call("pane.setZoom", num(id), "toggle").catch(swallow)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 16, flexShrink: 0, paddingLeft: 4, paddingRight: 2, backgroundColor: "#c0c0c0" }}
      >
        <div style={{ width: 6, height: 6, flexShrink: 0, backgroundColor: color[status] ?? "#808080", borderWidth: 1, borderColor: "#00000033" }} />
        <text style={{ fontSize: 11, fontWeight: focused ? "bold" : "normal", color: focused ? "#000000" : "#808080", flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{title}</text>
        <div style={{ flexGrow: 1 }} />
        {strips.map((strip) => renderView(strip, { pane: id }))}
        {actions.map((action) => (
          <div key={`${action.pkg}/${action.id}`} title={action.title} onClick={() => action.run({ pane: id })} style={{ display: "flex", width: 14, height: 14, alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name={action.icon ?? "ellipsis"} size={10} color="#000000" />
          </div>
        ))}
        {toolbar.map((contributed) => renderView(contributed, { pane: id }))}
        <div style={{ display: "flex", flexDirection: "row", gap: 1, flexShrink: 0 }}>
          <Button title="Split Right" onClick={() => call("pane.open", "terminal", {}, { split: "right", beside: num(id) }).catch(swallow)} style={{ width: 16, height: 13 }} icon="split" />
          <Button title="Split Down" onClick={() => call("pane.open", "terminal", {}, { split: "down", beside: num(id) }).catch(swallow)} style={{ width: 16, height: 13 }} icon="split_down" />
          {panes.length > 1 ? (
            <Button title="Zoom" onClick={() => call("pane.setZoom", num(id), "toggle").catch(swallow)} style={{ width: 16, height: 13 }} icon="maximize" />
          ) : null}
          <Button title="Close Pane" onClick={() => call("pane.close", num(id), true).catch(swallow)} style={{ width: 16, height: 13 }} icon="close" />
        </div>
      </div>
      <Bevel sunken style={{ flexGrow: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, position: "relative", backgroundColor: "#000000" }}>
          {body}
          {overlays.map((overlay) => (
            <div key={`${overlay.pkg}/${overlay.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
              {renderView(overlay, { pane: id })}
            </div>
          ))}
        </div>
      </Bevel>
    </div>
  )
}

interface SplitProps {
  tab: string
  tree: Tree
  path: boolean[]
  focused?: string
  preview?(path: string): number | undefined
  onPreview?(next: { path: string; ratio: number } | null): void
}

const keyOf = (path: boolean[]) => path.map((second) => (second ? "1" : "0")).join("")

// ── A window on the desktop ──────────────────────────────────────────

interface Place {
  x: number
  y: number
  w: number
  h: number
  min?: boolean
  max?: boolean
}

/** How tall the taskbar is, and how much of the screen a window keeps clear of it. */
const TASKBAR = 28

function DesktopWindow({ tab, index, active, place, onPlace, onClose, onRaise }: { tab: WindowTab; index: number; active: boolean; place: Place; onPlace(next: Place): void; onClose(): void; onRaise(): void }) {
  const C = useComponents()
  const { width, height } = useWindowSize()
  const [from, setFrom] = useState<{ x: number; y: number; place: Place } | null>(null)
  const focused = useFocusedPane(tab.tab_id)
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === tab.tab_id) ?? NO_PANES)
  const title = tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`
  const full = place.max ? { x: 0, y: 0, w: width, h: height - TASKBAR } : place
  const box = {
    left: Math.max(0, Math.min(full.x, width - 120)),
    top: Math.max(0, Math.min(full.y, height - TASKBAR - 40)),
    width: Math.max(120, Math.min(full.w, width - Math.max(0, Math.min(full.x, width - 120)))),
    height: Math.max(60, Math.min(full.h, height - TASKBAR - Math.max(0, Math.min(full.y, height - TASKBAR - 40)))),
  }
  const drag = (event: any) => {
    if (place.max) return
    const x = (event?.x ?? 0) - (from?.x ?? 0)
    const y = (event?.y ?? 0) - (from?.y ?? 0)
    onPlace({ ...place, x: Math.max(-box.width + 80, Math.min(place.x + x, width - 80)), y: Math.max(0, Math.min(place.y + y, height - TASKBAR - 18)) })
  }
  return (
    <div style={{ position: "absolute", ...box, display: "flex", zIndex: active ? 20 : 10 + index }} onMouseDown={onRaise}>
      <Bevel style={{ flexGrow: 1, minWidth: 0, minHeight: 0, padding: 2 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, gap: 2 }}>
          <div
            onMouseDown={(event: any) => {
              setFrom({ x: event?.x ?? 0, y: event?.y ?? 0, place })
              onRaise()
            }}
            onMouseMove={(event: any) => {
              if (from) drag(event)
            }}
            onMouseUp={() => setFrom(null)}
            onDoubleClick={() => onPlace({ ...place, max: !place.max })}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 3,
              height: 18,
              flexShrink: 0,
              paddingLeft: 2,
              paddingRight: 2,
              background: { type: "linear-gradient", angle: 90, stops: [{ color: active ? "#000080" : "#808080", position: 0 }, { color: active ? "#1084d0" : "#b5b5b5", position: 1 }] },
            }}
          >
            <Icon name="terminal" size={14} color={active ? "#ffffff" : "#dfdfdf"} />
            <text style={{ fontSize: 11, fontWeight: "bold", color: active ? "#ffffff" : "#dfdfdf", flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{title}</text>
            <div style={{ flexGrow: 1 }} />
            <CaptionButton glyph="_" title="Minimize" onClick={() => onPlace({ ...place, min: true })} />
            <CaptionButton glyph={place.max ? "❐" : "□"} title={place.max ? "Restore" : "Maximize"} onClick={() => onPlace({ ...place, max: !place.max })} />
            <CaptionButton glyph="✕" title="Close" onClick={onClose} />
          </div>
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, gap: 2 }}>
            <Bevel sunken style={{ flexGrow: 1, minWidth: 0, minHeight: 0 }}>
              <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: "#000000" }}>
                <C.Layout tab={tab.tab_id} />
              </div>
            </Bevel>
          </div>
          <div style={{ display: "flex", flexDirection: "row", height: 18, flexShrink: 0, gap: 2 }}>
            <Bevel sunken style={{ flexGrow: 1, paddingLeft: 3, paddingRight: 3 }}>
              <text style={{ fontSize: 11, color: "#000000", flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{panes.find((p) => p.pane_id === focused)?.cwd ?? ""}</text>
            </Bevel>
            <Bevel sunken style={{ width: 58 }}>
              <text style={{ fontSize: 11, color: "#000000", paddingLeft: 3, whiteSpace: "nowrap" }}>{`${panes.length} pane${panes.length === 1 ? "" : "s"}`}</text>
            </Bevel>
          </div>
        </div>
      </Bevel>
    </div>
  )
}

// ── The Start menu and the taskbar ───────────────────────────────────

function StartMenu({ close }: { close(): void }) {
  const sessions = useSessions()
  const here = useSession()
  const tabs = useTabs()
  const window = useWindow()
  const run = (name: string) => {
    const context = windowContext(window.id)
    if (context) commands.run(name, context)
    close()
  }
  const item = (label: string, onClick: () => void, icon?: string, bold?: boolean) => (
    <div
      key={label}
      onClick={onClick}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 20, flexShrink: 0, paddingLeft: 6, paddingRight: 16, cursor: "pointer", hover: { backgroundColor: "#000080" } }}
    >
      {icon ? <Icon name={icon} size={12} color="#000000" /> : <div style={{ width: 12 }} />}
      <text style={{ fontSize: 11, fontWeight: bold ? "bold" : "normal", color: "#000000" }}>{label}</text>
    </div>
  )
  const divider = <div style={{ height: 1, marginTop: 2, marginBottom: 2, backgroundColor: "#808080", borderBottomWidth: 1, borderColor: "#ffffff" }} />
  return (
    <div style={{ position: "absolute", left: 2, bottom: TASKBAR + 2, zIndex: 100, display: "flex", flexDirection: "row" }}>
      <Bevel style={{ width: 340 }}>
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
          {/* The menu's banner: the system's name up the side, on the title's blue. There is no
              vertical text here, so the letters are stacked, one to a line. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 22,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "flex-end",
              paddingBottom: 8,
              background: { type: "linear-gradient", angle: 0, stops: [{ color: "#000080", position: 0 }, { color: "#1084d0", position: 1 }] },
            }}
          >
            {"Windows 98".split("").map((letter, index) => (
              <text key={index} style={{ fontSize: 12, fontWeight: "bold", color: "#c0c0c0", lineHeight: 13 }}>
                {letter === " " ? "" : letter}
              </text>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, paddingTop: 2, paddingBottom: 2 }}>
            {sessions.map((session: WindowSession) =>
              item(session.label, () => {
                window.show(session.workspace_id)
                close()
              }, session.workspace_id === here?.workspace_id ? "folder_open" : "folder"),
            )}
            {divider}
            {tabs.map((tab, index) =>
              item(tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`, () => {
                call("tab.select", { tab: num(tab.tab_id) }).catch(swallow)
                close()
              }, "terminal"),
            )}
            {divider}
            {item("New Tab", () => run("new_tab"), "plus")}
            {item("Settings", () => run("settings"), "settings")}
            {divider}
            {item("Shut Down…", () => run("quit"), "close", true)}
          </div>
        </div>
      </Bevel>
    </div>
  )
}

function Taskbar({ tabs, active }: { tabs: WindowTab[]; active?: string }) {
  const window = useWindow()
  const [start, setStart] = useState(false)
  const now = useNow(15000)
  const clock = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const agents = useApp((s) => s.snapshot?.panes.filter((p) => p.agent) ?? NO_PANES)
  const busy = agents.filter((a) => a.agent_status !== "idle").length
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: TASKBAR,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingLeft: 2,
        paddingRight: 2,
        backgroundColor: "#c0c0c0",
        borderTopWidth: 1,
        borderColor: "#ffffff",
        zIndex: 90,
      }}
    >
      <Button label="Start" pressed={start} icon="blocks" onClick={() => setStart((v) => !v)} style={{ width: 62, height: 22 }} />
      <div style={{ width: 1, height: 20, marginLeft: 2, marginRight: 2, backgroundColor: "#808080", borderRightWidth: 1, borderColor: "#ffffff" }} />
      {tabs.map((tab, index) => (
        <Button
          key={tab.tab_id}
          label={tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`}
          pressed={tab.tab_id === active}
          icon="terminal"
          onClick={() => call("tab.select", { tab: num(tab.tab_id) }).catch(swallow)}
          style={{ width: 160, height: 22 }}
        />
      ))}
      <div style={{ flexGrow: 1 }} />
      {busy ? (
        <Bevel sunken style={{ width: 52, height: 20 }}>
          <text style={{ fontSize: 11, color: "#000000", paddingLeft: 4 }}>{`${busy} busy`}</text>
        </Bevel>
      ) : null}
      <Bevel sunken style={{ width: 58, height: 20 }}>
        <text style={{ fontSize: 11, color: "#000000", paddingLeft: 6 }}>{clock}</text>
      </Bevel>
      {start ? <StartMenu close={() => setStart(false)} /> : null}
    </div>
  )
}

// ── The desktop ──────────────────────────────────────────────────────

const DEFAULT_PLACES: Record<string, Place> = {}

export function Desktop() {
  const window = useWindow()
  const tabs = useTabs()
  const here = useSession()
  const { width, height } = useWindowSize()
  const [places, setPlaces] = useLocal<Record<string, Place>>("win98.windows", DEFAULT_PLACES)
  const [order, setOrder] = useState<string[]>([])
  const active = here?.active_tab_id ?? undefined
  // A tab is a window here: the chord closes the one you are looking at.
  useBinding("cmd+w", "close_tab")
  useBinding("cmd+shift+w", "close_window")
  commands.useCommand("toggle_sidebar", "Show the desktop", () => setOrder([]))
  // A tab with no place gets a cascaded one: a window is born, it does not appear.
  const placeOf = (tab: string, index: number): Place => {
    const known = places[tab]
    if (known) return known
    const step = 24 * (index % 5)
    return { x: 24 + step, y: 24 + step, w: Math.max(320, Math.min(760, width - 120)), h: Math.max(220, Math.min(480, height - TASKBAR - 80)) }
  }
  const setPlace = (tab: string, next: Place) => setPlaces((old) => ({ ...old, [tab]: next }))
  const raise = (tab: string) => {
    if (active !== tab) call("tab.select", { tab: num(tab) }).catch(swallow)
    setOrder((old) => [...old.filter((t) => t !== tab), tab])
  }
  const rank = (tab: string) => order.indexOf(tab)
  const shown = tabs.filter((tab) => !placeOf(tab.tab_id, 0).min)
  const top = [...shown].sort((a, b) => rank(b.tab_id) - rank(a.tab_id))[0]
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: "#008080",
        fontFamily: "Tahoma",
        fontSize: 11,
        color: "#000000",
      }}
    >
      {/* The windows, one a tab, the one pressed last on top. */}
      {shown.map((tab, index) => (
        <DesktopWindow
          key={tab.tab_id}
          tab={tab}
          index={index}
          active={tab.tab_id === top?.tab_id}
          place={placeOf(tab.tab_id, index)}
          onPlace={(next) => setPlace(tab.tab_id, next)}
          onClose={() => call("tab.close", num(tab.tab_id), true).catch(swallow)}
          onRaise={() => raise(tab.tab_id)}
        />
      ))}
      {/* A tab that is folded away is a button on the taskbar alone: its place is still kept. */}
      {tabs
        .filter((tab) => placeOf(tab.tab_id, 0).min)
        .map((tab) => (
          <div
            key={tab.tab_id}
            onClick={() => setPlace(tab.tab_id, { ...placeOf(tab.tab_id, 0), min: false })}
            style={{ display: "none" }}
          />
        ))}
      <Taskbar tabs={tabs} active={active} />
      <div style={{ width: 1, height: 1 }} onDoubleClick={() => commands.run("new_tab", windowContext(window.id)!)} />
    </div>
  )
}

/** Nothing to draw yet: the server is starting. */
export function Starting({ title, detail }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#008080" }}>
      <Bevel style={{ width: 320, padding: 12 }}>
        <text style={{ fontSize: 12, fontWeight: "bold", color: "#000000", padding: 8 }}>{title}</text>
        <text style={{ fontSize: 11, color: "#000000", paddingLeft: 8, paddingBottom: 8 }}>{detail}</text>
      </Bevel>
    </div>
  )
}
