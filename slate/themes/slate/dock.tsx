// The dock along the foot: every tab that is open, in every session, grouped by its session with a
// thin rule between the groups, and a plus that starts one. It is the only switcher the theme has
// (there is no side bar), so it is also the map of what is running: the front tab is marked, and a
// tab with something to say (working, blocked, an error, done) carries its status as a dot.
//
// It reads the window's own state (`useApp`), as a theme does — the plugin-side hooks (`useTabs`,
// `useSessions` in `pumi`) ask the worker, and a theme draws in the app.
import { Icon, TabIcon, useHover, useMetrics, useTabStatus, useTheme } from "pumi"
import { call, run, useApp, useDock, useWindow, via, type Snapshot } from "pumi/theme"
import { tabLabel } from "./panes.tsx"

const swallow = (err: unknown) => console.error(String(err))

const CELL = 38
const ICON = 18

// The window's snapshot before it answers, and when a list is empty: the hooks below hand these
// back by reference, so one shared empty array — a fresh `[]` each call reads as a change, and
// `useSyncExternalStore` would draw again and again (`useApp` is one).
const NO_SESSIONS: Snapshot["workspaces"] = []
const NO_TABS: Snapshot["tabs"] = []

/** The window's own fields, as the app has them: the SDK published on npm is older than the app
 *  it runs in, and has neither `view` nor `showView` on it. */
type Window = { id: number; view?: string; showView(view: string): void }

type TabRow = Snapshot["tabs"][number]

/** The bar itself: gone while its dock is hidden (⌘J, or the View menu), and while nothing is open. */
export function Dock() {
  const t = useTheme()
  const m = useMetrics()
  const dock = useDock("dock")
  const sessions = useApp((state) => state.snapshot?.workspaces ?? NO_SESSIONS)
  const tabs = useApp((state) => state.snapshot?.tabs ?? NO_TABS)
  if (!dock.open || !tabs.length) return null
  // A session with nothing open would leave a rule with nothing beside it.
  const groups = sessions
    .map((session) => ({ session, tabs: tabs.filter((tab) => tab.workspace_id === session.workspace_id) }))
    .filter((group) => group.tabs.length > 0)
  if (!groups.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", alignItems: "center", flexShrink: 0, height: m.dockHeight + m.deskGap / 2 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: m.dockHeight,
          paddingLeft: 14,
          paddingRight: 14,
          borderRadius: 18,
          backgroundColor: t["slate.dock"],
          borderWidth: 1,
          borderColor: `${t["slate.dockEdge"]}d9`,
          boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 22, spreadRadius: -6, color: `${t["slate.shadow"]}33` },
        }}
      >
        {groups.map((group, i) => (
          <div key={group.session.workspace_id} style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
            {i === 0 ? null : <Rule />}
            {group.tabs.map((tab) => (
              <Item key={tab.tab_id} tab={tab} />
            ))}
          </div>
        ))}
        <Rule />
        <NewTab />
      </div>
    </div>
  )
}

function Rule() {
  const t = useTheme()
  return <div style={{ width: 1, height: 24, flexShrink: 0, marginLeft: 8, marginRight: 8, backgroundColor: `${t.text}1f` }} />
}

/** One tab: its block's icon, the front one behind a plate and over a bar, and its status. */
function Item({ tab }: { tab: TabRow }) {
  const t = useTheme()
  const window = useWindow() as unknown as Window
  const [hovered, hover] = useHover()
  const status = useTabStatus(tab.tab_id)
  const focusedTab = useApp((state) => state.snapshot?.focused_tab_id)
  const front = focusedTab === tab.tab_id
  const dot = status === "working" || status === "blocked" || status === "error" || status === "done" ? t[`status.${status}`] : undefined
  return (
    <div
      title={tabLabel(tab)}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      onClick={() => {
        if (tab.view_id && window.view !== tab.view_id) window.showView(tab.view_id)
        call(via(tab.tab_id, "tab.focus"), tab.tab_id).catch(swallow)
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        width: CELL,
        height: CELL,
        flexShrink: 0,
        borderRadius: 10,
        backgroundColor: front ? `${t.text}12` : "#00000000",
        hover: { backgroundColor: `${t.text}${front ? "1a" : "0f"}` },
      }}
    >
      <TabIcon tab={tab.tab_id} size={ICON} />
      {/* The front tab: a bar under it, as the system's puts under a running app. */}
      {front ? <div style={{ position: "absolute", bottom: 4, width: 12, height: 3, borderRadius: 2, backgroundColor: `${t.text}80` }} /> : null}
      {dot ? <div style={{ position: "absolute", top: 5, right: 5, width: 5, height: 5, borderRadius: 3, backgroundColor: dot }} /> : null}
      {hovered ? null : null}
    </div>
  )
}

/** The plus: the app's own new tab, so it opens what a tab opens anywhere else. */
function NewTab() {
  const t = useTheme()
  const window = useWindow()
  const [hovered, hover] = useHover()
  return (
    <div
      title="New Tab"
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      onClick={() => run("new_tab", window.id)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: CELL,
        height: CELL,
        flexShrink: 0,
        borderRadius: 10,
        opacity: hovered ? 1 : 0.62,
        hover: { backgroundColor: `${t.text}0f` },
      }}
    >
      <Icon name="plus" size={16} color={t.muted} />
    </div>
  )
}
