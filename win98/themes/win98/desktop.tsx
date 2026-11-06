// The Windows 98 desktop: teal, its icons down the left, a window for each of the session's views
// (moved by its caption, sized by its edges, maximized, minimized to the taskbar, the one pressed
// last on top), and the taskbar along the foot — the Start button, the quick launch, a button
// for each window and the tray with the agents and the clock. The desktop and the taskbar move
// pumi's own window, whose system buttons sit over the desktop's top left (`Desk.top` clears them).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { useDragState, useTheme } from "pumi"
import {
  call,
  commands,
  confirm,
  num,
  prompt,
  renderComponent,
  run,
  startRename,
  useAgents,
  useApp,
  useAutoEqualize,
  useComponents,
  useFocusedTab,
  useLocal,
  useMenu,
  usePaneTitles,
  useSession,
  useSessions,
  useSidebar,
  useSlot,
  useTab,
  useViews,
  useWindow,
  useWindowSize,
  via,
  type ActionItem,
  type Tab as TabInfo,
  type View as ViewInfo,
} from "pumi/theme"
import { ExplorerBar, goTo } from "./explorer.tsx"
import { Art, bevel, Box, caption, CaptionButton, FONT, Label, Picture, PushButton, Separator, stop, swallow, tabArt, tabTitle, viewName } from "./kit.tsx"
import { DropMenu } from "./menu.tsx"

const TASKBAR = 28
/** What a plugin of the user's may have: the command palette's toggle, a browser's new page. */
const PALETTE = "amresyd.palette.toggle"
const BROWSER = "pumi.browser.openTab"

/** Whether a command exists now: a plugin's comes and goes with its plugin. */
function useHasCommand(name: string): boolean {
  return useSyncExternalStore(commands.subscribe, () => commands.commands().some((c) => c.name === name))
}

/** An action of the theme's own, for a menu. */
function act(id: string, title: string, run: () => unknown, more: Partial<ActionItem> = {}): ActionItem {
  return { id, title, plugin: "amresyd/win98", run: () => void Promise.resolve(run()).catch(swallow), ...more }
}

/** Runs one of the app's commands in this window. */
function useRun() {
  const window = useWindow()
  return (name: string) => run(name, window.id)
}

// ── Where each window is ───────────────────────────────────────────────────────────────────────

/** A window's place on the desktop, in px from its top left; and whether it fills it, or is folded away. */
interface Place {
  x: number
  y: number
  w: number
  h: number
  max?: boolean
  min?: boolean
}

type Places = Record<string, Place>

/** The desktop's room: its size, and how far down it is clear of the system's window buttons. */
interface Desk {
  w: number
  h: number
  top: number
}
const NO_PLACES: Places = {}

/** A new window's place: cascaded from the top left, as the system placed them. */
function cascade(index: number, desk: Desk): Place {
  const step = 26 * (index % 8)
  const w = Math.max(320, Math.min(820, desk.w - 140))
  const h = Math.max(220, Math.min(560, desk.h - 90))
  return { x: 96 + step, y: 16 + step, w, h }
}

// ── The desktop ────────────────────────────────────────────────────────────────────────────────

/** The `Window` part: the desktop, its windows and its taskbar. */
export function Desktop() {
  const t = useTheme()
  const session = useSession()
  const views = useViews()
  const sorted = useMemo(() => [...views].sort((a, b) => a.number - b.number), [views])
  const front = session?.active_view_id ?? undefined
  const [places, setPlaces] = useLocal<Places>("win98.windows", NO_PLACES)
  const size = useWindowSize()
  // The system's buttons stay over the top left: what sits there (the icons, a maximized
  // window) starts below them.
  const lights = useWindow().trafficLights
  const desk: Desk = { w: size?.width ?? 1100, h: (size?.height ?? 720) - TASKBAR, top: lights ? lights.y + lights.height + 8 : 0 }
  // The windows in the order they were pressed in, the front view's last (on top).
  const [order, setOrder] = useState<string[]>([])
  useEffect(() => {
    if (front) setOrder((now) => (now[now.length - 1] === front ? now : [...now.filter((x) => x !== front), front]))
  }, [front])
  const placeOf = (view: string, index: number) => places[view] ?? cascade(index, desk)
  const setPlace = (view: string, next: Place) => setPlaces((old) => ({ ...old, [view]: next }))
  const raise = (view: string) => {
    if (view !== front) call(via(view, "view.focus"), view).catch(swallow)
  }
  const rank = (view: string) => (order.indexOf(view) < 0 ? -1 : order.indexOf(view))
  const overlays = useSlot("window.overlay").components
  const shown = sorted.filter((view, i) => !placeOf(view.view_id, i).min)
  // The window on top that is not folded away: the active one, whose caption is navy.
  const top = [...shown].sort((a, b) => rank(a.view_id) - rank(b.view_id)).pop()?.view_id
  return (
    <div
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", backgroundColor: t["w98.desktop"], fontFamily: FONT, fontSize: 11, color: t.text, appRegion: "drag", overflow: "hidden" }}
    >
      <div style={{ position: "relative", flexGrow: 1, minHeight: 0 }}>
        <DesktopIcons top={Math.max(8, desk.top)} />
        {sorted.map((view, index) => {
          const place = placeOf(view.view_id, index)
          if (place.min) return null
          return (
            <ViewWindow
              key={view.view_id}
              view={view}
              active={view.view_id === top}
              z={rank(view.view_id) + 2}
              place={place}
              desk={desk}
              setPlace={(next) => setPlace(view.view_id, next)}
              raise={() => raise(view.view_id)}
            />
          )
        })}
      </div>
      <Taskbar views={sorted} active={top} minimized={(view) => !!places[view]?.min} toggle={(view, index) => {
        const place = placeOf(view, index)
        if (place.min) {
          setPlace(view, { ...place, min: false })
          raise(view)
        } else if (view === top) setPlace(view, { ...place, min: true })
        else raise(view)
      }} showDesktop={() => setPlaces((old) => Object.fromEntries(sorted.map((view, i) => [view.view_id, { ...(old[view.view_id] ?? cascade(i, desk)), min: true }])))} />
      <DragGhost />
      {overlays.map((v) => (
        <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {renderComponent(v)}
        </div>
      ))}
    </div>
  )
}

/** The desktop's icons down its left: a double press opens each, a press selects it. */
function DesktopIcons({ top }: { top: number }) {
  const window = useWindow()
  const go = useRun()
  const browser = useHasCommand(BROWSER)
  const [selected, setSelected] = useState<string>()
  const icons: { id: string; art: string; label: string; open(): void }[] = [
    { id: "computer", art: "computer", label: "My Computer", open: () => go("new_workspace") },
    { id: "dos", art: "dos", label: "MS-DOS Prompt", open: () => go("new_tab") },
    ...(browser ? [{ id: "web", art: "globe", label: "Internet Explorer", open: () => go(BROWSER) }] : []),
    { id: "recycle", art: "recycle", label: "Recycle Bin", open: () => go("reopen_closed") },
  ]
  return (
    <div onMouseDownOutside={() => setSelected(undefined)} style={{ position: "absolute", top, left: 6, display: "flex", flexDirection: "column", gap: 10 }}>
      {icons.map((icon) => (
        <DesktopIcon key={icon.id} {...icon} selected={selected === icon.id} select={() => setSelected(icon.id)} />
      ))}
    </div>
  )
}

function DesktopIcon({ art, label, selected, select, open, id }: { id: string; art: string; label: string; selected: boolean; select(): void; open(): void }) {
  const t = useTheme()
  return (
    <div
      onClick={select}
      onDoubleClick={() => {
        select()
        open()
      }}
      title={id === "recycle" ? "Open the pane closed last again" : undefined}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 74, gap: 3, cursor: "default" }}
    >
      <div style={{ display: "flex", opacity: selected ? 0.7 : 1, backgroundColor: selected ? `${t["w98.title"]}66` : undefined }}>
        <Art name={art} size={32} />
      </div>
      <div style={{ display: "flex", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? t["w98.title"] : undefined, borderWidth: 1, borderColor: selected ? t["w98.tip"] : "#00000000" }}>
        <text style={{ fontSize: 11, fontFamily: FONT, color: t["w98.white"], textAlign: "center", maxWidth: 70 }}>{label}</text>
      </div>
    </div>
  )
}

// ── A view's window ───────────────────────────────────────────────────────────────────────────

type Drag = { kind: "move" | "size"; x: number; y: number; from: Place }

/**
 * One view as a window: its frame, its caption (the front tab's picture, which opens the view's
 * menu; the view's name; minimize, maximize and close), its menu bar, the Explorer bar and its
 * panes, and its status bar. Pressed anywhere, it comes to the front.
 */
function ViewWindow({ view, active, z, place, desk, setPlace, raise }: { view: ViewInfo; active: boolean; z: number; place: Place; desk: Desk; setPlace(next: Place): void; raise(): void }) {
  const t = useTheme()
  const C = useComponents()
  const session = useSession()
  const [explorer] = useSidebar()
  const [width, setWidth] = useLocal("win98.explorer.width", 190)
  const focused = useFocusedTab(view.view_id)
  const tab = useTab(focused)
  const [drag, setDrag] = useState<Drag>()
  const [live, setLive] = useState<Place>()
  const { open: viewMenu, show: showViewMenu, menu } = useMenu(["view.menu", "view.actions"], { view: view.view_id })
  const shown = live ?? place
  const max = !!shown.max
  const name = viewName(view)
  const title = session?.label ? `${name} - ${session.label}` : name
  const close = () => call(via(view.view_id, "view.close"), num(view.view_id)).catch(swallow)
  const toggleMax = () => setPlace({ ...place, max: !place.max })
  const clamp = (p: Place): Place => ({ ...p, x: Math.min(Math.max(p.x, 40 - p.w), desk.w - 40), y: Math.min(Math.max(p.y, 0), desk.h - 20), w: Math.max(260, p.w), h: Math.max(160, p.h) })
  const begin = (kind: Drag["kind"]) => (e: any) => {
    stop(e)
    raise()
    if (max && kind === "move") return
    setDrag({ kind, x: e.x ?? 0, y: e.y ?? 0, from: place })
  }
  const moving = (e: any) => {
    if (!drag) return
    // The button came up somewhere the release was not heard.
    if (e.pressedButton !== 0) return end()
    const dx = (e.x ?? 0) - drag.x
    const dy = (e.y ?? 0) - drag.y
    const f = drag.from
    setLive(clamp(drag.kind === "move" ? { ...f, x: f.x + dx, y: f.y + dy } : { ...f, w: f.w + dx, h: f.h + dy }))
  }
  const end = () => {
    if (live) setPlace(live)
    setDrag(undefined)
    setLive(undefined)
  }
  const [outer, inner] = bevel(t, "window")
  return (
    <div
      onMouseDown={raise}
      style={{
        position: "absolute",
        zIndex: z,
        display: "flex",
        flexDirection: "column",
        ...(max ? { top: desk.top, left: 0, width: "100%", height: desk.h - desk.top } : { top: shown.y, left: shown.x, width: shown.w, height: shown.h }),
        borderWidth: 1,
        ...outer,
        backgroundColor: t["w98.face"],
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, borderWidth: 1, ...inner!, padding: 2 }}>
        {/* The caption: it moves the window, a double press maximizes it. */}
        <div
          onMouseDown={begin("move")}
          onMouseMove={moving}
          onMouseUp={end}
          onDoubleClick={toggleMax}
          onAuxClick={viewMenu}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, height: 18, flexShrink: 0, paddingLeft: 2, paddingRight: 2, userSelect: "none", ...caption(t, active) }}
        >
          <div onMouseDown={stop} onClick={(e: any) => (stop(e), showViewMenu(e))} title="Window menu" style={{ display: "flex", flexShrink: 0 }}>
            <Art name={tabArt(tab)} size={16} />
          </div>
          <Label bold color={active ? t["w98.white"] : t["w98.light"]} style={{ flexShrink: 1 }}>
            {title}
          </Label>
          <div style={{ flexGrow: 1 }} />
          <CaptionButton glyph="minimize" title="Minimize" onClick={() => setPlace({ ...place, min: true })} />
          <CaptionButton glyph={max ? "restore" : "maximize"} title={max ? "Restore" : "Maximize"} onClick={toggleMax} />
          <div style={{ width: 2 }} />
          <CaptionButton glyph="close" title="Close" onClick={close} />
        </div>
        <MenuBar view={view} tab={tab} />
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
          {explorer ? <ExplorerBar width={width} /> : null}
          {explorer ? <Sizer width={width} setWidth={setWidth} /> : null}
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: t["w98.shadow"] }}>
            <C.Layout view={view.view_id} />
          </div>
        </div>
        <StatusBar tab={tab} grip={!max} onGrip={begin("size")} onGripMove={moving} onGripUp={end} />
      </div>
      {menu}
    </div>
  )
}

/** The Explorer bar's edge: dragged, it sizes the bar. */
function Sizer({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const [from, setFrom] = useState<{ x: number; width: number }>()
  return (
    <div
      onMouseDown={(e: any) => (stop(e), setFrom({ x: e.x ?? 0, width }))}
      onMouseMove={(e: any) => from && setWidth(Math.min(420, Math.max(120, from.width + (e.x ?? 0) - from.x)))}
      onMouseUp={() => setFrom(undefined)}
      style={{ width: 4, flexShrink: 0, cursor: "col-resize" }}
    />
  )
}

/**
 * The window's menu bar: File, Edit (the front tab's own menu), View, Window and Help, each a
 * menu dropped under its title. Moving along the bar while one is open opens the next.
 */
function MenuBar({ view, tab }: { view: ViewInfo; tab?: TabInfo }) {
  const [open, setOpen] = useState<string>()
  const go = useRun()
  const [titles, setTitles] = usePaneTitles()
  const [explorer, setExplorer] = useSidebar()
  const [even] = useAutoEqualize()
  const tabMenu = useSlot("tab.menu", open === "edit" && tab ? { tab: tab.tab_id } : undefined).actions
  const sessions = useSessions()
  const window = useWindow()
  const name = viewName(view)
  const menus: { id: string; title: string; items(): ActionItem[] }[] = [
    {
      id: "file",
      title: "File",
      items: () => [
        act("new_tab", "New Tab", () => go("new_tab"), { keys: keysOf("new_tab"), group: "new" }),
        act("new_session", "New Session", () => go("new_workspace"), { keys: keysOf("new_workspace"), group: "new" }),
        act("new_window", "New Window", () => go("new_window"), { keys: keysOf("new_window"), group: "new" }),
        act("rename", "Rename…", () => startRename({ view: view.view_id }, name), { group: "view" }),
        act("close", "Close", () => go("close_view"), { keys: keysOf("close_view"), group: "close" }),
      ],
    },
    { id: "edit", title: "Edit", items: () => (tab ? tabMenu : []) },
    {
      id: "view",
      title: "View",
      items: () => [
        act("explorer", "Explorer Bar", () => setExplorer((v) => !v), { checked: explorer, keys: keysOf("toggle_sidebar"), group: "bars" }),
        act("titles", "Pane Captions", () => setTitles((v) => !v), { checked: titles, group: "bars" }),
        act("equalize", "Arrange Panes", () => go("equalize_panes"), { keys: keysOf("equalize_panes"), group: "panes" }),
        act("auto", "Auto Arrange", () => go("toggle_auto_equalize"), { checked: even, group: "panes" }),
        act("bigger", "Larger Text", () => go("font_bigger"), { keys: keysOf("font_bigger"), group: "text" }),
        act("smaller", "Smaller Text", () => go("font_smaller"), { keys: keysOf("font_smaller"), group: "text" }),
        act("fullscreen", "Full Screen", () => go("fullscreen"), { keys: keysOf("fullscreen"), group: "screen" }),
      ],
    },
    {
      id: "window",
      title: "Window",
      items: () => sessions.map((s) => act(`session.${s.workspace_id}`, s.label || s.workspace_id, () => goTo(window, s.workspace_id), { checked: s.workspace_id === window.session })),
    },
    {
      id: "help",
      title: "Help",
      items: () => [act("help", "Help Topics", () => go("help"), { keys: keysOf("help") }), act("about", "About pumi", () => go("settings"), { group: "about" })],
    },
  ]
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 20, flexShrink: 0, gap: 0 }}>
      {menus.map((m) => (
        <MenuTitle key={m.id} title={m.title} open={open === m.id} onOpen={() => setOpen(m.id)} onHover={() => open && open !== m.id && setOpen(m.id)} close={() => setOpen((now) => (now === m.id ? undefined : now))} items={open === m.id ? m.items() : []} />
      ))}
    </div>
  )
}

/** The keys a command has, as a menu writes them. */
function keysOf(command: string): string | undefined {
  const chord = commands.currentKeymap().chordFor(command)
  if (!chord) return undefined
  return chord
    .split(" ")[0]!
    .split("+")
    .map((k) => ({ cmd: "Cmd", shift: "Shift", alt: "Alt", ctrl: "Ctrl", equal: "=", minus: "-", plus: "+", enter: "Enter" })[k] ?? (k.length === 1 ? k.toUpperCase() : k))
    .join("+")
}

/** A menu bar's title: raised a little under the mouse, pushed in while its menu is open. */
function MenuTitle({ title, open, onOpen, onHover, close, items }: { title: string; open: boolean; onOpen(): void; onHover(): void; close(): void; items: ActionItem[] }) {
  const t = useTheme()
  // A press on the title while its menu is open closes it (the press outside does), and the
  // click that follows must not open it again.
  const pressedOpen = useRef(false)
  const [hover, setHover] = useState(false)
  const edge = open ? { borderTopColor: t["w98.shadow"]!, borderLeftColor: t["w98.shadow"]!, borderRightColor: t["w98.white"]!, borderBottomColor: t["w98.white"]! } : hover ? { borderTopColor: t["w98.white"]!, borderLeftColor: t["w98.white"]!, borderRightColor: t["w98.shadow"]!, borderBottomColor: t["w98.shadow"]! } : { borderColor: "#00000000" }
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
      <div
        onMouseDown={(e: any) => {
          stop(e)
          pressedOpen.current = open
        }}
        onClick={() => {
          if (pressedOpen.current) pressedOpen.current = false
          else onOpen()
        }}
        onMouseEnter={() => {
          setHover(true)
          onHover()
        }}
        onMouseLeave={() => setHover(false)}
        style={{ display: "flex", flexDirection: "row", height: 18, alignItems: "center", paddingLeft: 6, paddingRight: 6, borderWidth: 1, ...edge }}
      >
        <text style={{ fontSize: 11, fontFamily: FONT, color: t.text, textDecoration: "underline" }}>{title[0]}</text>
        <text style={{ fontSize: 11, fontFamily: FONT, color: t.text }}>{title.slice(1)}</text>
      </div>
      {open ? items.length ? <DropMenu actions={items} close={close} /> : <EmptyMenu close={close} /> : null}
    </div>
  )
}

/** A menu with nothing in it: one greyed row, as the system's said. */
function EmptyMenu({ close }: { close(): void }) {
  return <DropMenu actions={[act("empty", "(Empty)", () => {}, { disabled: true })]} close={close} />
}

/** The window's status bar: what its front tab is in, what its agent says, and the size grip. */
function StatusBar({ tab, grip, onGrip, onGripMove, onGripUp }: { tab?: TabInfo; grip: boolean; onGrip(e: any): void; onGripMove(e: any): void; onGripUp(): void }) {
  const t = useTheme()
  const agent = tab?.agent ? `${tab.agent}: ${tab.agent_status || "unknown"}` : undefined
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height: 20, flexShrink: 0, marginTop: 2 }}>
      <Box kind="status" style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 18 }} inner={{ justifyContent: "center", paddingLeft: 3, paddingRight: 3 }}>
        <Label>{tab?.cwd ?? (tab ? tabTitle(tab) : "")}</Label>
      </Box>
      {agent ? (
        <Box kind="status" style={{ height: 18, maxWidth: 220 }} inner={{ flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 3, paddingRight: 3 }}>
          <div style={{ width: 8, height: 8, flexShrink: 0, backgroundColor: t[`agent.${tab?.agent_status || "unknown"}`] ?? t["agent.unknown"], borderWidth: 1, borderColor: t["w98.dark"] }} />
          <Label>{agent}</Label>
        </Box>
      ) : null}
      {grip ? (
        <div onMouseDown={onGrip} onMouseMove={onGripMove} onMouseUp={onGripUp} title="Drag to size the window" style={{ display: "flex", width: 14, height: 14, alignSelf: "flex-end", alignItems: "flex-end", justifyContent: "flex-end", cursor: "nwse-resize" }}>
          <Picture name="grip" width={12} height={12} />
        </div>
      ) : null}
    </div>
  )
}

// ── The taskbar ────────────────────────────────────────────────────────────────────────────────

/**
 * The taskbar: Start, the quick launch (a new DOS prompt, a page, the desktop shown), a button
 * for each window (pushed in for the active one; pressed again, it folds away), and the tray.
 * Its empty part moves pumi's window, as the desktop does.
 */
function Taskbar({ views, active, minimized, toggle, showDesktop }: { views: ViewInfo[]; active?: string; minimized(view: string): boolean; toggle(view: string, index: number): void; showDesktop(): void }) {
  const t = useTheme()
  const go = useRun()
  const browser = useHasCommand(BROWSER)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, height: TASKBAR, flexShrink: 0, paddingLeft: 2, paddingRight: 2, backgroundColor: t["w98.face"], borderTopWidth: 1, borderTopColor: t["w98.light"], zIndex: 1000, appRegion: "drag" }}>
      <StartButton />
      <Separator vertical />
      <QuickLaunch art="dos" title="MS-DOS Prompt" onClick={() => go("new_tab")} />
      {browser ? <QuickLaunch art="globe" title="Launch Internet Explorer Browser" onClick={() => go(BROWSER)} /> : null}
      <QuickLaunch art="computer" title="Show Desktop" onClick={showDesktop} />
      <Separator vertical />
      <div style={{ display: "flex", flexDirection: "row", gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: "hidden" }}>
        {views.map((view, index) => (
          <Task key={view.view_id} view={view} pushed={view.view_id === active && !minimized(view.view_id)} onClick={() => toggle(view.view_id, index)} />
        ))}
      </div>
      <Tray />
    </div>
  )
}

/** A quick launch button: flat, its picture alone, raised under the mouse. */
function QuickLaunch({ art: picture, title, onClick }: { art: string; title: string; onClick(): void }) {
  const t = useTheme()
  const raised = { borderTopColor: t["w98.white"]!, borderLeftColor: t["w98.white"]!, borderRightColor: t["w98.shadow"]!, borderBottomColor: t["w98.shadow"]! }
  const sunk = { borderTopColor: t["w98.shadow"]!, borderLeftColor: t["w98.shadow"]!, borderRightColor: t["w98.white"]!, borderBottomColor: t["w98.white"]! }
  return (
    <div onClick={onClick} title={title} aria-label={title} style={{ display: "flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#00000000", hover: raised, active: sunk }}>
      <Art name={picture} size={16} />
    </div>
  )
}

/** A window's button on the taskbar: its picture and name; right-pressed, the view's menu. */
function Task({ view, pushed, onClick }: { view: ViewInfo; pushed: boolean; onClick(): void }) {
  const tab = useTab(useFocusedTab(view.view_id))
  const status = useApp((s) => lead(s.snapshot?.tabs.filter((t) => t.view_id === view.view_id && t.agent).map((t) => t.agent_status) ?? []))
  const { open, menu } = useMenu(["view.menu", "view.actions"], { view: view.view_id })
  const name = viewName(view)
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 1, minWidth: 40, width: 160 }}>
      <PushButton
        label={status === "done" || status === "blocked" || status === "error" ? `${name} *` : name}
        art={tabArt(tab)}
        pushed={pushed}
        bold={pushed}
        onClick={onClick}
        onAuxClick={open}
        title={tab ? `${name} — ${tabTitle(tab)}` : name}
        style={{ height: 22, flexGrow: 1 }}
        inner={{ justifyContent: "flex-start", paddingLeft: 3 }}
      />
      {menu}
    </div>
  )
}

/** The most urgent first: what a task says of the agents in its window. */
const URGENCY = ["error", "blocked", "working", "done", "idle", "unknown"]
function lead(statuses: string[]): string | undefined {
  let best: string | undefined
  for (const s of statuses) {
    const status = s || "unknown"
    if (URGENCY.indexOf(status) >= 0 && (best === undefined || URGENCY.indexOf(status) < URGENCY.indexOf(best))) best = status
  }
  return best
}

/** The tray: an icon for each agent (its state; a press goes to it), and the clock. */
function Tray() {
  const t = useTheme()
  const window = useWindow()
  const agents = useAgents()
  const now = useClock()
  return (
    <Box kind="status" style={{ height: 22, flexShrink: 0 }} inner={{ flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 4, paddingRight: 6 }}>
      {agents.slice(0, 8).map((a) => (
        <div
          key={a.tab_id}
          onClick={() => goTo(window, a.workspace_id, a.tab_id)}
          title={`${a.title || a.name || a.agent}: ${a.agent_status || "unknown"}`}
          style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ width: 9, height: 9, backgroundColor: t[`agent.${a.agent_status || "unknown"}`] ?? t["agent.unknown"], borderWidth: 1, borderColor: t["w98.dark"] }} />
        </div>
      ))}
      <Label style={{ marginLeft: 4 }}>{now}</Label>
    </Box>
  )
}

/** The time, as the tray says it (`3:45 PM`), again each minute. */
function useClock(): string {
  const say = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  const [now, setNow] = useState(say)
  useEffect(() => {
    const timer = setInterval(() => setNow(say()), 15_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

// ── Start ──────────────────────────────────────────────────────────────────────────────────────

/** The Start button, and its menu over it while it is pushed in. */
function StartButton() {
  const [open, setOpen] = useState(false)
  const pressedOpen = useRef(false)
  return (
    <div
      onMouseDown={() => (pressedOpen.current = open)}
      style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }}
    >
      <PushButton
        label="Start"
        art="flag"
        bold
        pushed={open}
        onClick={() => {
          if (pressedOpen.current) pressedOpen.current = false
          else setOpen(true)
        }}
        title="Click here to begin."
        style={{ height: 22, width: 56 }}
        inner={{ paddingLeft: 2, paddingRight: 4, gap: 3 }}
      />
      {open ? <StartMenu close={() => setOpen(false)} /> : null}
    </div>
  )
}

/**
 * The Start menu: its band, then Programs (the sessions and their tabs), Documents (the session's
 * worktrees), Settings, Find, Help and Run…, and at its foot Log Off and Shut Down.
 */
function StartMenu({ close }: { close(): void }) {
  const t = useTheme()
  const window = useWindow()
  const go = useRun()
  const sessions = useSessions()
  const views = useApp((s) => s.snapshot?.views ?? NO_VIEWS)
  const palette = useHasCommand(PALETTE)
  const [explorer, setExplorer] = useSidebar()
  const [titles, setTitles] = usePaneTitles()
  const [even] = useAutoEqualize()
  // The session's worktrees: the views of it that are in one.
  const session = window.session
  const worktrees = views.filter((view) => view.workspace_id === session && view.worktree)
  const programs: ActionItem[] = [
    ...sessions.map((s) => {
      const theirs = views.filter((view) => view.workspace_id === s.workspace_id).sort((a, b) => a.number - b.number)
      return act(`session.${s.workspace_id}`, s.label || s.workspace_id, () => {}, {
        icon: "folder",
        group: "sessions",
        items: [
          ...theirs.map((view) => act(`view.${view.view_id}`, viewName(view), () => goTo(window, s.workspace_id, view.view_id), { icon: "terminal", group: "views" })),
          act("new_view", "New View", () => call(via(s.workspace_id, "tab.open"), "terminal", {}, { kind: "view", session: num(s.workspace_id) }).then(() => window.session === s.workspace_id || window.show(s.workspace_id)), { group: "new" }),
        ],
      })
    }),
    act("dos", "MS-DOS Prompt", () => go("new_tab"), { icon: "terminal", group: "new" }),
    act("session", "New Session", () => go("new_workspace"), { icon: "computer", group: "new" }),
  ]
  const items: ActionItem[] = [
    act("programs", "Programs", () => {}, { icon: "programs", items: programs, group: "main" }),
    act("documents", "Documents", () => {}, {
      icon: "documents",
      group: "main",
      items: worktrees.map((view) => act(`worktree.${view.view_id}`, viewName(view), () => session && goTo(window, session, view.view_id), { icon: "folder" })),
    }),
    act("settings", "Settings", () => {}, {
      icon: "settings",
      group: "main",
      items: [
        act("control", "Control Panel", () => go("settings"), { icon: "settings", keys: keysOf("settings"), group: "panel" }),
        act("explorer", "Explorer Bar", () => setExplorer((v) => !v), { checked: explorer, group: "view" }),
        act("titles", "Pane Captions", () => setTitles((v) => !v), { checked: titles, group: "view" }),
        act("auto", "Auto Arrange Panes", () => go("toggle_auto_equalize"), { checked: even, group: "view" }),
      ],
    }),
    act("find", "Find", () => {}, {
      icon: "find",
      group: "main",
      items: [
        ...(palette ? [act("palette", "Commands…", () => go(PALETTE), { icon: "search", keys: keysOf(PALETTE) })] : []),
      ],
    }),
    act("help", "Help", () => go("help"), { icon: "help", group: "main" }),
    act("run", "Run…", async () => {
      const line = await prompt({ title: "Type the name of a program, and pumi will open it for you.", placeholder: "htop", confirm: "OK" })
      if (line?.trim()) await call(via(session, "tab.open"), "terminal", { command: line.trim() }, { kind: "view", ...(session ? { session: num(session) } : {}) })
    }, { icon: "run", group: "main" }),
    act("logoff", "Close Window…", async () => {
      if (await confirm({ title: "Are you sure you want to close this window?", detail: "Its sessions go on running.", confirm: "Yes", cancel: "No" })) go("close_window")
    }, { icon: "computer", group: "end" }),
    act("shutdown", "Shut Down…", async () => {
      if (await confirm({ title: "Are you sure you want to quit pumi?", detail: "The server keeps your sessions running.", confirm: "Yes", cancel: "No", danger: true })) go("quit")
    }, { icon: "shutdown", group: "end" }),
  ]
  const band: ReactNode = (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", width: 21, flexShrink: 0, paddingBottom: 4, background: { type: "linear-gradient", angle: 0, stops: [{ color: t["w98.title"] }, { color: t["w98.title2"] }] } as any }}>
      <Picture name="band" width={18} height={74} />
    </div>
  )
  return <DropMenu actions={items} close={close} side="top" large band={band} width={170} />
}

const NO_VIEWS: never[] = []

/** What a tab, a view or a session drag carries, by the mouse: its picture and its name, as a dotted outline would. */
function DragGhost() {
  const t = useTheme()
  const drag = useDragState()
  const it = drag?.data as { kind?: string; tab?: string; view?: string; session?: string } | undefined
  const snapshot = useApp((s) => (it?.kind?.startsWith("pumi.") ? s.snapshot : undefined))
  if (!drag || !snapshot || !it) return null
  const tab = it.tab ? snapshot.tabs.find((x) => x.tab_id === it.tab) : undefined
  const view = it.view ? snapshot.views.find((x) => x.view_id === it.view) : tab ? snapshot.views.find((x) => x.view_id === tab.view_id) : undefined
  const label = tab ? tabTitle(tab) : view ? viewName(view) : it.session ? snapshot.workspaces.find((x) => x.workspace_id === it.session)?.label : undefined
  if (!label) return null
  return (
    <anchored position={{ x: drag.x + 12, y: drag.y + 8 }} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 20, paddingLeft: 3, paddingRight: 6, pointerEvents: "none", ...caption(t, true), opacity: 0.85 }}>
        <Art name={tab ? tabArt(tab) : view ? "folder" : "computer"} size={16} />
        <Label bold color={t["w98.white"]}>
          {label}
        </Label>
      </div>
    </anchored>
  )
}

