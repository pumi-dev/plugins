// Halloween: a night-purple window lit in pumpkin orange. A working agent's icon is a
// jack-o'-lantern that flickers, a blocked one's a ghost that bobs, a failed one's a skull and a
// done one's a sweet. Menus are cards of the night with a cobweb in the corner, questions are
// gravestones (parts.tsx), and the plugin's `window.overlay` (src/ui.tsx) adds the bats, the
// cobwebs, the spider, the fog and the scares while this theme draws.
import { defineTheme, Icon, IconImage, motion, showsStatus, useTabIcon, useTabStatus, useTheme, type TabIconProps } from "pumi"
import { CANDY, GHOST, PUMPKIN, SKULL } from "../../src/sprites.ts"
import { PARTS } from "./parts.tsx"

const NIGHT = {
  window: "#0e0a14",
  surface: "#140e1c",
  editor: "#0c0911",
  text: "#f1e9dc",
  muted: "#bba9cc",
  faint: "#7a6a8e",
  border: "#2c2038",
  hover: "#231a30",
  active: "#2e2240",
  selected: "#3b2452",
  accent: "#ff7a1a",
  accentText: "#1c0c00",
  success: "#8be04e",
  warning: "#ffb347",
  error: "#ff4d4d",
  overlay: "#05020a99",
  "status.working": "#ff7a1a",
  "status.blocked": "#c38bff",
  "status.error": "#ff4d4d",
  "status.done": "#8be04e",
  "status.idle": "#7a6a8e",
  "status.unknown": "#5b4d6c",
  // The night's own: a pumpkin's glow, cobweb thread, the moonlight, and the gravestones.
  glow: "#ff7a1a26",
  glowEdge: "#ff7a1a80",
  web: "#c9b8e855",
  webFaint: "#c9b8e830",
  dusk: "#22143a",
  scrim: "#05020ad9",
  moonlight: "#3a2c5c99",
  moonGlow: "#b9a6ff40",
  stone: "#231d2c",
  stoneLight: "#3a3246",
  stoneDeep: "#1a1522",
  stoneRim: "#4c4160",
  engraved: "#8a7da0",
}

/** Black cat, blood, slime, candle, potion, witch, ghost light, bone; then their brighter selves. */
const ANSI = [
  "#1b1424", "#ff4d4d", "#8be04e", "#ffb347", "#8f7dff", "#c77dff", "#5ee7d0", "#e7ddf2",
  "#4a3b5c", "#ff7171", "#a8f070", "#ffcf6e", "#ad9fff", "#dba3ff", "#8ef3e2", "#ffffff",
]

/** What each status is drawn as, and how it moves. */
const LOOKS = {
  working: { src: PUMPKIN, animate: { opacity: [1, 0.7, 1, 0.85, 1] }, transition: { duration: 1.6, repeat: Infinity, ease: "easeInOut" as const } },
  blocked: { src: GHOST, animate: { y: [0, -2, 0] }, transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" as const } },
  error: { src: SKULL, animate: { x: [0, -1.5, 1.5, -1, 0, 0] }, transition: { duration: 2.4, repeat: Infinity, times: [0, 0.06, 0.12, 0.18, 0.24, 1], ease: "easeInOut" as const } },
  done: { src: CANDY, animate: { y: [0, -2, 0, -1, 0] }, transition: { duration: 0.8, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" as const } },
}

function TabIcon({ tab, size = 14, color }: TabIconProps) {
  const t = useTheme()
  const status = useTabStatus(tab)
  const icon = useTabIcon(tab)
  const look = status && status in LOOKS ? LOOKS[status as keyof typeof LOOKS] : undefined
  if (look && showsStatus(status, icon)) {
    return <motion.img src={look.src} animate={look.animate} transition={look.transition} style={{ width: size, height: size, flexShrink: 0 }} />
  }
  if (showsStatus(status, icon)) {
    const name = status === "idle" ? "status_ring" : "status_unknown"
    return <Icon name={name} size={size} color={t[`status.${status}`] ?? t.faint} />
  }
  return <IconImage icon={icon} size={size} color={color ?? t.muted} />
}

export default defineTheme({
  name: "Halloween",
  description: "Night purple and pumpkin orange: jack-o'-lanterns and ghosts for agents, gravestone questions, bats, cobwebs and fog.",
  appearance: "dark",
  colors: { dark: NIGHT },
  terminal: {
    dark: { background: "#0c0911", foreground: "#f1e9dc", cursor: "#ff7a1a", selection: "#3b2452", ansi: ANSI },
  },
  // The title face, brought along so it draws whether or not it is installed.
  fonts: [`${import.meta.dir}/fonts/Creepster-Regular.ttf`],
  metrics: { radius: 8, radiusSmall: 5, paneFade: 0.3 },
  layout: (t) => ({
    // A zoomed pane is lifted on a pumpkin glow.
    lifted: {
      borderWidth: 1,
      borderColor: t.glowEdge,
      backgroundColor: t.editor,
      boxShadow: [
        { offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 0, color: "#000000a0" },
        { offsetX: 0, offsetY: 0, blurRadius: 28, spreadRadius: 0, color: t.glow },
      ],
    },
  }),
  tooltip: (t) => ({
    backgroundColor: t.surface,
    color: t.text,
    borderWidth: 1,
    borderColor: t.glowEdge,
    borderRadius: 6,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 9,
    paddingRight: 9,
    fontSize: 12,
    boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 12, spreadRadius: 0, color: t.glow },
  }),
  components: { ...PARTS, TabIcon },
})
