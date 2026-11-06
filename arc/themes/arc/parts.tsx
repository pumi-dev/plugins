// Arc's window, drawn by hand: the window's own buttons in a cream sidebar at the left, an address
// pill under them that says where the tab in front is (its page's site, or what it holds), a row of
// its own small buttons, the tabs you pinned as pale letter tiles, the session's views as folders of
// tabs (a split's two tabs are one row of two chips, as Arc's are), and the panes floating beside it
// as rounded cards, a gutter between them. A page's card has Arc's bar over the browser's own
// toolbar and its address along the foot, so Arc's address pill is the only address bar; the page,
// its methods and what an agent reads of it stay the browser plugin's (the `browser_chrome` option
// turns the covering off).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Icon, IconImage, useDraggable, useDragState, useMetrics, useTabMeta, useTheme, useWebview, type Tokens } from "pumi"
import {
  call,
  carried,
  grouped,
  leavesOf,
  regionAt,
  regionBox,
  renderComponent,
  rowDrop,
  run,
  runMove,
  tabDrop,
  useApp,
  useComponents,
  useDropBox,
  useFocusedTab,
  useLayout,
  useLocal,
  useMenu,
  usePaneTabs,
  useSession,
  useSessions,
  useSidebar,
  useSlot,
  useTab,
  useThemeOption,
  useView,
  useWindow,
  via,
  whereIn,
  within,
  type ActionItem,
  type Carried,
  type Components,
  type DialogProps,
  type IconButtonProps,
  type MenuProps,
  type Tab,
  type TabIconProps,
} from "pumi/theme"
import { addressOf, groupsOf, mix, monogram, prunePinned, rowName, siteOf, tintFor, togglePinned, webOf, type Held } from "./kind.ts"
import { PIN, TRASH } from "./sprites.ts"

const swallow = (err: unknown) => console.error(`arc: ${err instanceof Error ? err.message : String(err)}`)

/** The bars the browser plugin draws in a page's tab, which Arc's own bar and foot cover. */
const BROWSER_TOP = 32
const BROWSER_FOOT = 20
/** Arc's rows: the sidebar's top bar, the address pill, a tab's row, a folder's header, the foot. */
const TOP = 38
const PILL = 34
const ROW = 28
const FOLD = 28
const FOOT = 36
/** The bar over a card that is not a page (a terminal, an agent): a page's bar covers the browser's. */
const BAR = 28
/** A card's radius: Arc's corners. */
const RADIUS = 10
/** The traffic lights' room, the sidebar's width until it is dragged, and a pinned tab's tile. */
const INSET = 78
const WIDTH = 252
const TILE = 32
const NO_IDS: string[] = []
const NO_TABS: Tab[] = []
const NO_VIEWS: { view_id: string; workspace_id: string; number: number; label: string | null; status: string }[] = []

/** What the sidebar keeps across runs: which tabs are pinned, which folders are open, its width. */
const PINNED = "arc.pinned"
const OPEN = "arc.folders.open"
const WIDTH_KEY = "arc.sidebar.width"

/** A tab's status as an icon of the app's set. */
const STATUS_ICON: Record<string, string> = {
  working: "status_spinner",
  blocked: "status_alert",
  error: "status_x",
  done: "status_check",
  idle: "status_ring",
  unknown: "status_unknown",
}

/** Brings a session to this window, and in it a view and a tab of it. */
function goTo(window: ReturnType<typeof useWindow>, session: string, view?: string, tab?: string) {
  window.show(session, view)
  if (tab) call(via(tab, "tab.focus"), tab).catch(swallow)
}

/** Whether a tab holds a page (the browser's, or any block that keeps a `url` option). */
function isWeb(tab: Held | undefined): boolean {
  return !!tab && !!webOf(tab)
}

// ── the window ──────────────────────────────────────────────────────────────────────────────

function Window() {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const window = useWindow()
  const [open] = useSidebar()
  const [width, setWidth] = useLocal(WIDTH_KEY, WIDTH)
  const overlays = useSlot("window.overlay").components
  const inset = window.fullscreened ? 14 : INSET
  // Arc's window is glass: `blur` (px) both softens what is behind it and lets it through.
  const blur = useThemeOption<number>("blur", 0) ?? 0
  useEffect(() => {
    window.setBackground(blur > 0 ? "blurred" : "opaque")
    window.setBlur(blur)
    window.setGlass(blur > 0 ? 0.92 : 1)
  }, [blur, window])
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: t.window,
        color: t.text,
        fontSize: m.fontSize,
      }}
    >
      {open ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width,
            flexShrink: 0,
            minWidth: 0,
            position: "relative",
            backgroundColor: t.surface,
          }}
        >
          <Toolbar inset={inset} />
          <Pill />
          <Actions />
          <C.Sessions />
          <Panels />
          <Foot />
          <Edge width={width} setWidth={setWidth} />
        </div>
      ) : null}
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0, position: "relative", backgroundColor: t.window }}>
        <C.Layout />
        {open ? null : <Collapsed />}
      </div>
      {/* The window's top edge moves it wherever it is pressed, over the sidebar's rows too. */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 5, appRegion: "drag" }} />
      {overlays.map((v) => (
        <div key={`${v.plugin}/${v.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {renderComponent(v)}
        </div>
      ))}
    </div>
  )
}

/**
 * The traffic lights' room, then the window's buttons: back, forward and reload on the tab in
 * front; at the far end the sidebar's own, a new tab and the tab's menu. Pressed outside them, it
 * moves the window.
 */
function Toolbar({ inset }: { inset: number }) {
  const t = useTheme()
  const window = useWindow()
  const [, setOpen] = useSidebar()
  const focused = useFocusedTab()
  const tab = useTab(focused)
  const state = useWebview(focused ?? "")
  const { open: menuAt, show, menu } = useMenu(["tab.menu", "window.menu"], { tab: focused })
  const web = isWeb(tab)
  const act = (method: string) => () => {
    if (focused && web) call("tab.call", focused, method).catch(swallow)
  }
  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 1,
          height: TOP,
          flexShrink: 0,
          paddingLeft: inset,
          paddingRight: 8,
          appRegion: "drag",
        }}
      >
        <Small icon="arrow_left" title="Back" onClick={act("back")} dim={!web || state?.back === false} />
        <Small icon="arrow_right" title="Forward" onClick={act("forward")} dim={!web || state?.forward === false} />
        <Small icon={state?.loading ? "rotate_cw" : "rotate_ccw"} title={state?.loading ? "Stop" : "Reload"} onClick={act("reload")} dim={!web} />
        <div style={{ flexGrow: 1, minWidth: 4, height: "100%" }} />
        <Small icon="sidebar_close_left" title="Hide Side Bar" onClick={() => setOpen(false)} />
        <Small icon="plus" title="New Tab" onClick={() => run("new_tab", window.id)} />
        <Small icon="ellipsis" title="Menu" onClick={show} />
      </div>
      {menu}
    </>
  )
}

/** A small button of the sidebar's top: quiet, dimmer where it cannot be pressed. */
function Small({ icon, title, onClick, dim }: { icon: string; title: string; onClick(e?: unknown): void; dim?: boolean }) {
  const t = useTheme()
  const m = useMetrics()
  return (
    <div
      aria-label={title}
      title={title}
      onClick={() => onClick()}
      style={{
        display: "flex",
        width: 26,
        height: 26,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        cursor: "pointer",
        color: dim ? t.faint : t.muted,
        opacity: dim ? 0.55 : 1,
        hover: { backgroundColor: t.hover, color: t.text, opacity: 1 },
      }}
    >
      <Icon name={icon} size={14} />
    </div>
  )
}

/**
 * Arc's address pill: the site of the page in front — or what the tab holds, when it is not a page
 * — and its pin. A press makes it a field, Arc's too: Enter takes a page there (the browser's own
 * block resolves the line, a search and all), or opens a page in the tab's pane when the tab is
 * something else. Hovering the site's tile offers its reload.
 */
function Pill() {
  const t = useTheme()
  const m = useMetrics()
  const focused = useFocusedTab()
  const tab = useTab(focused)
  const state = useWebview(focused ?? "")
  const [pinned, setPinned] = useLocal(PINNED, NO_IDS)
  const web = tab ? webOf(tab) : undefined
  const live = state?.url || web?.url || ""
  const [draft, setDraft] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const editing = draft !== null
  // The page's own address as it is now (it changes under the tab as links are followed), else
  // what the tab holds.
  const shown = tab ? (web && state?.url ? siteOf(state.url) || addressOf(tab) : addressOf(tab)) : "pumi"
  const isPinned = !!focused && pinned.includes(focused)
  const go = (text: string) => {
    const line = text.trim()
    setDraft(null)
    if (!line) return
    if (focused && web) {
      call("option.set", `${web.prefix}url`, line, { scope: "tab", id: focused }).catch(swallow)
      return
    }
    openPage(line, focused)
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, paddingLeft: 10, paddingRight: 10, paddingBottom: 6 }}>
      <div
        onMouseEnter={() => setOver(true)}
        onMouseLeave={() => setOver(false)}
        onMouseDownOutside={() => setDraft(null)}
        onClick={() => !editing && setDraft(live || shown)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          height: PILL,
          flexShrink: 0,
          paddingLeft: 7,
          paddingRight: 3,
          borderRadius: 11,
          backgroundColor: t.pill,
          borderWidth: 1,
          borderColor: editing ? t.accent : t.pillEdge,
        }}
      >
        {web && over && !editing ? (
          <Small icon="rotate_ccw" title="Reload" onClick={() => focused && call("tab.call", focused, "reload").catch(swallow)} />
        ) : (
          <Glyph tab={focused} size={17} />
        )}
        {editing ? (
          <input
            autoFocus
            value={draft ?? ""}
            onChange={(e: any) => setDraft(e?.value ?? "")}
            onSubmit={(e: any) => go(e?.value ?? draft ?? "")}
            onKeyDown={(e: any) => {
              if (e?.key === "escape") setDraft(null)
            }}
            style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 20, borderWidth: 0, backgroundColor: "#00000000", color: t.text, fontSize: m.fontSize - 0.5 }}
          />
        ) : (
          <text
            style={{
              fontSize: m.fontSize - 0.5,
              fontWeight: 500,
              color: tab ? t.text : t.muted,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            {shown}
          </text>
        )}
        {focused ? <SpriteButton src={PIN} title={isPinned ? "Unpin this tab" : "Pin this tab"} tint={isPinned ? t.accent : t.faint} onClick={() => setPinned((list) => togglePinned(list, focused))} /> : null}
      </div>
    </div>
  )
}

/** Arc's row of small buttons under the pill: the tab's pin, the session's tile, and the split. */
function Actions() {
  const t = useTheme()
  const m = useMetrics()
  const window = useWindow()
  const session = useSession()
  const focused = useFocusedTab()
  const [pinned, setPinned] = useLocal(PINNED, NO_IDS)
  const isPinned = !!focused && pinned.includes(focused)
  const initial = (session?.label || session?.workspace_id || "p").slice(0, 1).toUpperCase()
  const split = () => focused && call(via(focused, "tab.open"), null, {}, { kind: "tiled", beside: focused, split: "right" }).catch(swallow)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, height: 30, flexShrink: 0, paddingLeft: 10, paddingRight: 10, paddingBottom: 4 }}>
      <Flat
        title={isPinned ? "Unpin this tab" : "Pin this tab"}
        sprite={PIN}
        tint={isPinned ? t.accent : t.muted}
        onClick={() => focused && setPinned((list) => togglePinned(list, focused))}
      />
      <div
        title={session?.label || "Session"}
        onClick={() => run("new_view", window.id)}
        style={{
          display: "flex",
          width: 22,
          height: 22,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
          cursor: "pointer",
          backgroundColor: t.tileOn,
          hover: { backgroundColor: t.active },
        }}
      >
        <text style={{ fontSize: m.fontSize - 3, fontWeight: 700, color: t.accent }}>{initial}</text>
      </div>
      <div style={{ flexGrow: 1, minWidth: 4 }} />
      <Flat title="Split Right" icon="split" onClick={split} />
      <Flat title="New View" icon="square_plus" onClick={() => run("new_view", window.id)} />
    </div>
  )
}

/** Opens `line` in the pane `beside` is in: a browser tab, or the system's browser when the browser
 * plugin is not there. The browser's block resolves a bare line (a host, a search). */
function openPage(line: string, beside?: string) {
  const tree = useLayout()
  const leaf = beside && tree ? leavesOf(tree).find((pane) => pane.tabs.includes(beside)) : undefined
  call("tab.open", "pumi_dev.browser.page", { url: line }, { kind: "tiled", pane: leaf?.pane ?? "current" }).catch(() => {
    const url = /^[a-z][a-z0-9+.-]*:/i.test(line) || line.includes(".") ? line : `https://duckduckgo.com/?q=${encodeURIComponent(line)}`
    call("fs.open", url).catch(swallow)
  })
}

// ── the sidebar's body ──────────────────────────────────────────────────────────────────────

/**
 * The sidebar's body: the pinned tabs as tiles, then the tabs themselves — a session at a time
 * (when there is more than one), a folder for each of its views, and in a folder the tabs of each
 * of its panes, a split's two together as Arc draws them. A tab drags onto another row, or onto a
 * card, which splits it where it lands.
 */
function Sessions() {
  const t = useTheme()
  const m = useMetrics()
  const sessions = useSessions()
  const views = useApp((s) => s.snapshot?.views ?? NO_VIEWS)
  const current = useView()?.view_id
  const window = useWindow()
  const [open, setOpen] = useLocal(OPEN, NO_IDS)
  // The view in front opens by itself: a folder closed while you are in it is a bug.
  useEffect(() => {
    if (current) setOpen((list) => (list.includes(current) ? list : [...list, current]))
  }, [current, setOpen])
  const toggle = useCallback((view: string) => setOpen((list) => (list.includes(view) ? list.filter((key) => key !== view) : [...list, view])), [setOpen])
  const many = sessions.length > 1
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        overflowY: "scroll",
        paddingLeft: 8,
        paddingRight: 8,
        paddingBottom: 4,
        scrollbarWidth: 2,
        scrollbarColor: t.border,
      }}
    >
      <Pinned />
      {sessions.map((session) => {
        const own = views.filter((v) => v.workspace_id === session.workspace_id).sort((a, b) => a.number - b.number)
        const here = session.workspace_id === window.session
        return (
          <div key={session.workspace_id} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            {many ? (
              <div
                onClick={() => window.show(session.workspace_id)}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  height: FOLD,
                  flexShrink: 0,
                  marginTop: 8,
                  paddingLeft: 6,
                  paddingRight: 6,
                  cursor: "pointer",
                  userSelect: "none",
                  color: here ? t.text : t.muted,
                  hover: { color: t.text },
                }}
              >
                <text style={{ fontSize: m.fontSize - 1.5, fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{session.label || session.workspace_id}</text>
                <text style={{ fontSize: m.fontSize - 2.5, color: t.faint }}>{`${own.length}`}</text>
              </div>
            ) : null}
            {own.map((view) => (
              <Folder key={view.view_id} view={view.view_id} session={session.workspace_id} open={open.includes(view.view_id)} toggle={toggle} />
            ))}
          </div>
        )
      })}
      {sessions.length ? null : <text style={{ padding: 10, fontSize: m.fontSize - 1, color: t.faint }}>No sessions</text>}
    </div>
  )
}

/** One view as Arc's folder: its name, how many tabs it holds, and the tabs themselves when it is open. */
function Folder({ view, session, open: shown, toggle }: { view: string; session: string; open: boolean; toggle(view: string): void }) {
  const t = useTheme()
  const m = useMetrics()
  const window = useWindow()
  const tabs = useApp((s) => s.snapshot?.tabs ?? NO_TABS)
  const named = useView(view)
  const own = tabs.filter((p) => p.view_id === view)
  const label = named?.label || (own.length ? rowName(own[0]!) : "View")
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div
        onClick={() => {
          window.show(session, view)
          toggle(view)
        }}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: FOLD,
          flexShrink: 0,
          paddingLeft: 5,
          paddingRight: 6,
          borderRadius: 6,
          cursor: "pointer",
          userSelect: "none",
          color: t.muted,
          hover: { backgroundColor: t.hover, color: t.text },
        }}
      >
        <Icon name={shown ? "chevron_down" : "chevron_right"} size={10} color={t.faint} />
        <text style={{ fontSize: m.fontSize - 1.5, fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label}</text>
        <div style={{ flexGrow: 1, minWidth: 4 }} />
        <text style={{ fontSize: m.fontSize - 2.5, color: t.faint }}>{`${own.length}`}</text>
      </div>
      {shown ? <Rows view={view} session={session} /> : null}
    </div>
  )
}

/** A view's tabs as rows: a pane's tabs together (a split's two are one row of two chips). */
function Rows({ view, session }: { view: string; session: string }) {
  const tree = useLayout(view)
  const tabs = useApp((s) => s.snapshot?.tabs ?? NO_TABS)
  const rows = useMemo(() => {
    const held = tabs.filter((p) => p.view_id === view)
    const leaves = tree ? leavesOf(tree).map((leaf) => ({ pane: leaf.pane, tabs: leaf.tabs, active: leaf.active })) : []
    const tiled = new Set(leaves.flatMap((leaf) => leaf.tabs))
    return groupsOf(
      leaves,
      held.filter((p) => !tiled.has(p.tab_id)).map((p) => p.tab_id),
    )
  }, [tree, tabs, view])
  if (!rows.length) return <Empty />
  return (
    <>
      {rows.map((row) =>
        row.tabs.length > 1 ? (
          <SplitRow key={row.pane || "loose"} tabs={row.tabs} session={session} view={view} />
        ) : (
          <TabRow key={row.tabs[0]} tab={row.tabs[0]!} session={session} view={view} alone={rows.length === 1} inset={row.pane ? 19 : 10} />
        ),
      )}
    </>
  )
}

/** A folder with nothing in it. */
function Empty() {
  const m = useMetrics()
  const t = useTheme()
  return <text style={{ paddingLeft: 26, paddingTop: 2, paddingBottom: 4, fontSize: m.fontSize - 1, color: t.faint }}>No tabs</text>
}

/** A pane's tabs as Arc's split row: a chip each, side by side, the one in front lit. */
function SplitRow({ tabs, session, view }: { tabs: string[]; session: string; view: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, paddingLeft: 16, paddingRight: 5, paddingTop: 1, paddingBottom: 1 }}>
      {tabs.map((tab) => (
        <SplitChip key={tab} tab={tab} session={session} view={view} />
      ))}
    </div>
  )
}

function SplitChip({ tab, session, view }: { tab: string; session: string; view: string }) {
  const t = useTheme()
  const m = useMetrics()
  const window = useWindow()
  const p = useTab(tab)
  const lit = tab === useFocusedTab()
  return (
    <div
      onClick={() => goTo(window, session, view, tab)}
      title={p ? rowName(p) : tab}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 26,
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        paddingLeft: 4,
        paddingRight: 6,
        borderRadius: 6,
        cursor: "pointer",
        userSelect: "none",
        backgroundColor: lit ? t.selected : t.hover,
        hover: { backgroundColor: lit ? t.selected : t.active },
      }}
    >
      <Glyph tab={tab} size={14} />
      <text style={{ fontSize: m.fontSize - 2, color: lit ? t.text : t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{p ? rowName(p) : tab}</text>
    </div>
  )
}

/** A tab's row: its icon and name, the one in front on Arc's lavender, and on hover its pin and its
 * close. It drags beside, into or onto another row, and onto a card, which splits it where it lands. */
function TabRow({ tab, session, view, alone, inset = 10 }: { tab: string; session: string; view: string; alone: boolean; inset?: number }) {
  const t = useTheme()
  const m = useMetrics()
  const window = useWindow()
  const focused = useFocusedTab()
  const [pinned, setPinned] = useLocal(PINNED, NO_IDS)
  const [over, setOver] = useState(false)
  const { open, menu } = useMenu("tab.menu", { tab })
  const drag = useDraggable<Carried>({ kind: "pumi.tab", tab })
  const p = useTab(tab)
  const isPinned = pinned.includes(tab)
  const selected = tab === focused
  return (
    <>
      <div
        {...drag.props}
        onMouseEnter={() => setOver(true)}
        onMouseLeave={() => setOver(false)}
        onAuxClick={open}
        onClick={() => drag.wasDragged() || goTo(window, session, view, tab)}
        title={p ? rowName(p) : tab}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          height: ROW,
          flexShrink: 0,
          marginLeft: 6,
          marginRight: 2,
          paddingLeft: inset - 6,
          paddingRight: 4,
          borderRadius: 7,
          cursor: "pointer",
          userSelect: "none",
          backgroundColor: selected ? t.selected : undefined,
          hover: { backgroundColor: selected ? t.selected : t.hover },
        }}
      >
        <Glyph tab={tab} size={15} />
        <text
          style={{
            fontSize: m.fontSize - 1,
            fontWeight: selected ? 500 : 400,
            color: selected ? t.text : t.textTab,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {p ? rowName(p) : tab}
        </text>
        <div style={{ flexGrow: 1, minWidth: 4 }} />
        {isPinned && !over ? <SVG src={PIN} size={10} /> : null}
        {over ? (
          <>
            <Small icon="ellipsis" title="More" onClick={open} />
            <Small icon="close" title="Close Tab" onClick={() => call(via(tab, "tab.close"), tab).catch(swallow)} />
          </>
        ) : null}
        <DropRow row={{ kind: "tab", session, view, tab, alone }} />
      </div>
      {menu}
    </>
  )
}

/** A tab's row as a drop target: a tab dragged over it lands before or after it, its edge lit. */
function DropRow({ row }: { row: { kind: "tab"; session: string; view: string; tab: string; alone: boolean } }) {
  const t = useTheme()
  const window = useWindow()
  const snapshot = useApp((s) => s.snapshot)
  const drag = useDragState()
  const flying = carried(drag?.data)
  const drop = useDropBox<Carried>(
    (data): data is Carried => !!carried(data),
    (it, at, box) => {
      const { fy } = within(at, box)
      const move = rowDrop(it, row, fy, whereIn(snapshot))
      if (move) runMove(move, window)
    },
  )
  const move = drop.isOver && flying ? rowDrop(flying, row, drop.drag ? within(drop.drag, drop.box()).fy : 0.5, whereIn(snapshot)) : undefined
  const lit = move && "after" in move ? (move.after ? "after" : "before") : move ? "into" : undefined
  return (
    <div
      ref={drop.ref}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 20,
        pointerEvents: flying ? "auto" : "none",
        backgroundColor: "#00000001",
        borderRadius: 7,
        borderWidth: lit === "into" ? 1 : 0,
        borderColor: t.accent,
      }}
    >
      {lit === "before" || lit === "after" ? (
        <div style={{ position: "absolute", left: 6, right: 6, height: 2, borderRadius: 1, backgroundColor: t.accent, ...(lit === "before" ? { top: 0 } : { bottom: 0 }) }} />
      ) : null}
    </div>
  )
}

/** The tabs pinned, as Arc's tiles: a page's letter on its colour, or its icon. A press goes there,
 * a middle press or the little x unpins it. */
function Pinned() {
  const t = useTheme()
  const window = useWindow()
  const [width] = useLocal(WIDTH_KEY, WIDTH)
  const [pinned, setPinned] = useLocal(PINNED, NO_IDS)
  const tabs = useApp((s) => s.snapshot?.tabs ?? NO_TABS)
  const focused = useFocusedTab()
  const known = useMemo(() => new Set(tabs.map((p) => p.tab_id)), [tabs])
  useEffect(() => {
    const kept = prunePinned(pinned, known)
    if (kept.length !== pinned.length) setPinned(kept)
  }, [known, pinned, setPinned])
  const held = pinned.map((id) => tabs.find((p) => p.tab_id === id)).filter((p): p is Tab => !!p)
  if (!held.length) return null
  // Four to a row, filling the bar as Arc's grid does.
  const span = Math.max(26, Math.floor((width - 24 - 18) / 4))
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        flexShrink: 0,
        paddingTop: 2,
        paddingBottom: 8,
        marginBottom: 2,
        borderBottomWidth: 1,
        borderColor: t.border,
      }}
    >
      {held.map((p) => (
        <Tile
          key={p.tab_id}
          held={p}
          size={span}
          active={p.tab_id === focused}
          onClick={() => goTo(window, p.workspace_id, p.view_id, p.tab_id)}
          onUnpin={() => setPinned((list) => togglePinned(list, p.tab_id))}
        />
      ))}
    </div>
  )
}

function Tile({ held, size = TILE, active, onClick, onUnpin }: { held: Held; size?: number; active: boolean; onClick(): void; onUnpin(): void }) {
  const t = useTheme()
  const [over, setOver] = useState(false)
  const site = webOf(held) ? addressOf(held) : ""
  const page = site && site !== "New Tab"
  // A page's tile wears its site's pale colour; anything else the colour of its name, both with a
  // letter, as Arc's fallback tiles have.
  const tint = page ? tintFor(site) : t.muted
  return (
    <div
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      onClick={onClick}
      onAuxClick={onUnpin}
      title={rowName(held)}
      style={{
        display: "flex",
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: Math.round(size * 0.26),
        backgroundColor: mix(tint, t.editor, 0.86),
        cursor: "pointer",
        userSelect: "none",
        outlineWidth: active ? 1.5 : 0,
        outlineColor: t.accent,
        outlineOffset: 1,
        hover: { backgroundColor: mix(tint, t.editor, 0.74) },
      }}
    >
      <text style={{ fontSize: Math.round(size * 0.42), fontWeight: 600, color: tint }}>{monogram(page ? site : rowName(held))}</text>
      {over ? (
        <div
          aria-label="Unpin"
          onClick={(e: any) => {
            e?.stopPropagation?.()
            onUnpin()
          }}
          style={{
            display: "flex",
            position: "absolute",
            top: -5,
            right: -5,
            width: 15,
            height: 15,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            backgroundColor: t.text,
          }}
        >
          <Icon name="close" size={9} color={t.window} />
        </div>
      ) : null}
    </div>
  )
}

/** The sidebar's foot: a new tab, a new view, the session in front, and the close of its tab. */
function Foot() {
  const t = useTheme()
  const m = useMetrics()
  const window = useWindow()
  const session = useSession()
  const tab = useFocusedTab()
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
        height: FOOT,
        flexShrink: 0,
        paddingLeft: 8,
        paddingRight: 6,
        borderTopWidth: 1,
        borderColor: t.border,
      }}
    >
      <Small icon="plus" title="New Tab" onClick={() => run("new_tab", window.id)} />
      <Small icon="square_plus" title="New View" onClick={() => run("new_view", window.id)} />
      <div style={{ flexGrow: 1, minWidth: 4 }} />
      {session ? (
        <text style={{ fontSize: m.fontSize - 2.5, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 100, flexShrink: 1, paddingRight: 4 }}>
          {session.label || session.workspace_id}
        </text>
      ) : null}
      <SpriteButton src={TRASH} title="Close Tab" tint={tab ? t.muted : t.faint} onClick={() => tab && call(via(tab, "tab.close"), tab).catch(swallow)} />
    </div>
  )
}

/** The sidebar's right edge: drag it to size the bar. */
function Edge({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const t = useTheme()
  const [from, setFrom] = useState<{ x: number; width: number } | undefined>()
  return (
    <div
      onMouseDown={(e) => setFrom({ x: e.x ?? 0, width })}
      onMouseMove={(e) => from && setWidth(Math.min(420, Math.max(180, from.width + (e.x ?? 0) - from.x)))}
      onMouseUp={() => setFrom(undefined)}
      style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize", hover: { backgroundColor: `${t.accent}55` } }}
    />
  )
}

/** The plugins' panels: what they put in the sidebar's foot, over its own buttons. */
function Panels() {
  const C = useComponents()
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 1, minHeight: 0, maxHeight: 280 }}>
      <C.Panel point="panel" />
    </div>
  )
}

/** The sidebar put away: the button that brings it back, over the cards. */
function Collapsed() {
  const t = useTheme()
  const m = useMetrics()
  const [, setOpen] = useSidebar()
  const focused = useFocusedTab()
  const tab = useTab(focused)
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 100,
        height: 30,
        paddingLeft: 3,
        paddingRight: 3,
        borderRadius: 10,
        backgroundColor: t.overlay,
        borderWidth: 1,
        borderColor: t.pillEdge,
        boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 12, spreadRadius: 0, color: t.shadow },
      }}
    >
      <Small icon="layout_sidebar_left" title="Show Side Bar" onClick={() => setOpen(true)} />
      <text style={{ fontSize: m.fontSize - 1, color: t.muted, whiteSpace: "nowrap", maxWidth: 220, textOverflow: "ellipsis", paddingRight: 8 }}>{tab ? addressOf(tab) : "pumi"}</text>
    </div>
  )
}

// ── the cards ───────────────────────────────────────────────────────────────────────────────

/**
 * One pane as Arc's card: rounded, a soft shadow, the tab in front inside it. Its corners are cut
 * by four small squares of the window's colour painted over the body (a page is a native view the
 * window cannot clip, but it is cut wherever the window paints over it), and its bar and foot carry
 * the rounded corners themselves. A page's card has Arc's bar over the browser's own toolbar and
 * its address along the foot; another tab's card has a bar of its own above its body. A tab dragged
 * over a card splits it on whichever side it is dropped.
 */
function Pane({ pane, tabs, active, focused, zoomed }: { pane: string; tabs: string[]; active?: string | null; focused: boolean; zoomed: boolean }) {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  const [over, setOver] = useState(false)
  const front = active ?? tabs[0] ?? ""
  const live = useTab(front)
  const last = useRef(live)
  if (live) last.current = live
  const tab = live ?? last.current
  const web = isWeb(tab)
  const cover = useThemeOption<boolean>("browser_chrome", true)
  const state = useWebview(web ? front : "")
  const covered = web && cover !== false
  return (
    <div
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        backgroundColor: t.editor,
        borderRadius: RADIUS,
        overflow: "hidden",
        boxShadow: [
          { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: t.shadow },
          { offsetX: 0, offsetY: 10, blurRadius: 28, spreadRadius: -10, color: t.shadow },
        ],
      }}
    >
      {covered ? null : <Head tab={front} tabs={tabs} pane={pane} focused={focused} over={over} />}
      {front ? <C.TabBody key={front} tab={front} focused={focused} /> : null}
      {covered ? (
        <>
          <Float tab={front} tabs={tabs} pane={pane} focused={focused} over={over} />
          {state?.url ? <Address url={state.url} /> : null}
        </>
      ) : null}
      <Corners />
      <PaneDrop pane={pane} tabs={tabs} active={front} />
    </div>
  )
}

/** The four corners of a card, cut back to the window's colour: the rounding a page's own view has
 * not. `top` and `bottom` are the bands a bar or a foot paints, which are rounded themselves. */
function Corners() {
  const t = useTheme()
  const corner = (style: Record<string, unknown>) => (
    <div key={JSON.stringify(style)} style={{ position: "absolute", width: RADIUS + 1, height: RADIUS + 1, backgroundColor: t.window, zIndex: 42, pointerEvents: "none", ...style }} />
  )
  return (
    <>
      {corner({ top: 0, left: 0 })}
      {corner({ top: 0, right: 0 })}
      {corner({ bottom: 0, left: 0 })}
      {corner({ bottom: 0, right: 0 })}
    </>
  )
}

/** A card's bar, in flow: Arc's, over a tab that is not a page. */
function Head({ tab, tabs, pane, focused, over }: { tab: string; tabs: string[]; pane: string; focused: boolean; over: boolean }) {
  const t = useTheme()
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: BAR,
        flexShrink: 0,
        backgroundColor: t.editor,
        borderBottomWidth: 1,
        borderColor: t.hairline,
        borderTopLeftRadius: RADIUS,
        borderTopRightRadius: RADIUS,
      }}
    >
      <Bar tab={tab} tabs={tabs} pane={pane} focused={focused} over={over} />
    </div>
  )
}

/** The bar's contents, in flow or floating: the tab's name (or its pane's chips) and its buttons. */
function Bar({ tab, tabs, pane, focused, over }: { tab: string; tabs: string[]; pane: string; focused: boolean; over: boolean }) {
  const t = useTheme()
  const m = useMetrics()
  const p = useTab(tab)
  const web = isWeb(p)
  const state = useWebview(web ? tab : "")
  const { open, show, menu } = useMenu("tab.menu", { tab })
  const status = p?.status
  const split = (side: "left" | "right" | "up" | "down") => call(via(pane, "tab.open"), null, {}, { kind: "tiled", pane, split: side }).catch(swallow)
  return (
    <>
      <div
        onAuxClick={open}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          height: "100%",
          width: "100%",
          flexGrow: 1,
          minWidth: 0,
          paddingLeft: 8,
          paddingRight: 3,
          userSelect: "none",
        }}
      >
        {status && status !== "idle" && status !== "unknown" ? <Icon name={STATUS_ICON[status] ?? "status_unknown"} size={11} color={t[`status.${status}`] ?? t.faint} /> : null}
        {tabs.length > 1 ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1, minWidth: 0 }}>
            {tabs.map((id) => (
              <Chip key={id} tab={id} />
            ))}
          </div>
        ) : (
          <>
            <Glyph tab={tab} size={13} />
            <text style={{ fontSize: m.fontSize - 2.5, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0, maxWidth: 460 }}>{p ? rowName(p) : ""}</text>
          </>
        )}
        <div style={{ flexGrow: 1, minWidth: 4 }} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 0, flexShrink: 0, opacity: over ? 1 : 0 }}>
          {web ? <Small icon={state?.loading ? "rotate_cw" : "rotate_ccw"} title="Reload" onClick={() => call("tab.call", tab, "reload").catch(swallow)} /> : null}
          <Small icon="split" title="Split Right" onClick={() => split("right")} />
          <Small icon="ellipsis" title="More" onClick={show} />
          <Small icon="close" title="Close Tab" onClick={() => call(via(tab, "tab.close"), tab).catch(swallow)} />
        </div>
      </div>
      {menu}
    </>
  )
}

/** The bar of a page's card, floating over the browser's own toolbar and cut into the page under it. */
function Float({ tab, tabs, pane, focused, over }: { tab: string; tabs: string[]; pane: string; focused: boolean; over: boolean }) {
  const t = useTheme()
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: BROWSER_TOP,
        zIndex: 44,
        backgroundColor: t.editor,
        borderBottomWidth: 1,
        borderColor: t.hairline,
        borderTopLeftRadius: RADIUS,
        borderTopRightRadius: RADIUS,
      }}
    >
      <Bar tab={tab} tabs={tabs} pane={pane} focused={focused} over={over} />
    </div>
  )
}

/** The address along a page's card foot, over the browser's own: where the page is. */
function Address({ url }: { url: string }) {
  const t = useTheme()
  const m = useMetrics()
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: BROWSER_FOOT,
        zIndex: 44,
        paddingLeft: 10,
        paddingRight: 10,
        backgroundColor: t.editor,
        borderTopWidth: 1,
        borderColor: t.hairline,
        borderBottomLeftRadius: RADIUS,
        borderBottomRightRadius: RADIUS,
      }}
    >
      <text style={{ fontSize: m.fontSize - 3, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{siteOf(url) || url}</text>
    </div>
  )
}

/** One of a card's tabs, in its bar: a press brings it to the front. */
function Chip({ tab }: { tab: string }) {
  const t = useTheme()
  const m = useMetrics()
  const p = useTab(tab)
  const lit = tab === useFocusedTab()
  return (
    <div
      onClick={() => call(via(tab, "tab.focus"), tab).catch(swallow)}
      title={p ? rowName(p) : tab}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 21,
        flexShrink: 1,
        minWidth: 0,
        paddingLeft: 4,
        paddingRight: 7,
        borderRadius: 6,
        cursor: "pointer",
        backgroundColor: lit ? t.selected : t.hover,
        hover: { backgroundColor: lit ? t.selected : t.active },
      }}
    >
      <Glyph tab={tab} size={12} />
      <text style={{ fontSize: m.fontSize - 2.5, color: lit ? t.text : t.muted, whiteSpace: "nowrap", maxWidth: 130, textOverflow: "ellipsis" }}>{p ? rowName(p) : tab}</text>
    </div>
  )
}

/** A tab dragged over a card: the half it would take, lit. Nothing is in the way when none is. */
function PaneDrop({ pane, tabs, active }: { pane: string; tabs: string[]; active?: string | null }) {
  const t = useTheme()
  const window = useWindow()
  const snapshot = useApp((s) => s.snapshot)
  const rows = usePaneTabs()
  const drag = useDragState()
  const flying = carried(drag?.data)
  const drop = useDropBox<Carried>(
    (data): data is Carried => !!carried(data),
    (it, at, box) => {
      const { fx, fy } = within(at, box)
      const move = tabDrop(it, { pane, tabs, active }, regionAt(fx, fy, rows), rows)
      if (move) runMove(move, window)
    },
  )
  if (!flying) return null
  const at = drop.drag ? within(drop.drag, drop.box()) : { fx: 0.5, fy: 0.5 }
  const box = regionBox(regionAt(at.fx, at.fy, rows))
  return (
    <div ref={drop.ref} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 80 }}>
      {drop.isOver ? (
        <div
          style={{
            position: "absolute",
            left: `${Math.round(box.x * 100)}%`,
            top: `${Math.round(box.y * 100)}%`,
            width: `${Math.round(box.w * 100)}%`,
            height: `${Math.round(box.h * 100)}%`,
            backgroundColor: `${t.accent}26`,
            borderWidth: 1,
            borderColor: t.accent,
            borderRadius: 10,
          }}
        />
      ) : null}
    </div>
  )
}

// ── a tab's icon, and a painted one ────────────────────────────────────────────────────────

/**
 * A tab's icon: a page's letter on its site's pale colour (as Arc's fallback tile is), or the icon
 * its block brings; a tab at work says so instead.
 */
function Glyph({ tab, size = 14 }: { tab?: string; size?: number }) {
  const t = useTheme()
  const tiles = useThemeOption<boolean>("site_tiles", true)
  const p = useTab(tab ?? "")
  const { icon, status } = useTabMeta(tab ?? "")
  if (!p) return <div style={{ width: size, height: size, flexShrink: 0 }} />
  const web = webOf(p)
  if (!web) {
    if (status && status !== "idle" && status !== "clear") {
      return <Icon name={STATUS_ICON[status] ?? "status_unknown"} size={size} color={t[`status.${status}`] ?? t.faint} />
    }
    return <IconImage icon={icon} size={size} color={t.muted} />
  }
  const site = addressOf(p)
  if (tiles === false || site === "New Tab") return <Icon name="tool_web" size={size} color={t.muted} />
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: Math.max(3, Math.round(size * 0.26)),
        backgroundColor: mix(tintFor(site), t.surface, 0.84),
      }}
    >
      <text style={{ fontSize: Math.max(7, Math.round(size * 0.66)), fontWeight: 600, color: tintFor(site) }}>{monogram(site)}</text>
    </div>
  )
}

/** The `TabIcon` part: what the window shows for a tab wherever it shows one. */
function TabIcon({ tab, size = 14 }: TabIconProps) {
  return <Glyph tab={tab} size={size} />
}

/** A small button of the sidebar's own row, with an icon of the app's or one of the theme's. */
function Flat({ icon, sprite, title, tint, onClick }: { icon?: string; sprite?: string; title: string; tint?: string; onClick(): void }) {
  const t = useTheme()
  return (
    <div
      aria-label={title}
      title={title}
      onClick={onClick}
      style={{
        display: "flex",
        width: 24,
        height: 24,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        cursor: "pointer",
        color: tint ?? t.muted,
        hover: { backgroundColor: t.hover },
      }}
    >
      {sprite ? <svg src={sprite} style={{ width: 12, height: 12, color: tint ?? t.muted }} /> : <Icon name={icon ?? "circle"} size={13} />}
    </div>
  )
}

/** One of the theme's own glyphs, in a quiet colour: the mark a pinned row carries. */
function SVG({ src, size, tint }: { src: string; size: number; tint?: string }) {
  const t = useTheme()
  return <svg src={src} style={{ width: size, height: size, flexShrink: 0, color: tint ?? t.faint }} />
}

/** A button drawn with one of the theme's own glyphs (`sprites.ts`): the pin, the bin. */
function SpriteButton({ src, title, tint, size = 12, onClick, stop = false }: { src: string; title: string; tint?: string; size?: number; onClick(): void; stop?: boolean }) {
  const t = useTheme()
  return (
    <div
      aria-label={title}
      title={title}
      onClick={(e: any) => {
        if (stop) e?.stopPropagation?.()
        onClick()
      }}
      style={{
        display: "flex",
        width: 22,
        height: 22,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        cursor: "pointer",
        color: tint ?? t.muted,
        hover: { backgroundColor: t.hover },
      }}
    >
      <svg src={src} style={{ width: size, height: size, color: tint ?? t.muted }} />
    </div>
  )
}

// ── menus and questions ─────────────────────────────────────────────────────────────────────

/** A menu's card: a soft card, a rule between its groups. */
function card(t: Tokens, m: { radius: number }): Record<string, unknown> {
  return {
    display: "flex",
    flexDirection: "column",
    minWidth: 210,
    paddingTop: 5,
    paddingBottom: 5,
    borderRadius: 12,
    backgroundColor: t.overlay,
    borderWidth: 1,
    borderColor: t.pillEdge,
    boxShadow: [
      { offsetX: 0, offsetY: 10, blurRadius: 28, spreadRadius: -4, color: "#00000033" },
      { offsetX: 0, offsetY: 1, blurRadius: 3, spreadRadius: 0, color: "#0000001a" },
    ],
  }
}

/** A rule between two groups of a menu. */
function Rule() {
  const t = useTheme()
  return <div style={{ height: 1, flexShrink: 0, marginTop: 4, marginBottom: 4, marginLeft: 8, marginRight: 8, backgroundColor: t.border }} />
}

/** The `Menu` part: a slot's actions in their groups, submenus beside, and the slot's components under. */
function Menu({ at, actions, components, args, close }: MenuProps) {
  const t = useTheme()
  const m = useMetrics()
  return (
    <anchored position={at} fit="snap" snapMargin={8} deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
      <div onMouseDownOutside={close} style={card(t, m) as never}>
        <MenuRows actions={actions} close={close} />
        {components?.length && actions.length ? <Rule /> : null}
        {components?.map((v) => renderComponent(v, { ...args, close }))}
      </div>
    </anchored>
  )
}

/** Actions as a menu's rows, in their groups. */
function MenuRows({ actions, close }: { actions: ActionItem[]; close(): void }) {
  return (
    <>
      {grouped(actions).map((group, i) => (
        <Fragment key={`${i}:${group[0]?.group ?? ""}`}>
          {i > 0 ? <Rule /> : null}
          {group.map((a) => (
            <Item key={`${a.plugin}/${a.id}`} action={a} close={close} />
          ))}
        </Fragment>
      ))}
    </>
  )
}

/** One row of a menu: its icon, its name, its keys or its check, and a submenu of its own rows. */
function Item({ action, close }: { action: ActionItem; close(): void }) {
  const t = useTheme()
  const m = useMetrics()
  const [sub, setSub] = useState(false)
  const disabled = action.disabled === true
  const row = (
    <div
      onMouseEnter={() => setSub(!!action.items)}
      onClick={() => {
        if (action.items) return setSub((on) => !on)
        close()
        action.run()
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 24,
        flexShrink: 0,
        marginLeft: 5,
        marginRight: 5,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: 6,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        backgroundColor: sub ? t.hover : undefined,
        hover: disabled ? {} : { backgroundColor: t.hover },
      }}
    >
      {action.icon ? <Icon name={action.icon} size={13} color={t.muted} /> : null}
      <text style={{ fontSize: m.fontSize, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{action.title}</text>
      <div style={{ flexGrow: 1, minWidth: 16 }} />
      {action.keys ? <text style={{ fontSize: m.fontSize - 1, color: t.faint, whiteSpace: "nowrap" }}>{action.keys}</text> : null}
      {action.checked ? <Icon name="check" size={12} color={t.accent} /> : null}
      {action.items ? <Icon name="chevron_right" size={12} color={t.faint} /> : null}
    </div>
  )
  if (!action.items) return row
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }} onMouseLeave={() => setSub(false)}>
      {row}
      {sub ? (
        <anchored side="right" align="start" gap={4} offset={{ x: 0, y: -6 }} fit="snap" snapMargin={8} deferred occlude priority={2} style={{ backgroundColor: "transparent" }}>
          <div style={card(t, m) as never}>
            <MenuRows actions={action.items} close={close} />
          </div>
        </anchored>
      ) : null}
    </div>
  )
}

/** The `Dialog` part: a question in the middle of the window, over everything else. */
function Dialog({ title, detail, confirm: yes, cancel, danger, input, onConfirm, onCancel }: DialogProps) {
  const t = useTheme()
  const m = useMetrics()
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
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: "100%",
            maxWidth: 380,
            padding: 16,
            borderRadius: 14,
            backgroundColor: t.overlay,
            borderWidth: 1,
            borderColor: t.pillEdge,
            keyboardFocusDim: false,
            boxShadow: { offsetX: 0, offsetY: 14, blurRadius: 40, spreadRadius: -6, color: "#00000055" },
          }}
        >
          <text style={{ fontSize: m.fontSize, fontWeight: 600, color: t.text }}>{title}</text>
          {detail ? <text style={{ fontSize: m.fontSize - 1, color: t.muted }}>{detail}</text> : null}
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
              style={{ height: 28, fontSize: m.fontSize, color: t.text, paddingLeft: 8, paddingRight: 8, borderRadius: 7, borderWidth: 1, borderColor: t.accent, backgroundColor: t.editor }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Choice title={cancel} onClick={onCancel} />
            <Choice title={yes} danger={danger} primary onClick={onConfirm} />
          </div>
        </div>
      </div>
    </anchored>
  )
}

function Choice({ title, danger, primary, onClick }: { title: string; danger?: boolean; primary?: boolean; onClick(): void }) {
  const t = useTheme()
  const m = useMetrics()
  const fill = danger ? t.error : primary ? t.accent : t.active
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
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 28,
        flexShrink: 0,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 8,
        cursor: "pointer",
        backgroundColor: fill,
        keyboardFocusDim: false,
        hover: { backgroundColor: primary || danger ? fill : t.hover, opacity: 0.92 },
      }}
    >
      <text style={{ fontSize: m.fontSize - 1, fontWeight: 500, color: danger ? t.window : primary ? t.accentText : t.text, whiteSpace: "nowrap" }}>{title}</text>
    </div>
  )
}

/** The `IconButton` part: the window's own buttons, and a plugin's, as Arc's. */
function IconButton({ icon, title, onClick, active, color }: IconButtonProps) {
  const t = useTheme()
  return (
    <div
      aria-label={title}
      title={title}
      onClick={onClick}
      style={{
        display: "flex",
        width: 24,
        height: 24,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        color: color ?? (active ? t.text : t.faint),
        backgroundColor: active ? t.active : undefined,
        cursor: "pointer",
        hover: { backgroundColor: t.hover, color: t.text },
      }}
    >
      <Icon name={icon} size={13} />
    </div>
  )
}

/** The app's parts this theme leaves to it draw the rest. */
export const PARTS: Partial<Components> = {
  Window,
  Sessions,
  Pane,
  Menu,
  Dialog,
  IconButton,
  TabIcon,
}
