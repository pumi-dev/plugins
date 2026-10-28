// The office's furniture: what you can put on the floor in Decorate mode, what each piece does when
// you walk up to it and press X, and the lounge every office starts with. A piece is kept with its
// place: below the pods it is kept relative to the lounge (so the lounge moves down as the pods
// grow), above it on the floor itself.
import type { Plan, Pt, Rect } from "./plan.ts"

/** What a piece does when you use it. */
export type Use = "pingpong" | "lamp" | "arcade" | "water" | "snack" | "tv" | "sit" | "doodle" | "fish" | "read" | "plant"

export interface Kind {
  id: string
  label: string
  /** Its size on screen. */
  w: number
  h: number
  /** How tall its foot is, the part you bump into; 0 walks over it (a rug). */
  foot: number
  use?: Use
  /** What the prompt says. */
  verb?: string
  group: "Lounge" | "Fun" | "Office" | "Plants"
}

const k = (id: string, label: string, w: number, h: number, foot: number, group: Kind["group"], use?: Use, verb?: string): Kind => ({ id, label, w, h, foot, group, use, verb })

export const KINDS: Kind[] = [
  k("sofa", "Sofa", 80, 44, 22, "Lounge", "sit", "Sink into the sofa"),
  k("armchair-orange", "Armchair", 36, 32, 16, "Lounge", "sit", "Take a seat"),
  k("armchair-teal", "Teal chair", 36, 32, 16, "Lounge", "sit", "Take a seat"),
  k("beanbag-blue", "Beanbag", 32, 28, 14, "Lounge", "sit", "Flop on the beanbag"),
  k("beanbag-pink", "Pink beanbag", 32, 28, 14, "Lounge", "sit", "Flop on the beanbag"),
  k("round-table", "Coffee table", 56, 36, 16, "Lounge"),
  k("rug", "Rug", 120, 80, 0, "Lounge"),
  k("lamp", "Floor lamp", 24, 56, 8, "Lounge", "lamp", "Flip the lamp"),
  k("pingpong", "Ping-pong", 92, 60, 30, "Fun", "pingpong", "Play ping-pong"),
  k("arcade", "Arcade", 36, 60, 18, "Fun", "arcade", "Play a round"),
  k("tv", "TV", 72, 52, 18, "Fun", "tv", "Flip the channel"),
  k("aquarium", "Aquarium", 68, 60, 22, "Fun", "fish", "Feed the fish"),
  k("vending", "Vending machine", 40, 64, 18, "Office", "snack", "Get a snack"),
  k("cooler", "Water cooler", 28, 52, 14, "Office", "water", "Grab some water"),
  k("whiteboard", "Whiteboard", 68, 56, 12, "Office", "doodle", "Doodle on it"),
  k("bookcase", "Bookcase", 60, 64, 20, "Office", "read", "Browse the books"),
  k("monstera", "Monstera", 40, 52, 16, "Plants", "plant", "Water the plant"),
  k("bamboo", "Bamboo", 48, 64, 18, "Plants", "plant", "Water the bamboo"),
]

export const KIND = Object.fromEntries(KINDS.map((kind) => [kind.id, kind])) as Record<string, Kind>

/** A piece on the floor: `y` is from the lounge's top when `lounge`, else from the floor's. */
export interface Piece {
  id: string
  kind: string
  x: number
  y: number
  lounge?: boolean
  /** A lamp or a TV that is on. */
  on?: boolean
}

/** Where a piece stands on this floor: its box. */
export function placeOf(piece: Piece, room: Plan): Rect {
  const kind = KIND[piece.kind]
  const w = kind?.w ?? 32
  const h = kind?.h ?? 32
  const x = Math.max(0, Math.min(room.width - w, piece.x))
  const y = piece.lounge ? room.lounge.y + piece.y : piece.y
  return { x, y, w, h }
}

/** A piece put at `at` (its top-left, on the floor): kept by the lounge when it is in or below it. */
export function keepAt(piece: Omit<Piece, "x" | "y" | "lounge">, at: Pt, room: Plan): Piece {
  const lounge = at.y >= room.lounge.y - 20
  return { ...piece, x: Math.round(at.x), y: Math.round(lounge ? at.y - room.lounge.y : at.y), lounge }
}

/** What you bump into at a piece: its foot. */
export function bodyOf(piece: Piece, room: Plan): Rect | null {
  const kind = KIND[piece.kind]
  if (!kind?.foot) return null
  const at = placeOf(piece, room)
  return { x: at.x + 2, y: at.y + at.h - kind.foot, w: at.w - 4, h: kind.foot - 2 }
}

/** Where you stand to use a piece: in front of it. */
export function spotOf(piece: Piece, room: Plan): Pt {
  const at = placeOf(piece, room)
  return { x: at.x + at.w / 2, y: at.y + at.h + 26 }
}

/** Where you sit on a piece you sit on. */
export function seatOf(piece: Piece, room: Plan): Pt {
  const at = placeOf(piece, room)
  return { x: at.x + at.w / 2, y: at.y + Math.round(at.h * 0.78) }
}

let made = 0
export const newId = () => `p${Date.now().toString(36)}${(made++).toString(36)}`

/** The lounge an office starts with: a sitting area, a games corner and a kitchenette. */
export function starter(width: number): Piece[] {
  const c = Math.round(width / 2)
  const at = (kind: string, x: number, y: number, extra: Partial<Piece> = {}): Piece => ({ id: `starter-${kind}-${x}`, kind, x: c + x, y, lounge: true, ...extra })
  return [
    // The sitting area, on its rug.
    at("rug", -330, 40),
    at("lamp", -380, 26, { on: true }),
    at("sofa", -310, 30),
    at("armchair-orange", -360, 84),
    at("round-table", -298, 92),
    at("armchair-teal", -228, 84),
    at("monstera", -440, 50),
    // The games corner.
    at("pingpong", -100, 52),
    at("beanbag-blue", 20, 60),
    at("beanbag-pink", 22, 100),
    at("arcade", 90, 40),
    // The kitchenette.
    at("vending", 200, 36),
    at("cooler", 250, 48),
    at("bamboo", 300, 44),
  ].filter((piece) => piece.x >= 4 && piece.x + (KIND[piece.kind]?.w ?? 0) <= width - 4)
}
