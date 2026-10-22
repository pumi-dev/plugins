// Rex: tabs as pills, and the panes on near-black. The theme is its colours — a dark room where the
// text is the only light — and its tab bar: a row of pills, an agent's tab tinted by what it is
// doing, so a row of tabs reads as the state of the work.
import { Icon, call, num, useAgents, useTab, useTabs, useTheme } from "pumi"
import { defineTheme } from "pumi"

/** Near-black, with the ink of an editor and an agent's own colours. */
const TOKENS: Record<string, string> = {
  window: "#0c0c0f",
  surface: "#121216",
  editor: "#08080a",
  text: "#e8e8ee",
  muted: "#9a9aa8",
  faint: "#63636f",
  border: "#22222a",
  hover: "#1b1b21",
  active: "#24242c",
  selected: "#2c2c36",
  accent: "#7aa2f7",
  accentText: "#08080a",
  warning: "#e0af68",
  error: "#f7768e",
  success: "#9ece6a",
  overlay: "#121216f2",
  "agent.working": "#7aa2f7",
  "agent.blocked": "#e0af68",
  "agent.error": "#f7768e",
  "agent.done": "#9ece6a",
  "agent.idle": "#565f89",
  "agent.unknown": "#414868",
  // Rex's own: the pill's rim, its shadow, and the light along the top of the window.
  "rex.rim": "#2c2c36",
  "rex.pill": "#1b1b21",
  "rex.glow": "#7aa2f722",
}

/** A tab as a pill: its name, and — for an agent's tab — the colour it is in now. */
function Pills({ session }: { session?: string }) {
  const t = useTheme()
  const tabs = useTabs(session)
  const here = useTab()
  const agents = useAgents()
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: "100%", flexGrow: 1, minWidth: 0, paddingLeft: 8, paddingRight: 8, overflow: "hidden" }}>
      {tabs.map((tab, index) => {
        const on = tab.tab_id === here?.tab_id
        const status = tab.agent_status || agents.find((agent) => agent.tab_id === tab.tab_id)?.agent_status
        const tint = status ? (t[`agent.${status}`] ?? t["agent.unknown"]) : undefined
        const label = tab.label && !/^\d+$/.test(tab.label) ? tab.label : `Tab ${index + 1}`
        return (
          <div
            key={tab.tab_id}
            onClick={() => call("tab.select", { tab: num(tab.tab_id) }).catch((err: unknown) => console.error(`rex: ${String(err)}`))}
            onAuxClick={(e: any) => {
              if (e?.isRightClick) call("tab.close", num(tab.tab_id), true).catch(() => {})
            }}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              height: 24,
              maxWidth: 190,
              flexShrink: 1,
              minWidth: 64,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: 12,
              cursor: "pointer",
              borderWidth: 1,
              borderColor: tint ?? (on ? t["rex.rim"] : "transparent"),
              backgroundColor: on ? t.selected : t["rex.pill"],
              hover: { backgroundColor: on ? t.selected : t.hover },
            }}
          >
            {tint ? <div style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, backgroundColor: tint }} /> : <Icon name="terminal" size={11} color={on ? t.text : t.muted} />}
            <text style={{ fontSize: 11, color: on ? t.text : t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label}</text>
          </div>
        )
      })}
      <div style={{ flexGrow: 1 }} />
      <div
        aria-label="New tab"
        onClick={() => call("pane.open", "terminal", {}, { kind: "tab" }).catch(() => {})}
        style={{ display: "flex", width: 22, height: 22, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 11, cursor: "pointer", hover: { backgroundColor: t.hover } }}
      >
        <Icon name="plus" size={11} color={t.faint} />
      </div>
    </div>
  )
}

export default defineTheme({
  name: "Rex",
  description: "Tabs as pills in the titlebar, an agent's tab in its own colour, and the panes on near-black.",
  colors: { dark: TOKENS, light: TOKENS },
  // Tight, small, and round: a pill's corners are the only soft thing here.
  metrics: { fontSize: 13, radius: 8, radiusSmall: 6 },
  terminal: {
    dark: {
      background: "#08080a",
      foreground: "#e8e8ee",
      cursor: "#7aa2f7",
      selection: "#2c2c36",
      ansi: [
        "#08080a", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5",
        "#414868", "#ff899d", "#b9f27c", "#ffcf8a", "#9ab8ff", "#d0aaff", "#a4e8ff", "#e8e8ee",
      ],
    },
    light: {
      background: "#ffffff",
      foreground: "#121216",
      cursor: "#3a5fc0",
      selection: "#e2e6f0",
      ansi: [
        "#121216", "#c4344c", "#3f8a1f", "#9a6c10", "#2f5fc0", "#7a4fd0", "#1f8aa8", "#5c5c6b",
        "#6f6f7f", "#d94a63", "#4fa52a", "#b8841a", "#4670d0", "#8f66e0", "#33a3c0", "#121216",
      ],
    },
  },
  tooltip: (tokens, metrics) => ({
    backgroundColor: tokens.surface,
    color: tokens.text,
    borderWidth: 1,
    borderColor: tokens["rex.rim"],
    borderRadius: metrics.radiusSmall,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 11,
  }),
  components: { TabBar: Pills },
})
