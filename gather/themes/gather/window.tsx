// Gather as a game: pumi's window is the office floor, seen from above. Each view is a room — grey
// carpet, a blue rim, its name on a sign — and each pane in it is a desk: a white desk with the
// terminal as its monitor, a keyboard and a mug, and an office chair on this side with whoever is
// working on it sitting down (back to us), its name tag under the chair. A desk holds its tabs
// along its top, as a game keeps papers in a tray, so several terminals can sit at one desk. The
// lobby down the left is one more room, on tiles, where every agent stands. Your character walks
// to the desk you focus. Menus are the game's framed dialog boxes. Started from the app's default
// window (runtime/app/app/theme/default.tsx): the behaviour is the default's, the look is this
// file's.
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, useDraggable, useMetrics, useTab as useTabModel, useTheme } from "pumi"
import {
  call,
  carried,
  commands,
  grouped,
  leafOf,
  paneOfTab,
  REGIONS,
  regionAt,
  renderComponent,
  runMove,
  stripDrop,
  tabDrop,
  useAgentOf,
  useAgents,
  useComponents,
  useDropBox,
  useFloats,
  useFocusedTab,
  useLayout,
  useLocal,
  useMenu,
  usePaneTabs,
  useRenderer,
  useSession,
  useSessions,
  useSidebar,
  useSlot,
  useTab,
  useView,
  useViews,
  useWindow,
  useZoomed,
  via,
  within,
  windowContext,
  type ActionItem,
  type Carried,
  type Components,
  type DialogProps,
  type MenuProps,
  type Tab,
  type Tree,
} from "pumi/theme"
import { Avatar, box, Bubble, Decor, Floor, FONT, Nametag, Sign, useBeat, type Facing } from "./art.tsx"

const swallow = (err: unknown) => console.error(String(err))

// ── The map: where each desk is, for you to walk to ─────────────────────────────────────────

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

class Desks {
  private rects = new Map<string, Rect>()
  private listeners = new Set<() => void>()
  private n = 0
  set(pane: string, rect: Rect) {
    const was = this.rects.get(pane)
    if (was && was.x === rect.x && was.y === rect.y && was.width === rect.width && was.height === rect.height) return
    this.rects.set(pane, rect)
    this.n++
    for (const l of this.listeners) l()
  }
  get(pane: string | undefined): Rect | undefined {
    return pane ? this.rects.get(pane) : undefined
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  version = () => this.n
}

const DesksContext = createContext<Desks | null>(null)

// ── Controls ────────────────────────────────────────────────────────────────────────────────

/** A square framed button, as a game's are. */
function PixelButton({ icon, onClick, title, active, size = 28 }: { icon: string; onClick(): void; title?: string; active?: boolean; size?: number }) {
  const t = useTheme()
  return (
    <div
      onClick={onClick}
      aria-label={title}
      style={{
        display: "flex",
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        ...box(t, "slot"),
        ...(active ? { borderColor: t.slotActive } : {}),
        color: t.slotText,
        cursor: "pointer",
        hover: { borderColor: t.slotActive },
        active: { backgroundColor: t.slotRing },
      }}
    >
      <Icon name={icon} size={Math.round(size / 2)} />
    </div>
  )
}

function Window() {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const desks = useMemo(() => new Desks(), [])
  // Whether the lobby shows is the app's side bar (`toggle_sidebar`), whatever theme draws it.
  const [sidebar, setSidebar] = useSidebar()
  const [width, setWidth] = useLocal("gather.sidebar.width", 236)
  const overlays = useSlot("window.overlay").components
  return (
    <DesksContext.Provider value={desks}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", backgroundColor: t.window, color: t.text, fontSize: m.fontSize, fontFamily: FONT }}>
        <Floor kind="wood" />
        <TopHud sidebar={sidebar} toggleSidebar={() => setSidebar((v) => !v)} />
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, paddingLeft: 14, paddingRight: 14, paddingBottom: 8, gap: 14 }}>
          {sidebar ? (
            <div style={{ display: "flex", flexDirection: "column", width, flexShrink: 0, minWidth: 0, position: "relative", backgroundColor: t.tileFloor, borderWidth: 2, borderColor: t.roomRim, borderRadius: 3 }}>
              <Floor kind="tile" />
              <RoomSign name="Lobby" />
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, paddingTop: 30 }}>
                <C.Panel point="panel" />
              </div>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 2, height: 70, flexShrink: 0, paddingBottom: 2, pointerEvents: "none" }}>
                <Decor name="plant" />
                <Decor name="sofa" />
                <Decor name="aquarium" />
              </div>
              <Resizer width={width} setWidth={setWidth} />
            </div>
          ) : null}
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
            <C.Layout />
          </div>
        </div>
        <StatusBar />
        <Walker />
        {overlays.map((v) => (
          <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {renderComponent(v)}
          </div>
        ))}
      </div>
    </DesksContext.Provider>
  )
}

/** A room's name, on a sign over its top edge, as Gather hangs one. */
function RoomSign({ name, dot }: { name: string; dot?: string }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", width: "100%", position: "absolute", top: 4, left: 0, pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 22, paddingLeft: dot ? 8 : 10, paddingRight: 10, borderRadius: 11, backgroundColor: t.roomLabel, borderWidth: 1, borderColor: t.roomLabelRim }}>
        {dot ? <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} /> : null}
        <text style={{ fontSize: 13, color: t.roomLabelText, whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 240 }}>{name}</text>
      </div>
    </div>
  )
}

/** The lobby's wall: drag it to size the lobby. */
function Resizer({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const t = useTheme()
  const [from, setFrom] = useState<{ x: number; width: number } | undefined>()
  return (
    <div
      onMouseDown={(e) => setFrom({ x: e.x ?? 0, width })}
      onMouseMove={(e) => from && setWidth(Math.min(600, Math.max(170, from.width + (e.x ?? 0) - from.x)))}
      onMouseUp={() => setFrom(undefined)}
      style={{ position: "absolute", top: 0, right: -5, width: 10, height: "100%", cursor: "col-resize", hover: { backgroundColor: `${t.slotActive}66` } }}
    />
  )
}

// ── You ─────────────────────────────────────────────────────────────────────────────────────

interface Point {
  x: number
  y: number
}

const STEPS = [1, 0, 2, 0]

/**
 * You, on the floor: standing at the desk you're at. When the focus moves you walk there — out of
 * the room, along the floor, and in at the other desk.
 */
function Walker() {
  const t = useTheme()
  const desks = useContext(DesksContext)
  const tree = useLayout()
  const focused = useFocusedTab()
  // The desk of the tab in focus: a pane holds several, and only one of them is where you are.
  const pane = tree && focused ? paneOfTab(tree, focused)?.pane : undefined
  useSyncExternalStore(desks?.subscribe ?? (() => () => {}), desks?.version ?? (() => 0))
  const rect = desks?.get(pane)
  const target = rect ? { x: rect.x + Math.round(rect.width / 2) - 68, y: rect.y + rect.height - 58 } : undefined
  const [me, setMe] = useState<{ at: Point; facing: Facing; frame: number } | undefined>()
  const at = useRef<Point | undefined>(undefined)
  const desk = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!target) return
    const from = at.current
    const moved = desk.current !== pane
    desk.current = pane
    const stand = () => {
      at.current = target
      setMe({ at: target, facing: "down", frame: 0 })
    }
    // The first time, or the same desk moved or resized: you are simply there.
    if (!from || !moved) return stand()
    const hall = Math.max(6, Math.min(from.y, target.y) - 26)
    const path = [from, { x: from.x, y: hall }, { x: target.x, y: hall }, target]
    const legs = path.slice(1).map((p, i) => Math.abs(p.x - path[i]!.x) + Math.abs(p.y - path[i]!.y))
    const total = legs.reduce((a, b) => a + b, 0)
    if (total < 1) return stand()
    const speed = Math.max(0.5, total / 1400) // points a millisecond: no walk takes over 1.4s
    const start = Date.now()
    const timer = setInterval(() => {
      const ms = Date.now() - start
      let d = ms * speed
      if (d >= total) {
        clearInterval(timer)
        return stand()
      }
      let i = 0
      while (d > legs[i]!) d -= legs[i++]!
      const a = path[i]!
      const b = path[i + 1]!
      const k = legs[i] ? d / legs[i]! : 1
      const p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
      const facing: Facing = b.x > a.x ? "right" : b.x < a.x ? "left" : b.y < a.y ? "up" : "down"
      at.current = p
      setMe({ at: p, facing, frame: STEPS[Math.floor(ms / 110) % 4]! })
    }, 16)
    return () => clearInterval(timer)
  }, [pane, target?.x, target?.y])
  if (!target || !me) return null
  return (
    <div style={{ position: "absolute", left: Math.round(me.at.x) - 8, top: Math.round(me.at.y), width: 56, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, pointerEvents: "none" }}>
      <Nametag dot={t.success}>You</Nametag>
      <Avatar who="you" facing={me.facing} frame={me.frame} />
    </div>
  )
}

// ── The HUD ─────────────────────────────────────────────────────────────────────────────────

/** Along the top, over the floor: the lobby's switch, the session's plate, the minimap. */
function TopHud({ sidebar, toggleSidebar }: { sidebar: boolean; toggleSidebar(): void }) {
  const t = useTheme()
  const window = useWindow()
  const session = useSession()
  const sessions = useSessions()
  const [picking, setPicking] = useState(false)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 46, flexShrink: 0, gap: 8, paddingLeft: 80, paddingRight: 14 }}>
      <PixelButton icon="layout_sidebar_left" title="Toggle lobby" active={sidebar} onClick={toggleSidebar} />
      <div
        onClick={() => setPicking((v) => !v)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingLeft: 8, paddingRight: 8, flexShrink: 0, maxWidth: 240, cursor: "pointer", ...box(t, "panel"), hover: { backgroundColor: t.hover } }}
      >
        <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.success, flexShrink: 0 }} />
        <text style={{ fontSize: 14, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{session?.label || "pumi"}</text>
        <Icon name="chevron_up_down" size={11} color={t.muted} />
      </div>
      {picking ? (
        <anchored fill="window">
          <div onClick={() => setPicking(false)} style={{ width: "100%", height: "100%", paddingLeft: 116, paddingTop: 44 }}>
            <Choices
              items={[
                ...sessions.map((s) => ({ label: s.label || s.workspace_id, checked: s.workspace_id === window.session, run: () => window.show(s.workspace_id) })),
                { label: "New session", run: () => commands.run("new_workspace", ctx(window)) },
              ]}
              close={() => setPicking(false)}
            />
          </div>
        </anchored>
      ) : null}
      <div style={{ flexGrow: 1 }} />
      <Minimap />
    </div>
  )
}

/** The view you're in, from above: its desks as the layout splits them, you a blinking dot. */
function Minimap() {
  const t = useTheme()
  const tree = useLayout()
  const focused = useFocusedTab()
  const view = useView()
  const views = useViews()
  const index = views.findIndex((x) => x.view_id === view?.view_id)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingLeft: 4, paddingRight: 6, flexShrink: 0, ...box(t, "panel") }}>
      <div style={{ display: "flex", width: 96, height: 28, backgroundColor: t.carpetFloor, borderWidth: 1, borderColor: t.roomRim }}>
        {tree ? <MiniSplit tree={tree} focused={focused} /> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <text style={{ fontSize: 9, color: t.faint }}>FLOOR</text>
        <text style={{ fontSize: 13 }}>{`${index + 1}/${views.length}`}</text>
      </div>
    </div>
  )
}

function MiniSplit({ tree, focused }: { tree: Tree; focused?: string }) {
  if ("pane" in tree) return <MiniDesk tab={tree.active ?? tree.tabs[0]} here={(tree.active ?? tree.tabs[0]) === focused} />
  if ("app" in tree) return null
  const row = tree.axis === "row"
  return (
    <div style={{ display: "flex", flexDirection: row ? "row" : "column", width: "100%", height: "100%", gap: 1 }}>
      <div style={{ display: "flex", flexShrink: 0, ...(row ? { width: pct(tree.ratio), height: "100%" } : { height: pct(tree.ratio), width: "100%" }) }}>
        <MiniSplit tree={tree.first} focused={focused} />
      </div>
      <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
        <MiniSplit tree={tree.second} focused={focused} />
      </div>
    </div>
  )
}

function MiniDesk({ tab, here }: { tab?: string; here: boolean }) {
  const t = useTheme()
  const agent = useAgentOf(tab)
  const blink = useBeat(450, here) % 2 === 0
  const status = agent ? (t[`agent.${agent.agent_status || "unknown"}`] ?? t["agent.unknown"]) : undefined
  return (
    <div
      onClick={() => tab && call(via(tab, "tab.focus"), tab).catch(swallow)}
      style={{ display: "flex", flexDirection: "row", flexGrow: 1, gap: 2, padding: 2, alignItems: "flex-start", backgroundColor: t.desk, cursor: "pointer" }}
    >
      {here ? <div style={{ width: 4, height: 4, backgroundColor: blink ? t.success : t.desk }} /> : null}
      {status ? <div style={{ width: 4, height: 4, backgroundColor: status }} /> : null}
    </div>
  )
}

/** The context a click in `window` runs commands in. */
function ctx(window: { id: number }): commands.Context {
  const context = windowContext(window.id)
  if (!context) throw new Error(`pumi: no window ${window.id}`)
  return context
}

interface MenuItem {
  label: string
  checked?: boolean
  run(): void
}

/** A dialog box of choices; the one you're on gets the cursor. */
function Choices({ items, close }: { items: MenuItem[]; close(): void }) {
  const t = useTheme()
  const [at, setAt] = useState(-1)
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 220, padding: 6, ...box(t, "dialog") }}>
      {items.map((item, i) => (
        <div
          key={i}
          onMouseEnter={() => setAt(i)}
          onClick={() => {
            close()
            item.run()
          }}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 4, paddingRight: 10, cursor: "pointer", backgroundColor: i === at ? t.selected : undefined }}
        >
          <Cursor on={i === at} />
          <text style={{ fontSize: 14, flexGrow: 1 }}>{item.label}</text>
          {item.checked ? <div style={{ width: 6, height: 6, backgroundColor: t.success }} /> : null}
        </div>
      ))}
    </div>
  )
}

/** A dialog's pointing hand: the ▶ before the choice you're on. */
function Cursor({ on }: { on: boolean }) {
  const t = useTheme()
  const nudge = useBeat(300, on) % 2
  return (
    <div style={{ display: "flex", width: 14, paddingLeft: on ? nudge : 0, flexShrink: 0 }}>
      {on ? <text style={{ fontSize: 11, color: t.cursor }}>▶</text> : null}
    </div>
  )
}

/** The hotbar: one slot a view, its number above it, the one you're on lit gold. */
function ViewBar({ session }: { session?: string }) {
  const t = useTheme()
  const C = useComponents()
  const views = useViews(session)
  const front = useSession(session)?.active_view_id
  const window = useWindow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, padding: 4, minWidth: 0, flexShrink: 1, ...box(t, "panel") }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 1, overflowX: "scroll" }}>
        {views.map((view, index) => (
          <C.View key={view.view_id} view={view.view_id} index={index} active={view.view_id === front} />
        ))}
      </div>
      <PixelButton icon="plus" title="New view" size={40} onClick={() => commands.run("new_view", ctx(window))} />
    </div>
  )
}

function View({ view: id, active, index }: { view: string; active: boolean; index: number }) {
  const t = useTheme()
  const view = useView(id)
  const { actions } = useSlot("view.actions")
  if (!view) return null
  const label = view.label && !/^\d+$/.test(view.label) ? view.label : `View ${index + 1}`
  const status = view.agent_status ? (t[`agent.${view.agent_status}`] ?? t["agent.unknown"]) : undefined
  return (
    <div
      onClick={() => call(via(id, "view.focus"), id).catch(swallow)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 40,
        minWidth: 52,
        maxWidth: 160,
        paddingLeft: 10,
        paddingRight: active ? 4 : 10,
        flexShrink: 1,
        position: "relative",
        cursor: "pointer",
        ...box(t, "slot"),
        ...(active ? { borderColor: t.slotActive, boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 2, color: t.slotActiveRing, inset: true } } : {}),
        hover: { borderColor: t.slotActive },
      }}
    >
      <text style={{ position: "absolute", top: 1, left: 4, fontSize: 9, color: t.slotNumber }}>{`${index + 1}`}</text>
      {status ? <div style={{ position: "absolute", top: 4, right: 4, width: 5, height: 5, backgroundColor: status }} /> : null}
      <text style={{ fontSize: 13, color: active ? t.slotText : t.slotTextDim, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0, marginTop: 4 }}>{label}</text>
      <Point point="view.badge" args={{ view: id }} />
      {actions.map((a) => (
        <Contributed key={`${a.plugin}/${a.id}`} action={a} args={{ view: id }} />
      ))}
      {active ? (
        <div
          onClick={(e: any) => {
            e?.stopPropagation?.()
            call(via(id, "view.close"), id).catch(swallow)
          }}
          style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", color: t.slotText, opacity: 0.6, hover: { opacity: 1, backgroundColor: t.slotRing } }}
        >
          <Icon name="close" size={9} />
        </div>
      ) : null}
    </div>
  )
}

/** A point's components, given `args`, and its actions as buttons. */
function Point({ point, args, gap = 4 }: { point: string; args?: Record<string, unknown>; gap?: number }) {
  const C = useComponents()
  const { components, actions } = useSlot(point, args)
  if (!components.length && !actions.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap, flexShrink: 0 }}>
      {components.map((v) => renderComponent(v, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
    </div>
  )
}

/**
 * The `Menu` part: every menu of the app's (a tab's, an agent's: `useMenu`), as a pixel dialog
 * where the mouse is. Its groups with a rule between; a submenu (Open With, Move To) opens in
 * place under its row.
 */
function Menu({ at, actions, components, args, close }: MenuProps) {
  const t = useTheme()
  return (
    <anchored position={at} fit="snap" deferred occlude onMouseDownOutside={close}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 190, padding: 6, ...box(t, "dialog") }}>
        <MenuRows actions={actions} close={close} depth={0} />
        {components?.map((v) => renderComponent(v, { ...args, close }))}
      </div>
    </anchored>
  )
}

function MenuRows({ actions, close, depth }: { actions: ActionItem[]; close(): void; depth: number }) {
  const t = useTheme()
  const [open, setOpen] = useState<string>()
  return (
    <>
      {grouped(actions).map((group, i) => (
        <Fragment key={`${i}:${group[0]!.group ?? ""}`}>
          {i > 0 ? <div style={{ height: 2, marginTop: 4, marginBottom: 4, backgroundColor: t.border }} /> : null}
          {group.map((a) => (
            <Fragment key={`${a.plugin}/${a.id}`}>
              <div
                onClick={() => {
                  if (a.items) return setOpen(open === a.id ? undefined : a.id)
                  close()
                  a.run()
                }}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingLeft: 8 + depth * 14, paddingRight: 10, cursor: "pointer", opacity: a.disabled ? 0.5 : 1, hover: { backgroundColor: t.selected } }}
              >
                {a.icon ? <Icon name={a.icon} size={12} color={t.muted} /> : null}
                <text style={{ fontSize: 14, color: a.danger ? t.error : t.text }}>{a.title}</text>
                <div style={{ flexGrow: 1, minWidth: 12 }} />
                {a.keys ? <text style={{ fontSize: 12, color: t.faint }}>{a.keys}</text> : null}
                {a.checked ? <Icon name="check" size={12} color={t.accent} /> : null}
                {a.items ? <Icon name={open === a.id ? "chevron_down" : "chevron_right"} size={12} color={t.muted} /> : null}
              </div>
              {a.items && open === a.id ? <MenuRows actions={a.items} close={close} depth={depth + 1} /> : null}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  )
}

/** The `Dialog` part: a question as a pixel dialog in the middle of the room. */
function Dialog({ title, detail, confirm, cancel, danger, input, onConfirm, onCancel }: DialogProps) {
  const t = useTheme()
  const button = (label: string, fill: string | undefined, run: () => void) => (
    <div onClick={run} style={{ display: "flex", alignItems: "center", height: 30, paddingLeft: 14, paddingRight: 14, cursor: "pointer", ...box(t, "slot"), ...(fill ? { backgroundColor: fill } : {}) }}>
      <text style={{ fontSize: 14, color: fill ? t.accentText : t.text }}>{label}</text>
    </div>
  )
  return (
    <anchored fill="window" occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
        <div
          autoFocus={!input}
          tabIndex={0}
          onMouseDownOutside={onCancel}
          onKeyDown={(e: any) => {
            if (e.key === "escape") onCancel()
            else if (e.key === "enter" && !input) onConfirm()
          }}
          style={{ display: "flex", flexDirection: "column", gap: 10, width: 360, padding: 16, keyboardFocusDim: false, ...box(t, "dialog") }}
        >
          <text style={{ fontSize: 16, color: t.text }}>{title}</text>
          {detail ? <text style={{ fontSize: 13, color: t.muted }}>{detail}</text> : null}
          {input ? (
            <input
              autoFocus
              value={input.value}
              placeholder={input.placeholder}
              onChange={(e: any) => input.onChange(e.value ?? "")}
              onSubmit={onConfirm}
              style={{ height: 30, fontSize: 14, color: t.text, paddingLeft: 8, ...box(t, "slot") }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            {button(cancel, undefined, onCancel)}
            {button(confirm, danger ? t.error : t.accent, onConfirm)}
          </div>
        </div>
      </div>
    </anchored>
  )
}

function Contributed({ action, args }: { action: ActionItem; args?: unknown }) {
  const C = useComponents()
  return <C.Action action={action} args={args} />
}

const pct = (n: number) => `${n * 100}%`

// ── The room ────────────────────────────────────────────────────────────────────────────────

/** The view's room: its carpet, its sign, the desks on it. */
function Layout({ view }: { view?: string }) {
  const t = useTheme()
  const tree = useLayout(view)
  const focused = useFocusedTab(view)
  const zoomed = useZoomed(view)
  const shown = useView(view)
  const session = useSession(shown?.workspace_id)
  const views = useViews(shown?.workspace_id)
  const index = views.findIndex((x) => x.view_id === shown?.view_id)
  const C = useComponents()
  // Before the early return: a hook after it changes the hook order once a view has a tree.
  const floats = useFloats(view ?? undefined)
  // Zoomed, you sit at one desk: its tabs stay along its top, and the others are out of sight.
  const zoom = zoomed && tree && focused ? paneOfTab(tree, focused) : undefined
  const body = !tree ? <EmptyDesk /> : zoom ? <Leaf pane={zoom.pane} tabs={zoom.tabs} active={zoom.active} focused zoomed /> : <Split tree={tree} focused={focused} />
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, position: "relative", backgroundColor: t.carpetFloor, borderWidth: 2, borderColor: tree ? t.roomRing : t.roomRim, borderRadius: 3, boxShadow: { offsetX: 0, offsetY: 3, blurRadius: 0, spreadRadius: 0, color: t.drop } }}>
      <Floor kind="carpet" />
      <RoomSign name={`${session?.label || "pumi"} ${index + 1}`} dot={t.success} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, paddingTop: 28 }}>
        {body}
      </div>
      {floats.length ? (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
          {floats.map((p) => (
            <C.Float key={p.tab_id} tab={p.tab_id} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** A room with no desks in it yet: an empty chair, and the way to open one. */
function EmptyDesk() {
  const t = useTheme()
  const window = useWindow()
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
      <Decor name="plant" />
      <div
        onClick={() => commands.run("split_vertical", ctx(window))}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingLeft: 10, paddingRight: 10, cursor: "pointer", ...box(t, "tag") }}
      >
        <Icon name="plus" size={11} color={t.tagText} />
        <text style={{ fontSize: 13, color: t.tagText }}>New desk</text>
      </div>
    </div>
  )
}

/** A split: its first side takes its share of the room, the second starts past the floor between. */
function Split({ tree, focused }: { tree: Tree; focused?: string }) {
  if ("pane" in tree) return <Leaf pane={tree.pane} tabs={tree.tabs} active={tree.active} focused={!!focused && tree.tabs.includes(focused)} zoomed={false} />
  if ("app" in tree) return null
  const row = tree.axis === "row"
  return (
    <div style={{ display: "flex", flexDirection: row ? "row" : "column", width: "100%", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", flexShrink: 0, ...(row ? { width: pct(tree.ratio), height: "100%" } : { height: pct(tree.ratio), width: "100%" }) }}>
        <Split tree={tree.first} focused={focused} />
      </div>
      <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0, ...(row ? { paddingLeft: 10 } : { paddingTop: 10 }) }}>
        <Split tree={tree.second} focused={focused} />
      </div>
    </div>
  )
}

function Leaf({ pane, tabs, active, focused, zoomed }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean }) {
  const C = useComponents()
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}>
      <C.Pane pane={pane} tabs={tabs} active={active} focused={focused} zoomed={zoomed} lifted={zoomed} />
    </div>
  )
}

/** What a tab is called on its desk: its label, its title, or where it is. */
function tabName(tab: Tab | undefined): string {
  if (!tab) return "Tab"
  if (tab.label && !/^\d+$/.test(tab.label)) return tab.label
  if (tab.terminal_title) return tab.terminal_title
  const cwd = tab.cwd?.replace(/\/+$/, "")
  return cwd ? cwd.split("/").pop() || "/" : tab.block
}

/** What a desk is called: the tab in front at it. */
function deskName(tab: Tab | undefined): string {
  return tab ? tabName(tab) : "Desk"
}

/** Whether a drag carries a tab that could go into `pane`'s tray at some index. */
const intoStrip = (pane: string, tabs: string[]) => (data: unknown): data is Carried => {
  const it = carried(data)
  if (!it) return false
  const leaf = { pane, tabs }
  return [...tabs.keys(), tabs.length].some((i) => stripDrop(it, leaf, i) !== undefined)
}

/** The rest of a desk's tray: a tab dropped there goes last. */
function StripEnd({ pane, tabs }: { pane: string; tabs: string[] }) {
  const t = useTheme()
  const zone = useDropBox(intoStrip(pane, tabs), (it) => {
    const move = stripDrop(it, { pane, tabs }, tabs.length)
    if (move) runMove(move)
  })
  const it = zone.drag ? carried(zone.drag.data) : undefined
  const lit = zone.isOver && it ? stripDrop(it, { pane, tabs }, tabs.length) : undefined
  return <div ref={zone.ref} style={{ display: "flex", flexGrow: 1, height: 24, minWidth: 8, borderLeftWidth: lit ? 2 : 0, borderColor: t.slotActive }} />
}

/**
 * A pane is a desk: the white desk with the tab in front as its monitor, a keyboard, a mug and a
 * sticky note on it, and the chair this side with whoever works there sitting down, facing the
 * screen, its name tag under the chair. The desk's other tabs lie along its top, in a tray, so
 * several terminals can sit at one desk.
 */
function Pane({ pane: id, tabs, active, focused }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean; lifted?: boolean }) {
  const t = useTheme()
  const C = useComponents()
  const desks = useContext(DesksContext)
  const front = active ?? tabs[0] ?? id
  const tab = useTab(front)
  const { components: strip } = useSlot("tab.strip", { tab: front })
  const { open, menu } = useMenu("tab.menu", { tab: front })
  const tabbed = usePaneTabs()
  const leaf = { pane: id, tabs }
  // A float is drawn over the view and takes nothing by drag; a tiled desk does.
  const tiled = ((tab?.place as { kind?: string } | undefined)?.kind ?? "tiled") === "tiled"
  // A tab dropped on the desk's edge splits it; dropped in its middle, it joins the desk's tray.
  const zone = useDropBox<Carried>(
    (data): data is Carried => {
      const it = carried(data)
      return tiled && !!it && REGIONS.some((region) => tabDrop(it, leaf, region, tabbed) !== undefined)
    },
    (it, at, box) => {
      const { fx, fy } = within(at, box)
      const move = tabDrop(it, leaf, regionAt(fx, fy, tabbed), tabbed)
      if (move) runMove(move)
    },
    -1,
  )
  const dropping = zone.isOver
  return (
    <div
      ref={zone.ref}
      onLayout={(e) => desks?.set(id, { x: e.x ?? 0, y: e.y ?? 0, width: e.width ?? 0, height: e.height ?? 0 })}
      onMouseDown={() => {
        if (!focused) call(via(front, "tab.focus"), front).catch(swallow)
      }}
      onAuxClick={open}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, padding: 10, paddingBottom: 2, position: "relative" }}
    >
      {tabs.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 4, height: 28, flexShrink: 0, paddingLeft: 2, paddingRight: 2, overflowX: "scroll" }}>
          {tabs.map((tab, index) => (
            <C.PaneTab key={tab} tab={tab} pane={id} index={index} active={tab === front} focused={focused} />
          ))}
          <StripEnd pane={id} tabs={tabs} />
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          padding: 8,
          paddingBottom: 5,
          borderRadius: 5,
          backgroundColor: t.desk,
          borderWidth: 2,
          borderColor: focused ? t.deskFocus : t.deskRim,
          boxShadow: [
            { offsetX: 0, offsetY: 4, blurRadius: 0, spreadRadius: 0, color: t.deskEdge },
            ...(focused ? [{ offsetX: 0, offsetY: 0, blurRadius: 14, spreadRadius: 0, color: t.deskGlow }] : []),
          ],
        }}
      >
        {strip.map((v) => renderComponent(v, { tab: front }))}
        <C.TabBody key={front} tab={front} focused={focused} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 22, flexShrink: 0, paddingTop: 3 }}>
          <Decor name="mug" />
          <Decor name="keyboard" />
          <Decor name="sticky" />
          <div style={{ flexGrow: 1 }} />
          <Point point="tab.toolbar" args={{ tab: front }} />
        </div>
      </div>
      <Sitter tab={front} name={deskName(tab)} focused={focused} />
      {dropping ? (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: `${t.slotActive}22`, borderWidth: 2, borderColor: t.slotActive, pointerEvents: "none" }} />
      ) : null}
      {menu}
    </div>
  )
}

/**
 * One tab in a desk's tray: a press brings it to the front and gives its desk the focus, a press
 * with the right hand opens its menu, and a drag carries it along the tray, into another desk's,
 * or onto a desk's edge. A tab dropped on it goes before it, or after it past its middle.
 */
function PaneTab({ tab: id, pane, index, active, focused }: { tab: string; pane: string; index: number; active: boolean; focused: boolean }) {
  const t = useTheme()
  const tab = useTab(id)
  const tree = useLayout(tab?.view_id)
  const agent = useAgentOf(id)
  const status = agent ? (t[`agent.${agent.agent_status || "unknown"}`] ?? t["agent.unknown"]) : undefined
  const draggable = useDraggable<Carried>({ kind: "pumi.tab", tab: id })
  const { open, menu } = useMenu("tab.menu", { tab: id })
  const leaf = { pane, tabs: leafOf(tree, pane)?.tabs ?? [id] }
  const zone = useDropBox(intoStrip(pane, leaf.tabs), (it, at, box) => {
    const before = !box || at.x < box.x + box.width / 2
    const move = stripDrop(it, leaf, before ? index : index + 1)
    if (move) runMove(move)
  })
  const it = zone.drag ? carried(zone.drag.data) : undefined
  const at = zone.isOver && zone.drag ? { x: zone.drag.x, y: zone.drag.y } : undefined
  const area = at ? zone.box() : undefined
  const side = it && at ? (!area || at.x < area.x + area.width / 2 ? "left" : "right") : undefined
  const lit = side && it && stripDrop(it, leaf, side === "left" ? index : index + 1) ? side : undefined
  if (!tab) return null
  return (
    <div
      ref={zone.ref}
      {...draggable.props}
      onMouseDown={(e: any) => {
        draggable.props.onMouseDown(e)
        // The tray's tab is what was pressed: the desk around it must not bring the front one back.
        e?.stopPropagation?.()
        if ((e?.button ?? 0) !== 0) return
        if (!active || !focused) call(via(id, "tab.focus"), id).catch(swallow)
      }}
      onAuxClick={(e: any) => {
        e?.stopPropagation?.()
        open(e)
      }}
      title={tab.cwd ?? undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 24,
        minWidth: 44,
        maxWidth: 150,
        paddingLeft: 6,
        paddingRight: 2,
        flexShrink: 1,
        position: "relative",
        cursor: draggable.dragging ? "grabbing" : "pointer",
        opacity: draggable.dragging ? 0.55 : 1,
        ...box(t, "slot"),
        ...(active ? { borderColor: t.slotActive } : {}),
        ...(lit === "left" ? { borderLeftColor: t.slotActive } : lit === "right" ? { borderRightColor: t.slotActive } : {}),
        hover: { borderColor: t.slotActive },
      }}
    >
      {status ? <div style={{ width: 5, height: 5, flexShrink: 0, backgroundColor: status }} /> : null}
      <text style={{ fontSize: 11, color: active ? t.slotText : t.slotTextDim, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{tabName(tab)}</text>
      <div style={{ flexGrow: 1 }} />
      {active ? (
        <div
          onClick={(e: any) => {
            e?.stopPropagation?.()
            call(via(id, "tab.close"), id).catch(swallow)
          }}
          style={{ display: "flex", width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center", color: t.slotText, opacity: 0.6, hover: { opacity: 1, backgroundColor: t.slotRing } }}
        >
          <Icon name="close" size={8} />
        </div>
      ) : null}
      {menu}
    </div>
  )
}

/**
 * The `TabBody` part: the tab's block as its renderer draws it (`useRenderer`; the terminal's
 * is the bundled `pumi/terminal`), with the `tab.overlay` components over it, in the desk's
 * monitor frame.
 */
function TabBody({ tab: id, focused }: { tab: string; focused: boolean }) {
  const t = useTheme()
  const tab = useTab(id)
  const renderer = useRenderer(id)
  // A renderer is given the SDK's model (`RendererProps`), not the theme's snapshot of the tab.
  const model = useTabModel(id)
  const overlays = useSlot("tab.overlay").components
  // Every block is drawn by the renderer a plugin gives it, terminals included (`useRenderer`):
  // the terminal's is the bundled plugin `pumi/terminal`.
  const body: ReactNode = !tab ? null : renderer ? (
    renderComponent(renderer, { tab: model, block: tab.block, focused })
  ) : (
    <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
      <text style={{ color: t.faint }}>{`Nothing draws ${tab.block} blocks`}</text>
    </div>
  )
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
        padding: 3,
        borderRadius: 4,
        backgroundColor: t.editor,
        borderWidth: 6,
        borderColor: t.monitorBezel,
      }}
    >
      {body}
      {overlays.map((v) => (
        <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {renderComponent(v, { tab: id, focused })}
        </div>
      ))}
    </div>
  )
}

/** Whoever works at this desk, sitting in its chair — or the empty chair, if no one does. */
function Sitter({ tab, name, focused }: { tab: string; name: string; focused: boolean }) {
  const t = useTheme()
  const agent = useAgentOf(tab)
  const status = agent?.agent_status || "unknown"
  const working = status === "working"
  const alarmed = status === "blocked" || status === "error"
  const bob = useBeat(working ? 300 : 450, working || alarmed) % 2
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, height: 62, paddingTop: 2 }}>
      <div style={{ position: "relative", width: 46, height: 34 }}>
        <Decor name="chair" style={{ position: "absolute", left: 7, top: 12 }} />
        {agent ? <Avatar who={tab} sitting style={{ position: "absolute", left: 11, top: working ? bob : 0 }} /> : null}
        {agent ? <Bubble status={status} style={{ position: "absolute", left: 30, top: alarmed ? -bob * 2 : 0 }} /> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 20, paddingLeft: 8, paddingRight: 8, borderRadius: 7, ...box(t, focused ? "tagActive" : "tag") }}>
        <text style={{ fontSize: 12, color: t.tagText, whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 180 }}>{name}</text>
      </div>
    </div>
  )
}

/** A length of a float: cells (a number), `"60%"` or `"36px"`. */
function length(value: unknown, cells: number): number | string {
  if (typeof value === "number") return Math.round(value * cells)
  if (typeof value === "string" && /^\d+(\.\d+)?(px|%)$/.test(value)) return value
  return value === "fill" ? "100%" : 0
}

/** What a length is a share of its parent, when it was written as one (`"80%"`). */
function share(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim().endsWith("%")) return undefined
  const percent = Number.parseFloat(value)
  return Number.isFinite(percent) ? percent : undefined
}

/** Where a float sits in the tab: its anchor's corner, its row and column in from it. */
function placement(place: any, cells: { w: number; h: number }): Record<string, unknown> {
  const anchor = String(place?.anchor ?? "NW")
  const style: Record<string, unknown> = {
    width: length(place?.width, cells.w) || undefined,
    height: length(place?.height, cells.h) || undefined,
  }
  const row = length(place?.row, cells.h)
  const col = length(place?.col, cells.w)
  if (anchor === "center") {
    // A share has no pixel size to halve, so its corner moves in by half of what it leaves over.
    const w = share(place?.width)
    const h = share(place?.height)
    return {
      ...style,
      left: w === undefined ? "50%" : `${(100 - w) / 2}%`,
      top: h === undefined ? "50%" : `${(100 - h) / 2}%`,
      transform: undefined,
      marginLeft: typeof style.width === "number" ? -style.width / 2 : 0,
      marginTop: typeof style.height === "number" ? -style.height / 2 : 0,
    }
  }
  const top = anchor.startsWith("N")
  const bottom = anchor.startsWith("S")
  const left = anchor.endsWith("W")
  const right = anchor.endsWith("E")
  return {
    ...style,
    ...(top ? { top: row } : bottom ? { bottom: row } : { top: "50%" }),
    ...(left ? { left: col } : right ? { right: col } : { left: "50%" }),
  }
}

/** A tab floating over the view: a room in a dialog box. */
function Float({ tab: id }: { tab: string }) {
  const t = useTheme()
  const C = useComponents()
  const tab = useTab(id)
  const place: any = (tab as any)?.place ?? {}
  const close = () => call(via(id, "tab.close"), id).catch(swallow)
  const dismiss: string[] = place.dismiss ?? []
  const style = placement(place, { w: 7.8, h: 18 })
  return (
    <div
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: place.backdrop ? `#000000${Math.round((place.backdrop / 100) * 255).toString(16).padStart(2, "0")}` : undefined }}
      onMouseDown={dismiss.includes("press") || dismiss.includes("press-outside") ? close : undefined}
    >
      <div
        autoFocus
        tabIndex={0}
        onKeyDown={(e: any) => {
          if (e.key === "escape" && dismiss.includes("escape")) {
            e.preventDefault?.()
            close()
          }
        }}
        onMouseDown={(e: any) => e?.stopPropagation?.()}
        style={{ position: "absolute", display: "flex", flexDirection: "column", overflow: "hidden", padding: 4, ...box(t, "dialog"), ...style }}
      >
        <C.Pane pane={id} tabs={[id]} active={id} focused zoomed={false} />
      </div>
    </div>
  )
}

// ── The lobby ───────────────────────────────────────────────────────────────────────────────

/**
 * The lobby's sections, each under a sign: the players (every agent, whatever tab it's in)
 * standing on the tiles, and each package's view on a framed notice board.
 */
function Panel({ point }: { point: string }) {
  const t = useTheme()
  const { components } = useSlot(point)
  const [collapsed, setCollapsed] = useLocal<string[]>(`gather.${point}.collapsed`, [])
  const sections: { key: string; title: string; body: ReactNode; board: boolean }[] = [
    { key: "agents", title: "Players", body: <Agents />, board: false },
    ...components.map((v) => ({ key: `${v.plugin}/${v.id}`, title: v.title ?? v.id, body: renderComponent(v), board: true })),
  ]
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      {point === "panel" ? <SessionHeader /> : null}
      {sections.map((s) => {
        const open = !collapsed.includes(s.key)
        return (
          <div key={s.key} style={{ display: "flex", flexDirection: "column", minHeight: 0, ...(open ? { flexGrow: 1, flexBasis: 0 } : {}) }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", height: 30, paddingLeft: 8, paddingRight: 8, flexShrink: 0 }}>
              <Sign
                onClick={() => setCollapsed(open ? [...collapsed, s.key] : collapsed.filter((k) => k !== s.key))}
                before={<Icon name={open ? "chevron_down" : "chevron_right"} size={10} color={t.signText} />}
              >
                {s.title}
              </Sign>
            </div>
            {open ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  minHeight: 0,
                  overflowY: "scroll",
                  ...(s.board ? { marginLeft: 8, marginRight: 8, marginBottom: 8, padding: 2, ...box(t, "panel") } : {}),
                }}
              >
                {s.body}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function SessionHeader() {
  const t = useTheme()
  const session = useSession()
  const { components, actions } = useSlot("session.header")
  if (!session || (!components.length && !actions.length)) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, margin: 8, marginBottom: 0, paddingLeft: 8, paddingRight: 4, flexShrink: 0, ...box(t, "panel") }}>
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
        <Point point="session.header" args={{ session: session.workspace_id }} />
      </div>
    </div>
  )
}

function Agents() {
  const C = useComponents()
  const agents = useAgents()
  const t = useTheme()
  if (!agents.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 16 }}>
        <Decor name="plant" />
        <text style={{ fontSize: 13, color: t.muted }}>Nobody's online</text>
      </div>
    )
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingLeft: 4, paddingRight: 4, gap: 2 }}>
      {agents.map((a) => (
        <C.Agent key={a.tab_id} tab={a.tab_id} />
      ))}
    </div>
  )
}

/** A player: their avatar with a bubble, their tag, what they're on. Click to walk to them. */
function Agent({ tab }: { tab: string }) {
  const t = useTheme()
  const C = useComponents()
  const agent = useAgentOf(tab)
  const [hovered, setHovered] = useState(false)
  const { open, menu } = useMenu("agent.menu", { tab })
  if (!agent) return null
  const status = agent.agent_status || "unknown"
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onAuxClick={open}
      onClick={() => call(via(tab, "tab.focus"), tab).catch(swallow)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingLeft: 4, paddingRight: 4, cursor: "pointer", hover: { backgroundColor: t.floorHover } }}
    >
      <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
        <Avatar who={tab} style={{ position: "absolute", left: 2, top: 8 }} />
        <Bubble status={status} style={{ position: "absolute", left: 20, top: 0 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, flexGrow: 1, minWidth: 0 }}>
        <Nametag dot={t[`agent.${status}`] ?? t["agent.unknown"]}>{agent.name || agent.agent || tab}</Nametag>
        {agent.title ? <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "100%" }}>{agent.title}</text> : null}
        <Point point="agent.footer" args={{ tab }} />
      </div>
      <div style={{ display: "flex", flexDirection: "row", opacity: hovered ? 1 : 0 }}>
        <C.AgentControls tab={tab} />
      </div>
      {menu}
    </div>
  )
}

function AgentControls({ tab }: { tab: string }) {
  const C = useComponents()
  const { components, actions } = useSlot("agent.controls")
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3 }}>
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={{ tab }} />
      ))}
      {components.map((v) => renderComponent(v, { tab }))}
    </div>
  )
}

function Action({ action, args }: { action: ActionItem; args?: unknown }) {
  return <PixelButton icon={action.icon ?? "ellipsis"} title={action.title} size={24} onClick={() => action.run(args)} />
}

/** Along the foot, over the floor: your player card, the hotbar, and the tray with the clock.
 *  Gather's own: the app has no status bar part to give it. */
function StatusBar() {
  const t = useTheme()
  const C = useComponents()
  const session = useSession()
  const focused = useTab(useFocusedTab())
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: 60, flexShrink: 0, paddingLeft: 14, paddingRight: 14, paddingBottom: 6 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingLeft: 4, paddingRight: 10, flexGrow: 1, flexBasis: 0, minWidth: 0, maxWidth: 300, ...box(t, "panel") }}>
        <div style={{ position: "relative", width: 32, height: 32, flexShrink: 0, overflow: "hidden", ...box(t, "slot") }}>
          <Avatar who="you" sitting style={{ position: "absolute", left: 2, top: 3 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flexShrink: 1 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5 }}>
            <text style={{ fontSize: 14, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{session?.label || "pumi"}</text>
            <div style={{ width: 6, height: 6, backgroundColor: t.success, flexShrink: 0 }} />
          </div>
          <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis-start", minWidth: 0 }}>{focused?.cwd ?? ""}</text>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", flexGrow: 2, flexBasis: 0, minWidth: 0 }}>
        <C.ViewBar />
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", height: 28, paddingLeft: 10, paddingRight: 10, flexShrink: 0, ...box(t, "panel") }}>
          <text style={{ fontSize: 14 }}>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</text>
        </div>
      </div>
    </div>
  )
}

function Starting({ title, detail, gaveUp, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  const t = useTheme()
  const step = useBeat(150, !gaveUp)
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: t.window, color: t.text, fontFamily: FONT }}>
      <Floor kind="wood" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <Nametag dot={gaveUp ? t.error : t.success}>You</Nametag>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
          <Avatar who="you" frame={gaveUp ? 0 : STEPS[step % 4]!} />
          <Bubble status={gaveUp ? "error" : "working"} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 14, minWidth: 320, maxWidth: 620, ...box(t, "dialog") }}>
        <text style={{ fontSize: 16, color: gaveUp ? t.error : t.text }}>{title || "Joining the space…"}</text>
        {detail ? <text style={{ fontSize: 13, color: t.muted }}>{detail}</text> : null}
        {lines.length ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 4, padding: 8, alignSelf: "stretch", ...box(t, "sign") }}>
            {lines.map((line, i) => (
              <text key={i} style={{ fontSize: 11, color: t.signText, fontFamily: "Menlo" }}>{line}</text>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Gather's parts: the whole window. `Layout` draws its own split, so the app's is not used. */
export const GATHER: Partial<Components> = {
  Window,
  Starting,
  ViewBar,
  View,
  Layout,
  Pane,
  PaneTab,
  TabBody,
  Panel,
  Float,
  Agent,
  AgentControls,
  Action,
  Menu,
  Dialog,
}
