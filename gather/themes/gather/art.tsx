// The theme's pixel art, as the window draws it: floors repeated under a place, people (standing,
// walking, typing), speech bubbles, name tags, signs and the game's framed boxes. The art is SVG
// files under art/ (`bun tools/art.ts` draws them); an <img> of one is rasterised once and shared
// by every place that shows it.
import { useState, useSyncExternalStore, type ReactNode } from "react"
import { useTheme, type Tokens } from "pumi"
import { useAppearance } from "pumi/theme"

const ART = `${import.meta.dir}/art`

/** The chrome's typeface: a pixel font, when it is installed (the system's when it is not). */
export const FONT = "Pixelify Sans"

/** A floor, and the size in points of its tile. */
const FLOORS = {
  wood: [384, 192],
  carpet: [128, 128],
  rug: [128, 128],
  tile: [128, 128],
  grass: [128, 128],
} as const

export type FloorKind = keyof typeof FLOORS

/**
 * A floor filling its parent (which is `position: "relative"`), under what follows it: as many
 * tiles as cover the box, re-counted when it resizes. Clicks go through it.
 */
export function Floor({ kind }: { kind: FloorKind }) {
  const look = useAppearance()
  const [w, h] = FLOORS[kind]
  const [grid, setGrid] = useState({ cols: 0, rows: 0 })
  const src = `${ART}/${look}/${kind}.svg`
  return (
    <div
      onLayout={(e) => {
        const cols = Math.ceil((e.width ?? 0) / w)
        const rows = Math.ceil((e.height ?? 0) / h)
        setGrid((g) => (g.cols === cols && g.rows === rows ? g : { cols, rows }))
      }}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", overflow: "hidden", pointerEvents: "none" }}
    >
      {Array.from({ length: grid.rows }, (_, r) => (
        <div key={r} style={{ display: "flex", flexDirection: "row", flexShrink: 0, height: h, pointerEvents: "none" }}>
          {Array.from({ length: grid.cols }, (_, c) => (
            <img key={c} src={src} style={{ width: w, height: h, flexShrink: 0, pointerEvents: "none" }} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Time: one clock for every animation ─────────────────────────────────────────────────────

const BEAT = 150
let beat = 0
let timer: ReturnType<typeof setInterval> | undefined
const beaters = new Set<() => void>()

function subscribeBeat(listener: () => void) {
  beaters.add(listener)
  timer ??= setInterval(() => {
    beat++
    for (const l of beaters) l()
  }, BEAT)
  return () => {
    beaters.delete(listener)
    if (!beaters.size && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

const still = () => 0
const noop = () => () => {}

/** A counter that goes up every `every` ms (a multiple of 150) while `on`: what frame to draw. */
export function useBeat(every: number, on = true): number {
  const n = useSyncExternalStore(on ? subscribeBeat : noop, on ? () => Math.floor(beat / Math.max(1, Math.round(every / BEAT))) : still)
  return n
}

// ── People ──────────────────────────────────────────────────────────────────────────────────

/** As many looks as tools/art.ts draws. */
const AVATARS = 12

/** A number from a string, the same each time: who someone looks like. */
function hash(s: string): number {
  let n = 2166136261
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619)
  return n >>> 0
}

export type Facing = "down" | "up" | "left" | "right"

/**
 * Someone: 12×17 art pixels, 24×34 points standing. `who` picks the look; `frame` 0 stands, 1 and
 * 2 step; `facing` way they look. `sitting` is them from the waist up, 24×24, facing their desk.
 */
export function Avatar({ who, facing = "down", frame = 0, sitting, style }: { who: string; facing?: Facing; frame?: number; sitting?: boolean; style?: Record<string, unknown> }) {
  const i = hash(who) % AVATARS
  const src = sitting ? `${ART}/sit/${i}.svg` : `${ART}/walk/${i}-${facing}-${frame}.svg`
  return <img src={src} style={{ width: 24, height: sitting ? 24 : 34, flexShrink: 0, ...style }} />
}

const BUBBLES = new Set(["working", "blocked", "error", "done", "idle"])

/** A speech bubble saying what someone is doing; "working" types its dots one at a time. */
export function Bubble({ status, style }: { status?: string; style?: Record<string, unknown> }) {
  const typing = useBeat(300, status === "working")
  if (!status || !BUBBLES.has(status)) return null
  const name = status === "working" ? ["working-0", "working-1", "working"][typing % 3] : status
  return <img src={`${ART}/bubble-${name}.svg`} style={{ width: 24, height: 16, flexShrink: 0, ...style }} />
}

/** The room's furniture and the desk's things, in points (art pixels × 2). */
const DECOR = {
  plant: [48, 64],
  aquarium: [68, 60],
  sofa: [80, 44],
  chair: [32, 22],
  keyboard: [60, 18],
  mug: [18, 14],
  sticky: [18, 18],
} as const

export type DecorName = keyof typeof DECOR

/** A piece of furniture, or something on the desk. */
export function Decor({ name, style }: { name: DecorName; style?: Record<string, unknown> }) {
  const size = DECOR[name]
  return <img src={`${ART}/${name}.svg`} style={{ width: size[0], height: size[1], flexShrink: 0, ...style }} />
}

// ── Words on the map ────────────────────────────────────────────────────────────────────────

/** Gather's name tag: a dark pill over whoever it names, with a dot for how they are. */
export function Nametag({ children, dot, dim }: { children: string; dot?: string; dim?: boolean }) {
  const t = useTheme()
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 18,
        paddingLeft: dot ? 5 : 7,
        paddingRight: 7,
        borderRadius: 6,
        flexShrink: 1,
        minWidth: 0,
        backgroundColor: dim ? t.tagDim : t.tag,
      }}
    >
      {dot ? <div style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: dot }} /> : null}
      <text style={{ fontFamily: FONT, fontSize: 12, color: dim ? t.tagTextDim : t.tagText, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>
        {children}
      </text>
    </div>
  )
}

/** A painted plate, as a room's name is on its wall: square corners, a dark rim, a light edge. */
export function Sign({ children, before, onClick }: { children: string; before?: ReactNode; onClick?(): void }) {
  const t = useTheme()
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 18,
        paddingLeft: before ? 5 : 8,
        paddingRight: 8,
        flexShrink: 1,
        minWidth: 0,
        ...box(t, "sign"),
        ...(onClick ? { cursor: "pointer", hover: { backgroundColor: t.signHover } } : {}),
      }}
    >
      {before}
      <text style={{ fontFamily: FONT, fontSize: 11, color: t.signText, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{children}</text>
    </div>
  )
}

// ── The game's boxes ────────────────────────────────────────────────────────────────────────

/**
 * A framed box, as a pixel game draws its windows: a dark rim and a light ring inside it, square
 * corners. `dialog` is the menus' and the palette's, `slot` the hotbar's, `sign` a plate.
 */
export function box(t: Tokens, kind: "dialog" | "slot" | "sign" | "panel" | "tag" | "tagActive"): Record<string, unknown> {
  const [fill, rim, ring] = {
    dialog: [t.surface, t.rim, t.ring],
    panel: [t.surface, t.rim, t.ring],
    slot: [t.slot, t.slotRim, t.slotRing],
    sign: [t.sign, t.signRim, t.signRing],
    tag: [t.tag, t.tag, t.tag],
    tagActive: [t.tag, t.slotActive, t.tag],
  }[kind]
  const width = kind === "sign" ? 1 : kind === "tag" || kind === "tagActive" ? 1 : 2
  return {
    backgroundColor: fill,
    borderWidth: width,
    borderColor: rim,
    borderRadius: kind === "sign" ? 1 : 3,
    boxShadow: [
      ...(kind === "tag" ? [] : [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: width, color: ring, inset: true }]),
      ...(kind === "dialog" ? [{ offsetX: 4, offsetY: 4, blurRadius: 0, spreadRadius: 0, color: t.drop }] : []),
    ],
  }
}
