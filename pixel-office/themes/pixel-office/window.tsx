// Pixel Office: pumi as a pixel office you walk around. Every session is a carpeted
// room on the floor with its name on a plate, and every view in it is a desk — or, with "One desk
// per tab" on, every tab — whose little screen shows the tab in front of it, live, its agent
// sitting at it with a bubble that says what it is doing. The whole app is in the room at once.
//
// It plays like a game: arrow keys or WASD walk you (brisk; you slide along what you bump into), a
// click walks you there in a moment, and walking up to something lights it and says which key uses
// it — X (or E, Enter, Space) sits you at a desk and opens its monitor with the real views, opens
// the lobby, pours a coffee (Settings) or opens the door to your sessions. 1–5 are emotes.
//
// The plugins are all here: the lobby down the left (⌘B, or the bookshelf) holds the players and
// every plugin's panel on a notice board; the top right the minimap; the bar along the foot their
// status views beside the hotbar; and their overlays, menus (a desk's right click is its view's
// and its tab's menu) and dialogs are the office's pixel boxes.
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Icon, motion, useHover, useNow, useTheme } from "pumi"
import {
  call,
  commands,
  prompt,
  renderComponent,
  useApp,
  useAppearance,
  useComponents,
  useFocusedTab,
  useLayout,
  useLocal,
  useSession,
  useSessions,
  useSidebar,
  useSlot,
  useThemeOption,
  useWindow,
  useWindowSize,
  via,
  windowContext,
  type ActionItem,
  type Session,
  type Tree,
} from "pumi/theme"
import { BuildPanel, Ghost, Lighting, PieceView, WALLS, floorOf, lightNow, type Fx, type Light } from "./build.tsx"
import { KIND, bodyOf, keepAt, newId, placeOf, seatOf, spotOf, starter, type Piece } from "./furniture.ts"
import { Game, isWalkKey, near, type You } from "./game.ts"
import { Bubble, Cursor, FONT, Keycap, LOOKS, Nametag, RoomLabel, Slot, Sprite, WideSlot, art, box, sitArt, useBeat, useFloorArt, walkArt } from "./kit.tsx"
import { Point, RoomContext } from "./parts.tsx"
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
  statusOf,
  type Plan,
  type Pod,
  type Prop,
  type Pt,
  type Rect,
  type Seat,
} from "./plan.ts"

const deskArt = art("desk")
const chairArt = art("chair")
const cupArt = art("cup")
const plantArt = art("decor/plant")
const shelfArt = art("shelf")
const coffeeArt = art("coffee")
const matArt = art("mat")

const swallow = (err: unknown) => console.error(String(err))
/** How close you stand to something to use it. */
const REACH = 48
/** The emotes, on 1–5. */
const EMOTES = ["👋", "❤️", "😂", "🎉", "👍"]
/** The keys that use what you stand by. */
const USE_KEYS = new Set(["x", "e", "enter", "space"])
/** How far a press may wander before it is a drag. */
const DRAG_SLOP = 4
const OFFICE = "pumi_dev/pixel-office"

/** "Press X to …", over what you stand by: a framed box that fades in, then bobs. */
function Prompt({ x, y, label }: { x: number; y: number; label: string }) {
  const t = useTheme()
  const bob = useBeat(450) % 2
  return (
    <div
      style={{ position: "absolute", left: x - 130, top: y - bob * 2, width: 260, zIndex: 40000, pointerEvents: "none", display: "flex", flexDirection: "row", justifyContent: "center" }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 5, paddingRight: 9, height: 30, ...box(t, "dialog") }}>
        <Keycap>X</Keycap>
        <text style={{ fontSize: 14, color: t.text, whiteSpace: "nowrap" }}>{label}</text>
      </div>
    </div>
  )
}

// ── The room ────────────────────────────────────────────────────────────────────────────────

/** The floor, the wall and the plants: what never moves (but for the floor and paint you chose). */
function Room({ width, height, floor, wall, onGround }: { width: number; height: number; floor: string; wall: string; onGround(event: any): void }) {
  const t = useTheme()
  const f = floorOf(floor, useAppearance())
  const w = WALLS.find((x) => x.id === wall) ?? WALLS[0]!
  const plant = (left: number) => <Sprite key={left} src={plantArt} width={36} height={48} style={{ position: "absolute", left, top: height - 56, zIndex: height, pointerEvents: "none" }} />
  return (
    <>
      {/* The ground: a click on it walks you there (what stands on it takes its own clicks). */}
      <div onClick={onGround} style={{ position: "absolute", left: 0, top: 0, width, height, backgroundColor: t["office.floor"], backgroundImage: { src: f.src, repeat: "repeat", size: f.size }, imageRendering: "pixelated" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width, height: WALL, backgroundImage: { src: w.src, repeat: "repeat-x", size: [64, 56] }, imageRendering: "pixelated", zIndex: 1, pointerEvents: "none" }} />
      {/* The skirting board along the foot of the wall. */}
      <div style={{ position: "absolute", left: 0, top: WALL, width, height: 4, backgroundColor: t.drop, zIndex: 1, pointerEvents: "none" }} />
      {[6, 46, width - 42, width - 82].map(plant)}
    </>
  )
}

/** A session's room: a carpet with a rim, and its name on the plate over its top edge. */
function Carpet({ pod }: { pod: Pod }) {
  const t = useTheme()
  const here = useSession()
  const window = useWindow()
  const carpet = useFloorArt("carpet")
  const current = pod.session.workspace_id === here?.workspace_id
  const status = pod.session.agent_status
  const dot = status ? (t[`agent.${status}`] ?? t["agent.unknown"]) : t.success
  return (
    <div style={{ position: "absolute", left: pod.x, top: pod.y, width: pod.width, height: pod.height, zIndex: 2, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 30,
          width: pod.width,
          height: pod.height - 30,
          borderRadius: 3,
          borderWidth: 2,
          borderColor: current ? t.roomRing : t.roomRim,
          backgroundColor: t.carpetFloor,
          backgroundImage: { src: carpet.src, repeat: "repeat", size: carpet.size },
          imageRendering: "pixelated",
          boxShadow: { offsetX: 0, offsetY: 3, blurRadius: 0, spreadRadius: 0, color: t.drop },
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "absolute", left: 12, top: 18, display: "flex", flexDirection: "row" }}>
        <RoomLabel
          dot={dot}
          count={pod.seats.length}
          active={current}
          title={current ? pod.session.label : `${pod.session.label} — make it the session in front`}
          onClick={() => {
            if (!current) window.show(pod.session.workspace_id)
          }}
        >
          {pod.session.label || "Session"}
        </RoomLabel>
      </div>
    </div>
  )
}

/** What stands where a pod has room to spare, in the same order each time. */
const DECOR = [
  { src: plantArt, w: 36, h: 48, top: 46 },
  { src: coffeeArt, w: 32, h: 48, top: 46 },
  { src: art("decor/aquarium"), w: 68, h: 60, top: 40 },
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

/** The bookshelf (the lobby), the coffee machine (Settings) and the door mat: lit when you stand by them. */
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
      animate={{ y: over || lit ? -2 : 0 }}
      transition={{ duration: 0.12 }}
      style={{ position: "absolute", left: prop.x, top: prop.y, width: prop.w, height: prop.h, cursor: "pointer", zIndex: prop.id === "door" ? 3 : prop.y + prop.h }}
    >
      <Sprite src={src} width={prop.w} height={prop.h} style={lit ? { outlineWidth: 2, outlineColor: t.slotActive, outlineOffset: 2, borderRadius: 2 } : undefined} />
      {over && !lit ? (
        <div style={{ position: "absolute", left: prop.w / 2 - 60, top: -24, width: 120, display: "flex", flexDirection: "row", justifyContent: "center" }}>
          <Nametag>{prop.label}</Nametag>
        </div>
      ) : null}
    </motion.div>
  )
}

// ── Desks ───────────────────────────────────────────────────────────────────────────────────

const viewTitle = (seat: Seat) => (seat.view.label && !/^\d+$/.test(seat.view.label) ? seat.view.label : `Desk ${seat.view.number}`)

/** What a desk is called: its tab's name when it is a tab's desk, else its view's. */
function deskTitle(seat: Seat): string {
  const tab = seat.tab
  if (!tab) return viewTitle(seat)
  if (tab.label) return tab.label
  if (tab.terminal_title) return tab.terminal_title
  const cwd = tab.cwd?.replace(/\/+$/, "")
  return cwd ? cwd.split("/").pop() || "/" : `${viewTitle(seat)} · ${seat.i}`
}

/** What an agent's name tag says: its tab's title as the tab bar has it (what the agent calls its
 *  session, `π - Fixing the build - pumi`), else the tab's name, else the agent's own (`pi`). */
function agentName(tab: { terminal_title?: string | null; label?: string | null; agent?: string | null }): string {
  return tab.terminal_title || tab.label || tab.agent || ""
}

/** A tab's screen in its box, scaled: one pane of the layout's insides. */
function TabScreen({ tab }: { tab: string }) {
  const t = useTheme()
  return (
    <div style={{ display: "flex", flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "hidden", borderRadius: 2, backgroundColor: t.editor }}>
      <preview tab={tab} style={{ width: "100%", height: "100%" }} />
    </div>
  )
}

/** A view's panes as its layout splits them, each its front tab's live screen: the big screen's insides. */
function ScreenTree({ tree }: { tree: Tree }) {
  if ("pane" in tree) {
    const front = tree.active ?? tree.tabs[0]
    return front ? <TabScreen tab={front} /> : null
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
  const tree = useLayout(seat.view.view_id)
  const tabs = useApp((s) => s.snapshot?.tabs.filter((x) => x.view_id === seat.view.view_id) ?? [])
  const status = statusOf(seat, tabs)
  const colour = status ? (t[`agent.${status}`] ?? t["agent.unknown"]) : undefined
  return (
    <div
      style={{
        position: "absolute",
        left: left ? -346 : CELL_W - 6,
        top: -24,
        width: 340,
        height: 220,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: 7,
        ...box(t, "dialog"),
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 18, flexShrink: 0, paddingLeft: 2 }}>
        {colour ? <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colour }} /> : null}
        <text style={{ fontSize: 14, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{deskTitle(seat)}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap" }}>{status || "idle"}</text>
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0, overflow: "hidden", padding: 2, borderRadius: 3, backgroundColor: t.editor, borderWidth: 5, borderColor: t.monitorBezel }}>
        {seat.tab ? <TabScreen tab={seat.tab.tab_id} /> : tree ? <ScreenTree tree={tree} /> : null}
      </div>
    </div>
  )
}

interface DeskHandlers {
  dragStart(key: string): void
  drag(key: string, to: Pt | null): void
  use(seat: Seat): void
  rename(seat: Seat): void
  menu(seat: Seat, at: Pt): void
}

interface DeskProps {
  seat: Seat
  at: Pt
  dragging: boolean
  sitting: boolean
  lit: boolean
  peekLeft: boolean
  on: DeskHandlers
}

/**
 * A desk: its sprite, its live little screen, the chair and the agent at it, the cups of a split
 * view, the bubble and the name tag. Pressed and dragged it moves; clicked, you walk over and sit;
 * walked up to (or pointed at) its screen opens big beside it.
 */
const Desk = memo(function Desk({ seat, at, dragging, sitting, lit, peekLeft, on }: DeskProps) {
  const t = useTheme()
  const key = deskKey(seat)
  const focused = useFocusedTab(seat.view.view_id)
  const tabs = useApp((s) => s.snapshot?.tabs.filter((x) => x.view_id === seat.view.view_id) ?? [])
  const shown = seat.tab?.tab_id ?? focused ?? tabs[0]?.tab_id
  const status = statusOf(seat, tabs)
  const agentTab = seat.tab ?? tabs.find((x) => x.agent_status === status && status) ?? tabs.find((x) => x.agent || x.agent_status)
  const busy = !!(agentTab && (agentTab.agent || agentTab.agent_status))
  const title = deskTitle(seat)
  const agent = (agentTab && agentName(agentTab)) || title
  const working = status === "working"
  const alarmed = status === "blocked" || status === "error"
  const bob = useBeat(working ? 300 : 450, busy && (working || alarmed)) % 2
  const colour = t[`agent.${status || "unknown"}`] ?? t["agent.unknown"]
  const [over, hover] = useHover(350)
  const press = useRef<{ x: number; y: number; base: Pt; moved: boolean } | null>(null)
  const ring = sitting ? t.slotActive : alarmed ? t["office.blocked"] : status === "done" ? t["office.done"] : "#00000000"
  return (
    <motion.div
      {...hover}
      animate={{ y: (over || lit) && !dragging ? -2 : 0 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
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
      {lit ? <div style={{ position: "absolute", left: DESK_ART.x - 4, top: DESK_ART.y - 4, width: DESK_ART.w + 8, height: DESK_ART.h + 8, borderRadius: 3, borderWidth: 2, borderColor: t.slotActive }} /> : null}
      <Sprite src={deskArt} width={DESK_ART.w} height={DESK_ART.h} style={{ position: "absolute", left: DESK_ART.x, top: DESK_ART.y }} />
      {/* The little screen: the view's front tab, live; it flickers while its agent works. */}
      <div style={{ position: "absolute", left: 68, top: 16, width: 40, height: 22, overflow: "hidden", backgroundColor: t.monitorBezel, borderWidth: 1, borderColor: ring }}>
        {shown ? <preview tab={shown} style={{ width: "100%", height: "100%" }} /> : null}
        {working ? (
          <motion.div
            animate={{ opacity: [0, 0.3, 0.05, 0.25, 0] }}
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
      {/* A cup for each tab past the first: a view you have split. */}
      {seat.tab ? null : tabs.slice(1, 5).map((_, index) => <Sprite key={index} src={cupArt} width={12} height={10} style={{ position: "absolute", left: 44 + index * 13, top: 26 }} />)}
      <Sprite src={chairArt} width={28} height={24} style={{ position: "absolute", left: 74, top: 72 }} />
      {/* The agent, back to us at its screen: typing while it works, fidgeting while it waits. */}
      {busy ? <Sprite src={sitArt(key)} width={24} height={24} style={{ position: "absolute", left: 76 + (alarmed ? bob * 2 - 1 : 0), top: 66 + (working ? bob : 0) }} /> : null}
      {busy ? <Bubble status={status} style={{ position: "absolute", left: 98, top: 44 - (alarmed ? bob * 2 : 0) }} /> : null}
      <div style={{ position: "absolute", left: 0, top: 100, width: CELL_W, display: "flex", flexDirection: "row", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "row", maxWidth: 164 }}>
          <Nametag dot={busy ? colour : undefined} dim={!busy && !sitting} active={sitting}>
            {busy ? agent : title}
          </Nametag>
        </div>
      </div>
      {/* The surface a press lands on, over the sprites and the live screen, which would take the
          hit themselves: a drag moves the desk, a click walks you to it. */}
      <div
        title={busy && agent !== title ? `${agent} — ${title}` : title}
        onMouseDown={(event: any) => {
          press.current = { x: event?.x ?? 0, y: event?.y ?? 0, base: at, moved: false }
        }}
        onMouseMove={(event: any) => {
          const from = press.current
          if (!from) return
          // The button came up somewhere the release was not heard.
          if (event?.pressedButton !== 0) {
            press.current = null
            on.drag(key, null)
            return
          }
          const dx = (event?.x ?? 0) - from.x
          const dy = (event?.y ?? 0) - from.y
          if (!from.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
          if (!from.moved) {
            from.moved = true
            on.dragStart(key)
          }
          on.drag(key, { x: Math.round(from.base.x + dx), y: Math.round(from.base.y + dy) })
        }}
        onMouseUp={() => {
          if (press.current?.moved) on.drag(key, null)
        }}
        onClick={(event: any) => {
          event?.stopPropagation?.()
          const was = press.current
          press.current = null
          if (was?.moved) return
          on.use(seat)
        }}
        onDoubleClick={(event: any) => {
          event?.stopPropagation?.()
          on.rename(seat)
        }}
        onAuxClick={(event: any) => {
          if (!event?.isRightClick) return
          event?.stopPropagation?.()
          on.menu(seat, { x: event?.x ?? 0, y: event?.y ?? 0 })
        }}
        style={{ position: "absolute", left: 30, top: 0, width: CELL_W - 60, height: 124, cursor: dragging ? "grabbing" : "pointer", zIndex: 5, pointerEvents: "auto" }}
      />
      {(over || lit) && !dragging && !sitting ? <Peek seat={seat} left={peekLeft} /> : null}
    </motion.div>
  )
})

/** The desk a room always has free: walking to it (or a click) makes a new view in its session. */
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
      title="New desk: a new view in this session"
      style={{ position: "absolute", left: at.x, top: at.y, width: CELL_W, height: 130, cursor: "pointer", zIndex: Math.round(at.y + 96), opacity: over || lit ? 1 : 0.6 }}
    >
      {lit ? <div style={{ position: "absolute", left: DESK_ART.x - 4, top: DESK_ART.y - 4, width: DESK_ART.w + 8, height: DESK_ART.h + 8, borderRadius: 3, borderWidth: 2, borderColor: t.slotActive }} /> : null}
      <Sprite src={deskArt} width={DESK_ART.w} height={DESK_ART.h} style={{ position: "absolute", left: DESK_ART.x, top: DESK_ART.y }} />
      <Sprite src={chairArt} width={28} height={24} style={{ position: "absolute", left: 74, top: 72 }} />
      <div style={{ position: "absolute", left: 0, top: 100, width: CELL_W, display: "flex", flexDirection: "row", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 19, paddingLeft: 7, paddingRight: 8, borderRadius: 6, backgroundColor: t.tagDim }}>
          <Icon name="plus" size={10} color={t.tagText} />
          <text style={{ fontSize: 12, color: t.tagText }}>New desk</text>
        </div>
      </div>
    </div>
  )
}

// ── You ─────────────────────────────────────────────────────────────────────────────────────

/** You, on the floor: your look, walking the way you go, your name tag, and the emote you sent. */
function Player({ game, look, emote }: { game: Game; look: number; emote: string | null }) {
  const t = useTheme()
  const you = useSyncExternalStore(game.subscribe, game.get)
  const x = Math.round(you.at.x)
  const y = Math.round(you.at.y)
  return (
    <div style={{ position: "absolute", left: x - 40, top: y - 58, width: 80, height: 58, display: "flex", flexDirection: "column", alignItems: "center", zIndex: y, pointerEvents: "none" }}>
      {emote ? (
        <motion.div
          key={emote}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: [0, -6, -4] }}
          transition={{ duration: 0.35, ease: "backOut" }}
          style={{ position: "absolute", top: -32, width: 32, height: 28, alignItems: "center", justifyContent: "center", ...box(t, "dialog") }}
        >
          <text style={{ fontSize: 14 }}>{emote}</text>
        </motion.div>
      ) : null}
      <Nametag dot={t["office.online"]}>You</Nametag>
      {/* A shadow under your feet, and you. */}
      <div style={{ position: "absolute", top: 53, width: 18, height: 6, borderRadius: 3, backgroundColor: t.drop }} />
      <Sprite src={walkArt(look, you.facing, you.frame)} width={24} height={34} style={{ marginTop: 3 }} />
    </div>
  )
}

/** The floor, where the camera is: it follows you as you walk, and the wheel looks around. */
function Camera({ game, children }: { game: Game; children: ReactNode }) {
  useSyncExternalStore(game.subscribe, () => game.cam)
  return <div style={{ position: "absolute", left: 0, top: -game.cam, width: "100%", height: game.size.height, pointerEvents: "none" }}>{children}</div>
}

/** The floor from above, in a framed box: the rooms, the desks by how they are, you blinking. */
function Minimap({ game, room, onWalk }: { game: Game; room: Plan; onWalk(at: Pt): void }) {
  const t = useTheme()
  const you = useSyncExternalStore(game.subscribe, game.get)
  const cam = useSyncExternalStore(game.subscribe, () => game.cam)
  const blink = useBeat(450) % 2 === 0
  const tabs = useApp((s) => s.snapshot?.tabs ?? [])
  const W = 140
  const k = W / room.width
  const H = Math.max(40, Math.min(120, Math.round(room.height * k)))
  return (
    <div onClick={(event: any) => event?.stopPropagation?.()} style={{ display: "flex", flexShrink: 0, padding: 4, ...box(t, "panel") }}>
      <div style={{ position: "relative", width: W, height: H, overflow: "hidden", backgroundColor: t["office.floor"], borderWidth: 1, borderColor: t.roomRim }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: WALL * k, backgroundColor: t.slot }} />
        {room.pods.map((pod) => (
          <div key={pod.session.workspace_id} style={{ position: "absolute", left: pod.x * k, top: (pod.y + 30) * k, width: pod.width * k, height: (pod.height - 30) * k, backgroundColor: t.carpetFloor }} />
        ))}
        {room.pods.flatMap((pod) =>
          pod.seats.map((seat, i) => {
            const status = statusOf(seat, tabs)
            const cell = pod.cells[i]!
            return (
              <div
                key={deskKey(seat)}
                onClick={() => onWalk(deskSpot(cell))}
                style={{ position: "absolute", left: (cell.x + DESK_ART.x) * k, top: (cell.y + DESK_ART.y) * k, width: Math.max(3, DESK_ART.w * k), height: Math.max(2, DESK_ART.h * k), backgroundColor: status ? (t[`agent.${status}`] ?? t.desk) : t.desk, cursor: "pointer" }}
              />
            )
          }),
        )}
        <div style={{ position: "absolute", left: 0, top: cam * k, width: W, height: game.view * k, borderWidth: 1, borderColor: t.rim }} />
        <div style={{ position: "absolute", left: you.at.x * k - 3, top: you.at.y * k - 5, width: 5, height: 5, backgroundColor: blink ? t.success : t.rim }} />
      </div>
    </div>
  )
}

// ── What opens over the room ───────────────────────────────────────────────────────────────

/**
 * The monitor: the desk you sat down at: the screen in its bezel with the real
 * views in it, the keyboard, the mug and a sticky note under it. A tab's own desk shows that
 * tab, or (a press on "Whole view") its whole view.
 */
function Monitor({ seat, onStand }: { seat: Seat; onStand(): void }) {
  const t = useTheme()
  const C = useComponents()
  const view = seat.view.view_id
  const tabs = useApp((s) => s.snapshot?.tabs.filter((x) => x.view_id === view) ?? [])
  const [whole, setWhole] = useState(false)
  const one = seat.tab && !whole ? seat.tab.tab_id : undefined
  const status = statusOf(seat, tabs)
  return (
    <div
      onClick={onStand}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: HUD, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: t.scrim, zIndex: 50 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        onClick={(event: any) => event?.stopPropagation?.()}
        style={{ display: "flex", flexDirection: "column", width: "92%", height: "90%", padding: 10, paddingBottom: 6, borderRadius: 5, backgroundColor: t.desk, borderWidth: 2, borderColor: t.deskFocus, boxShadow: [{ offsetX: 0, offsetY: 5, blurRadius: 0, spreadRadius: 0, color: t.deskEdge }, { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: 0, color: "#00000055" }] }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 34, flexShrink: 0, paddingBottom: 6 }}>
          <Nametag dot={status ? (t[`agent.${status}`] ?? t["agent.unknown"]) : t["office.online"]} size={13}>
            {deskTitle(seat)}
          </Nametag>
          <text style={{ fontSize: 12, color: t.muted }}>{one ? `tab ${seat.i} of ${viewTitle(seat)}` : `${tabs.length} tab${tabs.length === 1 ? "" : "s"}`}</text>
          <div style={{ flexGrow: 1 }} />
          {seat.tab && tabs.length > 1 ? <WideSlot icon="layout_panel_left" label={whole ? "This tab" : "Whole view"} onClick={() => setWhole((v) => !v)} active={whole} /> : null}
          <WideSlot icon="arrow_left" label="Stand up" onClick={onStand} />
        </div>
        <div style={{ display: "flex", flexGrow: 1, minHeight: 0, overflow: "hidden", borderRadius: 4, backgroundColor: t.editor, borderWidth: 6, borderColor: t.monitorBezel }}>
          {one ? <C.TabBody tab={one} focused /> : <C.Layout view={view} />}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 24, flexShrink: 0, paddingTop: 4 }}>
          <Sprite src={art("decor/mug")} width={18} height={14} />
          <Sprite src={art("decor/keyboard")} width={60} height={18} />
          <Sprite src={art("decor/sticky")} width={18} height={18} />
          <div style={{ flexGrow: 1 }} />
          <Point point="tab.toolbar" args={{ tab: one ?? tabs[0]?.tab_id }} />
        </div>
      </motion.div>
    </div>
  )
}

/** A framed dialog in the middle of the room: the door's sessions. */
function Box({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const t = useTheme()
  return (
    <div onClick={onClose} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: HUD, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: t.scrim, zIndex: 70 }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 560, damping: 34 }}
        onClick={(event: any) => event?.stopPropagation?.()}
        style={{ display: "flex", flexDirection: "column", gap: 10, width: 380, padding: 14, ...box(t, "dialog") }}
      >
        <text style={{ fontSize: 17, color: t.text }}>{title}</text>
        {children}
      </motion.div>
    </div>
  )
}

/** Choices, as a game lists them: the one you're on gets the pointing hand. */
function Choices({ items }: { items: { key: string; label: string; detail?: string; dot?: string; run(): void }[] }) {
  const t = useTheme()
  const [at, setAt] = useState(-1)
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((item, i) => (
        <div
          key={item.key}
          onMouseEnter={() => setAt(i)}
          onClick={item.run}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingLeft: 4, paddingRight: 10, cursor: "pointer", backgroundColor: i === at ? t.selected : undefined }}
        >
          <Cursor on={i === at} />
          {item.dot ? <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: item.dot }} /> : null}
          <text style={{ fontSize: 14, color: t.text, flexGrow: 1 }}>{item.label}</text>
          {item.detail ? <text style={{ fontSize: 12, color: t.muted }}>{item.detail}</text> : null}
        </div>
      ))}
    </div>
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
    <Box title="Where to?" onClose={onClose}>
      <Choices
        items={[
          ...sessions.map((session) => ({
            key: session.workspace_id,
            label: session.label || session.workspace_id,
            detail: session.workspace_id === here?.workspace_id ? "you are here" : undefined,
            dot: session.agent_status ? (t[`agent.${session.agent_status}`] ?? t["agent.unknown"]) : t["agent.unknown"],
            run: () => go(session),
          })),
          {
            key: "new",
            label: "New session",
            run: () => {
              const context = windowContext(window.id)
              if (context) commands.run("new_workspace", context)
              onClose()
            },
          },
        ]}
      />
    </Box>
  )
}

/** A desk's menu where it was right-clicked: the office's own, then its view's and its tab's (the app's and the plugins'). */
function DeskMenu({ seat, at, own, onClose }: { seat: Seat; at: Pt; own: ActionItem[]; onClose(): void }) {
  const C = useComponents()
  const tab = seat.tab
  const view = useSlot("view.menu", { view: seat.view.view_id })
  const onTab = useSlot(tab ? "tab.menu" : "", tab ? { tab: tab.tab_id } : undefined)
  const actions = [...own, ...view.actions.map((a) => ({ ...a, group: `view:${a.group ?? ""}` })), ...(tab ? onTab.actions.map((a) => ({ ...a, group: `tab:${a.group ?? ""}` })) : [])]
  return <C.Menu at={at} actions={actions} components={[...view.components, ...(tab ? onTab.components : [])]} args={{ view: seat.view.view_id, tab: tab?.tab_id }} close={onClose} />
}

// ── The lobby ───────────────────────────────────────────────────────────────────────────────

/** The lobby down the left, on tiles: the players and every plugin's panel (`C.Panel`). */
function Lobby({ width, setWidth }: { width: number; setWidth(w: number): void }) {
  const t = useTheme()
  const C = useComponents()
  const tile = useFloorArt("tile")
  const [from, setFrom] = useState<{ x: number; width: number } | undefined>()
  return (
    <div style={{ display: "flex", flexDirection: "column", width, flexShrink: 0, paddingLeft: 10, paddingBottom: 6 }}>
      {/* Over the lobby, the window's top edge: a press and a move there moves the window. */}
      <div style={{ height: 36, flexShrink: 0, appRegion: "drag" }} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, position: "relative", backgroundColor: t.tileFloor, backgroundImage: { src: tile.src, repeat: "repeat", size: tile.size }, borderWidth: 2, borderColor: t.roomRim, borderRadius: 3, boxShadow: { offsetX: 0, offsetY: 3, blurRadius: 0, spreadRadius: 0, color: t.drop } }}>
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", height: 34, alignItems: "center", flexShrink: 0 }}>
          <RoomLabel>Lobby</RoomLabel>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
          <C.Panel point="panel" />
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 4, height: 60, flexShrink: 0, paddingBottom: 4, pointerEvents: "none" }}>
          <Sprite src={plantArt} width={36} height={48} />
          <Sprite src={art("decor/sofa")} width={80} height={44} />
          <Sprite src={plantArt} width={36} height={48} />
        </div>
        {/* Its wall: drag it to size the lobby. */}
        <div
          onMouseDown={(e: any) => setFrom({ x: e.x ?? 0, width })}
          onMouseMove={(e: any) => {
            if (!from) return
            if (e?.pressedButton !== 0) return setFrom(undefined)
            setWidth(Math.min(560, Math.max(190, from.width + (e.x ?? 0) - from.x)))
          }}
          onMouseUp={() => setFrom(undefined)}
          style={{ position: "absolute", top: 0, right: -6, width: 10, height: "100%", cursor: "col-resize", hover: { backgroundColor: `${t.slotActive}66` } }}
        />
      </div>
    </div>
  )
}

// ── The bar ─────────────────────────────────────────────────────────────────────────────────

/**
 * The bar along the foot, on the floor: your player card, the hotbar (new desk, decorate, the
 * lobby, settings, one desk per tab, the emotes), and the tray — the agents' counts and the
 * clock.
 */
function Hud({ lobby, look, decorating, onLobby, onLook, onEmote, onDecorate, onAgent }: { lobby: boolean; look: number; decorating: boolean; onLobby(): void; onLook(): void; onEmote(index: number): void; onDecorate(): void; onAgent(tab: string): void }) {
  const t = useTheme()
  const window = useWindow()
  const session = useSession()
  const now = useNow(15000)
  const perTab = useThemeOption<boolean>("desk_per_tab", false)
  const agents = useApp((s) => s.snapshot?.tabs.filter((p) => p.agent) ?? [])
  const count = (status: string) => agents.filter((a) => a.agent_status === status).length
  const run = (name: string) => {
    const context = windowContext(window.id)
    if (context) commands.run(name, context)
  }
  return (
    <div
      onClick={(event: any) => event?.stopPropagation?.()}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: HUD, flexShrink: 0, paddingLeft: 10, paddingRight: 10, zIndex: 60 }}
    >
      <div onClick={onLook} title="Change your look" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 46, paddingLeft: 4, paddingRight: 10, flexShrink: 1, minWidth: 0, maxWidth: 240, cursor: "pointer", ...box(t, "panel"), hover: { backgroundColor: t.hover } }}>
        <div style={{ position: "relative", width: 36, height: 36, flexShrink: 0, overflow: "hidden", ...box(t, "slot") }}>
          <Sprite src={walkArt(look, "down", 0)} width={24} height={34} style={{ position: "absolute", left: 4, top: 3 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flexShrink: 1 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5 }}>
            <text style={{ fontSize: 15, color: t.text }}>You</text>
            <div style={{ width: 6, height: 6, backgroundColor: t["office.online"], flexShrink: 0 }} />
          </div>
          <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{session?.label ?? "no session"}</text>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, padding: 4, flexShrink: 1, minWidth: 0, overflowX: "scroll", ...box(t, "panel") }}>
          <WideSlot icon="plus" label="New desk" onClick={() => run("new_view")} />
          <Slot icon="sparkle" label="Decorate" active={decorating} onClick={onDecorate} />
          <Slot icon="layout_sidebar_left" label="Lobby: the players and the plugins' panels (⌘B)" active={lobby} onClick={onLobby} />
          <Slot icon="blocks" label={`One desk per tab: ${perTab ? "on" : "off"}`} active={perTab === true} onClick={() => call("option.set", "pumi_dev.pixel_office.desk_per_tab", !perTab, { scope: "plugin", plugin: OFFICE }).catch(swallow)} />
          <Slot icon="settings" label="Settings" onClick={() => run("settings")} />
          <div style={{ width: 2, height: 30, marginLeft: 2, marginRight: 2, backgroundColor: t.slotRing, flexShrink: 0 }} />
          {EMOTES.map((emote, index) => (
            <Slot key={emote} glyph={emote} number={`${index + 1}`} label={`${emote}  (${index + 1})`} onClick={() => onEmote(index)} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, flexShrink: 1, minWidth: 0 }}>
        {["working", "blocked"].map((status) =>
          count(status) ? (
            <div
              key={status}
              title={status === "blocked" ? "Walk to the one waiting for you" : "Walk to one at work"}
              onClick={() => {
                const next = agents.find((a) => a.agent_status === status)
                if (next) onAgent(next.tab_id)
              }}
              style={{ display: "flex", flexDirection: "row", cursor: "pointer", flexShrink: 0 }}
            >
              <Nametag dot={t[`agent.${status}`]}>{`${count(status)} ${status}`}</Nametag>
            </div>
          ) : null,
        )}
        <div style={{ display: "flex", alignItems: "center", height: 30, paddingLeft: 10, paddingRight: 10, flexShrink: 0, ...box(t, "panel") }}>
          <text style={{ fontSize: 14, color: t.text }}>{new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</text>
        </div>
      </div>
    </div>
  )
}

/** Over the floor's top: the session's plate (a press lists the others), the minimap. */
function TopHud({ left, onDoor, minimap }: { left: number; onDoor(): void; minimap: ReactNode }) {
  const t = useTheme()
  const session = useSession()
  return (
    <>
      <div
        onClick={(event: any) => {
          event?.stopPropagation?.()
          onDoor()
        }}
        title="Your sessions"
        style={{ position: "absolute", left, top: 12, zIndex: 45, display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingLeft: 8, paddingRight: 8, maxWidth: 260, cursor: "pointer", ...box(t, "panel"), hover: { backgroundColor: t.hover } }}
      >
        <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t["office.online"], flexShrink: 0 }} />
        <text style={{ fontSize: 15, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{session?.label || "pumi"}</text>
        <Icon name="chevron_up_down" size={11} color={t.muted} />
      </div>
      <div onClick={(event: any) => event?.stopPropagation?.()} style={{ position: "absolute", right: 10, top: 10, zIndex: 45, display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
        {minimap}
      </div>
    </>
  )
}

// ── The window ──────────────────────────────────────────────────────────────────────────────

/** Something you can walk up to and use, and the place you stand to. */
type Spot = { key: string; at: Pt; label: string; prompt: Pt; use(): void }

export function Office() {
  const t = useTheme()
  const window = useWindow()
  const size = useWindowSize()
  const sessions = useSessions()
  const views = useApp((s) => s.snapshot?.views ?? [])
  const tabs = useApp((s) => s.snapshot?.tabs ?? [])
  const perTab = useThemeOption<boolean>("desk_per_tab", false) === true
  const overlays = useSlot("window.overlay").components
  const wood = useFloorArt("wood")
  const look_ = useAppearance()
  const [lobby, setLobby] = useSidebar()
  const [lobbyWidth, setLobbyWidth] = useLocal<number>("office.lobby.width", 270)
  const [sitting, setSitting] = useState<string | null>(null)
  const [door, setDoor] = useState(false)
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
  const [floorStyle, setFloorStyle] = useLocal<string>("office.floor", "wood")
  const [wallStyle, setWallStyle] = useLocal<string>("office.wall", "classic")
  const [light, setLight] = useLocal<Light>("office.light", "auto")
  const [score, setScore] = useLocal<number>("office.arcade", 0)
  // The floor's box, as it was laid out (until then, the window less the lobby and the bar).
  const [box_, setBox] = useState<{ width: number; height: number } | null>(null)
  const now = useNow(60000)
  const width = Math.max(420, box_?.width ?? size.width - (lobby ? lobbyWidth : 0))
  const view = Math.max(200, box_?.height ?? size.height - HUD)
  // The furniture: what you put down, or the starter lounge until you change it.
  const pieces = useMemo(() => stored ?? starter(width), [stored, width])
  const room = useMemo(() => {
    const first = plan(sessions, views, tabs, width, view, perTab)
    // The floor goes on as far down as the furniture does.
    const lowest = pieces.reduce((end, piece) => {
      const at = placeOf(piece, first)
      return Math.max(end, at.y + at.h)
    }, 0)
    return lowest + 80 > first.height ? plan(sessions, views, tabs, width, view, perTab, lowest) : first
  }, [sessions, views, tabs, width, view, perTab, pieces])
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
  const sat = sitting ? desks.find((d) => d.key === sitting)?.seat : undefined

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
  // The desk you sat at went away (its view closed): you stand up.
  useEffect(() => {
    if (sitting && !sat) setSitting(null)
  }, [sitting, sat])

  const run = (name: string) => {
    const context = windowContext(window.id)
    if (context) commands.run(name, context)
  }
  const sendEmote = (glyph: string) => {
    setEmote(glyph)
    later(2400, () => setEmote((now) => (now === glyph ? null : now)))
  }
  const sit = (seat: Seat, tab?: string) => {
    call(via(seat.view.view_id, "view.focus"), seat.view.view_id).catch(swallow)
    const focus = tab ?? seat.tab?.tab_id
    if (focus) call(via(focus, "tab.focus"), focus).catch(swallow)
    g.stop()
    setDecorating(false)
    setSitting(deskKey(seat))
  }
  const stand = () => {
    setSitting(null)
    setFocus((n) => n + 1)
  }
  const rename = (seat: Seat) => {
    const label = seat.view.label && !/^\d+$/.test(seat.view.label) ? seat.view.label : ""
    prompt({ title: "Rename desk", detail: seat.tab ? `Names its view, ${viewTitle(seat)}` : undefined, value: label, placeholder: "A name for this desk", confirm: "Rename" })
      .then((name) => (name === undefined ? undefined : call(via(seat.view.view_id, "view.update"), seat.view.view_id, { name: name.trim() || null })))
      .catch(swallow)
      .finally(() => setFocus((n) => n + 1))
  }
  const newDesk = (pod: Pod) => call(via(pod.session.workspace_id, "tab.open"), "terminal", {}, { kind: "view", session: pod.session.workspace_id }).catch(swallow)
  const useProp = (prop: Prop) => {
    if (prop.id === "shelf") setLobby((v) => !v)
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
        setLobby(true)
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
    ...desks.map((d) => ({ key: `desk:${d.key}`, at: deskSpot(d.at), label: `Sit at ${deskTitle(d.seat)}`, prompt: { x: d.at.x + CELL_W / 2, y: d.at.y - 36 }, use: () => sit(d.seat) })),
    ...freeDesks.map((d) => ({ key: `free:${d.pod.session.workspace_id}`, at: deskSpot(d.at), label: "Set up a new desk", prompt: { x: d.at.x + CELL_W / 2, y: d.at.y - 16 }, use: () => newDesk(d.pod) })),
    ...room.props.map((prop) => ({
      key: `prop:${prop.id}`,
      at: propSpot(prop),
      label: prop.id === "shelf" ? (lobby ? "Close the lobby" : "Open the lobby (plugins)") : prop.id === "coffee" ? "Coffee & settings" : "Go to another session",
      prompt: { x: prop.x + prop.w / 2, y: prop.y - 30 },
      use: () => useProp(prop),
    })),
    ...pieces
      .filter((piece) => KIND[piece.kind]?.use)
      .map((piece) => {
        const at = placeOf(piece, room)
        return { key: `piece:${piece.id}`, at: spotOf(piece, room), label: verbOf(piece), prompt: { x: at.x + at.w / 2, y: at.y - 34 }, use: () => usePiece(piece) }
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
  const goUse = (spot: Spot | undefined, then?: () => void) => {
    if (!spot) return
    const use = () => {
      spot.use()
      then?.()
    }
    if (near(g.you.at, spot.at, REACH)) use()
    else if (!g.walkTo(spot.at, use)) use()
  }
  /** Walks you to the desk a tab is at and sits you down there, in front of that tab. */
  const visit = (tab: string) => {
    const view = tabs.find((t) => t.tab_id === tab)?.view_id
    const desk = desks.find((d) => d.seat.tab?.tab_id === tab) ?? desks.find((d) => !d.seat.tab && d.seat.view.view_id === view)
    if (!desk) return void call(via(tab, "tab.focus"), tab).catch(swallow)
    setSitting(null)
    const spot = spots.find((s) => s.key === `desk:${desk.key}`)
    goUse(spot && { ...spot, use: () => sit(desk.seat, tab) })
  }
  // The desks' handlers, the same functions each time (so a desk draws again only when it changes),
  // calling what this draw made.
  const latest = useRef({ goUse, spots, rename, setMenu, setDragged, setMoved, clamp })
  latest.current = { goUse, spots, rename, setMenu, setDragged, setMoved, clamp }
  const deskOn = useMemo<DeskHandlers>(
    () => ({
      dragStart: (key) => latest.current.setDragged(key),
      drag: (key, to) => {
        if (!to) return latest.current.setDragged(null)
        latest.current.setMoved((old) => ({ ...old, [key]: latest.current.clamp(to) }))
      },
      use: (seat) => latest.current.goUse(latest.current.spots.find((s) => s.key === `desk:${deskKey(seat)}`)),
      rename: (seat) => latest.current.rename(seat),
      menu: (seat, at) => latest.current.setMenu({ seat, at }),
    }),
    [],
  )
  const latestVisit = useRef(visit)
  latestVisit.current = visit
  const room_ = useMemo(() => ({ visit: (tab: string) => latestVisit.current(tab) }), [])

  const floorAt = (event: any): Pt => ({ x: (event?.x ?? 0) - origin.current.x, y: (event?.y ?? 0) - origin.current.y + g.cam })
  const overlay = !!(sitting || door)
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
  const deskActions = (seat: Seat): ActionItem[] => [
    { id: "sit", title: "Sit here", icon: "terminal", plugin: OFFICE, group: "office", run: () => deskOn.use(seat) },
    { id: "rename", title: "Rename…", icon: "code", plugin: OFFICE, group: "office", run: () => rename(seat) },
    ...(moved[deskKey(seat)]
      ? [
          {
            id: "put-back",
            title: "Put back",
            icon: "rotate_ccw",
            plugin: OFFICE,
            group: "office",
            run: () =>
              setMoved((old) => {
                const next = { ...old }
                delete next[deskKey(seat)]
                return next
              }),
          },
        ]
      : []),
  ]

  return (
    <RoomContext.Provider value={room_}>
      <div style={{ display: "flex", flexDirection: "column", position: "relative", width: "100%", height: "100%", backgroundColor: t.window, backgroundImage: { src: wood.src, repeat: "repeat", size: wood.size }, color: t.text, fontSize: 13, fontFamily: FONT, imageRendering: "pixelated" }}>
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
          {lobby ? <Lobby width={lobbyWidth} setWidth={setLobbyWidth} /> : null}
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0, paddingLeft: lobby ? 10 : 0 }}>
            {/* The view of the floor: it takes the keys while nothing over it does. */}
            <div
              tabIndex={0}
              onLayout={(event: any) => {
                origin.current = { x: event?.x ?? 0, y: event?.y ?? 0 }
                const w = Math.round(event?.width ?? 0)
                const h = Math.round(event?.height ?? 0)
                if (w > 0 && h > 0) setBox((old) => (old && old.width === w && old.height === h ? old : { width: w, height: h }))
              }}
              onKeyDown={(event: any) => {
                if (overlay) {
                  if (String(event?.key ?? "").toLowerCase() === "escape" && door) setDoor(false)
                  return
                }
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
                  setMenu(null)
                }
              }}
              onKeyUp={(event: any) => g.release(String(event?.key ?? "").toLowerCase())}
              onBlur={() => g.releaseAll()}
              onScroll={(event: any) => g.scroll(-(event?.deltaY ?? 0) * (event?.precise ? 1 : 24))}
              style={{ position: "relative", flexGrow: 1, minWidth: 0, overflow: "hidden", keyboardFocusDim: false }}
            >
              <div key={focus} tabIndex={0} autoFocus style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, keyboardFocusDim: false }} />
              <Camera game={g}>
                <Room
                  width={room.width}
                  height={room.height}
                  floor={floorStyle}
                  wall={wallStyle}
                  onGround={(event) => {
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
                  <Desk key={d.key} seat={d.seat} at={d.at} dragging={dragged === d.key} sitting={sitting === d.key} lit={nearKey === `desk:${d.key}`} peekLeft={d.at.x + CELL_W + 340 > room.width} on={deskOn} />
                ))}
                <Player game={g} look={look % LOOKS} emote={emote} />
                <Lighting
                  dark={look_ === "dark"}
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
              {/* The window's top edge moves it, under the plate and the minimap, which keep their presses. */}
              <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: 28, zIndex: 44, appRegion: "drag" }} />
              <TopHud left={lobby ? 10 : 80} onDoor={() => setDoor(true)} minimap={<Minimap game={g} room={room} onWalk={(at) => g.walkTo(at)} />} />
              {/* How to play, until you have walked somewhere. */}
              {!kept && !decorating ? (
                <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 10, height: 34, zIndex: 44, ...box(t, "dialog") }}>
                  <Keycap>WASD</Keycap>
                  <text style={{ fontSize: 13, color: t.text, paddingRight: 4 }}>walk</text>
                  <Keycap>X</Keycap>
                  <text style={{ fontSize: 13, color: t.text, paddingRight: 4 }}>use</text>
                  <Keycap>1–5</Keycap>
                  <text style={{ fontSize: 13, color: t.text, paddingRight: 4 }}>emote</text>
                  <Keycap>⌘B</Keycap>
                  <text style={{ fontSize: 13, color: t.text }}>lobby</text>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <Hud
          lobby={lobby}
          look={look % LOOKS}
          decorating={decorating}
          onLobby={() => setLobby((v) => !v)}
          onLook={() => setLook((n) => (n + 1) % LOOKS)}
          onEmote={(index) => sendEmote(EMOTES[index]!)}
          onDecorate={() => (decorating ? stopDecorating() : setDecorating(true))}
          onAgent={visit}
        />
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
        {sat ? <Monitor seat={sat} onStand={stand} /> : null}
        {door ? (
          <Door
            onClose={() => {
              setDoor(false)
              setFocus((n) => n + 1)
            }}
          />
        ) : null}
        {menu ? <DeskMenu seat={menu.seat} at={menu.at} own={deskActions(menu.seat)} onClose={() => setMenu(null)} /> : null}
        {overlays.map((c) => (
          <div key={`${c.plugin}/${c.id}`} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {renderComponent(c)}
          </div>
        ))}
      </div>
    </RoomContext.Provider>
  )
}

/** Nothing to draw yet: the server is starting. You, walking on the spot, and why. */
export function Starting({ title, detail, gaveUp, lines }: { title: string; detail: string; gaveUp: boolean; lines: string[] }) {
  const t = useTheme()
  const wood = useFloorArt("wood")
  const step = useBeat(150, !gaveUp)
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: t.window, backgroundImage: { src: wood.src, repeat: "repeat", size: wood.size }, color: t.text, fontFamily: FONT }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <Nametag dot={gaveUp ? t.error : t["office.online"]}>You</Nametag>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start" }}>
          <Sprite src={walkArt(0, "down", gaveUp ? 0 : [1, 0, 2, 0][step % 4]!)} width={24} height={34} />
          <Bubble status={gaveUp ? "error" : "working"} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 14, minWidth: 320, maxWidth: 620, ...box(t, "dialog") }}>
        <text style={{ fontSize: 17, color: gaveUp ? t.error : t.text }}>{title || "Opening the office…"}</text>
        {detail ? <text style={{ fontSize: 13, color: t.muted }}>{detail}</text> : null}
        {lines.length ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 4, padding: 8, alignSelf: "stretch", ...box(t, "sign") }}>
            {lines.map((line, i) => (
              <text key={i} style={{ fontSize: 11, color: t.signText, fontFamily: "Menlo" }}>
                {line}
              </text>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export type { You }
