// The office's plan: a session is a pod on the carpet with its name on it, and every view in it is a
// desk — or, with "a desk for every tab" on, one desk for each tab in a split view — plus the free
// desk that makes a new view. Pods stand next to each other, wrap onto the next row when the floor
// runs out, and the rows sit in the middle of the room. The plan also says what you bump into
// (desks, the shelf, the coffee machine, the wall) and how to walk around it.
import type { Session, Tab, View } from "pumi/theme"

/** A desk's cell on the carpet. */
export const CELL_W = 176
export const CELL_H = 156
/** A pod's carpet around its desks, and the name above them. */
export const CARPET = 22
export const LABEL_H = 34
/** What the floor keeps free at its sides (the shelf and the coffee machine stand there). */
export const MARGIN = 96
/** The wall along the top. */
export const WALL = 56
/** The bar along the foot. */
export const HUD = 56
/** Between two pods. */
export const POD_GAP = 24
/** How tall the lounge below the pods is. */
export const LOUNGE_H = 170
/** The walk grid's cell, in floor pixels. */
export const GRID = 12

export interface Pt {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A desk: the view it holds, and — a desk of its own — the tab. */
export interface Seat {
  view: View
  tab?: Tab
  /** The tab's place in its view (1-based); 1 for a view's own desk. */
  i: number
}

/** A session: its carpet, its name, and the cells its desks stand in. */
export interface Pod {
  session: Session
  cols: number
  down: number
  seats: Seat[]
  x: number
  y: number
  width: number
  height: number
  /** `cells[i]` is seat `i`'s cell, in floor pixels; `cells[seats.length]` is the free desk's. */
  cells: Pt[]
}

/** Something on the floor you can walk up to and use. */
export interface Prop {
  id: "shelf" | "coffee" | "door"
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface Plan {
  width: number
  /** The floor's height, wall included. */
  height: number
  pods: Pod[]
  props: Prop[]
  /** The lounge: the open floor below the pods, where the furniture you have not moved stands. */
  lounge: Rect
  /** Where you stand when you have never walked. */
  centre: Pt
}

/** A view's seats: itself, or one for each of its tabs when the theme is told to. */
export function seatsOf(view: View, tabs: Tab[], perTab: boolean): Seat[] {
  const mine = tabs.filter((tab) => tab.view_id === view.view_id)
  if (!perTab || !mine.length) return [{ view, i: 1 }]
  return mine.map((tab, index) => ({ view, tab, i: index + 1 }))
}

/** How a desk is keyed in what the office keeps: its view, and the tab it holds. */
export const deskKey = (seat: Seat) => `${seat.view.view_id}${seat.tab ? `:${seat.tab.tab_id}` : ""}`

/**
 * The room: each session's pod (its desks in columns, about as wide as tall, and a free desk), the
 * pods in rows in the middle of the floor, the props along its edges.
 */
export function plan(sessions: Session[], views: View[], tabs: Tab[], width: number, viewHeight: number, perTab: boolean, lowest = 0): Plan {
  const pods: Pod[] = []
  for (const session of sessions) {
    const seats = views.filter((view) => view.workspace_id === session.workspace_id).flatMap((view) => seatsOf(view, tabs, perTab))
    // Its desks, and always a free one.
    const n = seats.length + 1
    const down = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n / 1.4))))
    const cols = Math.ceil(n / down)
    pods.push({
      session,
      cols,
      down,
      seats,
      x: 0,
      y: 0,
      width: cols * CELL_W + CARPET * 2,
      height: LABEL_H + down * CELL_H + CARPET,
      cells: Array.from({ length: n }, (_, i) => ({ x: CARPET + Math.floor(i / down) * CELL_W, y: LABEL_H + (i % down) * CELL_H })),
    })
  }
  // Pods next to each other, onto the next row when the floor runs out.
  const room = Math.max(CELL_W + CARPET * 2, width - MARGIN * 2)
  const rows: { pods: Pod[]; width: number; height: number }[] = []
  for (const pod of pods) {
    const row = rows.at(-1)
    if (row && row.width + POD_GAP + pod.width <= room) {
      row.pods.push(pod)
      row.width += POD_GAP + pod.width
      row.height = Math.max(row.height, pod.height)
    } else rows.push({ pods: [pod], width: pod.width, height: pod.height })
  }
  const tall = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * POD_GAP
  let y = WALL + Math.max(40, Math.floor((viewHeight - WALL - tall - LOUNGE_H - 100) / 2))
  for (const row of rows) {
    let x = Math.max(MARGIN, Math.floor((width - row.width) / 2))
    for (const pod of row.pods) {
      pod.x = x
      pod.y = y
      for (const cell of pod.cells) {
        cell.x += x
        cell.y += y
      }
      x += pod.width + POD_GAP
    }
    y += row.height + POD_GAP
  }
  const bottom = pods.reduce((end, pod) => Math.max(end, pod.y + pod.height), WALL + 40)
  const lounge: Rect = { x: 0, y: bottom + 30, w: width, h: LOUNGE_H }
  // The floor reaches past the lounge and whatever was put lower still, to the door.
  const height = Math.max(viewHeight, lounge.y + lounge.h + 70, lowest + 80)
  const props: Prop[] = [
    { id: "shelf", label: "Bookshelf", x: 24, y: WALL + 10, w: 56, h: 60 },
    { id: "coffee", label: "Settings", x: 92, y: WALL + 14, w: 32, h: 48 },
    { id: "door", label: "Sessions", x: Math.round(width / 2) - 30, y: height - 32, w: 60, h: 28 },
  ]
  return { width, height, pods, props, lounge, centre: { x: Math.round(width / 2), y: Math.min(height - 60, bottom + 18) } }
}

// ── A desk on the floor ─────────────────────────────────────────────────────────────────────

/** Where a desk's sprite stands in its cell, and the chair in front of it. */
export const DESK_ART: Rect = { x: 40, y: 12, w: 96, h: 60 }

/** What you bump into at a desk whose cell is at `at`: the desk itself, not its chair. */
export const deskBody = (at: Pt): Rect => ({ x: at.x + DESK_ART.x, y: at.y + DESK_ART.y + 8, w: DESK_ART.w, h: DESK_ART.h - 10 })

/** Where you stand to sit at a desk: in front of its chair (your feet). */
export const deskSpot = (at: Pt): Pt => ({ x: at.x + 88, y: at.y + 112 })

/** Where you stand to use a prop: in front of it. */
export const propSpot = (prop: Prop): Pt => ({ x: prop.x + Math.round(prop.w / 2), y: prop.id === "door" ? prop.y - 6 : prop.y + prop.h + 14 })

/** What you bump into at a prop: the door mat you walk onto, the rest you walk into. */
export const propBody = (prop: Prop): Rect | null => (prop.id === "door" ? null : { x: prop.x, y: prop.y + 16, w: prop.w, h: prop.h - 16 })

// ── Walking ─────────────────────────────────────────────────────────────────────────────────

/** Your feet: what has to fit between two things for you to pass. */
export const FEET = { w: 14, h: 8 }

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Your feet's box, standing at `p`. */
export const feetAt = (p: Pt): Rect => ({ x: p.x - FEET.w / 2, y: p.y - FEET.h, w: FEET.w, h: FEET.h })

/** Whether you can stand at `p`: on the floor, under the wall, in nothing. */
export function free(p: Pt, size: { width: number; height: number }, walls: Rect[]): boolean {
  const feet = feetAt(p)
  if (feet.x < 4 || feet.x + feet.w > size.width - 4 || feet.y < WALL + 6 || p.y > size.height - 4) return false
  return !walls.some((wall) => overlaps(feet, wall))
}

/**
 * One step from `from` by `(dx, dy)`, sliding along what is in the way: each axis on its own, so
 * walking into a desk at an angle carries you along its edge instead of stopping you.
 */
export function step(from: Pt, dx: number, dy: number, size: { width: number; height: number }, walls: Rect[]): Pt {
  // Stuck inside something (a desk was dragged onto you): any way out is allowed.
  if (!free(from, size, walls)) {
    return { x: Math.max(12, Math.min(size.width - 12, from.x + dx)), y: Math.max(WALL + 16, Math.min(size.height - 6, from.y + dy)) }
  }
  let at = from
  const x = { x: at.x + dx, y: at.y }
  if (dx && free(x, size, walls)) at = x
  const y = { x: at.x, y: at.y + dy }
  if (dy && free(y, size, walls)) at = y
  return at
}

/**
 * A walk from `from` to `to` around what is in the way: A* over a grid of `GRID` pixels, eight
 * ways, then the corners only (straight runs between them). `null` when there is no way.
 */
export function route(from: Pt, to: Pt, size: { width: number; height: number }, walls: Rect[]): Pt[] | null {
  const cols = Math.ceil(size.width / GRID)
  const rows = Math.ceil(size.height / GRID)
  const cellOf = (p: Pt) => ({ c: Math.max(0, Math.min(cols - 1, Math.floor(p.x / GRID))), r: Math.max(0, Math.min(rows - 1, Math.floor(p.y / GRID))) })
  const centre = (c: number, r: number): Pt => ({ x: c * GRID + GRID / 2, y: r * GRID + GRID / 2 })
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && free(centre(c, r), size, walls)
  const start = cellOf(from)
  let goal = cellOf(to)
  // A goal inside something: the nearest cell you can stand in.
  if (!open(goal.c, goal.r)) {
    let best: { c: number; r: number } | null = null
    for (let ring = 1; ring < 12 && !best; ring++) {
      for (let dc = -ring; dc <= ring && !best; dc++) {
        for (const dr of [-ring, ring]) if (!best && open(goal.c + dc, goal.r + dr)) best = { c: goal.c + dc, r: goal.r + dr }
        for (const side of [-ring, ring]) if (!best && Math.abs(dc) < ring && open(goal.c + side, goal.r + dc)) best = { c: goal.c + side, r: goal.r + dc }
      }
    }
    if (!best) return null
    goal = best
  }
  const id = (c: number, r: number) => r * cols + c
  const g = new Map<number, number>([[id(start.c, start.r), 0]])
  const came = new Map<number, number>()
  const h = (c: number, r: number) => Math.hypot(c - goal.c, r - goal.r)
  // A small binary heap of [f, id].
  const heap: [number, number][] = [[h(start.c, start.r), id(start.c, start.r)]]
  const push = (item: [number, number]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent]![0] <= heap[i]![0]) break
      ;[heap[parent], heap[i]] = [heap[i]!, heap[parent]!]
      i = parent
    }
  }
  const pop = () => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i]!, heap[m]!]
        i = m
      }
    }
    return top
  }
  const goalId = id(goal.c, goal.r)
  const closed = new Set<number>()
  let found = false
  while (heap.length) {
    const [, current] = pop()
    if (current === goalId) {
      found = true
      break
    }
    if (closed.has(current)) continue
    closed.add(current)
    const c = current % cols
    const r = Math.floor(current / cols)
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue
        const nc = c + dc
        const nr = r + dr
        if (!open(nc, nr)) continue
        // No cutting a corner through something.
        if (dc && dr && (!open(c + dc, r) || !open(c, r + dr))) continue
        const next = id(nc, nr)
        const cost = (g.get(current) ?? 0) + (dc && dr ? Math.SQRT2 : 1)
        if (cost >= (g.get(next) ?? Infinity)) continue
        g.set(next, cost)
        came.set(next, current)
        push([cost + h(nc, nr), next])
      }
    }
  }
  if (!found && goalId !== id(start.c, start.r)) return null
  const cells: number[] = [goalId]
  while (cells[0] !== id(start.c, start.r)) {
    const prev = came.get(cells[0]!)
    if (prev === undefined) break
    cells.unshift(prev)
  }
  // The corners: where the walk turns.
  const points = cells.map((cell) => centre(cell % cols, Math.floor(cell / cols)))
  const corners: Pt[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const c = points[i + 1]
    if (!c || Math.sign(b.x - a.x) !== Math.sign(c.x - b.x) || Math.sign(b.y - a.y) !== Math.sign(c.y - b.y)) corners.push(b)
  }
  // And where you asked to go, when you can stand there.
  if (free(to, size, walls)) {
    if (corners.length) corners[corners.length - 1] = to
    else corners.push(to)
  }
  return corners
}

// ── How a desk is ───────────────────────────────────────────────────────────────────────────

/** Which status says the most, when a desk holds more than one agent: the one that needs you. */
const URGENCY = ["blocked", "error", "working", "done", "idle"]

/**
 * What a desk's agent is doing: its tab's status for a tab's desk, else the most urgent of its
 * view's tabs (the view's own `agent_status` when it has one and no tab says more). "" for none.
 */
export function statusOf(seat: Seat, tabs: Tab[]): string {
  if (seat.tab) return seat.tab.agent_status || ""
  const all = tabs.filter((t) => t.view_id === seat.view.view_id).map((t) => t.agent_status || "")
  if (seat.view.agent_status) all.push(seat.view.agent_status)
  let best = ""
  for (const status of all) {
    if (!status) continue
    const rank = URGENCY.indexOf(status)
    if (!best || (rank >= 0 && (URGENCY.indexOf(best) < 0 || rank < URGENCY.indexOf(best)))) best = status
  }
  return best
}
