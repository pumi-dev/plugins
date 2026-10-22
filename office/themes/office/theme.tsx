// Office: pumi as a little pixel office, after Gather — a desk for every tab of every session, each
// with its screen, and the real panes behind a desk you sit down at.
import { defineTheme } from "pumi"
import { Office, Starting } from "./window.tsx"

/** The room's own colours, and the app's tokens set to the office's blue. One look, dark or light. */
const COLORS: Record<string, string> = {
  window: "#efe3cf",
  surface: "#ffffff",
  editor: "#ffffff",
  text: "#2b2d42",
  muted: "#6b6f80",
  faint: "#8a8fa3",
  border: "#d9cfc0",
  hover: "#f4ecdf",
  active: "#e7dccb",
  selected: "#1d1f2b",
  accent: "#5aa9ff",
  accentText: "#ffffff",
  warning: "#ffd166",
  error: "#ef476f",
  success: "#06d6a0",
  overlay: "#1d1f2bd9",
  "agent.working": "#ffd166",
  "agent.blocked": "#ef476f",
  "agent.error": "#ef476f",
  "agent.done": "#06d6a0",
  "agent.idle": "#9a9db3",
  "agent.unknown": "#8a8fa3",
  // The room's own: the floor, the wall, the ink of its cards and its bar.
  "office.floor": "#efe3cf",
  "office.wall": "#6c74a8",
  "office.ink": "#2b2d42",
  "office.paper": "#ffffff",
  "office.pill": "#1d1f2bd9",
  "office.hud": "#1d1f2b",
  "office.hudText": "#e9eaf2",
  "office.hudMuted": "#9a9db3",
  "office.online": "#4ade80",
  "office.lit": "#5aa9ff",
  "office.working": "#ffd166",
  "office.blocked": "#ef476f",
  "office.done": "#06d6a0",
}

export default defineTheme({
  name: "Office",
  description: "A pixel office: a desk for every tab of every session, each with its screen.",
  colors: { dark: COLORS, light: COLORS },
  // Soft and round, like the room.
  metrics: { radius: 7, radiusSmall: 5, radiusLarge: 10, fontSize: 12 },
  components: { Window: Office, Starting },
  tooltip: (tokens) => ({
    backgroundColor: tokens["office.ink"],
    color: "#ffffff",
    borderRadius: 8,
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 11,
  }),
})
