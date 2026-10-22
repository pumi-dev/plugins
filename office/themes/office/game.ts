// The game: you, on the floor. Arrow keys or WASD walk you (sliding along what you bump into); a
// click on the floor, a desk or a prop walks you there around everything (plan.ts's `route`), and
// what you walked to happens when you arrive. One timer runs while you move and stops when you
// stand; the window subscribes to what it draws (where you are, which way you face, your step).
import { feetAt, route, step, type Pt, type Rect } from "./plan.ts"

export type Facing = "down" | "up" | "left" | "right"

/** Frames of a walk, in order: a step, standing, the other step, standing. */
const STRIDE = [1, 0, 2, 0]
/** How often you move, and how far each time: about 210 px a second. */
export const TICK_MS = 33
const SPEED = 7
/** Keys that walk you, and the way each goes. */
const KEYS: Record<string, [number, number]> = {
  up: [0, -1],
  w: [0, -1],
  down: [0, 1],
  s: [0, 1],
  left: [-1, 0],
  a: [-1, 0],
  right: [1, 0],
  d: [1, 0],
}

export const isWalkKey = (key: string) => key in KEYS

export interface You {
  at: Pt
  facing: Facing
  /** Which walk frame: 0 standing, 1 and 2 a step. */
  frame: number
  walking: boolean
}

export class Game {
  you: You
  /** The keys held, and when each was last heard (a key-down or its repeat). */
  private keys = new Map<string, number>()
  /** Whether a held key's repeats have started: after that, a gap in them means it was let go. */
  private repeating = false
  private path: Pt[] = []
  private arrive: (() => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private ticks = 0
  private listeners = new Set<() => void>()
  /** What you bump into, and the floor's size: the window sets them each time it draws. */
  walls: Rect[] = []
  size = { width: 800, height: 600 }
  /** Where you are, when it changes and you stop: the window keeps it across runs. */
  onRest: ((at: Pt) => void) | null = null
  /** The camera: how far down the floor the view starts, and how tall the view is. */
  cam = 0
  view = 600

  /** Keeps you in the middle band of the view, as a game's camera follows its player. */
  follow() {
    const y = this.you.at.y
    let cam = this.cam
    if (y - cam < this.view * 0.32) cam = y - this.view * 0.32
    if (y - cam > this.view * 0.72) cam = y - this.view * 0.72
    cam = Math.round(Math.max(0, Math.min(cam, this.size.height - this.view)))
    if (cam !== this.cam) {
      this.cam = cam
      return true
    }
    return false
  }

  /** The wheel looks around the floor without walking. */
  scroll(dy: number) {
    const cam = Math.round(Math.max(0, Math.min(this.cam + dy, this.size.height - this.view)))
    if (cam === this.cam) return
    this.cam = cam
    this.emit()
  }

  constructor(at: Pt) {
    this.you = { at, facing: "down", frame: 0, walking: false }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  get = () => this.you

  private emit() {
    for (const listener of this.listeners) listener()
  }

  /** Puts you somewhere without walking (the first time, or the floor moved under you). */
  place(at: Pt) {
    this.you = { ...this.you, at }
    this.follow()
    this.emit()
  }

  press(key: string, held = false) {
    if (!isWalkKey(key)) return
    const fresh = !this.keys.has(key)
    this.keys.set(key, Date.now())
    if (held) this.repeating = true
    // The keys take over from a walk you clicked.
    this.path = []
    this.arrive = null
    this.wake()
    // A tap moves you at once, even when its key-up comes before the next frame.
    if (fresh) this.tick()
  }

  release(key: string) {
    this.keys.delete(key)
    if (!this.keys.size) this.repeating = false
  }

  /**
   * Forgets keys whose key-up never came (the window lost them): a key not heard again within the
   * OS's first repeat delay, or a gap in its repeats, is not held any more.
   */
  private expire() {
    const now = Date.now()
    const limit = this.repeating ? 260 : 700
    for (const [key, seen] of this.keys) if (now - seen > limit) this.keys.delete(key)
    if (!this.keys.size) this.repeating = false
  }

  /** Lets go of every key: the window lost focus, and their key-ups will not come. */
  releaseAll() {
    this.keys.clear()
    this.repeating = false
  }

  /** Walks you to `to` around what is in the way, then runs `then`. False when there is no way. */
  walkTo(to: Pt, then?: () => void): boolean {
    const path = route(this.you.at, to, this.size, this.walls)
    if (!path) return false
    // A click is where you want to go: it takes over from the keys.
    this.releaseAll()
    this.path = path
    this.arrive = then ?? null
    if (!path.length) this.done()
    else this.wake()
    return true
  }

  /** Stops where you are, forgetting where you were going. */
  stop() {
    this.path = []
    this.arrive = null
    this.releaseAll()
  }

  private wake() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  private sleep() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private done() {
    const then = this.arrive
    this.arrive = null
    then?.()
  }

  /** One frame of the game: a step by the keys held, or along the path. */
  tick() {
    this.expire()
    let dx = 0
    let dy = 0
    for (const key of this.keys.keys()) {
      const [x, y] = KEYS[key]!
      dx += x
      dy += y
    }
    dx = Math.sign(dx)
    dy = Math.sign(dy)
    let at = this.you.at
    if (dx || dy) {
      const k = dx && dy ? Math.SQRT1_2 : 1
      at = step(at, Math.round(dx * SPEED * k), Math.round(dy * SPEED * k), this.size, this.walls)
    } else if (this.path.length) {
      const next = this.path[0]!
      const ox = next.x - at.x
      const oy = next.y - at.y
      const far = Math.hypot(ox, oy)
      if (far <= SPEED) {
        at = next
        this.path.shift()
      } else at = { x: at.x + (ox / far) * SPEED, y: at.y + (oy / far) * SPEED }
      dx = Math.abs(ox) > 0.5 ? Math.sign(ox) : 0
      dy = Math.abs(oy) > 0.5 ? Math.sign(oy) : 0
      // Facing the way you mostly go.
      if (Math.abs(ox) > Math.abs(oy) * 1.2) dy = 0
      else if (Math.abs(oy) > Math.abs(ox) * 1.2) dx = 0
    }
    const moved = at.x !== this.you.at.x || at.y !== this.you.at.y
    const facing: Facing = dy < 0 && !dx ? "up" : dy > 0 && !dx ? "down" : dx < 0 ? "left" : dx > 0 ? "right" : this.you.facing
    if (moved) this.ticks++
    const walking = moved || this.keys.size > 0
    const frame = moved ? STRIDE[Math.floor(this.ticks / 3) % STRIDE.length]! : 0
    const was = this.you
    this.you = { at: moved ? { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 } : was.at, facing, frame, walking }
    const panned = moved && this.follow()
    if (moved || panned || was.facing !== facing || was.frame !== frame || was.walking !== walking) this.emit()
    if (!this.keys.size && !this.path.length) {
      this.sleep()
      this.you = { ...this.you, frame: 0, walking: false }
      this.emit()
      this.onRest?.(this.you.at)
      this.done()
    }
  }

  dispose() {
    this.sleep()
    this.listeners.clear()
  }
}

/** Whether you stand within `reach` of `p`. */
export const near = (you: Pt, p: Pt, reach: number) => Math.hypot(you.x - p.x, you.y - p.y) <= reach

/** Your feet, for a hit test against a rect. */
export { feetAt }
