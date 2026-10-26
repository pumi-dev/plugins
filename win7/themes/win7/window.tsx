// Windows 7 as a UI theme: Aero glass around the session's tabs, the panes in a white frame, and a
// Superbar along the foot — the Start orb, a button a tab, and the clock. The window's own parts
// (the panes, the side bar's sections, the status bar) are the app's; this draws the window around
// them, which is where Windows 7's look is.
import { useState } from "react"
import {
  Icon,
  call,
  commands,
  num,
  renderView,
  useComponents,
  useContributions,
  useFocusedPane,
  useNow,
  usePane,
  useSession,
  useSessions,
  useTabs,
  useTheme,
  useWindow,
  windowContext,
  type WindowSession,
  type WindowTab,
} from "pumi"

const swallow = (err: unknown) => console.error(String(err))

/** The Superbar's height, in pixels. */
const SUPERBAR = 40
/** A titlebar's, and a tab's. */
const TITLEBAR = 30
const TABBAR = 30

/** The glass a titlebar and the Superbar are: Aero's blue, lighter at the top, with a lit edge. */
const GLASS = {
  background: {
    type: "linear-gradient" as const,
    angle: 90,
    stops: [
      { color: "#cfe8faee", position: 0 },
      { color: "#a5cff0ee", position: 0.45 },
      { color: "#8ab8e0ee", position: 0.55 },
      { color: "#d9eefcdd", position: 1 },
    ],
  },
  borderTopColor: "#ffffffcc",
  borderBottomColor: "#4a6d8c55",
}

/** The window buttons of a titlebar: a `−`, a `□`, and a `✕` that is red when the pointer is on it. */
function CaptionButton({ glyph, title, danger, onClick }: { glyph: string; title: string; danger?: boolean; onClick(): void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      aria-label={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e: any) => {
        e?.stopPropagation?.()
        onClick()
      }}
      style={{
        display: "flex",
        width: 26,
        height: 20,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 3,
        backgroundColor: hovered ? (danger ? "#e81123" : "#ffffff55") : undefined,
        cursor: "pointer",
      }}
    >
      <text style={{ fontSize: 11, color: hovered && danger ? "#ffffff" : "#16364f" }}>{glyph}</text>
    </div>
  )
}

/** A tab of the glass titlebar: the session's tabs, the one showing lit. */
function GlassTab({ tab, active, index }: { tab: WindowTab; active: boolean; index: number }) {
  const t = useTheme()
  const each = usePane(useFocusedPane(tab.tab_id))
  const title = tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`
  return (
    <div
      onClick={() => call("tab.focus", tab.tab_id).catch(swallow)}
      onAuxClick={(e: any) => {
        if (e?.isRightClick) call("tab.close", tab.tab_id).catch(swallow)
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 22,
        maxWidth: 200,
        flexShrink: 1,
        minWidth: 80,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 3,
        cursor: "pointer",
        backgroundColor: active ? "#ffffff88" : "#00000010",
        color: active ? "#16364f" : "#2a4a63",
        hover: { backgroundColor: active ? "#ffffffaa" : "#ffffff44" },
      }}
    >
      <Icon name="terminal" size={12} color={active ? "#16364f" : "#2a4a63"} />
      <text style={{ fontSize: 11, color: active ? "#16364f" : "#2a4a63", whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
      {each?.agent_status ? <div style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: t[`agent.${each.agent_status}`] ?? t["agent.unknown"] }} /> : null}
    </div>
  )
}

/** The Start menu: a search box, the sessions, and the window's tabs. */
function StartMenu({ close }: { close(): void }) {
  const [query, setQuery] = useState("")
  const sessions = useSessions()
  const here = useSession()
  const tabs = useTabs()
  const window = useWindow()
  const finds = (text: string) => query === "" || text.toLowerCase().includes(query.toLowerCase())
  const run = (name: string) => {
    const context = windowContext(window.id)
    if (context) commands.run(name, context)
    close()
  }
  const item = (key: string, label: string, icon: string, onClick: () => void) => (
    <div
      key={key}
      onClick={onClick}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 3, cursor: "pointer", hover: { backgroundColor: "#d6ebfa" } }}
    >
      <Icon name={icon} size={13} color="#2a4a63" />
      <text style={{ fontSize: 12, color: "#16364f", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</text>
    </div>
  )
  const shownTabs = tabs.filter((tab, index) => finds(tab.label || `Tab ${index + 1}`))
  return (
    <div
      onMouseDownOutside={close}
      style={{ position: "absolute", left: 0, bottom: SUPERBAR, width: 300, display: "flex", flexDirection: "column", padding: 6, gap: 2, borderRadius: 6, backgroundColor: "#f2f8fcee", borderWidth: 1, borderColor: "#7aa7c7", boxShadow: { offsetX: 0, offsetY: -6, blurRadius: 24, spreadRadius: 0, color: "#00000055" }, zIndex: 95 }}
    >
      <input
        value={query}
        autoFocus
        placeholder="Search programs and files"
        onChange={(e: any) => setQuery(e?.value ?? "")}
        style={{ display: "flex", height: 24, marginBottom: 4, paddingLeft: 8, paddingRight: 8, fontSize: 12, color: "#16364f", borderRadius: 3, borderWidth: 1, borderColor: "#7aa7c7", backgroundColor: "#ffffff" }}
      />
      <text style={{ paddingLeft: 10, paddingTop: 2, paddingBottom: 2, fontSize: 10, fontWeight: 600, color: "#4a6d8c" }}>SESSIONS</text>
      {sessions.filter((session) => finds(session.label)).map((session) => item(session.workspace_id, session.label || session.workspace_id, "terminal", () => {
        window.show(session.workspace_id)
        close()
      }))}
      <text style={{ paddingLeft: 10, paddingTop: 2, paddingBottom: 2, fontSize: 10, fontWeight: 600, color: "#4a6d8c" }}>TABS</text>
      {shownTabs.map((tab, index) =>
        item(tab.tab_id, tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`, "layout_panel_bottom", () => {
          call("tab.focus", tab.tab_id).catch(swallow)
          close()
        }),
      )}
      {shownTabs.length === 0 ? <text style={{ paddingLeft: 10, paddingBottom: 4, fontSize: 11, color: "#4a6d8c" }}>No tabs match</text> : null}
      <div style={{ height: 1, marginTop: 4, marginBottom: 4, backgroundColor: "#c3dced" }} />
      {item("new-tab", "New tab", "plus", () => run("new_tab"))}
      {item("palette", "Command palette", "keyboard", () => run("palette"))}
      {item("quit", "Close pumi", "close", () => run("quit"))}
    </div>
  )
}

/** The Superbar: the Start orb, a glass button a tab, and the clock. */
function Superbar() {
  const window = useWindow()
  const here = useSession()
  const tabs = useTabs()
  const now = useNow(15_000)
  const [start, setStart] = useState(false)
  const clock = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const active = here?.active_tab_id ?? undefined
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: SUPERBAR,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: 4,
        paddingRight: 8,
        ...GLASS,
        borderTopWidth: 1,
        zIndex: 90,
      }}
    >
      <div
        aria-label="Start"
        onClick={() => setStart((v) => !v)}
        style={{
          display: "flex",
          width: 34,
          height: 34,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 17,
          cursor: "pointer",
          borderWidth: 1,
          borderColor: "#ffffffcc",
          background: {
            type: "radial-gradient",
            stops: [
              { color: "#eaf6ff", position: 0 },
              { color: "#8cc4ea", position: 0.55 },
              { color: "#2f6f9e", position: 1 },
            ],
          },
          hover: { borderColor: "#ffffff" },
        }}
      >
        <Icon name="pumi" size={18} color="#ffffff" />
      </div>
      <div style={{ width: 1, height: 26, flexShrink: 0, backgroundColor: "#4a6d8c44", borderRightWidth: 1, borderColor: "#ffffff88" }} />
      {tabs.map((tab, index) => {
        const on = tab.tab_id === active
        return (
          <div
            key={tab.tab_id}
            onClick={() => call("tab.focus", tab.tab_id).catch(swallow)}
            onAuxClick={(e: any) => {
              if (e?.isRightClick) call("tab.close", tab.tab_id).catch(swallow)
            }}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              height: 30,
              width: 160,
              flexShrink: 1,
              minWidth: 60,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 3,
              cursor: "pointer",
              borderWidth: 1,
              borderColor: on ? "#ffffffcc" : "#ffffff55",
              backgroundColor: on ? "#ffffff66" : "#ffffff22",
              hover: { backgroundColor: on ? "#ffffff88" : "#ffffff44" },
            }}
          >
            <Icon name="terminal" size={13} color="#16364f" />
            <text style={{ fontSize: 11, color: "#16364f", whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>
              {tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`}
            </text>
          </div>
        )
      })}
      <div style={{ flexGrow: 1 }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", paddingLeft: 10, paddingRight: 10 }}>
        <text style={{ fontSize: 11, color: "#16364f" }}>{clock}</text>
      </div>
      {start ? <StartMenu close={() => setStart(false)} /> : null}
    </div>
  )
}

/** The window: a glass titlebar over the session's tabs, the panes on white, and the Superbar. */
export function Desktop() {
  const t = useTheme()
  const C = useComponents()
  const window = useWindow()
  const session = useSession()
  const tabs = useTabs()
  const active = session?.active_tab_id ?? undefined
  const { views: overlays } = useContributions("window.overlay")
  const { actions: titleActions } = useContributions("window.titlebar")
  // The window's own chords, as Windows 7's keys are.
  const [, setSidebar] = useState(true)
  commands.useCommand("toggle_sidebar", "Show or hide the navigation pane", () => setSidebar((v) => !v))
  const title = session?.label || "pumi"
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", fontFamily: "Segoe UI", fontSize: 12, color: "#16364f", background: { type: "linear-gradient", angle: 135, stops: [{ color: "#2f6f9e", position: 0 }, { color: "#7fb3d5", position: 0.5 }, { color: "#0b3a5c", position: 1 }] } }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, margin: 10, marginBottom: SUPERBAR + 10, borderRadius: 6, overflow: "hidden", borderWidth: 1, borderColor: "#ffffff66", boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 0, color: "#00000066" } }}>
        {/* The glass: the window's title, its buttons, and the tabs. */}
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, ...GLASS, borderBottomWidth: 1 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: TITLEBAR, flexShrink: 0, paddingLeft: 10, paddingRight: 4 }}>
            <Icon name="pumi" size={14} color="#16364f" />
            <text style={{ fontSize: 12, color: "#16364f", flexGrow: 1, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{title}</text>
            {titleActions.map((action) => (
              <div key={`${action.pkg}/${action.id}`} onClick={() => action.run()} style={{ display: "flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 3, cursor: "pointer", hover: { backgroundColor: "#ffffff66" } }}>
                <Icon name={action.icon ?? "ellipsis"} size={12} color="#16364f" />
              </div>
            ))}
            <CaptionButton glyph="_" title="Minimize" onClick={() => window.minimize()} />
            <CaptionButton glyph="□" title="Maximize" onClick={() => window.zoom()} />
            <CaptionButton glyph="✕" title="Close" danger onClick={() => window.close()} />
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 3, height: TABBAR, flexShrink: 0, paddingLeft: 8, paddingRight: 8, overflow: "hidden" }}>
            {tabs.map((tab, index) => (
              <GlassTab key={tab.tab_id} tab={tab} index={index} active={tab.tab_id === active} />
            ))}
            <div
              aria-label="New tab"
              onClick={() => commands.run("new_tab", windowContext(window.id)!)}
              style={{ display: "flex", width: 22, height: 22, flexShrink: 0, alignItems: "center", justifyContent: "center", marginBottom: 4, borderRadius: 3, cursor: "pointer", hover: { backgroundColor: "#ffffff66" } }}
            >
              <Icon name="plus" size={12} color="#16364f" />
            </div>
          </div>
        </div>
        {/* The page: the tab's panes, each with a thin frame. */}
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: "#ffffff" }}>
          <C.Layout />
        </div>
      </div>
      <Superbar />
      {overlays.map((v) => (
        <div key={`${v.pkg}/${v.id}`} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}>
          {renderView(v)}
        </div>
      ))}
    </div>
  )
}

/** Nothing to draw yet: the server is starting, on Aero's blue. */
export function Starting({ title, detail, gaveUp, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 10, background: { type: "linear-gradient", angle: 135, stops: [{ color: "#2f6f9e", position: 0 }, { color: "#7fb3d5", position: 0.5 }, { color: "#0b3a5c", position: 1 }] } }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 420, maxWidth: "80%", padding: 14, borderRadius: 6, backgroundColor: "#f2f8fcee", borderWidth: 1, borderColor: "#ffffff" }}>
        <text style={{ fontSize: 14, fontWeight: 600, color: gaveUp ? "#c00000" : "#16364f" }}>{title || "Starting pumi…"}</text>
        {detail ? <text style={{ fontSize: 12, color: "#2a4a63" }}>{detail}</text> : null}
        {lines.length ? (
          <div style={{ display: "flex", flexDirection: "column", alignSelf: "stretch", marginTop: 4, padding: 8, borderRadius: 3, backgroundColor: "#16364f", overflow: "hidden" }}>
            {lines.slice(-8).map((line, i) => (
              <text key={i} style={{ fontSize: 10, color: "#d6ebfa", fontFamily: "Consolas" }}>{line}</text>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The sessions a window shows, for the Start menu's list (`useSessions` keeps it alive). */
export type { WindowSession }
