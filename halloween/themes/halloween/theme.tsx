// Halloween: a night-purple window lit in pumpkin orange. A working agent's icon is a
// jack-o'-lantern that flickers, a blocked one's a ghost that bobs; done is slime green. The
// plugin's `window.overlay` adds the bats, the cobwebs and the spider while this theme draws.
import { defineTheme, Icon, IconImage, motion, showsStatus, useTabMeta, useTheme, type TabIconProps } from "pumi"
import { GHOST, PUMPKIN } from "../../src/sprites.ts"

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
  "agent.working": "#ff7a1a",
  "agent.blocked": "#c38bff",
  "agent.error": "#ff4d4d",
  "agent.done": "#8be04e",
  "agent.idle": "#7a6a8e",
  "agent.unknown": "#5b4d6c",
}

/** Black cat, blood, slime, candle, potion, witch, ghost light, bone; then their brighter selves. */
const ANSI = [
  "#1b1424", "#ff4d4d", "#8be04e", "#ffb347", "#8f7dff", "#c77dff", "#5ee7d0", "#e7ddf2",
  "#4a3b5c", "#ff7171", "#a8f070", "#ffcf6e", "#ad9fff", "#dba3ff", "#8ef3e2", "#ffffff",
]

function TabIcon({ tab, size = 14, color }: TabIconProps) {
  const t = useTheme()
  const { status, icon } = useTabMeta(tab)
  if (status === "working") {
    return (
      <motion.svg
        src={PUMPKIN}
        animate={{ opacity: [1, 0.7, 1, 0.85, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ width: size, height: size, flexShrink: 0 }}
      />
    )
  }
  if (status === "blocked") {
    return (
      <motion.svg
        src={GHOST}
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        style={{ width: size, height: size, flexShrink: 0 }}
      />
    )
  }
  if (showsStatus(status, icon)) {
    const name = status === "done" ? "status_check" : status === "error" ? "status_x" : status === "idle" ? "status_ring" : "status_unknown"
    return <Icon name={name} size={size} color={t[`agent.${status}`] ?? t.faint} />
  }
  return <IconImage icon={icon} size={size} color={color ?? t.muted} />
}

export default defineTheme({
  name: "Halloween",
  description: "Night purple and pumpkin orange; jack-o'-lanterns, ghosts, bats and cobwebs.",
  appearance: "dark",
  colors: { dark: NIGHT },
  terminal: {
    dark: { background: "#0c0911", foreground: "#f1e9dc", cursor: "#ff7a1a", selection: "#3b2452", ansi: ANSI },
  },
  metrics: { radius: 8, radiusSmall: 5, paneFade: 0.3 },
  components: { TabIcon },
})
