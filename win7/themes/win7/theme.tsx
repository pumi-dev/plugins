// Windows 7: Aero's blue glass around the session, the panes on white, and a Superbar along the
// foot — the Start orb with a search box, a button a tab, and the clock. `window.tsx` draws the
// window; this is its palette: Aero's tokens, the solid colours the parts need, and the metrics a
// 2010 desktop has (square-ish, Segoe UI at 12).
import { defineTheme } from "pumi"

import { Desktop, Starting } from "./window.tsx"

/** Aero's light and dark, and the glass's own names for what the parts draw. */
const TOKENS: Record<string, string> = {
  window: "#dfeefa",
  surface: "#f2f8fc",
  editor: "#ffffff",
  text: "#16364f",
  muted: "#2a4a63",
  faint: "#6f8fa8",
  border: "#a8c8e0",
  hover: "#dcecf9",
  active: "#c3dced",
  selected: "#b8dcf5",
  accent: "#1f6fb2",
  accentText: "#ffffff",
  warning: "#b8860b",
  error: "#c00000",
  success: "#1f8a3b",
  overlay: "#f2f8fcee",
  "agent.working": "#1f6fb2",
  "agent.blocked": "#c77800",
  "agent.error": "#c00000",
  "agent.done": "#1f8a3b",
  "agent.idle": "#6f8fa8",
  "agent.unknown": "#a8c8e0",
  // The glass's own: the titlebar's two blues, the lit edge, and the Superbar's tint.
  "aero.light": "#d9eefc",
  "aero.mid": "#8ab8e0",
  "aero.deep": "#2f6f9e",
  "aero.edge": "#ffffffcc",
  "aero.superbar": "#bfdcf2",
  "aero.orb": "#8cc4ea",
}

export default defineTheme({
  name: "Windows 7",
  description: "Aero glass: the session's tabs in a glass titlebar, the panes on white, and a Superbar with a Start orb and a search box.",
  colors: { light: TOKENS, dark: TOKENS },
  // Square-ish corners and Segoe UI's 12, as Aero drew them.
  metrics: { fontSize: 12, radius: 4, radiusSmall: 3 },
  terminal: {
    light: { background: "#ffffff", foreground: "#16364f" },
    dark: { background: "#0b1a26", foreground: "#dfeefa" },
  },
  // A tooltip is Aero's: a pale blue card with a thin edge.
  tooltip: {
    backgroundColor: "#f2f8fc",
    color: "#16364f",
    borderWidth: 1,
    borderColor: "#7aa7c7",
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 6,
    paddingRight: 6,
    fontSize: 11,
  },
  // The window itself is the theme's; the panes, the side bar's sections and the status bar are the
  // app's, drawn in these colours.
  components: { Window: Desktop, Starting },
})
