// The `Window` part: the desk, the panes tiled on it, and the dock along its foot.
//
// There is no side bar. The desk is a gradient of its own (a theme paints its own wallpaper; the
// window itself is opaque underneath), the panes are cards with a gap between them (`layout` in
// theme.tsx), and the dock — every open tab, grouped by session — is the only switcher.
import { useMetrics, useTheme } from "pumi"
import { useComponents } from "pumi/theme"
import { Dock } from "./dock.tsx"

export function Window() {
  const t = useTheme()
  const m = useMetrics()
  const C = useComponents()
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        position: "relative",
        color: t.text,
        fontSize: m.fontSize,
        // The desk: light from the left of the window, as the prototype's sheet had it.
        background: { type: "linear-gradient", angle: 90, stops: [{ color: t["slate.deskA"] }, { color: t["slate.deskB"] }] },
      }}
    >
      {/* The panes fill the desk above the dock; the layout's own `gap` and `around` are the air
          between and about the cards. */}
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        <C.Layout />
      </div>
      <Dock />
      {/* The desk's top edge drags the window, over the panes too, without taking their presses. */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 10, appRegion: "drag" }} />
    </div>
  )
}
