// Windows 98: a teal desktop, a window for every tab, a taskbar along the foot and a Start menu of
// your sessions and tabs. One look, light and dark alike, as the system had one.
import { defineTheme } from "pumi"
import { Desktop, Pane, Starting } from "./window.tsx"

const TOKENS: Record<string, string> = {
  window: "#c0c0c0",
  surface: "#c0c0c0",
  editor: "#ffffff",
  text: "#000000",
  muted: "#404040",
  faint: "#808080",
  border: "#808080",
  hover: "#dfdfdf",
  active: "#b5b5b5",
  selected: "#a6caf0",
  accent: "#000080",
  accentText: "#ffffff",
  success: "#008000",
  warning: "#808000",
  error: "#c00000",
  overlay: "#00000033",
  "agent.working": "#b8860b",
  "agent.blocked": "#ff8000",
  "agent.error": "#c00000",
  "agent.done": "#008000",
  "agent.idle": "#808080",
  "agent.unknown": "#808080",
  // The palette's own names: the bevels, the desktop, the caption.
  "w98.desktop": "#008080",
  "w98.face": "#c0c0c0",
  "w98.light": "#dfdfdf",
  "w98.white": "#ffffff",
  "w98.shadow": "#808080",
  "w98.dark": "#0a0a0a",
  "w98.title": "#000080",
  "w98.title2": "#1084d0",
  "w98.inactive": "#808080",
  "w98.inactive2": "#b5b5b5",
  "w98.checker": "#e8e8e8",
  "w98.tip": "#ffffe1",
}

export default defineTheme({
  name: "Windows 98",
  description: "A teal desktop, a window for each tab, and a Start menu of your sessions.",
  colors: { dark: TOKENS, light: TOKENS },
  // Square corners, thin bevels, Tahoma at 11 as the system's was.
  metrics: { radius: 0, radiusSmall: 0, radiusLarge: 0, fontSize: 11 },
  terminal: { dark: { background: "#000000" }, light: { background: "#000000" } },
  // A tooltip is the system's: a pale yellow card with a black edge.
  tooltip: {
    backgroundColor: "#ffffe1",
    color: "#000000",
    borderWidth: 1,
    borderColor: "#000000",
    paddingTop: 2,
    paddingBottom: 2,
    paddingLeft: 4,
    paddingRight: 4,
    fontSize: 11,
  },
  components: { Window: Desktop, Starting, Pane },
})
