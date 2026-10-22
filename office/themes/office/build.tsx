// Decorate mode and what it puts on the floor: the furniture as it stands (lit when you are by it,
// playing when you use it, draggable and removable while you decorate), the build panel along the
// foot (furniture to place, the floor, the wall paint, the lights), the ghost of the piece you are
// placing, and the room's lighting — lamps that glow when the evening comes.
import { useState, type ReactNode } from "react"
import { Icon, motion, useTheme } from "pumi"
import { KIND, KINDS, placeOf, type Kind, type Piece } from "./furniture.ts"
import { HUD, WALL, type Plan, type Pt, type Rect } from "./plan.ts"

const art = (name: string) => `${import.meta.dir}/images/${name}.svg`
export const pieceArt = (kind: string) => art(`furniture/${kind}`)

// ── The room's looks ────────────────────────────────────────────────────────────────────────

/** The floors: the office's own, and the gather package's. */
export const FLOORS: { id: string; label: string; src: string; size: number | [number, number] }[] = [
  { id: "classic", label: "Parquet", src: art("floor"), size: 32 },
  { id: "wood", label: "Planks", src: art("floors/wood"), size: [384, 192] },
  { id: "tile", label: "Tiles", src: art("floors/tile"), size: 128 },
  { id: "carpet", label: "Carpet", src: art("floors/carpet"), size: 128 },
  { id: "rug", label: "Patterned", src: art("floors/rug"), size: 128 },
]

/** The wall's paints. */
export const WALLS: { id: string; label: string; src: string; swatch: string }[] = [
  { id: "classic", label: "Periwinkle", src: art("wall"), swatch: "#6c74a8" },
  { id: "sage", label: "Sage", src: art("walls/sage"), swatch: "#7aa384" },
  { id: "brick", label: "Brick", src: art("walls/brick"), swatch: "#b85c48" },
  { id: "peach", label: "Peach", src: art("walls/peach"), swatch: "#eaa985" },
  { id: "night", label: "Midnight", src: art("walls/night"), swatch: "#3f4360" },
]

export type Light = "auto" | "day" | "evening" | "night"
export const LIGHTS: { id: Light; label: string; icon: string }[] = [
  { id: "auto", label: "By the clock", icon: "rotate_cw" },
  { id: "day", label: "Day", icon: "sparkle" },
  { id: "evening", label: "Evening", icon: "zap" },
  { id: "night", label: "Night", icon: "status_dot" },
]

/** The light it is now: the clock's, unless you chose one. */
export function lightNow(light: Light, now: number): Exclude<Light, "auto"> {
  if (light !== "auto") return light
  const hour = new Date(now).getHours()
  return hour >= 20 || hour < 6 ? "night" : hour >= 17 ? "evening" : "day"
}

// ── Furniture on the floor ──────────────────────────────────────────────────────────────────

/** What a piece is doing because you used it, and since when. */
export type Fx = { at: number; n: number }

/** A ping-pong rally across the table. */
function Rally({ w }: { w: number }) {
  return (
    <motion.div
      animate={{ left: [10, w - 18, 10], top: [8, 2, 8] }}
      transition={{ duration: 0.7, repeat: Infinity, ease: "easeInOut" }}
      style={{ position: "absolute", left: 10, top: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#2b2433" }}
    />
  )
}

/** Bubbles rising out of the aquarium. */
function Bubbles({ w }: { w: number }) {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          animate={{ top: [40, -14], opacity: [0, 1, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.3, ease: "easeOut" }}
          style={{ position: "absolute", left: 12 + ((i * 17) % (w - 20)), top: 40, width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: "#cfefff" }}
        />
      ))}
    </>
  )
}

/** A number floating up off the arcade: the points that round scored. */
function Points({ n }: { n: number }) {
  return (
    <motion.div
      key={n}
      initial={{ top: 0, opacity: 1 }}
      animate={{ top: -36, opacity: [1, 1, 0] }}
      transition={{ duration: 1.4, ease: "easeOut" }}
      style={{ position: "absolute", left: -20, top: 0, width: 76, display: "flex", flexDirection: "row", justifyContent: "center" }}
    >
      <text style={{ fontSize: 12, fontWeight: "bold", color: "#ffd166" }}>{`+${n}`}</text>
    </motion.div>
  )
}

export function PieceView({
  piece,
  room,
  lit,
  fx,
  decorating,
  dragging,
  onPress,
  onRemove,
  onUse,
}: {
  piece: Piece
  room: Plan
  lit: boolean
  fx?: Fx
  decorating: boolean
  dragging: boolean
  onPress(piece: Piece, at: Pt, phase: "down" | "move" | "up"): void
  onRemove(piece: Piece): void
  onUse(piece: Piece): void
}) {
  const t = useTheme()
  const kind = KIND[piece.kind]
  const [over, setOver] = useState(false)
  const [press, setPress] = useState<{ x: number; y: number; moved: boolean } | null>(null)
  if (!kind) return null
  const at = placeOf(piece, room)
  const active = !!fx
  const wiggle = active && (kind.use === "plant" || kind.use === "sit" || kind.use === "water" || kind.use === "snack" || kind.use === "doodle")
  return (
    <motion.div
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      animate={wiggle ? { y: [0, -3, 0, -1, 0] } : { y: lit && !decorating ? -2 : 0 }}
      transition={wiggle ? { duration: 0.5, ease: "easeOut" } : { duration: 0.12 }}
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        width: at.w,
        height: at.h,
        // A rug lies under everything; the rest stand in depth order with you.
        zIndex: dragging ? 20000 : kind.foot ? at.y + at.h : 3,
        opacity: dragging ? 0.8 : 1,
      }}
    >
      <img src={pieceArt(piece.kind)} style={{ width: at.w, height: at.h, imageRendering: "pixelated" }} />
      {/* What it does while you use it. */}
      {piece.kind === "pingpong" && active ? <Rally w={at.w} /> : null}
      {piece.kind === "aquarium" && active ? <Bubbles w={at.w} /> : null}
      {piece.kind === "arcade" && active ? (
        <motion.div
          animate={{ opacity: [0.2, 0.9, 0.2] }}
          transition={{ duration: 0.25, repeat: Infinity }}
          style={{ position: "absolute", left: 8, top: 12, width: 20, height: 14, backgroundColor: "#4ade80" }}
        />
      ) : null}
      {piece.kind === "arcade" && fx ? <Points n={fx.n} /> : null}
      {piece.kind === "tv" && piece.on ? (
        <motion.div
          key={fx?.n ?? 0}
          animate={{ opacity: [0.25, 0.55, 0.3, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, repeatType: "mirror" }}
          style={{ position: "absolute", left: 8, top: 4, width: 56, height: 20, backgroundColor: ["#ff4fa3", "#4ade80", "#ffd166", "#5aa9ff"][(fx?.n ?? 0) % 4] }}
        />
      ) : null}
      {piece.kind === "lamp" && !piece.on ? <div style={{ position: "absolute", left: 2, top: 2, width: 20, height: 12, backgroundColor: "#4b506399" }} /> : null}
      {lit && !decorating ? (
        <motion.div
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "absolute", left: -4, top: -4, width: at.w + 8, height: at.h + 8, borderRadius: 6, borderWidth: 2, borderColor: t["office.working"], pointerEvents: "none" }}
        />
      ) : null}
      {decorating && (over || dragging) ? (
        <div style={{ position: "absolute", left: -3, top: -3, width: at.w + 6, height: at.h + 6, borderRadius: 4, borderWidth: 2, borderStyle: "dashed", borderColor: t["office.lit"], pointerEvents: "none" }} />
      ) : null}
      {/* The surface a press lands on: in Decorate mode a drag moves the piece; otherwise a click
          walks you over to use it. */}
      <div
        title={decorating ? `${kind.label} — drag to move` : kind.verb ?? kind.label}
        onMouseDown={(event: any) => {
          if (!decorating) return
          setPress({ x: event?.x ?? 0, y: event?.y ?? 0, moved: false })
          onPress(piece, { x: 0, y: 0 }, "down")
        }}
        onMouseMove={(event: any) => {
          if (!press || !decorating) return
          if (event?.pressedButton !== 0) {
            setPress(null)
            onPress(piece, { x: 0, y: 0 }, "up")
            return
          }
          const dx = (event?.x ?? 0) - press.x
          const dy = (event?.y ?? 0) - press.y
          if (!press.moved && Math.hypot(dx, dy) < 3) return
          if (!press.moved) setPress({ ...press, moved: true })
          onPress(piece, { x: dx, y: dy }, "move")
        }}
        onMouseUp={() => {
          if (!decorating) return
          setPress(null)
          onPress(piece, { x: 0, y: 0 }, "up")
        }}
        onClick={(event: any) => {
          event?.stopPropagation?.()
          if (!decorating && kind.use) onUse(piece)
        }}
        style={{ position: "absolute", left: 0, top: 0, width: at.w, height: at.h, cursor: decorating ? (dragging ? "grabbing" : "grab") : kind.use ? "pointer" : "default" }}
      />
      {decorating && over && !dragging ? (
        <div
          onClick={(event: any) => {
            event?.stopPropagation?.()
            onRemove(piece)
          }}
          title="Put it away"
          style={{ position: "absolute", left: at.w - 8, top: -10, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: t["office.blocked"], borderWidth: 2, borderColor: "#ffffff", cursor: "pointer" }}
        >
          <Icon name="close" size={8} color="#ffffff" />
        </div>
      ) : null}
    </motion.div>
  )
}

/** The piece you are placing, under the pointer, half there. */
export function Ghost({ kind, at }: { kind: Kind; at: Pt }) {
  const t = useTheme()
  return (
    <div style={{ position: "absolute", left: Math.round(at.x - kind.w / 2), top: Math.round(at.y - kind.h / 2), width: kind.w, height: kind.h, opacity: 0.6, zIndex: 40000, pointerEvents: "none" }}>
      <img src={pieceArt(kind.id)} style={{ width: kind.w, height: kind.h, imageRendering: "pixelated" }} />
      <div style={{ position: "absolute", left: -3, top: -3, width: kind.w + 6, height: kind.h + 6, borderRadius: 4, borderWidth: 2, borderStyle: "dashed", borderColor: t["office.lit"] }} />
    </div>
  )
}

// ── The light ───────────────────────────────────────────────────────────────────────────────

/** The evening's tint over the floor, and the pools of light the lamps and the screens throw. */
export function Lighting({ light, room, lamps, screens }: { light: Exclude<Light, "auto">; room: Plan; lamps: Rect[]; screens: Pt[] }) {
  if (light === "day") return null
  const night = light === "night"
  const pool = (x: number, y: number, r: number, color: string, key: string) => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        background: { type: "radial-gradient", shape: "circle", radius: r, stops: [{ color, position: 0 }, { color: `${color.slice(0, 7)}00`, position: 1 }] },
        pointerEvents: "none",
      }}
    />
  )
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: room.width, height: room.height, zIndex: 30000, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: room.width, height: room.height, backgroundColor: night ? "#0a0f2e" : "#ff8a3d", opacity: night ? 0.4 : 0.12, pointerEvents: "none" }} />
      {/* The windows go dark blue at night. */}
      {night ? <div style={{ position: "absolute", left: 0, top: 0, width: room.width, height: WALL, backgroundColor: "#0b1035", opacity: 0.25, pointerEvents: "none" }} /> : null}
      {lamps.map((lamp, i) => pool(lamp.x + lamp.w / 2, lamp.y + 10, night ? 130 : 90, night ? "#ffd16659" : "#ffd16633", `lamp${i}`))}
      {night ? screens.map((at, i) => pool(at.x, at.y, 46, "#5aa9ff40", `screen${i}`)) : null}
    </div>
  )
}

// ── The build panel ─────────────────────────────────────────────────────────────────────────

type Tab = "furniture" | "floor" | "walls" | "lights"

export function BuildPanel({
  holding,
  floor,
  wall,
  light,
  onHold,
  onFloor,
  onWall,
  onLight,
  onReset,
  onClear,
  onClose,
}: {
  holding: string | null
  floor: string
  wall: string
  light: Light
  onHold(kind: string | null): void
  onFloor(id: string): void
  onWall(id: string): void
  onLight(id: Light): void
  onReset(): void
  onClear(): void
  onClose(): void
}) {
  const t = useTheme()
  const [tab, setTab] = useState<Tab>("furniture")
  const tabButton = (id: Tab, label: string, icon: string) => (
    <div
      key={id}
      onClick={() => setTab(id)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 13, cursor: "pointer", backgroundColor: tab === id ? t["office.lit"] : "#ffffff12", hover: { backgroundColor: tab === id ? t["office.lit"] : "#ffffff24" } }}
    >
      <Icon name={icon} size={12} color="#ffffff" />
      <text style={{ fontSize: 11, color: "#ffffff", fontWeight: tab === id ? "bold" : "normal" }}>{label}</text>
    </div>
  )
  const swatch = (key: string, active: boolean, onClick: () => void, label: string, body: ReactNode) => (
    <div key={key} onClick={onClick} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 76, cursor: "pointer" }}>
      <div style={{ width: 64, height: 44, borderRadius: 6, overflow: "hidden", borderWidth: 2, borderColor: active ? t["office.lit"] : "#ffffff22" }}>{body}</div>
      <text style={{ fontSize: 10, color: active ? "#ffffff" : t["office.hudMuted"], whiteSpace: "nowrap" }}>{label}</text>
    </div>
  )
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 36 }}
      onClick={(event: any) => event?.stopPropagation?.()}
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: HUD + 8,
        height: 186,
        zIndex: 55,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: 12,
        backgroundColor: "#1d1f2bf2",
        borderWidth: 2,
        borderColor: "#3a3d52",
        boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: "#00000055" },
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <Icon name="sparkle" size={14} color={t["office.working"]} />
        <text style={{ fontSize: 13, fontWeight: "bold", color: "#ffffff", paddingRight: 8 }}>Decorate</text>
        {tabButton("furniture", "Furniture", "box")}
        {tabButton("floor", "Floor", "blocks")}
        {tabButton("walls", "Walls", "layout_panel_bottom")}
        {tabButton("lights", "Lights", "zap")}
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 10, color: t["office.hudMuted"], paddingRight: 6 }}>
          {holding ? "Click the floor to place it · Esc to stop" : "Pick a piece, drag what is on the floor, × puts it away"}
        </text>
        <div onClick={onReset} title="The starter lounge, as it was" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 12, cursor: "pointer", backgroundColor: "#ffffff12", hover: { backgroundColor: "#ffffff24" } }}>
          <Icon name="rotate_ccw" size={11} color="#e9eaf2" />
          <text style={{ fontSize: 10, color: "#e9eaf2" }}>Reset</text>
        </div>
        <div onClick={onClear} title="Put every piece away" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 12, cursor: "pointer", backgroundColor: "#ffffff12", hover: { backgroundColor: "#ef476f55" } }}>
          <Icon name="square_minus" size={11} color="#e9eaf2" />
          <text style={{ fontSize: 10, color: "#e9eaf2" }}>Clear</text>
        </div>
        <div onClick={onClose} style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12, cursor: "pointer", hover: { backgroundColor: "#ffffff24" } }}>
          <Icon name="close" size={11} color="#e9eaf2" />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6, flexGrow: 1, minHeight: 0, overflowY: "scroll", alignContent: "flex-start" }}>
        {tab === "furniture"
          ? KINDS.map((kind) => {
              const active = holding === kind.id
              const scale = Math.min(1, 40 / kind.w, 36 / kind.h)
              return (
                <div
                  key={kind.id}
                  onClick={() => onHold(active ? null : kind.id)}
                  title={kind.use ? `${kind.label} — ${kind.verb}` : kind.label}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, width: 66, height: 60, borderRadius: 8, cursor: "pointer", backgroundColor: active ? "#5aa9ff44" : "#ffffff0d", borderWidth: 2, borderColor: active ? t["office.lit"] : "#00000000", hover: { backgroundColor: active ? "#5aa9ff44" : "#ffffff1f" } }}
                >
                  <div style={{ display: "flex", width: 44, height: 38, alignItems: "center", justifyContent: "center" }}>
                    <img src={pieceArt(kind.id)} style={{ width: Math.round(kind.w * scale), height: Math.round(kind.h * scale), imageRendering: "pixelated" }} />
                  </div>
                  <text style={{ fontSize: 9, color: "#e9eaf2", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 64 }}>{kind.label}</text>
                </div>
              )
            })
          : tab === "floor"
            ? FLOORS.map((f) =>
                swatch(f.id, floor === f.id, () => onFloor(f.id), f.label, <div style={{ width: "100%", height: "100%", backgroundImage: { src: f.src, repeat: "repeat", size: typeof f.size === "number" ? f.size : f.size }, imageRendering: "pixelated" }} />),
              )
            : tab === "walls"
              ? WALLS.map((w) =>
                  swatch(w.id, wall === w.id, () => onWall(w.id), w.label, <div style={{ width: "100%", height: "100%", backgroundImage: { src: w.src, repeat: "repeat-x", size: [64, 56] }, imageRendering: "pixelated" }} />),
                )
              : LIGHTS.map((l) =>
                  swatch(
                    l.id,
                    light === l.id,
                    () => onLight(l.id),
                    l.label,
                    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: l.id === "night" ? "#0b1035" : l.id === "evening" ? "#f2a65a" : l.id === "day" ? "#efe3cf" : "#8a8fa3" }}>
                      <Icon name={l.icon} size={16} color={l.id === "day" ? "#2b2d42" : "#ffffff"} />
                    </div>,
                  ),
                )}
      </div>
    </motion.div>
  )
}
