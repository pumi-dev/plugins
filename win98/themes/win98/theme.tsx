// Windows 98: a teal desktop, a window for each view (moved by its caption, sized by its corner,
// maximized and minimized to the taskbar), the taskbar along the foot and a Start menu of your
// sessions and their views. Every menu is the system's grey card, every question a message box.
// One look, light and dark alike, as the system had one.
import { defineTheme } from "pumi"
import { Desktop } from "./desktop.tsx"
import { Menu } from "./menu.tsx"
import { Action, Dialog, IconButton, Pane, PaneTab, PaneTitle, Splitter, Starting } from "./panes.tsx"

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
  selected: "#000080",
  accent: "#000080",
  accentText: "#ffffff",
  success: "#008000",
  warning: "#808000",
  error: "#c00000",
  overlay: "#00000033",
  "agent.working": "#ffff00",
  "agent.blocked": "#ff8000",
  "agent.error": "#ff0000",
  "agent.done": "#00ff00",
  "agent.idle": "#c0c0c0",
  "agent.unknown": "#808080",
  // The system's own names: the bevels, the desktop, the captions.
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
  description: "A teal desktop, a window for each tab, a taskbar and a Start menu of your sessions.",
  colors: { dark: TOKENS, light: TOKENS },
  // Square corners and Tahoma at 11, as the system's.
  metrics: { radius: 0, radiusSmall: 0, fontSize: 11 },
  terminal: {
    dark: { background: "#000000", foreground: "#c0c0c0", cursor: "#c0c0c0", selection: "#000080" },
    light: { background: "#000000", foreground: "#c0c0c0", cursor: "#c0c0c0", selection: "#000080" },
  },
  // The desktop is the whole window, the system's buttons over its top left; the desktop and
  // the taskbar move it.
  window: { background: "opaque" },
  // Panes sit a bar apart (the `Splitter`, raised), each a child window with its own frame; a
  // maximized one fills its window with no shadow, as the system's did.
  layout: { gap: 4, divider: 0, zoomInset: 0, lifted: { backgroundColor: "#c0c0c0" } },
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
    fontFamily: "Tahoma",
  },
  components: { Window: Desktop, Starting, Pane, PaneTitle, PaneTab, Splitter, Menu, Dialog, IconButton, Action },
})
