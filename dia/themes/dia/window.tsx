// Dia: one frosted sidebar of pinned tiles, folders and tabs, and the panes on a card beside it.
//
// The sidebar is the whole chrome: the packages' panel views pinned as tiles at its top, your
// sessions as folders, then this session's tabs as rows — a split tab shows its panes side by side
// in its row. The panes sit on one rounded card beside it, under a quiet toolbar, borderless: the
// focused pane is marked only by its title.
//
// After the Dia browser. From this package's `theme.lua`, which extended the default theme: the
// parts it copied from there went with the CSS renderer, so this window is drawn in full.
import { useEffect, useRef, useState } from "react"
import { Icon, call, useTheme } from "pumi"
import {
  commands,
  renderView,
  useApp,
  useBinding,
  useComponents,
  useFocusedPane,
  useLayout,
  useLocal,
  usePane,
  useRenderer,
  useSession,
  useSessions,
  useSlot,
  useTabs,
  useWindow,
  windowContext,
  type Pane as WindowPane,
  type Session as WindowSession,
  type Tab as WindowTab,
  type Tree,
} from "pumi/theme"

type TabRow = WindowTab

const swallow = (err: unknown) => console.error(String(err))
const NO_PANES: WindowPane[] = []

/** The window's own chrome, as a theme that draws a title bar needs it. */
function useChrome() {
  const window = useWindow()
  const lights = window.trafficLights
  return { fullscreen: window.fullscreened, active: window.active, trafficLights: lights, inset: lights ? lights.x + lights.width + 12 : 0 }
}

/** A tab's status, as a dot: its own agent's state. */
function Dot({ status, size = 7 }: { status?: string; size?: number }) {
  const t = useTheme()
  const color = t[`agent.${status || "unknown"}`] ?? t["agent.unknown"]
  return <div style={{ width: size, height: size, borderRadius: size / 2, flexShrink: 0, backgroundColor: color }} />
}

/** A quiet icon button: a hover wash, the ink's muted tone. */
function Button({ icon, title, onClick, active, size = 15 }: { icon: string; title?: string; onClick(): void; active?: boolean; size?: number }) {
  const t = useTheme()
  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        display: "flex",
        width: 26,
        height: 26,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        cursor: "pointer",
        color: active ? t.text : t["dia.inkMuted"],
        hover: { backgroundColor: t["dia.rowHover"], color: t.text },
      }}
    >
      <Icon name={icon} size={size} />
    </div>
  )
}

/** What a pane holds, as an icon: its agent's state, else its kind. */
function PaneIcon({ pane }: { pane?: WindowPane }) {
  const t = useTheme()
  const status = pane?.agent_status
  if (status && status !== "idle" && status !== "unknown") return <Dot status={status} />
  const kind = pane?.block ?? "terminal"
  const name = kind === "browser" ? "tool_web" : kind === "document" ? "code" : "terminal"
  return <Icon name={name} size={15} color={t["dia.inkMuted"]} />
}

/** One pane of a split tab, in the tab's row: its icon, its title, its own close. */
function Segment({ pane, tab, active }: { pane: WindowPane; tab: TabRow; active: boolean }) {
  const t = useTheme()
  const focused = useFocusedPane()
  const [hovered, setHovered] = useState(false)
  const title = pane.terminal_title || pane.label || pane.block
  const on = active && focused === pane.pane_id
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!active) call("tab.focus", tab.tab_id, {}).catch(swallow)
        call("pane.focus", pane.pane_id, {}).catch(swallow)
      }}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 0, height: 28, paddingLeft: 6, paddingRight: 4, borderRadius: 6 }}
    >
      <div style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <PaneIcon pane={pane} />
      </div>
      <text style={{ fontSize: 13, flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", color: on ? t["dia.ink"] : t["dia.inkMuted"] }}>{title}</text>
      <div style={{ flexGrow: 1 }} />
      <div
        onClick={(event: any) => {
          event?.stopPropagation?.()
          call("pane.close", pane.pane_id).catch(swallow)
        }}
        style={{ display: "flex", width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 4, opacity: hovered ? 1 : 0, hover: { backgroundColor: t.active } }}
      >
        <Icon name="close" size={10} />
      </div>
    </div>
  )
}

/** A tab of the session: a row of its own, or a split tab's panes side by side in it. */
function Tab({ tab, index, active }: { tab: TabRow; index: number; active: boolean }) {
  const t = useTheme()
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === tab.tab_id) ?? NO_PANES)
  const [hovered, setHovered] = useState(false)
  const title = tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`
  const split = panes.length > 1
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={(event: any) => {
        if (event?.button === 1) call("tab.close", tab.tab_id).catch(swallow)
      }}
      onClick={() => {
        if (!active) call("tab.focus", tab.tab_id, {}).catch(swallow)
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: split ? 2 : 9,
        height: 34,
        flexShrink: 0,
        paddingLeft: split ? 3 : 9,
        paddingRight: split ? 3 : 6,
        borderRadius: 8,
        cursor: "pointer",
        backgroundColor: active ? t["dia.rowActive"] : hovered ? t["dia.rowHover"] : undefined,
        boxShadow: active ? { offsetX: 0, offsetY: 1, blurRadius: 3, spreadRadius: 0, color: "#00000026" } : undefined,
      }}
    >
      {split ? (
        panes.map((pane) => <Segment key={pane.pane_id} pane={pane} tab={tab} active={active} />)
      ) : (
        <>
          <div style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <PaneIcon pane={panes[0]} />
          </div>
          <text style={{ fontSize: 13, flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", color: t["dia.ink"] }}>{title}</text>
          <div style={{ flexGrow: 1 }} />
          <div
            onClick={(event: any) => {
              event?.stopPropagation?.()
              call("tab.close", tab.tab_id).catch(swallow)
            }}
            style={{ display: "flex", width: 20, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 5, opacity: hovered ? 1 : 0, hover: { backgroundColor: t.active } }}
          >
            <Icon name="close" size={11} />
          </div>
        </>
      )}
    </div>
  )
}

/** A session, as one of Dia's folders: the one in front open, the rest a click away. */
function Folder({ session }: { session: WindowSession }) {
  const t = useTheme()
  const here = useSession()
  const window = useWindow()
  const current = session.workspace_id === here?.workspace_id
  const busy = session.agent_status && session.agent_status !== "idle"
  return (
    <div
      onClick={() => {
        if (!current) window.show(session.workspace_id)
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        height: 34,
        flexShrink: 0,
        paddingLeft: 9,
        paddingRight: 6,
        borderRadius: 8,
        cursor: "pointer",
        hover: { backgroundColor: t["dia.rowHover"] },
      }}
    >
      <div style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {busy ? <Dot status={session.agent_status} /> : <Icon name={current ? "folder_open" : "folder"} size={15} color={t["dia.inkMuted"]} />}
      </div>
      <text style={{ fontSize: 13, fontWeight: 600, flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", color: current ? t.accent : t["dia.ink"] }}>{session.label}</text>
      <div style={{ flexGrow: 1 }} />
      <Icon name={current ? "chevron_down" : "chevron_right"} size={11} color={t["dia.inkMuted"]} />
    </div>
  )
}

/** The agents waiting, as counts: a press goes to one of them. */
function Agents() {
  const t = useTheme()
  const agents = useApp((s) => s.snapshot?.panes.filter((p) => p.agent) ?? NO_PANES)
  const count = (status: string) => agents.filter((agent) => agent.agent_status === status).length
  const shown = ["blocked", "working", "done", "error"].filter((status) => count(status) > 0)
  if (!shown.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
      {shown.map((status) => (
        <div
          key={status}
          title={`${count(status)} ${status}`}
          onClick={() => {
            const next = agents.find((agent) => agent.agent_status === status)
            if (next) call("pane.focus", next.pane_id, {}).catch(swallow)
          }}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, cursor: "pointer" }}
        >
          <Dot status={status} />
          <text style={{ fontSize: 11, color: t["dia.inkMuted"] }}>{String(count(status))}</text>
        </div>
      ))}
    </div>
  )
}

/** The sidebar's foot: the agents, the session's path, and what packages put in the status. */
function Foot() {
  const t = useTheme()
  const session = useSession()
  const { views } = useSlot("status")
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 26, flexShrink: 0, paddingLeft: 6, paddingRight: 6 }}>
      <Agents />
      <text style={{ fontSize: 11, color: t["dia.inkMuted"], flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{session?.cwd ?? ""}</text>
      <div style={{ flexGrow: 1 }} />
      {views.map((view) => renderView(view))}
    </div>
  )
}

/** The sidebar's edge: drag it to size the bar. */
function Handle({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const t = useTheme()
  const [from, setFrom] = useState<{ x: number; width: number } | null>(null)
  return (
    <div
      onMouseDown={(event: any) => setFrom({ x: event?.x ?? 0, width })}
      onMouseMove={(event: any) => {
        if (from) setWidth(Math.min(420, Math.max(180, from.width + (event?.x ?? 0) - from.x)))
      }}
      onMouseUp={() => setFrom(null)}
      style={{ position: "absolute", top: 0, right: -6, width: 6, height: "100%", cursor: "col-resize", hover: { backgroundColor: `${t.accent}55` } }}
    />
  )
}

/** Which session the window shows, as a small card under the sessions button. */
function Sessions({ at, close }: { at: { x: number; y: number }; close(): void }) {
  const t = useTheme()
  const sessions = useSessions()
  const here = useSession()
  const window = useWindow()
  return (
    <anchored position={at} fit="snap" deferred occlude onMouseDownOutside={close}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 220,
          padding: 4,
          borderRadius: 12,
          backgroundColor: t.surface,
          borderWidth: 1,
          borderColor: t["dia.line"],
          boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: "#00000038" },
        }}
      >
        {sessions.map((session) => (
          <div
            key={session.workspace_id}
            onClick={() => {
              window.show(session.workspace_id)
              close()
            }}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              height: 28,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 7,
              cursor: "pointer",
              backgroundColor: session.workspace_id === here?.workspace_id ? t["dia.rowHover"] : undefined,
              hover: { backgroundColor: t.active },
            }}
          >
            <Icon name={session.workspace_id === here?.workspace_id ? "folder_open" : "folder"} size={14} color={t["dia.inkMuted"]} />
            <text style={{ fontSize: 13, color: t.text }}>{session.label}</text>
          </div>
        ))}
        <div style={{ height: 1, marginTop: 4, marginBottom: 4, backgroundColor: t["dia.line"] }} />
        <div
          onClick={() => {
            commands.run("new_workspace", windowContext(window.id)!)
            close()
          }}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: 7, cursor: "pointer", hover: { backgroundColor: t.active } }}
        >
          <Icon name="plus" size={14} color={t["dia.inkMuted"]} />
          <text style={{ fontSize: 13, color: t["dia.inkMuted"] }}>New Session</text>
        </div>
      </div>
    </anchored>
  )
}

/** The sidebar: the traffic lights' row, the pinned tiles, the folders, the tabs, the foot. */
function Sidebar({ width, setWidth, pinned, setPinned }: { width: number; setWidth(w: number): void; pinned: string | null; setPinned(id: string | null): void }) {
  const t = useTheme()
  const chrome = useChrome()
  const sessions = useSessions()
  const tabs = useTabs()
  const here = useSession()
  const window = useWindow()
  const { views } = useSlot("panel")
  const { views: titlebar } = useSlot("window.titlebar")
  const [sessions_at, setSessionsAt] = useState<{ x: number; y: number } | null>(null)
  const open = views.find((view) => `${view.plugin}/${view.id}` === pinned)
  const tiles = views.filter((view) => view.icon)
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6, width, flexShrink: 0, minWidth: 0, paddingLeft: 6, paddingRight: 6 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 30, flexShrink: 0, gap: 4, paddingLeft: 6 }}>
        <div style={{ width: chrome.inset, flexShrink: 0 }} />
        <div style={{ flexGrow: 1 }} />
        {titlebar.map((view) => renderView(view))}
        <Button icon="chevron_up_down" title="Sessions" onClick={() => setSessionsAt(sessions_at ? null : (window.trafficLights ? { x: 30, y: 34 } : { x: 30, y: 34 }))} />
        {sessions_at ? <Sessions at={sessions_at} close={() => setSessionsAt(null)} /> : null}
      </div>
      {tiles.length ? (
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
          {tiles.map((view) => {
            const id = `${view.plugin}/${view.id}`
            const active = pinned === id
            return (
              <div
                key={id}
                title={view.title ?? view.id}
                onClick={() => setPinned(active ? null : id)}
                style={{
                  display: "flex",
                  width: 42,
                  height: 42,
                  flexGrow: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 12,
                  backgroundColor: active ? t["dia.tileActive"] : t["dia.tile"],
                  cursor: "pointer",
                  boxShadow: active ? { offsetX: 0, offsetY: 1, blurRadius: 3, spreadRadius: 0, color: "#0000001f" } : undefined,
                  hover: { backgroundColor: active ? t["dia.tileActive"] : t["dia.tileHover"] },
                }}
              >
                <Icon name={view.icon!} size={16} color={t["dia.ink"]} />
              </div>
            )
          })}
        </div>
      ) : null}
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, borderRadius: 12, backgroundColor: t["dia.tile"], overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 32, flexShrink: 0, paddingLeft: 10, paddingRight: 4 }}>
            <text style={{ fontSize: 12, fontWeight: 600, color: t["dia.inkMuted"] }}>{open.title ?? open.id}</text>
            <div style={{ flexGrow: 1 }} />
            <Button icon="close" title="Back to tabs" onClick={() => setPinned(null)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>{renderView(open)}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", gap: 1, paddingTop: 4 }}>
          {sessions.map((session) => (
            <Folder key={session.workspace_id} session={session} />
          ))}
          <div style={{ height: 1, flexShrink: 0, marginTop: 6, marginBottom: 6, marginLeft: 8, marginRight: 8, backgroundColor: t["dia.line"] }} />
          <div
            onClick={() => commands.run("new_tab", windowContext(window.id)!)}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 9, height: 34, flexShrink: 0, paddingLeft: 9, paddingRight: 6, borderRadius: 8, cursor: "pointer", hover: { backgroundColor: t["dia.rowHover"] } }}
          >
            <div style={{ display: "flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="plus" size={15} color={t["dia.inkMuted"]} />
            </div>
            <text style={{ fontSize: 13, color: t["dia.inkMuted"] }}>New Tab</text>
          </div>
          {tabs.map((tab, index) => (
            <Tab key={tab.tab_id} tab={tab} index={index} active={tab.tab_id === here?.active_tab_id} />
          ))}
        </div>
      )}
      <Foot />
      <Handle width={width} setWidth={setWidth} />
    </div>
  )
}

/** The toolbar over the panes: the sidebar, splits, zoom, a notice, Settings. */
function Toolbar() {
  const t = useTheme()
  const window = useWindow()
  const chrome = useChrome()
  const [sidebar, setSidebar] = useLocal("dia.sidebar", true)
  const focused = useFocusedPane()
  const tree = useLayout()
  const zoomed = useApp((s) => s.snapshot?.layouts.find((l) => l.tab_id === s.snapshot?.focused_tab_id)?.zoomed ?? false)
  const notice = useApp((s) => (s as any).notice as string | undefined)
  const split = tree && "axis" in tree
  const run = (name: string) => commands.run(name, windowContext(window.id)!)
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 38, flexShrink: 0, paddingLeft: sidebar ? 8 : 6, paddingRight: 8 }}>
      {!sidebar ? <div style={{ width: chrome.inset, flexShrink: 0 }} /> : null}
      <Button icon="layout_sidebar_left" title="Side Bar" active={sidebar} onClick={() => setSidebar((v) => !v)} />
      <Button icon="split" title="Split Right" onClick={() => run("split_vertical")} />
      <Button icon="split_down" title="Split Down" onClick={() => run("split_horizontal")} />
      {split ? <Button icon={zoomed ? "minimize" : "maximize"} title="Zoom" onClick={() => run("zoom")} /> : null}
      <div style={{ flexGrow: 1 }} />
      {notice ? <text style={{ fontSize: 11, color: t.warning, flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{notice}</text> : null}
      {!focused ? <text style={{ fontSize: 11, color: t["dia.inkMuted"] }}>No pane</text> : null}
      <div
        onClick={() => run("settings")}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 26, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: 8, backgroundColor: t["dia.tile"], color: t["dia.inkMuted"], cursor: "pointer", hover: { backgroundColor: t["dia.tileHover"], color: t["dia.ink"] } }}
      >
        <Icon name="settings" size={13} />
        <text style={{ fontSize: 12 }}>Settings</text>
      </div>
    </div>
  )
}

/** The empty tab: Dia's orb, and what it offers to start. */
function Empty() {
  const t = useTheme()
  const window = useWindow()
  const run = (name: string) => commands.run(name, windowContext(window.id)!)
  const chip = (icon: string, label: string, command: string) => (
    <div
      key={command}
      onClick={() => run(command)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 15, borderWidth: 1, borderColor: t["dia.line"], cursor: "pointer", hover: { backgroundColor: t["dia.rowHover"] } }}
    >
      <Icon name={icon} size={12} color={t["dia.inkMuted"]} />
      <text style={{ fontSize: 12, color: t["dia.ink"] }}>{label}</text>
    </div>
  )
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 28, paddingBottom: 80 }}>
      <div
        style={{
          width: 84,
          height: 84,
          flexShrink: 0,
          borderRadius: 42,
          background: { type: "linear-gradient", angle: 180, stops: [{ color: t["dia.orb"] }, { color: t["dia.orb2"] }] },
          boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 28, spreadRadius: 0, color: `${t["dia.orb"]}59` },
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 560,
          maxWidth: "80%",
          gap: 14,
          paddingTop: 16,
          paddingBottom: 12,
          paddingLeft: 16,
          paddingRight: 14,
          borderRadius: 20,
          backgroundColor: t["dia.ask"],
          boxShadow: [
            { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 1, color: t["dia.line"] },
            { offsetX: 0, offsetY: 4, blurRadius: 16, spreadRadius: 0, color: "#00000014" },
          ],
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name="magnifying_glass" size={15} color={t["dia.inkMuted"]} />
          <text style={{ fontSize: 15, color: t["dia.inkMuted"] }}>What would you like to do?</text>
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          {chip("terminal", "New Terminal", "new_tab")}
          {chip("split", "Split Right", "split_vertical")}
          {chip("blocks", "Commands", "palette")}
        </div>
      </div>
    </div>
  )
}

/** A tab's panes, as the app's split renderer draws them (its edges drag); an empty tab gets the orb. */
export function Layout({ tab }: { tab?: string }) {
  const tree = useLayout(tab)
  const focused = useFocusedPane(tab)
  const zoomed = useApp((s) => (tab ? s.snapshot?.layouts.find((l) => l.tab_id === tab)?.zoomed ?? false : false))
  const C = useComponents()
  if (!tree) return <Empty />
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, marginLeft: 4, marginRight: 4, marginBottom: 4 }}>
      {zoomed && focused ? (
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, padding: 2 }}>
          <C.Pane pane={focused} focused zoomed />
        </div>
      ) : (
        <C.Split tree={tree} tab={tab} focused={focused} />
      )}
    </div>
  )
}

/** One pane: a quiet strip — a dot, its title, its buttons — then a terminal or a view. */
export function Pane({ pane: id, focused }: { pane: string; focused: boolean; zoomed: boolean }) {
  const t = useTheme()
  const pane = usePane(id)
  const view = useRenderer(pane?.block)
  const [hovered, setHovered] = useState(false)
  const { views: strips } = useSlot("pane.strip")
  const { views: toolbar, actions } = useSlot("pane.toolbar")
  const { views: overlays } = useSlot("pane.overlay")
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === pane?.tab_id) ?? NO_PANES)
  const zoomed = useApp((s) => s.snapshot?.layouts.find((l) => l.tab_id === pane?.tab_id)?.zoomed ?? false)
  const title = pane?.terminal_title || pane?.label || pane?.block || ""
  const open = (split: "right" | "down") => call("pane.open", "terminal", {}, { split, beside: id }).catch(swallow)
  const body =
    pane?.block === "terminal" || !pane ? (
      <terminal pane={id} autoFocus={focused} style={{ flexGrow: 1, minWidth: 0, minHeight: 0 }} />
    ) : view ? (
      renderView(view, { pane: id })
    ) : (
      <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text style={{ color: t.faint }}>{`Nothing draws ${pane.block} panes`}</text>
      </div>
    )
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={() => {
        if (!focused) call("pane.focus", id, {}).catch(swallow)
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        borderRadius: 8,
        // A hairline ring outside the box (an outline takes no space, and a spread shadow would
        // wash the pane's transparent body).
        ...(focused ? { outlineWidth: 1, outlineColor: t["dia.line"] } : {}),
      }}
    >
      <div
        title={title}
        // A double press on the strip zooms the pane, as it always did.
        onDoubleClick={() => call("pane.update", id, { zoom: "toggle" }).catch(swallow)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 28, flexShrink: 0, paddingLeft: 8, paddingRight: 4 }}
      >
        <div style={{ display: "flex", width: 14, height: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <PaneIcon pane={pane} />
        </div>
        <text style={{ fontSize: 12, flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", color: focused ? t["dia.ink"] : t["dia.inkMuted"] }}>{title}</text>
        <div style={{ flexGrow: 1 }} />
        {strips.map((strip) => renderView(strip, { pane: id }))}
        {actions.map((action) => (
          <Button key={`${action.plugin}/${action.id}`} icon={action.icon ?? "ellipsis"} title={action.title} onClick={() => action.run({ pane: id })} />
        ))}
        {toolbar.map((contributed) => renderView(contributed, { pane: id }))}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0, opacity: focused || hovered ? 1 : 0 }}>
          <Button icon="split" title="Split Right" size={13} onClick={() => open("right")} />
          <Button icon="split_down" title="Split Down" size={13} onClick={() => open("down")} />
          {panes.length > 1 ? (
            <Button
              icon={zoomed ? "minimize" : "maximize"}
              title={zoomed ? "Unzoom" : "Zoom"}
              size={13}
              onClick={() => call("pane.update", id, { zoom: "toggle" }).catch(swallow)}
            />
          ) : null}
          <Button icon="close" title="Close Pane" size={13} onClick={() => call("pane.close", id).catch(swallow)} />
        </div>
      </div>
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
        {body}
        {overlays.map((overlay) => (
          <div key={`${overlay.plugin}/${overlay.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
            {renderView(overlay, { pane: id })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The whole window: the sidebar, and the card the panes sit on. */
export function Dia() {
  const t = useTheme()
  const [sidebar, setSidebar] = useLocal("dia.sidebar", true)
  const [width, setWidth] = useLocal("dia.sidebar.width", 264)
  const [pinned, setPinned] = useState<string | null>(null)
  const tab = useApp((s) => s.snapshot?.focused_tab_id ?? undefined)
  // This theme's own: the pane in front is what closes, as in a terminal multiplexer.
  useBinding("cmd+w", "close_pane")
  useBinding("cmd+shift+w", "close_tab")
  commands.useCommand("toggle_sidebar", "Toggle sidebar", () => setSidebar((v) => !v))
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        gap: 6,
        paddingTop: 6,
        paddingBottom: 6,
        paddingRight: 6,
        paddingLeft: sidebar ? 0 : 6,
        background: { type: "linear-gradient", angle: 180, stops: [{ color: t["dia.top"] }, { color: t["dia.bottom"] }] },
        color: t["dia.ink"],
      }}
    >
      {sidebar ? <Sidebar width={Number(width)} setWidth={(next) => setWidth(next)} pinned={pinned} setPinned={setPinned} /> : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minWidth: 0,
          borderRadius: 12,
          backgroundColor: t["dia.card"],
          overflow: "hidden",
          boxShadow: [
            { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 1, color: t["dia.line"] },
            { offsetX: 0, offsetY: 2, blurRadius: 10, spreadRadius: 0, color: "#00000024" },
          ],
        }}
      >
        <Toolbar />
        <Layout tab={tab} />
      </div>
    </div>
  )
}

/** Nothing to draw yet: the server is starting, or it could not. */
export function Starting({ title, detail, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: t["dia.card"] }}>
      <text style={{ fontSize: 14, color: t.ink }}>{title}</text>
      <text style={{ fontSize: 12, color: t["dia.inkMuted"] }}>{detail}</text>
      {lines.slice(-4).map((line, index) => (
        <text key={index} style={{ fontSize: 11, color: t.faint }}>
          {line}
        </text>
      ))}
    </div>
  )
}
