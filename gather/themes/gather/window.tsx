// Gather as a game: pumi's window is the office floor, seen from above. Each tab is a room — grey
// carpet, a blue rim, its name on a sign — and each pane in it is a desk: a white desk with the
// terminal as its monitor, a keyboard and a mug, and an office chair on this side with whoever is
// working on it sitting down (back to us), its name tag under the chair. The lobby down the left
// is one more room, on tiles, where every agent stands. Your character walks to the desk you focus.
// Menus are the game's framed dialog boxes. Started from the app's default window
// (runtime/app/app/theme/default.tsx): the behaviour is the default's, the look is this file's.
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, useMetrics, useTheme } from "pumi"
import {
  call,
  commands,
  grouped,
  num,
  renderView,
  useAgentOf,
  useAgents,
  useComponents,
  useFloats,
  useFocusedPane,
  useLayout,
  useLocal,
  useMenu,
  usePane,
  useRenderer,
  useSession,
  useSessions,
  useSidebar,
  useSlot,
  useTab,
  useTabs,
  useWindow,
  useZoomed,
  windowContext,
  type ActionItem,
  type Components,
  type DialogProps,
  type MenuProps,
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
  const overlays = useSlot("window.overlay").views
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
        <C.StatusBar />
        <Walker />
        {overlays.map((v) => (
          <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
            {renderView(v)}
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
  const focused = useFocusedPane()
  useSyncExternalStore(desks?.subscribe ?? (() => () => {}), desks?.version ?? (() => 0))
  const rect = desks?.get(focused)
  const target = rect ? { x: rect.x + Math.round(rect.width / 2) - 68, y: rect.y + rect.height - 58 } : undefined
  const [me, setMe] = useState<{ at: Point; facing: Facing; frame: number } | undefined>()
  const at = useRef<Point | undefined>(undefined)
  const desk = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!target) return
    const from = at.current
    const moved = desk.current !== focused
    desk.current = focused
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
  }, [focused, target?.x, target?.y])
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
  const C = useComponents()
  const window = useWindow()
  const session = useSession()
  const sessions = useSessions()
  const [picking, setPicking] = useState(false)
  const { views, actions } = useSlot("window.titlebar")
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
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} />
      ))}
      {views.length ? <Board>{views.map((v) => renderView(v))}</Board> : null}
      <Minimap />
    </div>
  )
}

/** A framed board for what packages draw on the HUD, in the theme's own colours. */
function Board({ children }: { children: ReactNode }) {
  const t = useTheme()
  return <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28, paddingLeft: 6, paddingRight: 6, flexShrink: 0, ...box(t, "panel") }}>{children}</div>
}

/** The tab you're in, from above: its desks as the layout splits them, you a blinking dot. */
function Minimap() {
  const t = useTheme()
  const tree = useLayout()
  const focused = useFocusedPane()
  const tab = useTab()
  const tabs = useTabs()
  const index = tabs.findIndex((x) => x.tab_id === tab?.tab_id)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingLeft: 4, paddingRight: 6, flexShrink: 0, ...box(t, "panel") }}>
      <div style={{ display: "flex", width: 96, height: 28, backgroundColor: t.carpetFloor, borderWidth: 1, borderColor: t.roomRim }}>
        {tree ? <MiniSplit tree={tree} focused={focused} /> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <text style={{ fontSize: 9, color: t.faint }}>FLOOR</text>
        <text style={{ fontSize: 13 }}>{`${index + 1}/${tabs.length}`}</text>
      </div>
    </div>
  )
}

function MiniSplit({ tree, focused }: { tree: Tree; focused?: string }) {
  if ("pane" in tree) return <MiniDesk pane={tree.pane} here={tree.pane === focused} />
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

function MiniDesk({ pane: id, here }: { pane: string; here: boolean }) {
  const t = useTheme()
  const pane = usePane(id)
  const blink = useBeat(450, here) % 2 === 0
  const agent = pane?.agent ? (t[`agent.${pane.agent_status || "unknown"}`] ?? t["agent.unknown"]) : undefined
  return (
    <div
      onClick={() => call("pane.focus", id, {}).catch(swallow)}
      style={{ display: "flex", flexDirection: "row", flexGrow: 1, gap: 2, padding: 2, alignItems: "flex-start", backgroundColor: t.desk, cursor: "pointer" }}
    >
      {here ? <div style={{ width: 4, height: 4, backgroundColor: blink ? t.success : t.desk }} /> : null}
      {agent ? <div style={{ width: 4, height: 4, backgroundColor: agent }} /> : null}
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

/** The hotbar: one slot a tab, its number above it, the one you're on lit gold. */
function TabBar({ session }: { session?: string }) {
  const t = useTheme()
  const C = useComponents()
  const tabs = useTabs(session)
  const front = useSession(session)?.active_tab_id
  const window = useWindow()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, padding: 4, minWidth: 0, flexShrink: 1, ...box(t, "panel") }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 1, overflowX: "scroll" }}>
        {tabs.map((tab, index) => (
          <C.Tab key={tab.tab_id} tab={tab.tab_id} index={index} active={tab.tab_id === front} />
        ))}
      </div>
      <PixelButton icon="plus" title="New tab" size={40} onClick={() => commands.run("new_tab", ctx(window))} />
    </div>
  )
}

function Tab({ tab: id, active, index }: { tab: string; active: boolean; index: number }) {
  const t = useTheme()
  const tab = useTab(id)
  const { actions } = useSlot("tab.actions")
  if (!tab) return null
  const label = tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`
  const status = tab.agent_status ? (t[`agent.${tab.agent_status}`] ?? t["agent.unknown"]) : undefined
  return (
    <div
      onClick={() => call("tab.focus", id, {}).catch(swallow)}
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
      <Point point="tab.badge" args={{ tab: id }} />
      {actions.map((a) => (
        <Contributed key={`${a.plugin}/${a.id}`} action={a} args={{ tab: id }} />
      ))}
      {active ? (
        <div
          onClick={(e: any) => {
            e?.stopPropagation?.()
            call("tab.close", id).catch(swallow)
          }}
          style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", color: t.slotText, opacity: 0.6, hover: { opacity: 1, backgroundColor: t.slotRing } }}
        >
          <Icon name="close" size={9} />
        </div>
      ) : null}
    </div>
  )
}

/** A point's views, given `args`, and its actions as buttons. */
function Point({ point, args, gap = 4 }: { point: string; args?: Record<string, unknown>; gap?: number }) {
  const C = useComponents()
  const { views, actions } = useSlot(point)
  if (!views.length && !actions.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap, flexShrink: 0 }}>
      {views.map((v) => renderView(v, args))}
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={args} />
      ))}
    </div>
  )
}

/**
 * The `Menu` part: every menu of the app's (a pane's, an agent's: `useMenu`), as a pixel dialog
 * where the mouse is. Its groups with a rule between; a submenu (Open With, Move To) opens in
 * place under its row.
 */
function Menu({ at, actions, views, args, close }: MenuProps) {
  const t = useTheme()
  return (
    <anchored position={at} fit="snap" deferred occlude onMouseDownOutside={close}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 190, padding: 6, ...box(t, "dialog") }}>
        <MenuRows actions={actions} close={close} depth={0} />
        {views?.map((v) => renderView(v, { ...args, close }))}
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

/** The tab's room: its carpet, its sign, the desks on it. */
function Layout({ tab }: { tab?: string }) {
  const t = useTheme()
  const tree = useLayout(tab)
  const focused = useFocusedPane(tab)
  const zoomed = useZoomed(tab)
  const session = useSession(tab)
  const tabs = useTabs(tab)
  const index = tabs.findIndex((x) => x.tab_id === (session?.active_tab_id ?? undefined))
  const C = useComponents()
  // Before the early return: a hook after it changes the hook order once a tab has a tree.
  const floats = useFloats(tab ?? undefined)
  const body = !tree ? <EmptyDesk /> : zoomed && focused ? <Leaf pane={focused} focused zoomed /> : <Split tree={tree} focused={focused} />
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
            <C.Float key={p.pane_id} pane={p.pane_id} />
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
  if ("pane" in tree) return <Leaf pane={tree.pane} focused={tree.pane === focused} zoomed={false} />
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

function Leaf(props: { pane: string; focused: boolean; zoomed: boolean }) {
  const C = useComponents()
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}>
      <C.Pane {...props} />
    </div>
  )
}

/** What a desk is called: the pane's label, its title, or where it is. */
function deskName(pane: ReturnType<typeof usePane>): string {
  if (!pane) return "Desk"
  if (pane.label) return pane.label
  if (pane.terminal_title) return pane.terminal_title
  const cwd = pane.cwd?.replace(/\/+$/, "")
  return cwd ? cwd.split("/").pop() || "/" : pane.block
}

/**
 * A pane is a desk: the white desk with the terminal as its monitor, a keyboard, a mug and a
 * sticky note on it, and the chair this side with whoever works there sitting down, facing the
 * screen, its name tag under the chair.
 */
function Pane({ pane: id, focused }: { pane: string; focused: boolean; zoomed: boolean }) {
  const t = useTheme()
  const desks = useContext(DesksContext)
  const pane = usePane(id)
  const renderer = useRenderer(id)
  const { views } = useSlot("pane.strip")
  const overlays = useSlot("pane.overlay").views
  const { open, menu } = useMenu("pane.menu", { pane: id })
  // Every block is drawn by the renderer a plugin gives it, terminals included (`useRenderer`):
  // the terminal's is the bundled plugin `pumi/terminal`.
  const body: ReactNode = !pane ? null : renderer ? (
    renderView(renderer, { pane, block: pane.block, focused })
  ) : (
    <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
      <text style={{ color: t.faint }}>{`Nothing draws ${pane.block} blocks`}</text>
    </div>
  )
  return (
    <div
      onLayout={(e) => desks?.set(id, { x: e.x ?? 0, y: e.y ?? 0, width: e.width ?? 0, height: e.height ?? 0 })}
      onMouseDown={() => {
        if (!focused) call("pane.focus", id, {}).catch(swallow)
      }}
      onAuxClick={open}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, padding: 10, paddingBottom: 2 }}
    >
      {views.map((v) => renderView(v, { pane: id }))}
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
            <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
              {renderView(v, { pane: id, focused })}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 22, flexShrink: 0, paddingTop: 3 }}>
          <Decor name="mug" />
          <Decor name="keyboard" />
          <Decor name="sticky" />
          <div style={{ flexGrow: 1 }} />
          <Point point="pane.toolbar" args={{ pane: id }} />
        </div>
      </div>
      <Sitter pane={id} name={deskName(pane)} focused={focused} />
      {menu}
    </div>
  )
}

/** Whoever works at this desk, sitting in its chair — or the empty chair, if no one does. */
function Sitter({ pane, name, focused }: { pane: string; name: string; focused: boolean }) {
  const t = useTheme()
  const agent = useAgentOf(pane)
  const status = agent?.agent_status || "unknown"
  const working = status === "working"
  const alarmed = status === "blocked" || status === "error"
  const bob = useBeat(working ? 300 : 450, working || alarmed) % 2
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, height: 62, paddingTop: 2 }}>
      <div style={{ position: "relative", width: 46, height: 34 }}>
        <Decor name="chair" style={{ position: "absolute", left: 7, top: 12 }} />
        {agent ? <Avatar who={pane} sitting style={{ position: "absolute", left: 11, top: working ? bob : 0 }} /> : null}
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

/** A pane floating over the tab: a room in a dialog box. */
function Float({ pane: id }: { pane: string }) {
  const t = useTheme()
  const C = useComponents()
  const pane = usePane(id)
  const place: any = (pane as any)?.place ?? {}
  const close = () => call("pane.close", id).catch(swallow)
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
        <C.Pane pane={id} focused zoomed={false} />
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
  const { views } = useSlot(point)
  const [collapsed, setCollapsed] = useLocal<string[]>(`gather.${point}.collapsed`, [])
  const sections: { key: string; title: string; body: ReactNode; board: boolean }[] = [
    { key: "agents", title: "Players", body: <Agents />, board: false },
    ...views.map((v) => ({ key: `${v.plugin}/${v.id}`, title: v.title ?? v.id, body: renderView(v), board: true })),
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
  const { views, actions } = useSlot("session.header")
  if (!session || (!views.length && !actions.length)) return null
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
        <C.Agent key={a.pane_id} pane={a.pane_id} />
      ))}
    </div>
  )
}

/** A player: their avatar with a bubble, their tag, what they're on. Click to walk to them. */
function Agent({ pane }: { pane: string }) {
  const t = useTheme()
  const C = useComponents()
  const agent = useAgentOf(pane)
  const [hovered, setHovered] = useState(false)
  const { open, menu } = useMenu("agent.menu", { pane })
  if (!agent) return null
  const status = agent.agent_status || "unknown"
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onAuxClick={open}
      onClick={() => call("pane.focus", pane, {}).catch(swallow)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingLeft: 4, paddingRight: 4, cursor: "pointer", hover: { backgroundColor: t.floorHover } }}
    >
      <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
        <Avatar who={pane} style={{ position: "absolute", left: 2, top: 8 }} />
        <Bubble status={status} style={{ position: "absolute", left: 20, top: 0 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, flexGrow: 1, minWidth: 0 }}>
        <Nametag dot={t[`agent.${status}`] ?? t["agent.unknown"]}>{agent.name || agent.agent || pane}</Nametag>
        {agent.title ? <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "100%" }}>{agent.title}</text> : null}
        <Point point="agent.footer" args={{ pane }} />
      </div>
      <div style={{ display: "flex", flexDirection: "row", opacity: hovered ? 1 : 0 }}>
        <C.AgentControls pane={pane} />
      </div>
      {menu}
    </div>
  )
}

function AgentControls({ pane }: { pane: string }) {
  const C = useComponents()
  const { views, actions } = useSlot("agent.controls")
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3 }}>
      {actions.map((a) => (
        <C.Action key={`${a.plugin}/${a.id}`} action={a} args={{ pane }} />
      ))}
      {views.map((v) => renderView(v, { pane }))}
    </div>
  )
}

function Action({ action, args }: { action: ActionItem; args?: unknown }) {
  return <PixelButton icon={action.icon ?? "ellipsis"} title={action.title} size={24} onClick={() => action.run(args)} />
}

/** Along the foot, over the floor: your player card, the hotbar, and the tray with the clock. */
function StatusBar() {
  const t = useTheme()
  const C = useComponents()
  const session = useSession()
  const focused = usePane(useFocusedPane())
  const { views, actions } = useSlot("status")
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
        <C.TabBar />
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        {views.length ? <Board>{views.map((v) => renderView(v))}</Board> : null}
        {actions.map((a) => (
          <C.Action key={`${a.plugin}/${a.id}`} action={a} />
        ))}
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
  TabBar,
  Tab,
  Layout,
  Pane,
  Panel,
  StatusBar,
  Float,
  Agent,
  AgentControls,
  Action,
  Menu,
  Dialog,
}
