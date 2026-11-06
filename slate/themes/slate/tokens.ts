// slate's two looks: a cool grey desk with white cards on it.
// These are the numbers drawn in notes/os-theme (sheets C and D); change one, change both places.
//
// The first block is the tokens every theme has (`Tokens` in the SDK); the `slate.*` ones are the
// theme's own, read by the window and the dock with `useTheme()`.
export const LIGHT: Record<string, string> = {
  // The parts the app draws for us (menus, dialogs, the terminal's furniture) read these.
  window: "#d9dee4",
  surface: "#f0f2f5",
  editor: "#ffffff",
  text: "#17191d",
  muted: "#5d646c",
  faint: "#8f969e",
  border: "#dcdfe5",
  hover: "#eef1f5",
  active: "#e4e8ed",
  selected: "#dfe4ea",
  accent: "#0a7cff",
  accentText: "#ffffff",
  warning: "#b27200",
  error: "#c4574b",
  success: "#2f9e5f",
  overlay: "#fffffff2",
  "status.working": "#0a7cff",
  "status.blocked": "#c98a2b",
  "status.error": "#c4574b",
  "status.done": "#2f9e5f",
  "status.idle": "#8f969e",
  "status.unknown": "#b3b9c0",
  // The desk, the dock and the tab that is in front: what the prototype settled on.
  "slate.deskA": "#9fa8b4",
  "slate.deskB": "#dde1e7",
  "slate.dock": "#ffffff",
  "slate.dockEdge": "#ffffff",
  "slate.tab": "#ffffff",
  "slate.shadow": "#1b2430",
}

export const DARK: Record<string, string> = {
  window: "#24272d",
  surface: "#1e2126",
  editor: "#25282e",
  text: "#eaecf0",
  muted: "#9ba2aa",
  faint: "#6d747d",
  border: "#3a3e46",
  hover: "#2e3239",
  active: "#373b43",
  selected: "#3a3f47",
  accent: "#4b9bff",
  accentText: "#ffffff",
  warning: "#e0a458",
  error: "#e0736b",
  success: "#4ec185",
  overlay: "#24272df2",
  "status.working": "#4b9bff",
  "status.blocked": "#e0a458",
  "status.error": "#e0736b",
  "status.done": "#4ec185",
  "status.idle": "#6d747d",
  "status.unknown": "#575e67",
  "slate.deskA": "#0e1013",
  "slate.deskB": "#24272d",
  "slate.dock": "#33373f",
  "slate.dockEdge": "#ffffff",
  "slate.tab": "#33373e",
  "slate.shadow": "#000000",
}

export const METRICS = {
  fontSize: 12.5,
  radius: 16,
  radiusSmall: 8,
  // A terminal out of focus fades a little, as the app's own does.
  paneFade: 0.25,
  backgroundOpacity: 1,
  // The theme's own numbers, read by the window and the panes.
  stripHeight: 40,
  dockHeight: 54,
  deskGap: 12,
}
