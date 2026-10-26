// The header's tabs, every session's: one group a session, a hairline between groups, no names.
// A tab is the theme's `Tab` (the default's), so a `Tab` a theme restyles shows here too.
import { Fragment } from "react"
import { Icon, call, useTheme } from "pumi"
import {
  commands,
  useApp,
  useComponents,
  useSessions,
  useSession,
  useThemeOption,
  useWindow,
  windowContext,
  type Snapshot,
} from "pumi/theme"

/** A tab row, as the snapshot has it. */
type Row = Snapshot["tabs"][number]

const NO_ROWS: Row[] = []

/** The rows of each session that has any. */
function bySession(rows: Row[], sessions: { workspace_id: string }[]): Row[][] {
  return sessions.map((s) => rows.filter((tab) => tab.workspace_id === s.workspace_id)).filter((tabs) => tabs.length > 0)
}

export function TabBar({ session }: { session?: string }) {
  const C = useComponents()
  const t = useTheme()
  const window = useWindow()
  const here = useSession(session)
  const sessions = useSessions()
  const every = useThemeOption("all_sessions", true)
  const rows = useApp((s) => s.snapshot?.tabs ?? NO_ROWS)
  const mine = rows.filter((tab) => tab.workspace_id === here?.workspace_id)
  const shown = every ? bySession(rows, sessions) : mine.length ? [mine] : []
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 0, minWidth: 0, flexShrink: 1, overflowX: "scroll" }}>
      {shown.map((tabs, group) => (
        <Fragment key={tabs[0].workspace_id}>
          {group > 0 ? (
            <div style={{ width: 1, height: 16, flexShrink: 0, marginLeft: 4, marginRight: 4, backgroundColor: t.border }} />
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "stretch", gap: 0, minWidth: 0, flexShrink: 1, overflow: "hidden" }}>
            {tabs.map((tab, index) => (
              <div
                key={tab.tab_id}
                // A tab of another session first moves the window there: `tab.focus` makes a tab
                // of the session in front current. A press comes before the tab's own click
                // (which is on release), so the session is the right one by then.
                onMouseDown={() => {
                  if (tab.workspace_id === here?.workspace_id) return
                  call("session.focus", tab.workspace_id, {}).catch(() => {})
                }}
              >
                <C.Tab tab={tab.tab_id} index={index} active={tab.tab_id === here?.active_tab_id} />
              </div>
            ))}
          </div>
        </Fragment>
      ))}
      <div
        onClick={() => {
          const context = windowContext(window.id)
          if (context) commands.run("new_tab", context)
        }}
        title="New tab"
        style={{
          display: "flex",
          width: 24,
          height: 24,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
          cursor: "pointer",
          color: t.faint,
          hover: { backgroundColor: t.hover, color: t.text },
        }}
      >
        <Icon name="plus" size={12} />
      </div>
    </div>
  )
}
