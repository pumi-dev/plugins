// Office: pumi as a little pixel office you walk around, after Gather. Every session is a pod on
// the floor with its name on it, and every tab in it is a desk whose little screen shows that tab's
// pane in front, live — so the whole app is in the room at once.
//
// It plays like a game: arrow keys or WASD walk you (you bump into desks and slide along them), a
// click walks you there around everything, and walking up to something lights it and says which
// key uses it — X (or E, Enter, Space) sits you at a desk and opens its monitor with the tab's real
// panes, opens the bookshelf, pours a coffee (Settings) or opens the door to your sessions. 1–5
// are emotes. Desks are dragged by their body and stay where you put them; double-click one to
// rename it, right-click for its menu. The agents at the desks type while they work, their screens
// flicker, and their bubbles say what they are doing.
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, motion, useHover, useNow, useTheme } from "pumi"
import {
  call,
  commands,
  num,
  renderView,
  useApp,
  useComponents,
  useFocusedPane,
  useLayout,
  useLocal,
  useSession,
  useSessions,
  useSlot,
  useTabs,
  useThemeOption,
  useWindow,
  useWindowSize,
  windowContext,
  type Session,
  type Tree,
} from "pumi/theme"
import { BuildPanel, FLOORS, Ghost, Lighting, PieceView, WALLS, lightNow, type Fx, type Light } from "./build.tsx"
import { KIND, bodyOf, keepAt, newId, placeOf, seatOf, spotOf, starter, type Piece } from "./furniture.ts"
import { Game, isWalkKey, near, type You } from "./game.ts"
import {
  CELL_H,
  CELL_W,
  DESK_ART,
  HUD,
  WALL,
  deskBody,
  deskKey,
  deskSpot,
  plan,
  propBody,
  propSpot,
  type Plan,
  type Pod,
  type Prop,
  type Pt,
  type Rect,
  type Seat,
} from "./plan.ts"

/**
 * The room's art, by path. Not `import … from "./images/x.svg"`: a theme is loaded from disk when
 * the window draws it, and the app's module loader hands back an SVG without a default export —
 * a path is what `<img src>` and `backgroundImage` take anyway.
 */
const art = (name: string) => `${import.meta.dir}/images/${name}.svg`
const floorArt = art("floor")
const wallArt = art("wall")
const carpetArt = art("carpet")
const deskArt = art("desk")
const chairArt = art("chair")
const cupArt = art("cup")
const plantArt = art("plant")
const shelfArt = art("shelf")
const coffeeArt = art("coffee")
const matArt = art("mat")
const SEATED = [1, 2, 3, 4, 5, 6].map((n) => art(`seated${n}`))
/** You, walking: 12 looks, four ways, three frames (images/walk, from the gather package's art). */
const LOOKS = 12
const walkArt = (look: number, facing: string, frame: number) => art(`walk/${look}-${facing}-${frame}`)

const swallow = (err: unknown) => console.error(String(err))
/** How close you stand to something to use it. */
const REACH = 44
/** The emotes, on 1–5. */
const EMOTES = ["👋", "❤️", "😂", "🎉", "👍"]
/** The keys that use what you stand by. */
const USE_KEYS = new Set(["x", "e", "enter", "space"])
/** How long a press may wander before it is a drag. */
const DRAG_SLOP = 4

/** A pixel sprite: nearest neighbour, never smoothed. */
function Sprite({ src, width, height, style }: { src: string; width: number; height: number; style?: Record<string, unknown> }) {
  return <img src={src} style={{ width, height, flexShrink: 0, imageRendering: "pixelated", ...style }} />
}

/** A keycap, as a game prints the key to press. */
function Key({ children }: { children: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, paddingLeft: 4, paddingRight: 4, borderRadius: 4, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#1d1f2b", boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 0, spreadRadius: 0, color: "#1d1f2b" } }}>
      <text style={{ fontSize: 10, fontWeight: "bold", color: "#1d1f2b" }}>{children}</text>
    </div>
  )
}

/** "Press X to …", over what you stand by: it fades in, then bobs, as a game's prompt does. */
function Prompt({ x, y, label }: { x: number; y: number; label: string }) {
  const t = useTheme()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      style={{ position: "absolute", left: x - 110, top: y, width: 220, zIndex: 40000, pointerEvents: "none" }}
    >
      <motion.div
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        style={{ display: "flex", flexDirection: "row", justifyContent: "center", width: 220 }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 6, paddingRight: 9, paddingTop: 3, paddingBottom: 3, borderRadius: 9, backgroundColor: t["office.pill"] }}>
          <Key>X</Key>
          <text style={{ fontSize: 11, fontWeight: "bold", color: "#ffffff", whiteSpace: "nowrap" }}>{label}</text>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── The room ────────────────────────────────────────────────────────────────────────────────

/** The floor, the wall and the plants: what never moves (but for the floor and paint you chose). */
function Room({ width, height, floor, wall, onGround }: { width: number; height: number; floor: string; wall: string; onGround(event: any): void }) {
  const f = FLOORS.find((x) => x.id === floor) ?? FLOORS[0]!
  const w = WALLS.find((x) => x.id === wall) ?? WALLS[0]!
  return (
    <>
      {/* The ground: a click on it walks you there (what stands on it takes its own clicks). */}
      <div onClick={onGround} style={{ position: "absolute", left: 0, top: 0, width, height, backgroundImage: { src: f.src, repeat: "repeat", size: f.size }, imageRendering: "pixelated" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width, height: WALL, backgroundImage: { src: w.src, repeat: "repeat-x", size: [64, 56] }, imageRendering: "pixelated", zIndex: 1, pointerEvents: "none" }} />
      {/* The skirting board along the foot of the wall. */}
      <div style={{ position: "absolute", left: 0, top: WALL, width, height: 4, backgroundColor: "#00000018", zIndex: 1, pointerEvents: "none" }} />
      <Sprite src={plantArt} width={28} height={44} style={{ position: "absolute", left: 6, top: height - 52, zIndex: height, pointerEvents: "none" }} />
      <Sprite src={plantArt} width={28} height={44} style={{ position: "absolute", left: 40, top: height - 52, zIndex: height, pointerEvents: "none" }} />
      <Sprite src={plantArt} width={28} height={44} style={{ position: "absolute", left: width - 36, top: height - 52, zIndex: height, pointerEvents: "none" }} />
      <Sprite src={plantArt} width={28} height={44} style={{ position: "absolute", left: width - 70, top: height - 52, zIndex: height, pointerEvents: "none" }} />
    </>
  )
}

/** A session's carpet, and its name on a plate: a click on it brings the session in front. */
function Carpet({ pod }: { pod: Pod }) {
  const t = useTheme()
  const here = useSession()
  const window = useWindow()
  const current = pod.session.workspace_id === here?.workspace_id
  const status = pod.session.agent_status
  const dot = status ? (t[`agent.${status}`] ?? t["agent.unknown"]) : undefined
  return (
    <div style={{ position: "absolute", left: pod.x, top: pod.y, width: pod.width, height: pod.height, zIndex: 2, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 30,
          width: pod.width,
          height: pod.height - 30,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: current ? t["office.lit"] : "#7c8496",
          backgroundImage: { src: carpetArt, repeat: "repeat", size: 32 },
          imageRendering: "pixelated",
          opacity: 0.9,
          pointerEvents: "none",
        }}
      />
      <div
        onClick={(event: any) => {
          event?.stopPropagation?.()
          if (!current) window.show(pod.session.workspace_id)
        }}
        title={current ? pod.session.label : `${pod.session.label} — click to make it the session in front`}
        style={{
          position: "absolute",
          left: 10,
          top: 2,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 3,
          borderRadius: 12,
          backgroundColor: current ? t["office.ink"] : "#ffffffcc",
          cursor: "pointer",
          pointerEvents: "auto",
          hover: { backgroundColor: current ? t["office.ink"] : "#ffffff" },
        }}
      >
        {dot ? <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} /> : null}
        <text style={{ fontSize: 12, fontWeight: "bold", color: current ? "#ffffff" : "#4b5063", whiteSpace: "nowrap" }}>{pod.session.label || "Session"}</text>
        <text style={{ fontSize: 11, color: current ? t["office.hudMuted"] : "#8a8fa3" }}>{`${pod.seats.length}`}</text>
      </div>
    </div>
  )
}

/** What stands where a pod has room to spare, in the same order each time. */
const DECOR = [
  { src: plantArt, w: 28, h: 44, top: 50 },
  { src: coffeeArt, w: 32, h: 48, top: 46 },
  { src: plantArt, w: 28, h: 44, top: 50 },
]

/** The places in a pod's grid past its desks and its free desk. */
function spareCells(pod: Pod): Pt[] {
  const out: Pt[] = []
  const first = pod.cells[0]
  if (!first) return out
  for (let i = pod.cells.length; i < pod.cols * pod.down; i++) {
    out.push({ x: first.x + Math.floor(i / pod.down) * CELL_W, y: first.y + (i % pod.down) * CELL_H })
  }
  return out
}

function Decor({ at, index }: { at: Pt; index: number }) {
  const d = DECOR[index % DECOR.length]!
  return <Sprite src={d.src} width={d.w} height={d.h} style={{ position: "absolute", left: at.x + (CELL_W - d.w) / 2, top: at.y + d.top, zIndex: Math.round(at.y + d.top + d.h), pointerEvents: "none" }} />
}

const decorBody = (at: Pt, index: number): Rect => {
  const d = DECOR[index % DECOR.length]!
  return { x: at.x + (CELL_W - d.w) / 2, y: at.y + d.top + d.h - 14, w: d.w, h: 12 }
}

/** The bookshelf, the coffee machine and the door mat: lit when you stand by them. */
function PropView({ prop, lit, onUse }: { prop: Prop; lit: boolean; onUse(prop: Prop): void }) {
  const t = useTheme()
  const [over, hover] = useHover()
  const src = prop.id === "shelf" ? shelfArt : prop.id === "coffee" ? coffeeArt : matArt
  return (
    <motion.div
      {...hover}
      onClick={(event: any) => {
        event?.stopPropagation?.()
        onUse(prop)
      }}
      title={prop.label}
      animate={{ y: over || lit ? -2 : 0 }}
      transition={{ duration: 0.12 }}
      style={{ position: "absolute", left: prop.x, top: prop.y, width: prop.w, height: prop.h, cursor: "pointer", zIndex: prop.id === "door" ? 3 : prop.y + prop.h }}
    >
      <Sprite src={src} width={prop.w} height={prop.h} style={lit ? { outlineWidth: 2, outlineColor: t["office.working"], outlineOffset: 2, borderRadius: 3 } : undefined} />
      {over && !lit ? (
        <div style={{ position: "absolute", left: prop.w / 2 - 50, top: -20, width: 100, display: "flex", flexDirection: "row", justifyContent: "center" }}>
          <div style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, borderRadius: 8, backgroundColor: t["office.pill"] }}>
            <text style={{ fontSize: 11, color: "#ffffff", whiteSpace: "nowrap" }}>{prop.label}</text>
          </div>
        </div>
      ) : null}
    </motion.div>
  )
}

// ── Desks ───────────────────────────────────────────────────────────────────────────────────

/** Which of the seated sprites a desk's agent is: the same office every time. */
function agentOf(key: string): number {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return Math.abs(hash) % SEATED.length
}

const deskTitle = (seat: Seat) => (seat.tab.label && !/^\d+$/.test(seat.tab.label) ? seat.tab.label : `Desk ${seat.tab.number}`)

/** A tab's panes as its layout splits them, each its live screen: the big screen's insides. */
function ScreenTree({ tree }: { tree: Tree }) {
  if ("pane" in tree) {
    return (
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "hidden", borderRadius: 3, backgroundColor: "#14161f" }}>
        <preview pane={tree.pane} style={{ width: "100%", height: "100%" }} />
      </div>
    )
  }
  if ("app" in tree) return null
  const row = tree.axis === "row"
  return (
    <div style={{ display: "flex", flexDirection: row ? "row" : "column", flexGrow: 1, width: "100%", height: "100%", gap: 3 }}>
      <div style={{ display: "flex", flexShrink: 0, ...(row ? { width: `${tree.ratio * 100}%`, height: "100%" } : { height: `${tree.ratio * 100}%`, width: "100%" }) }}>
        <ScreenTree tree={tree.first} />
      </div>
      <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
        <ScreenTree tree={tree.second} />
      </div>
    </div>
  )
}

/** A desk's screen, big, beside it: what you see walking up to it (or pointing at it). */
function Peek({ seat, left }: { seat: Seat; left: boolean }) {
  const t = useTheme()
  const tree = useLayout(seat.tab.tab_id)
  const status = seat.pane?.agent_status ?? seat.tab.agent_status
  const colour = status ? (t[`agent.${status}`] ?? t["agent.unknown"]) : undefined
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      style={{
        position: "absolute",
        left: left ? -346 : CELL_W - 6,
        top: -24,
        width: 340,
        height: 214,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: 6,
        borderRadius: 10,
        backgroundColor: t["office.ink"],
        borderWidth: 2,
        borderColor: t["office.lit"],
        boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 30, spreadRadius: 0, color: "#00000066" },
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 16, flexShrink: 0, paddingLeft: 2 }}>
        {colour ? <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colour }} /> : null}
        <text style={{ fontSize: 11, fontWeight: "bold", color: "#e9eaf2", whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{deskTitle(seat)}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 10, color: t["office.hudMuted"], whiteSpace: "nowrap" }}>{status || "idle"}</text>
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0, overflow: "hidden", borderRadius: 5, backgroundColor: "#14161f" }}>
        {seat.pane ? <ScreenTree tree={{ pane: seat.pane.pane_id } as Tree} /> : tree ? <ScreenTree tree={tree} /> : null}
      </div>
    </motion.div>
  )
}

/** The bubble over an agent: dots that type while it works, a bouncing "!" when it needs you. */
function Bubble({ status }: { status: string }) {
  const t = useTheme()
  if (!["working", "blocked", "done", "error"].includes(status)) return null
  const bad = status === "blocked" || status === "error"
  const fill = bad ? t["office.blocked"] : status === "done" ? t["office.done"] : "#ffffff"
  const box = { position: "absolute", left: 110, top: -12, height: 20, minWidth: 26, display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingLeft: 6, paddingRight: 6, borderRadius: 10, backgroundColor: fill, borderWidth: 2, borderColor: t["office.ink"], zIndex: 4 } as const
  if (status === "working") {
    return (
      <div style={box}>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
            style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: t["office.ink"] }}
          />
        ))}
      </div>
    )
  }
  const glyph = status === "blocked" ? "!" : status === "done" ? "✓" : "✕"
  return (
    <motion.div
      animate={status === "blocked" ? { y: [0, -6, 0] } : status === "error" ? { x: [0, -2, 2, -2, 0] } : { y: [8, -3, 0], opacity: [0, 1, 1] }}
      transition={status === "done" ? { duration: 0.4, ease: "backOut" } : { duration: status === "blocked" ? 0.8 : 0.5, repeat: Infinity, repeatDelay: status === "error" ? 1.2 : 0, ease: "easeInOut" }}
      style={box}
    >
      <text style={{ fontSize: 13, fontWeight: "bold", color: bad ? "#ffffff" : t["office.ink"] }}>{glyph}</text>
    </motion.div>
  )
}

interface DeskProps {
  seat: Seat
  at: Pt
  dragging: boolean
  sitting: boolean
  lit: boolean
  peekLeft: boolean
  onDragStart(key: string): void
  onDrag(key: string, to: Pt | null): void
  onUse(seat: Seat): void
  onRename(seat: Seat): void
  onMenu(seat: Seat, at: Pt): void
}

/**
 * A desk: its sprite, its live little screen, the chair and the agent at it, the cups of a split
 * tab, the bubble and the nameplate. Pressed and dragged it moves; clicked, you walk over and sit;
 * walked up to (or pointed at) its screen opens big beside it.
 */
const Desk = memo(function Desk({ seat, at, dragging, sitting, lit, peekLeft, onDragStart, onDrag, onUse, onRename, onMenu }: DeskProps) {
  const t = useTheme()
  const key = deskKey(seat)
  const focused = useFocusedPane(seat.tab.tab_id)
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === seat.tab.tab_id) ?? [])
  const shown = seat.pane?.pane_id ?? focused ?? panes[0]?.pane_id
  const status = (seat.pane ? seat.pane.agent_status : seat.tab.agent_status) || ""
  const busy = seat.pane ? !!(seat.pane.agent || seat.pane.agent_status) : panes.some((p) => p.agent || p.agent_status)
  const title = deskTitle(seat)
  const agent = seat.pane?.label || seat.pane?.agent || panes.find((p) => p.agent)?.label || title
  const sprite = SEATED[agentOf(key)]!
  const colour = t[`agent.${status || "unknown"}`] ?? t["agent.unknown"]
  const [over, hover] = useHover(350)
  const press = useRef<{ x: number; y: number; base: Pt; moved: boolean } | null>(null)
  const ring = sitting ? t["office.lit"] : status === "blocked" || status === "error" ? t["office.blocked"] : status === "done" ? t["office.done"] : "#00000000"
  return (
    <motion.div
      {...hover}
      animate={{ y: (over || lit) && !dragging ? -2 : 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        width: CELL_W,
        height: CELL_H,
        // Drawn in depth order with you: behind you when you stand in front, over you behind it.
        zIndex: dragging ? 32000 : over || lit ? 31000 : Math.round(at.y + 96),
        opacity: dragging ? 0.85 : 1,
        pointerEvents: "none",
      }}
    >
      {lit ? (
        <motion.div
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "absolute", left: DESK_ART.x - 4, top: DESK_ART.y - 4, width: DESK_ART.w + 8, height: DESK_ART.h + 8, borderRadius: 6, borderWidth: 2, borderColor: t["office.working"] }}
        />
      ) : null}
      <Sprite src={deskArt} width={DESK_ART.w} height={DESK_ART.h} style={{ position: "absolute", left: DESK_ART.x, top: DESK_ART.y }} />
      {/* The little screen: the pane in front of the tab, live; it flickers while its agent works. */}
      <div style={{ position: "absolute", left: 68, top: 16, width: 40, height: 22, overflow: "hidden", backgroundColor: "#2a2d3e", borderWidth: 1, borderColor: ring }}>
        {shown ? <preview pane={shown} style={{ width: "100%", height: "100%" }} /> : null}
        {status === "working" ? (
          <motion.div
            animate={{ opacity: [0, 0.35, 0.05, 0.3, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", backgroundColor: t["office.lit"] }}
          />
        ) : null}
        {status === "blocked" ? (
          <motion.div
            animate={{ opacity: [0, 0.45, 0] }}
            transition={{ duration: 0.9, repeat: Infinity }}
            style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", backgroundColor: t["office.blocked"] }}
          />
        ) : null}
      </div>
      {/* A cup for each pane past the first: a desk you have split. */}
      {seat.pane
        ? null
        : panes.slice(1, 5).map((_, index) => <Sprite key={index} src={cupArt} width={12} height={10} style={{ position: "absolute", left: 44 + index * 13, top: 26 }} />)}
      <Sprite src={chairArt} width={28} height={24} style={{ position: "absolute", left: 74, top: 72 }} />
      {/* The agent: typing while it works, fidgeting while it waits for you, still otherwise. */}
      {busy ? (
        <motion.div
          animate={status === "working" ? { y: [0, -2, 0, -1, 0] } : status === "blocked" ? { x: [0, -2, 0, 2, 0] } : { y: [0, -1, 0] }}
          transition={{ duration: status === "working" ? 0.45 : status === "blocked" ? 0.6 : 2.6, repeat: Infinity, ease: "easeInOut", repeatDelay: status === "blocked" ? 0.6 : 0 }}
          style={{ position: "absolute", left: 76, top: 64, width: 24, height: 28 }}
        >
          <Sprite src={sprite} width={24} height={28} />
        </motion.div>
      ) : null}
      {busy ? <Bubble status={status} /> : null}
      <div style={{ position: "absolute", left: 0, top: 100, width: CELL_W, display: "flex", flexDirection: "row", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: 10,
            maxWidth: 150,
            backgroundColor: sitting ? t["office.ink"] : "#4b5063d9",
            outlineWidth: sitting ? 2 : 0,
            outlineColor: t["office.lit"],
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colour }} />
          <text style={{ fontSize: 10, color: "#ffffff", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{busy ? agent : title}</text>
        </div>
      </div>
      {/* The surface a press lands on, over the sprites and the live screen, which would take the
          hit themselves: a drag moves the desk, a click walks you to it. */}
      <div
        title={`${agent} — ${title}`}
        onMouseDown={(event: any) => {
          press.current = { x: event?.x ?? 0, y: event?.y ?? 0, base: at, moved: false }
        }}
        onMouseMove={(event: any) => {
          const from = press.current
          if (!from) return
          // The button came up somewhere the release was not heard.
          if (event?.pressedButton !== 0) {
            press.current = null
            onDrag(key, null)
            return
          }
          const dx = (event?.x ?? 0) - from.x
          const dy = (event?.y ?? 0) - from.y
          if (!from.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
          if (!from.moved) {
            from.moved = true
            onDragStart(key)
          }
          onDrag(key, { x: Math.round(from.base.x + dx), y: Math.round(from.base.y + dy) })
        }}
        onMouseUp={() => {
          if (press.current?.moved) onDrag(key, null)
        }}
        onClick={(event: any) => {
          event?.stopPropagation?.()
          const was = press.current
          press.current = null
          if (was?.moved) return
          onUse(seat)
        }}
        onDoubleClick={(event: any) => {
          event?.stopPropagation?.()
          onRename(seat)
        }}
        onContextMenu={(event: any) => {
          event?.stopPropagation?.()
          onMenu(seat, { x: event?.x ?? 0, y: event?.y ?? 0 })
        }}
        style={{ position: "absolute", left: 30, top: 0, width: CELL_W - 60, height: 124, cursor: dragging ? "grabbing" : "pointer", zIndex: 5, pointerEvents: "auto" }}
      />
      {(over || lit) && !dragging && !sitting ? <Peek seat={seat} left={peekLeft} /> : null}
    </motion.div>
  )
})

/** The desk a pod always has free: walking to it (or a click) makes a new tab in its session. */
function FreeDesk({ at, lit, onUse }: { at: Pt; lit: boolean; onUse(): void }) {
  const t = useTheme()
  const [over, hover] = useHover()
  return (
    <div
      {...hover}
      onClick={(event: any) => {
        event?.stopPropagation?.()
        onUse()
      }}
      title="New desk: a new tab in this session"
      style={{ position: "absolute", left: at.x, top: at.y, width: CELL_W, height: 130, cursor: "pointer", zIndex: Math.round(at.y + 96), opacity: over || lit ? 0.95 : 0.55 }}
    >
      {lit ? (
        <motion.div
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          style={{ position: "absolute", left: DESK_ART.x - 4, top: DESK_ART.y - 4, width: DESK_ART.w + 8, height: DESK_ART.h + 8, borderRadius: 6, borderWidth: 2, borderColor: t["office.working"] }}
        />
      ) : null}
      <Sprite src={deskArt} width={DESK_ART.w} height={DESK_ART.h} style={{ position: "absolute", left: DESK_ART.x, top: DESK_ART.y }} />
      <Sprite src={chairArt} width={28} height={24} style={{ position: "absolute", left: 74, top: 72 }} />
      <div style={{ position: "absolute", left: 0, top: 100, width: CELL_W, display: "flex", flexDirection: "row", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2, borderRadius: 10, backgroundColor: "#4b5063d9" }}>
          <Icon name="plus" size={10} color="#ffffff" />
          <text style={{ fontSize: 10, color: "#ffffff" }}>New desk</text>
        </div>
      </div>
    </div>
  )
}

// ── You ─────────────────────────────────────────────────────────────────────────────────────

/** You, on the floor: your look, walking the way you go, your name, and the emote you sent. */
function Player({ game, look, emote }: { game: Game; look: number; emote: string | null }) {
  const t = useTheme()
  const you = useSyncExternalStore(game.subscribe, game.get)
  const x = Math.round(you.at.x)
  const y = Math.round(you.at.y)
  return (
    <div style={{ position: "absolute", left: x - 30, top: y - 58, width: 60, height: 58, display: "flex", flexDirection: "column", alignItems: "center", zIndex: y, pointerEvents: "none" }}>
      {emote ? (
        <motion.div
          key={emote}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: [0, -6, -4] }}
          transition={{ duration: 0.4, ease: "backOut" }}
          style={{ position: "absolute", top: -28, width: 30, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#ffffff", borderWidth: 2, borderColor: t["office.ink"] }}
        >
          <text style={{ fontSize: 14 }}>{emote}</text>
        </motion.div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 18, paddingLeft: 6, paddingRight: 7, borderRadius: 9, backgroundColor: t["office.pill"] }}>
        <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t["office.online"] }} />
        <text style={{ fontSize: 10, fontWeight: "bold", color: "#ffffff" }}>You</text>
      </div>
      {/* A shadow under your feet, and you. */}
      <div style={{ position: "absolute", top: 52, width: 18, height: 6, borderRadius: 3, backgroundColor: "#00000026" }} />
      <Sprite src={walkArt(look, you.facing, you.frame)} width={24} height={34} style={{ marginTop: 4 }} />
    </div>
  )
}

/** The floor, where the camera is: it follows you as you walk, and the wheel looks around. */
function Camera({ game, children }: { game: Game; children: ReactNode }) {
  useSyncExternalStore(game.subscribe, () => game.cam)
  return <div style={{ position: "absolute", left: 0, top: -game.cam, width: "100%", height: game.size.height, pointerEvents: "none" }}>{children}</div>
}

/** The floor from above, in the top corner: the pods, the desks by how they are, you blinking. */
function Minimap({ game, room, onWalk }: { game: Game; room: Plan; onWalk(at: Pt): void }) {
  const t = useTheme()
  const you = useSyncExternalStore(game.subscribe, game.get)
  const cam = useSyncExternalStore(game.subscribe, () => game.cam)
  const blink = Math.floor(useNow(500) / 500) % 2 === 0
  const W = 150
  const k = W / room.width
  const H = Math.round(room.height * k)
  return (
    <div
      onClick={(event: any) => {
        event?.stopPropagation?.()
      }}
      style={{ position: "absolute", right: 10, top: 10, width: W + 8, height: H + 8, padding: 4, borderRadius: 8, backgroundColor: "#1d1f2bd9", zIndex: 45 }}
    >
      <div
        style={{ position: "relative", width: W, height: H, overflow: "hidden", borderRadius: 4, backgroundColor: "#efe3cf" }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: WALL * k, backgroundColor: "#6c74a8" }} />
        {room.pods.map((pod) => (
          <div key={pod.session.workspace_id} style={{ position: "absolute", left: pod.x * k, top: (pod.y + 30) * k, width: pod.width * k, height: (pod.height - 30) * k, backgroundColor: "#9aa1b5" }} />
        ))}
        {room.pods.flatMap((pod) =>
          pod.seats.map((seat, i) => {
            const status = (seat.pane ? seat.pane.agent_status : seat.tab.agent_status) || ""
            const cell = pod.cells[i]!
            return (
              <div
                key={deskKey(seat)}
                onClick={() => onWalk(deskSpot(cell))}
                style={{ position: "absolute", left: (cell.x + DESK_ART.x) * k, top: (cell.y + DESK_ART.y) * k, width: DESK_ART.w * k, height: DESK_ART.h * k, backgroundColor: status ? (t[`agent.${status}`] ?? "#ffffff") : "#ffffff", cursor: "pointer" }}
              />
            )
          }),
        )}
        <div style={{ position: "absolute", left: 0, top: cam * k, width: W, height: game.view * k, borderWidth: 1, borderColor: "#1d1f2b66" }} />
        <div style={{ position: "absolute", left: you.at.x * k - 3, top: you.at.y * k - 5, width: 6, height: 6, borderRadius: 3, backgroundColor: blink ? t["office.lit"] : "#1d1f2b" }} />
      </div>
    </div>
  )
}

// ── What opens over the room ───────────────────────────────────────────────────────────────

/** The monitor: a desk you sat down at, with the tab's real panes in it. */
function Monitor({ tab, onStand }: { tab: string; onStand(): void }) {
  const t = useTheme()
  const shown = useTabs().find((row) => row.tab_id === tab)
  const panes = useApp((s) => s.snapshot?.panes.filter((p) => p.tab_id === tab) ?? [])
  const C = useComponents()
  const label = shown?.label && !/^\d+$/.test(shown.label) ? shown.label : `Desk ${shown?.number ?? ""}`
  return (
    <div
      onClick={onStand}
      style={{ position: "absolute", left: 0, top: 0, width: "100%", bottom: HUD, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: "#1d1f2b88", zIndex: 50 }}
    >
      {/* The monitor zooms up from the desk, on its stand. */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        onClick={(event: any) => event?.stopPropagation?.()}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "88%", height: "86%" }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: "100%",
            flexGrow: 1,
            minHeight: 0,
            padding: 10,
            borderRadius: 14,
            backgroundColor: t["office.ink"],
            borderWidth: 3,
            borderColor: "#3a3d52",
            boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 40, spreadRadius: 0, color: "#00000066" },
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 26, flexShrink: 0, paddingLeft: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t["office.online"] }} />
            <text style={{ fontSize: 12, fontWeight: "bold", color: "#e9eaf2", flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</text>
            <text style={{ fontSize: 10, color: t["office.hudMuted"] }}>{`${panes.length} pane${panes.length === 1 ? "" : "s"}`}</text>
            <div style={{ flexGrow: 1 }} />
            <div
              onClick={onStand}
              style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4, borderRadius: 13, backgroundColor: t["office.lit"], cursor: "pointer", hover: { backgroundColor: "#3d8ce8" } }}
            >
              <Icon name="arrow_left" size={12} color="#ffffff" />
              <text style={{ fontSize: 12, fontWeight: "bold", color: "#ffffff" }}>Stand up</text>
            </div>
          </div>
          <div style={{ display: "flex", flexGrow: 1, minHeight: 0, overflow: "hidden", borderRadius: 6, backgroundColor: "#14161f" }}>
            <C.Layout tab={tab} />
          </div>
        </div>
        <div style={{ width: 26, height: 14, flexShrink: 0, backgroundColor: "#3a3d52" }} />
        <div style={{ width: 140, height: 10, flexShrink: 0, borderRadius: 5, backgroundColor: "#3a3d52" }} />
      </motion.div>
    </div>
  )
}

/** The bookshelf: the packages' panels, a book each, and the one that is open. */
function Shelf({ close }: { close(): void }) {
  const t = useTheme()
  const { views } = useSlot("panel")
  const [open, setOpen] = useState<string | null>(views[0] ? `${views[0].plugin}/${views[0].id}` : null)
  const shown = views.find((v) => `${v.plugin}/${v.id}` === open)
  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      onClick={(event: any) => event?.stopPropagation?.()}
      style={{
        position: "absolute",
        left: 12,
        top: 12,
        bottom: HUD + 12,
        width: 360,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 12,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.border,
        boxShadow: { offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 0, color: "#00000055" },
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 36, flexShrink: 0, paddingLeft: 12, paddingRight: 6, borderBottomWidth: 1, borderColor: t.border }}>
        <Sprite src={shelfArt} width={18} height={20} />
        <text style={{ fontSize: 13, fontWeight: "bold", color: t.text }}>Bookshelf</text>
        <div style={{ flexGrow: 1 }} />
        <div onClick={close} style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 6, cursor: "pointer", color: t.muted, hover: { backgroundColor: t.hover } }}>
          <Icon name="close" size={12} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 8, flexShrink: 0, borderBottomWidth: 1, borderColor: t.border }}>
        {views.length ? (
          views.map((view) => {
            const id = `${view.plugin}/${view.id}`
            const active = open === id
            return (
              <div
                key={id}
                onClick={() => setOpen(id)}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 12, cursor: "pointer", backgroundColor: active ? t.accent : t.active, hover: { backgroundColor: active ? t.accent : t.hover } }}
              >
                <Icon name={view.icon ?? "puzzle"} size={13} color={active ? t.accentText : t.muted} />
                <text style={{ fontSize: 12, color: active ? t.accentText : t.muted }}>{view.title ?? view.id}</text>
              </div>
            )
          })
        ) : (
          <text style={{ fontSize: 12, color: t.faint, padding: 4 }}>No panel yet</text>
        )}
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>{shown ? renderView(shown) : null}</div>
    </motion.div>
  )
}

/** A framed box in the middle of the room: the door's sessions, a desk's new name. */
function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const t = useTheme()
  return (
    <div onClick={onClose} style={{ position: "absolute", left: 0, top: 0, width: "100%", bottom: HUD, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#1d1f2b55", zIndex: 70 }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 34 }}
        onClick={(event: any) => event?.stopPropagation?.()}
        style={{ display: "flex", flexDirection: "column", gap: 10, width: 380, padding: 16, borderRadius: 12, backgroundColor: t.surface, borderWidth: 2, borderColor: t["office.ink"], boxShadow: { offsetX: 4, offsetY: 4, blurRadius: 0, spreadRadius: 0, color: "#1d1f2b55" } }}
      >
        <text style={{ fontSize: 14, fontWeight: "bold", color: t.text }}>{title}</text>
        {children}
      </motion.div>
    </div>
  )
}

function Button({ label, primary, onClick }: { label: string; primary?: boolean; onClick(): void }) {
  const t = useTheme()
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 30, paddingLeft: 14, paddingRight: 14, borderRadius: 8, cursor: "pointer", backgroundColor: primary ? t["office.lit"] : t.active, hover: { backgroundColor: primary ? "#3d8ce8" : t.hover } }}>
      <text style={{ fontSize: 12, fontWeight: primary ? "bold" : "normal", color: primary ? "#ffffff" : t.text }}>{label}</text>
    </div>
  )
}

/** A desk's name, asked for: Enter keeps it, Escape (or Cancel) leaves it. */
function Rename({ seat, onClose }: { seat: Seat; onClose(): void }) {
  const t = useTheme()
  const [value, setValue] = useState(seat.tab.label && !/^\d+$/.test(seat.tab.label) ? seat.tab.label : "")
  const done = (name: string) => {
    call("tab.rename", num(seat.tab.tab_id), name.trim() || null).catch(swallow)
    onClose()
  }
  return (
    <Dialog title="Rename desk" onClose={onClose}>
      <text style={{ fontSize: 11, color: t.muted }}>{deskTitle(seat)}</text>
      <input
        value={value}
        autoFocus
        placeholder="A name for this desk"
        onChange={(event: any) => setValue(event?.value ?? "")}
        onSubmit={(event: any) => done(event?.value ?? value)}
        onKeyDown={(event: any) => {
          if (event?.key === "escape") onClose()
        }}
        style={{ height: 34, paddingLeft: 10, paddingRight: 10, borderRadius: 8, borderWidth: 2, borderColor: t["office.lit"], backgroundColor: t.surface, color: t.text, fontSize: 13 }}
      />
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label="Rename" primary onClick={() => done(value)} />
      </div>
    </Dialog>
  )
}

/** The door: every session, to go to, and a new one. */
function Door({ onClose }: { onClose(): void }) {
  const t = useTheme()
  const window = useWindow()
  const sessions = useSessions()
  const here = useSession()
  const go = (session: Session) => {
    window.show(session.workspace_id)
    onClose()
  }
  return (
    <Dialog title="Where to?" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sessions.map((session) => {
          const current = session.workspace_id === here?.workspace_id
          return (
            <div
              key={session.workspace_id}
              onClick={() => go(session)}
              style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: "pointer", backgroundColor: current ? t.active : undefined, hover: { backgroundColor: t.hover } }}
            >
              <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: session.agent_status ? (t[`agent.${session.agent_status}`] ?? t["agent.unknown"]) : t["agent.unknown"] }} />
              <text style={{ fontSize: 12, color: t.text, flexGrow: 1 }}>{session.label || session.workspace_id}</text>
              {current ? <text style={{ fontSize: 11, color: t.muted }}>you are here</text> : null}
            </div>
          )
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button label="Close" onClick={onClose} />
        <Button
          label="New session"
          primary
          onClick={() => {
            const context = windowContext(window.id)
            if (context) commands.run("new_workspace", context)
            onClose()
          }}
        />
      </div>
    </Dialog>
  )
}

/** A desk's menu, where it was right-clicked. */
function DeskMenu({ at, items, onClose }: { at: Pt; items: { label: string; icon: string; run(): void; danger?: boolean }[]; onClose(): void }) {
  const t = useTheme()
  return (
    <anchored position={at} fit="snap" deferred occlude onMouseDownOutside={onClose}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 170, padding: 4, borderRadius: 8, backgroundColor: t.surface, borderWidth: 2, borderColor: t["office.ink"], boxShadow: { offsetX: 3, offsetY: 3, blurRadius: 0, spreadRadius: 0, color: "#1d1f2b55" } }}>
        {items.map((item) => (
          <div
            key={item.label}
            onClick={() => {
              onClose()
              item.run()
            }}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 5, cursor: "pointer", hover: { backgroundColor: t.hover } }}
          >
            <Icon name={item.icon} size={12} color={item.danger ? t.error : t.muted} />
            <text style={{ fontSize: 12, color: item.danger ? t.error : t.text }}>{item.label}</text>
          </div>
        ))}
      </div>
    </anchored>
  )
}

// ── The bar ─────────────────────────────────────────────────────────────────────────────────

/** The bar along the foot: you, the session, the room's doors, the emotes, its counts and clock. */
function Hud({ shelf, look, decorating, onShelf, onLook, onEmote, onDecorate }: { shelf: boolean; look: number; decorating: boolean; onShelf(): void; onLook(): void; onEmote(index: number): void; onDecorate(): void }) {
  const t = useTheme()
  const window = useWindow()
  const session = useSession()
  const now = useNow(15000)
  const perPane = useThemeOption<boolean>("desk_per_pane", false)
  const agents = useApp((s) => s.snapshot?.panes.filter((p) => p.agent) ?? [])
  const count = (status: string) => agents.filter((a) => a.agent_status === status).length
  const run = (name: string) => {
    const context = windowContext(window.id)
    if (context) commands.run(name, context)
  }
  // A button with its word, or (`short`) only its icon and the word as its tooltip.
  const button = (label: string, icon: string, onClick: () => void, active?: boolean, short?: boolean) => (
    <div
      onClick={onClick}
      title={label}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingLeft: short ? 10 : 12, paddingRight: short ? 10 : 12, borderRadius: 10, cursor: "pointer", backgroundColor: active ? t["office.lit"] : "#ffffff12", hover: { backgroundColor: active ? t["office.lit"] : "#ffffff24" } }}
    >
      <Icon name={icon} size={15} color={active ? "#ffffff" : "#e9eaf2"} />
      {short ? null : <text style={{ fontSize: 12, color: active ? "#ffffff" : "#e9eaf2", whiteSpace: "nowrap" }}>{label}</text>}
    </div>
  )
  return (
    <div
      onClick={(event: any) => event?.stopPropagation?.()}
      style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: HUD, display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 12, backgroundColor: t["office.hud"], zIndex: 60 }}
    >
      <div onClick={onLook} title="Change your look" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 4, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 10, cursor: "pointer", hover: { backgroundColor: "#ffffff14" } }}>
        <div style={{ display: "flex", width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: "#ffffff1f" }}>
          <Sprite src={walkArt(look, "down", 0)} width={24} height={34} style={{ marginTop: 10 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5 }}>
            <text style={{ fontSize: 13, fontWeight: "bold", color: "#e9eaf2" }}>You</text>
            <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t["office.online"] }} />
          </div>
          <text style={{ fontSize: 11, color: t["office.hudMuted"], whiteSpace: "nowrap" }}>{session?.label ?? "no session"}</text>
        </div>
      </div>
      <div style={{ width: 1, height: 28, marginLeft: 6, marginRight: 6, backgroundColor: "#ffffff26" }} />
      {button("New desk", "plus", () => run("new_tab"))}
      {button("Decorate", "sparkle", onDecorate, decorating)}
      {button("Bookshelf", "blocks", onShelf, shelf, true)}
      {button("Settings", "settings", () => run("settings"), false, true)}
      {button("A desk for every pane", perPane ? "check" : "square_dot", () => call("option.set", "office.desk_per_pane", !perPane).catch(swallow), perPane, true)}
      <div style={{ width: 1, height: 28, marginLeft: 6, marginRight: 6, backgroundColor: "#ffffff26" }} />
      {/* The emotes, as the keys 1–5 send them. */}
      <div style={{ display: "flex", flexDirection: "row", gap: 2 }}>
        {EMOTES.map((emote, index) => (
          <div key={emote} onClick={() => onEmote(index)} title={`${emote}  (${index + 1})`} style={{ display: "flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8, cursor: "pointer", hover: { backgroundColor: "#ffffff24" } }}>
            <text style={{ fontSize: 15 }}>{emote}</text>
          </div>
        ))}
      </div>
      <div style={{ flexGrow: 1 }} />
      {["working", "blocked"].map((status) =>
        count(status) ? (
          <div
            key={status}
            onClick={() => {
              const next = agents.find((a) => a.agent_status === status)
              if (next) call("pane.select", { pane: num(next.pane_id) }).catch(swallow)
            }}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 13, cursor: status === "blocked" ? "pointer" : "default", backgroundColor: status === "blocked" ? "#ef476f33" : "#ffffff12" }}
          >
            <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: status === "blocked" ? t["office.blocked"] : t["office.working"] }} />
            <text style={{ fontSize: 11, color: "#e9eaf2" }}>{`${count(status)} ${status}`}</text>
          </div>
        ) : null,
      )}
      <text style={{ fontSize: 11, color: t["office.hudMuted"], paddingLeft: 8, whiteSpace: "nowrap" }}>{new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</text>
    </div>
  )
}

// ── The window ──────────────────────────────────────────────────────────────────────────────

/** Something you can walk up to and use, and the place you stand to. */
type Spot = { key: string; at: Pt; label: string; prompt: Pt; use(): void }

export function Office() {
  const t = useTheme()
  const window = useWindow()
  const { width, height } = useWindowSize()
  const sessions = useSessions()
  const tabs = useApp((s) => s.snapshot?.tabs ?? [])
  const panes = useApp((s) => s.snapshot?.panes ?? [])
  const perPane = useThemeOption<boolean>("desk_per_pane", false)
  const [sitting, setSitting] = useState<string | null>(null)
  const [shelf, setShelf] = useState(false)
  const [door, setDoor] = useState(false)
  const [renaming, setRenaming] = useState<Seat | null>(null)
  const [menu, setMenu] = useState<{ seat: Seat; at: Pt } | null>(null)
  const [emote, setEmote] = useState<string | null>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  // Decorate mode: whether it is on, the piece you are placing, and where the pointer is.
  const [decorating, setDecorating] = useState(false)
  const [holding, setHolding] = useState<string | null>(null)
  const [ghost, setGhost] = useState<Pt | null>(null)
  const [fx, setFx] = useState<Record<string, Fx>>({})
  // Bumped when you stand up: the floor takes the keys back.
  const [focus, setFocus] = useState(0)
  const [kept, setKept] = useLocal<Pt | null>("office.you", null)
  const [moved, setMoved] = useLocal<Record<string, Pt>>("office.desks", {})
  const [look, setLook] = useLocal<number>("office.look", 0)
  const [stored, setStored] = useLocal<Piece[] | null>("office.furniture", null)
  const [floorStyle, setFloorStyle] = useLocal<string>("office.floor", "classic")
  const [wallStyle, setWallStyle] = useLocal<string>("office.wall", "classic")
  const [light, setLight] = useLocal<Light>("office.light", "auto")
  const [score, setScore] = useLocal<number>("office.arcade", 0)
  const now = useNow(60000)
  const view = Math.max(200, height - HUD)
  // The furniture: what you put down, or the starter lounge until you change it.
  const pieces = useMemo(() => stored ?? starter(width), [stored, width])
  const room = useMemo(() => {
    const first = plan(sessions, tabs, panes, width, view, perPane === true)
    // The floor goes on as far down as the furniture does.
    const lowest = pieces.reduce((end, piece) => {
      const at = placeOf(piece, first)
      return Math.max(end, at.y + at.h)
    }, 0)
    return lowest + 80 > first.height ? plan(sessions, tabs, panes, width, view, perPane === true, lowest) : first
  }, [sessions, tabs, panes, width, view, perPane, pieces])
  const origin = useRef<Pt>({ x: 0, y: 0 })
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (ms: number, run: () => void) => {
    timers.current.push(setTimeout(run, ms))
  }

  const game = useRef<Game | null>(null)
  if (!game.current) game.current = new Game(kept ?? room.centre)
  const g = game.current
  g.size = { width: room.width, height: room.height }
  g.view = view
  g.onRest = (at) => setKept({ x: Math.round(at.x), y: Math.round(at.y) })
  useEffect(() => () => g.dispose(), [g])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // Where each desk is: its cell, moved by where you dragged it, kept on the floor.
  const clamp = (p: Pt): Pt => ({ x: Math.max(0, Math.min(room.width - CELL_W, p.x)), y: Math.max(WALL - 8, Math.min(room.height - CELL_H, p.y)) })
  const desks = room.pods.flatMap((pod) => pod.seats.map((seat, i) => ({ seat, key: deskKey(seat), at: clamp(moved[deskKey(seat)] ?? pod.cells[i]!) })))
  const freeDesks = room.pods.map((pod) => ({ pod, at: pod.cells[pod.seats.length]! }))
  const spares = room.pods.flatMap(spareCells)

  // What you bump into.
  g.walls = [
    ...desks.map((d) => deskBody(d.at)),
    ...freeDesks.map((d) => deskBody(d.at)),
    ...spares.map((at, i) => decorBody(at, i)),
    ...room.props.map(propBody).filter((r): r is Rect => !!r),
    ...pieces.map((piece) => bodyOf(piece, room)).filter((r): r is Rect => !!r),
  ]
  // You stay on the floor when it shrinks under you.
  useEffect(() => {
    const at = g.you.at
    const x = Math.max(12, Math.min(room.width - 12, at.x))
    const y = Math.max(WALL + 16, Math.min(room.height - 8, at.y))
    if (x !== at.x || y !== at.y) g.place({ x, y })
    else if (g.follow()) g.place(at)
  }, [room.width, room.height, view])

  const run = (name: string) => {
    const context = windowContext(window.id)
    if (context) commands.run(name, context)
  }
  const sendEmote = (glyph: string) => {
    setEmote(glyph)
    later(2600, () => setEmote((now) => (now === glyph ? null : now)))
  }
  const sit = (seat: Seat) => {
    call("tab.select", { tab: num(seat.tab.tab_id) }).catch(swallow)
    if (seat.pane) call("pane.select", { pane: num(seat.pane.pane_id) }).catch(swallow)
    g.stop()
    setShelf(false)
    setDecorating(false)
    setSitting(seat.tab.tab_id)
  }
  const stand = () => {
    setSitting(null)
    setFocus((n) => n + 1)
  }
  const newDesk = (pod: Pod) => call("pane.open", "terminal", {}, { kind: "tab", session: num(pod.session.workspace_id) }).catch(swallow)
  const useProp = (prop: Prop) => {
    if (prop.id === "shelf") setShelf((v) => !v)
    else if (prop.id === "coffee") {
      sendEmote("☕")
      run("settings")
    } else setDoor(true)
  }
  /** Changes the furniture: what is on the floor now becomes what is kept. */
  const edit = (change: (old: Piece[]) => Piece[]) => setStored((old) => change(old ?? pieces))
  /** A piece doing what it does for a while: the rally, the bubbles, the points. */
  const play = (piece: Piece, ms: number, n = 0) => {
    const mark = { at: Date.now(), n }
    setFx((old) => ({ ...old, [piece.id]: mark }))
    later(ms, () =>
      setFx((old) => {
        if (old[piece.id] !== mark) return old
        const next = { ...old }
        delete next[piece.id]
        return next
      }),
    )
  }
  const usePiece = (piece: Piece) => {
    const kind = KIND[piece.kind]
    switch (kind?.use) {
      case "sit":
        g.stop()
        g.place(seatOf(piece, room))
        play(piece, 600)
        sendEmote("😌")
        break
      case "pingpong":
        play(piece, 4200)
        sendEmote("🏓")
        break
      case "arcade": {
        const points = 50 + Math.floor(Math.random() * 20) * 25
        play(piece, 1500, points)
        setScore((best) => Math.max(best, points))
        sendEmote(points >= score ? "🏆" : "🕹️")
        break
      }
      case "lamp":
        edit((old) => old.map((p) => (p.id === piece.id ? { ...p, on: !p.on } : p)))
        break
      case "tv":
        edit((old) => old.map((p) => (p.id === piece.id ? { ...p, on: true } : p)))
        play(piece, 100000, (fx[piece.id]?.n ?? 0) + 1)
        sendEmote("📺")
        break
      case "fish":
        play(piece, 3000)
        sendEmote("🐟")
        break
      case "water":
        play(piece, 600)
        sendEmote("💧")
        break
      case "snack":
        play(piece, 600)
        sendEmote(["🍫", "🥤", "🍪", "🍩"][Math.floor(Math.random() * 4)]!)
        break
      case "doodle":
        play(piece, 600)
        sendEmote("✏️")
        break
      case "read":
        setShelf(true)
        break
      case "plant":
        play(piece, 600)
        sendEmote("🌱")
        break
    }
  }

  // Everything you can walk up to.
  const verbOf = (piece: Piece) => {
    const kind = KIND[piece.kind]
    if (piece.kind === "lamp") return piece.on ? "Switch the lamp off" : "Switch the lamp on"
    if (piece.kind === "arcade" && score) return `${kind?.verb ?? "Play"}  ·  best ${score}`
    return kind?.verb ?? kind?.label ?? piece.kind
  }
  const spots: Spot[] = [
    ...desks.map((d) => ({ key: `desk:${d.key}`, at: deskSpot(d.at), label: `Sit at ${deskTitle(d.seat)}`, prompt: { x: d.at.x + CELL_W / 2, y: d.at.y - 34 }, use: () => sit(d.seat) })),
    ...freeDesks.map((d) => ({ key: `free:${d.pod.session.workspace_id}`, at: deskSpot(d.at), label: "Set up a new desk", prompt: { x: d.at.x + CELL_W / 2, y: d.at.y - 14 }, use: () => newDesk(d.pod) })),
    ...room.props.map((prop) => ({
      key: `prop:${prop.id}`,
      at: propSpot(prop),
      label: prop.id === "shelf" ? "Browse the bookshelf" : prop.id === "coffee" ? "Coffee & settings" : "Go to another session",
      prompt: { x: prop.x + prop.w / 2, y: prop.y - 26 },
      use: () => useProp(prop),
    })),
    ...pieces
      .filter((piece) => KIND[piece.kind]?.use)
      .map((piece) => {
        const at = placeOf(piece, room)
        return { key: `piece:${piece.id}`, at: spotOf(piece, room), label: verbOf(piece), prompt: { x: at.x + at.w / 2, y: at.y - 32 }, use: () => usePiece(piece) }
      }),
  ]
  const spotsRef = useRef(spots)
  spotsRef.current = spots
  const nearKey = useSyncExternalStore(g.subscribe, () => {
    let best = ""
    let far = REACH
    for (const spot of spotsRef.current) {
      const d = Math.hypot(g.you.at.x - spot.at.x, g.you.at.y - spot.at.y)
      if (d <= far) {
        far = d
        best = spot.key
      }
    }
    return best
  })
  const nearSpot = spots.find((spot) => spot.key === nearKey)

  /** Walks you to a spot and uses it there — at once when you are already there. */
  const goUse = (spot: Spot | undefined) => {
    if (!spot) return
    if (near(g.you.at, spot.at, REACH)) spot.use()
    else if (!g.walkTo(spot.at, () => spot.use())) spot.use()
  }
  const floorAt = (event: any): Pt => ({ x: (event?.x ?? 0) - origin.current.x, y: (event?.y ?? 0) - origin.current.y + g.cam })
  const overlay = !!(sitting || renaming || door)
  const held = holding ? KIND[holding] : undefined
  const place = (at: Pt) => {
    if (!held) return
    const top = { x: Math.max(0, Math.min(room.width - held.w, at.x - held.w / 2)), y: Math.max(WALL, at.y - held.h / 2) }
    edit((old) => [...old, keepAt({ id: newId(), kind: held.id, ...(held.id === "lamp" ? { on: true } : {}) }, top, room)])
  }
  // A piece dragged in Decorate mode: where it was when the press came, and how far it has gone.
  const pieceDrag = useRef<{ id: string; base: Pt } | null>(null)
  const stopDecorating = () => {
    setDecorating(false)
    setHolding(null)
    setGhost(null)
  }
  const lit = lightNow(light, now)

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", backgroundColor: t["office.floor"], color: t["office.ink"], fontSize: 12, imageRendering: "pixelated" }}>
      {/* The view of the floor: it takes the keys while nothing over it does. */}
      <div
        tabIndex={0}
        onLayout={(event: any) => {
          origin.current = { x: event?.x ?? 0, y: event?.y ?? 0 }
        }}
        onKeyDown={(event: any) => {
          if (overlay) return
          const key = String(event?.key ?? "").toLowerCase()
          if (isWalkKey(key)) {
            event.preventDefault?.()
            g.press(key, !!event?.isHeld)
          } else if (USE_KEYS.has(key)) {
            event.preventDefault?.()
            if (!event?.isHeld && !decorating) nearSpot?.use()
          } else if (/^[1-5]$/.test(key)) sendEmote(EMOTES[Number(key) - 1]!)
          else if (key === "escape") {
            if (holding) {
              setHolding(null)
              setGhost(null)
            } else if (decorating) stopDecorating()
            setShelf(false)
            setMenu(null)
          }
        }}
        onKeyUp={(event: any) => g.release(String(event?.key ?? "").toLowerCase())}
        onBlur={() => g.releaseAll()}
        onScroll={(event: any) => g.scroll(-(event?.deltaY ?? 0) * (event?.precise ? 1 : 24))}
        style={{ position: "absolute", left: 0, top: 0, width: "100%", bottom: HUD, overflow: "hidden", keyboardFocusDim: false }}
      >
        <div key={focus} tabIndex={0} autoFocus style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, keyboardFocusDim: false }} />
        <Camera game={g}>
          <Room
            width={room.width}
            height={room.height}
            floor={floorStyle}
            wall={wallStyle}
            onGround={(event) => {
              setShelf(false)
              setMenu(null)
              g.walkTo(floorAt(event))
            }}
          />
          {room.pods.map((pod) => (
            <Carpet key={pod.session.workspace_id} pod={pod} />
          ))}
          {spares.map((at, i) => (
            <Decor key={`decor${i}`} at={at} index={i} />
          ))}
          {room.props.map((prop) => (
            <PropView key={prop.id} prop={prop} lit={nearKey === `prop:${prop.id}`} onUse={(p) => goUse(spots.find((s) => s.key === `prop:${p.id}`))} />
          ))}
          {pieces.map((piece) => (
            <PieceView
              key={piece.id}
              piece={piece}
              room={room}
              lit={nearKey === `piece:${piece.id}`}
              fx={fx[piece.id]}
              decorating={decorating}
              dragging={dragged === `piece:${piece.id}`}
              onUse={(p) => goUse(spots.find((s) => s.key === `piece:${p.id}`))}
              onRemove={(p) => edit((old) => old.filter((x) => x.id !== p.id))}
              onPress={(p, by, phase) => {
                if (phase === "down") {
                  const at = placeOf(p, room)
                  pieceDrag.current = { id: p.id, base: { x: at.x, y: at.y } }
                } else if (phase === "move" && pieceDrag.current?.id === p.id) {
                  const base = pieceDrag.current.base
                  setDragged(`piece:${p.id}`)
                  edit((old) => old.map((x) => (x.id === p.id ? { ...keepAt(x, { x: base.x + by.x, y: Math.max(WALL, base.y + by.y) }, room), on: x.on } : x)))
                } else {
                  pieceDrag.current = null
                  setDragged(null)
                }
              }}
            />
          ))}
          {freeDesks.map((d) => (
            <FreeDesk key={`free${d.pod.session.workspace_id}`} at={d.at} lit={nearKey === `free:${d.pod.session.workspace_id}`} onUse={() => goUse(spots.find((s) => s.key === `free:${d.pod.session.workspace_id}`))} />
          ))}
          {desks.map((d) => (
            <Desk
              key={d.key}
              seat={d.seat}
              at={d.at}
              dragging={dragged === d.key}
              sitting={sitting === d.seat.tab.tab_id}
              lit={nearKey === `desk:${d.key}`}
              peekLeft={d.at.x + CELL_W + 340 > room.width}
              onDragStart={setDragged}
              onDrag={(key, to) => {
                if (!to) return setDragged(null)
                setMoved((old) => ({ ...old, [key]: clamp(to) }))
              }}
              onUse={(seat) => goUse(spots.find((s) => s.key === `desk:${deskKey(seat)}`))}
              onRename={setRenaming}
              onMenu={(seat, at) => setMenu({ seat, at })}
            />
          ))}
          <Player game={g} look={look % LOOKS} emote={emote} />
          <Lighting
            light={lit}
            room={room}
            lamps={pieces.filter((p) => p.kind === "lamp" && p.on).map((p) => placeOf(p, room))}
            screens={desks.map((d) => ({ x: d.at.x + 88, y: d.at.y + 30 }))}
          />
          {held && ghost ? <Ghost kind={held} at={ghost} /> : null}
          {/* Placing a piece: a layer over the whole floor follows the pointer and puts it down. */}
          {held ? (
            <div
              onMouseMove={(event: any) => setGhost(floorAt(event))}
              // A press puts it down (a right press stops placing): not a click, which a pointer
              // moving the ghost between its press and its release would not make.
              onMouseDown={(event: any) => {
                if ((event?.button ?? 0) === 0) place(floorAt(event))
                else {
                  setHolding(null)
                  setGhost(null)
                }
              }}
              style={{ position: "absolute", left: 0, top: 0, width: room.width, height: room.height, zIndex: 39000, cursor: "crosshair", pointerEvents: "auto", backgroundColor: "#00000001" }}
            />
          ) : null}
          {nearSpot && !overlay && !dragged && !decorating ? <Prompt x={nearSpot.prompt.x} y={nearSpot.prompt.y} label={nearSpot.label} /> : null}
        </Camera>
        {/* How to play, until you have walked somewhere. */}
        {!kept && !decorating ? (
          <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 8, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 10, backgroundColor: "#1d1f2bd9", zIndex: 44 }}>
            <Key>WASD</Key>
            <text style={{ fontSize: 11, color: "#e9eaf2", paddingRight: 4 }}>walk</text>
            <Key>X</Key>
            <text style={{ fontSize: 11, color: "#e9eaf2", paddingRight: 4 }}>use</text>
            <Key>1–5</Key>
            <text style={{ fontSize: 11, color: "#e9eaf2" }}>emote</text>
          </div>
        ) : null}
      </div>
      <Minimap game={g} room={room} onWalk={(at) => g.walkTo(at)} />
      {decorating ? (
        <BuildPanel
          holding={holding}
          floor={floorStyle}
          wall={wallStyle}
          light={light}
          onHold={(kind) => {
            setHolding(kind)
            if (!kind) setGhost(null)
            setFocus((n) => n + 1)
          }}
          onFloor={setFloorStyle}
          onWall={setWallStyle}
          onLight={setLight}
          onReset={() => setStored(null)}
          onClear={() => setStored([])}
          onClose={stopDecorating}
        />
      ) : null}
      <Hud
        shelf={shelf}
        look={look % LOOKS}
        decorating={decorating}
        onShelf={() => setShelf((v) => !v)}
        onLook={() => setLook((n) => (n + 1) % LOOKS)}
        onEmote={(index) => sendEmote(EMOTES[index]!)}
        onDecorate={() => (decorating ? stopDecorating() : setDecorating(true))}
      />
      {shelf ? <Shelf close={() => setShelf(false)} /> : null}
      {sitting ? <Monitor tab={sitting} onStand={stand} /> : null}
      {renaming ? (
        <Rename
          seat={renaming}
          onClose={() => {
            setRenaming(null)
            setFocus((n) => n + 1)
          }}
        />
      ) : null}
      {door ? (
        <Door
          onClose={() => {
            setDoor(false)
            setFocus((n) => n + 1)
          }}
        />
      ) : null}
      {menu ? (
        <DeskMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={[
            { label: "Sit here", icon: "terminal", run: () => goUse(spots.find((s) => s.key === `desk:${deskKey(menu.seat)}`)) },
            { label: "Rename…", icon: "code", run: () => setRenaming(menu.seat) },
            ...(moved[deskKey(menu.seat)]
              ? [
                  {
                    label: "Put back",
                    icon: "rotate_ccw",
                    run: () =>
                      setMoved((old) => {
                        const next = { ...old }
                        delete next[deskKey(menu.seat)]
                        return next
                      }),
                  },
                ]
              : []),
            { label: "Close desk", icon: "close", danger: true, run: () => call("tab.close", num(menu.seat.tab.tab_id)).catch(swallow) },
          ]}
        />
      ) : null}
    </div>
  )
}

/** Nothing to draw yet: the server is starting. */
export function Starting({ title, detail }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#efe3cf" }}>
      <text style={{ fontSize: 14, color: "#2b2d42" }}>{title}</text>
      <text style={{ fontSize: 12, color: "#6b6f80" }}>{detail}</text>
    </div>
  )
}

export type { You }
