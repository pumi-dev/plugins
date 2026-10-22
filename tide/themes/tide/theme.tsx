// Tide: a deep-sea glass window, lavender moonlight, and panes that float on the water. The colours
// are the theme: the app's own parts draw in them, over whatever the window's background shows
// through (`window.background: "blurred"` is the system's vibrancy).
import { defineTheme } from "pumi"

/** The water at depth, and the moonlight on it. */
const TOKENS: Record<string, string> = {
  window: "#0b1522cc",
  surface: "#101d2eee",
  editor: "#0a1220ee",
  text: "#e6e9f5",
  muted: "#a9b3d0",
  faint: "#6f7c9c",
  border: "#24344d",
  hover: "#1a2b42cc",
  active: "#22374fcc",
  selected: "#2a4260dd",
  accent: "#b7a6f5",
  accentText: "#0b1522",
  warning: "#e8c07a",
  error: "#e8849a",
  success: "#7fd8c0",
  overlay: "#101d2ef2",
  "agent.working": "#9db8ff",
  "agent.blocked": "#e8c07a",
  "agent.error": "#e8849a",
  "agent.done": "#7fd8c0",
  "agent.idle": "#8c93b5",
  "agent.unknown": "#5c6685",
  // The sea's own: moonlight, the shallows, and the foam on the panes.
  "tide.moon": "#d8d0ff",
  "tide.shallow": "#2f5c78",
  "tide.foam": "#cfe3f2",
  "tide.glow": "#b7a6f5",
}

/** The same water in daylight: the night's colours lifted, not a second palette. */
const LIGHT: Record<string, string> = {
  window: "#eaf1f7cc",
  surface: "#f4f8fcee",
  editor: "#ffffff",
  text: "#16283a",
  muted: "#4a5c74",
  faint: "#7f8fa6",
  border: "#c6d6e4",
  hover: "#e0ebf4",
  active: "#d3e3ef",
  selected: "#c3dbec",
  accent: "#6d5cd0",
  accentText: "#ffffff",
  warning: "#a47618",
  error: "#b84461",
  success: "#1f8a74",
  overlay: "#f4f8fcf2",
  "agent.working": "#3a5fc0",
  "agent.blocked": "#a47618",
  "agent.error": "#b84461",
  "agent.done": "#1f8a74",
  "agent.idle": "#6b7690",
  "agent.unknown": "#a3aec4",
  "tide.moon": "#6d5cd0",
  "tide.shallow": "#7fb0c9",
  "tide.foam": "#ffffff",
  "tide.glow": "#6d5cd0",
}

export default defineTheme({
  name: "Tide",
  description: "A deep-sea glass window, lavender moonlight, and panes that float on the water.",
  colors: { dark: TOKENS, light: LIGHT },
  // Rounded, roomy, and a little larger than the default: the sea is soft.
  metrics: { fontSize: 13, radius: 8, radiusSmall: 6 },
  terminal: {
    dark: {
      background: "#0a1220",
      foreground: "#e6e9f5",
      cursor: "#b7a6f5",
      selection: "#2a4260",
      ansi: [
        "#0a1220", "#e8849a", "#7fd8c0", "#e8c07a", "#9db8ff", "#b7a6f5", "#7fc8e0", "#e6e9f5",
        "#4a5c74", "#f2a2b4", "#9fe8d2", "#f2d39a", "#bcd0ff", "#cfc2f8", "#a5dcee", "#ffffff",
      ],
      // A little of the water shows through the terminal too.
      opacity: 0.94,
    },
    light: {
      background: "#ffffff",
      foreground: "#16283a",
      cursor: "#6d5cd0",
      selection: "#dce6f5",
      ansi: [
        "#16283a", "#b84461", "#1f8a74", "#a47618", "#3a5fc0", "#6d5cd0", "#2f8fa8", "#c6d6e4",
        "#4a5c74", "#d2647e", "#2aa48c", "#c08f2b", "#5478d8", "#8574e0", "#3fa6bf", "#ffffff",
      ],
    },
  },
  // The window is glass: what it paints nothing over is the system's vibrancy.
  window: { background: "blurred" },
  tooltip: (tokens, metrics) => ({
    backgroundColor: tokens.surface,
    color: tokens.text,
    borderWidth: 1,
    borderColor: tokens["tide.shallow"],
    borderRadius: metrics.radiusSmall,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 11,
  }),
})
