#!/usr/bin/env bun
// Draws the theme's pixel art as SVG files: `bun tools/art.ts` writes themes/gather/art/ and
// themes/gather/preview.svg. Every sprite is a grid of art pixels, one art pixel two points on
// screen (`SCALE`), drawn as crisp rects, so the GPU rasterises it sharp at any display scale
// (GPUI renders an SVG at twice its size, which is one device pixel per point on a Retina panel).
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const SCALE = 2
const root = join(import.meta.dir, "..", "themes", "gather")

type Color = string | null

/** A grid of art pixels. */
class Sprite {
  px: Color[][]
  constructor(
    readonly w: number,
    readonly h: number,
    fill: Color = null,
  ) {
    this.px = Array.from({ length: h }, () => Array<Color>(w).fill(fill))
  }
  set(x: number, y: number, c: Color) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y]![x] = c
  }
  rect(x: number, y: number, w: number, h: number, c: Color) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c)
  }
  /** Rows of characters, each a key of `palette` ('.' is clear). */
  static of(rows: string[], palette: Record<string, string>): Sprite {
    const w = rows[0]!.length
    const s = new Sprite(w, rows.length)
    rows.forEach((row, y) => {
      if (row.length !== w) throw new Error(`row ${y} is ${row.length} wide, not ${w}: ${row}`)
      ;[...row].forEach((ch, x) => {
        if (ch === ".") return
        const c = palette[ch]
        if (!c) throw new Error(`no colour for '${ch}'`)
        s.set(x, y, c)
      })
    })
    return s
  }
  /** One rect per horizontal run of a colour, runs the same in the rows below merged into it. */
  svg(scale = SCALE): string {
    const out: string[] = []
    // Open runs by "x,width,colour": where they started and how tall they are so far.
    let open = new Map<string, { y: number; h: number }>()
    const close = (key: string, run: { y: number; h: number }) => {
      const [x, w, c] = key.split(",")
      out.push(`<rect x="${x}" y="${run.y}" width="${w}" height="${run.h}" fill="${c}"/>`)
    }
    for (let y = 0; y < this.h; y++) {
      const next = new Map<string, { y: number; h: number }>()
      let x = 0
      while (x < this.w) {
        const c = this.px[y]![x]
        let end = x + 1
        while (end < this.w && this.px[y]![end] === c) end++
        if (c) {
          const key = `${x},${end - x},${c}`
          const run = open.get(key)
          if (run) {
            run.h++
            open.delete(key)
            next.set(key, run)
          } else next.set(key, { y, h: 1 })
        }
        x = end
      }
      for (const [key, run] of open) close(key, run)
      open = next
    }
    for (const [key, run] of open) close(key, run)
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w * scale}" height="${this.h * scale}" ` +
      `viewBox="0 0 ${this.w} ${this.h}" shape-rendering="crispEdges">${out.join("")}</svg>\n`
    )
  }
}

// ── Floors: tiles the window repeats ────────────────────────────────────────────────────────

interface Floors {
  wood: [string, string, string]
  carpet: [string, string]
  rug: [string, string]
  tile: [string, string, string]
}

const FLOORS: Record<"light" | "dark", Floors> = {
  // Sampled from Gather's office map: pale planks, blue-grey carpet, lavender rug, lilac tiles.
  light: {
    wood: ["#eee4d9", "#ebdfd2", "#e2d1bf"],
    carpet: ["#94a3a8", "#a0aeb4"],
    rug: ["#888dcf", "#8e9fda"],
    tile: ["#dde3f1", "#d5d8ea", "#ccd0e4"],
  },
  // The same office at night.
  dark: {
    wood: ["#34324a", "#312f46", "#29273b"],
    carpet: ["#3a4459", "#404b61"],
    rug: ["#474b8c", "#4e5699"],
    tile: ["#2b2f45", "#282b40", "#24273a"],
  },
}

/** Planks in rows, each row's seams half a plank along from the last: drawn a point a pixel, for
 *  seams as fine as Gather's. Large, so a window needs few of them. */
function wood([a, b, seam]: Floors["wood"]): Sprite {
  const plank = 48
  const row = 12
  const rows = 16
  const s = new Sprite(plank * 8, row * rows)
  for (let r = 0; r < rows; r++) {
    const shift = (r % 2) * (plank / 2)
    for (let x = 0; x < s.w; x++) {
      const along = (x + s.w - shift) % s.w
      const which = Math.floor(along / plank)
      const tone = (which * 7 + r * 3) % 5 < 2 ? b : a
      for (let y = r * row; y < (r + 1) * row; y++) s.set(x, y, along % plank === 0 ? seam : tone)
    }
    for (let x = 0; x < s.w; x++) s.set(x, (r + 1) * row - 1, seam)
  }
  return s
}

/** Tiles: art pixels a side, so a tile is `TILE * SCALE` points. */
export const TILE = 64

/** Gather's office carpet: two tones in bands that zigzag across. */
function zigzag([a, b]: [string, string]): Sprite {
  const s = new Sprite(TILE, TILE)
  const tri = [0, 0, 1, 1, 2, 2, 1, 1]
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) s.set(x, y, Math.floor((y + tri[x % 8]!) / 4) % 2 ? b : a)
  return s
}

/** Lilac floor tiles in a diamond checker, with a fine grout line. */
function tiles([a, b, grout]: Floors["tile"]): Sprite {
  const s = new Sprite(TILE, TILE)
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const u = (x + y) & 15
      const v = (x - y + 64) & 15
      s.set(x, y, u === 0 || v === 0 ? grout : (u >> 3) ^ (v >> 3) ? b : a)
    }
  return s
}

// ── Avatars ─────────────────────────────────────────────────────────────────────────────────

const OUTLINE = "#2b2433"

const SHORT = [
  "...oooooo...",
  "..ohhhhhho..",
  ".ohhhhhhhho.",
  ".ohhhhhhhho.",
  ".ohhsssshho.",
  ".osesssseso.",
  ".orssssssro.",
  "..osssssso..",
  "..occsscco..",
  ".occcccccco.",
  "osccccccccso",
  "osccccccccso",
  ".occcccccco.",
  "..ollllllo..",
  "..olloollo..",
  "..ozzoozzo..",
  "...oo..oo...",
]

const LONG = [
  "...oooooo...",
  "..ohhhhhho..",
  ".ohhhhhhhho.",
  "ohhhhhhhhhho",
  "ohhsssssshho",
  "ohsessssesho",
  "ohrssssssrho",
  "ohhsssssshho",
  "ohhccsscchho",
  ...SHORT.slice(9),
]

const BUN = ["....oooo....", "..oohhhhoo..", ".ohhhhhhhho.", ".ohhhhhhhho.", ...SHORT.slice(4)]

/** The same people from behind: the face is hair, the collar shirt. */
const BACK: Record<string, string[]> = {
  short: [...SHORT.slice(0, 4), ".ohhhhhhhho.", ".ohhhhhhhho.", ".ohhhhhhhho.", "..ohhhhhho..", "..occcccco..", ...SHORT.slice(9)],
  long: [...LONG.slice(0, 4), "ohhhhhhhhhho", "ohhhhhhhhhho", "ohhhhhhhhhho", "ohhhhhhhhhho", "ohhcccccchho", ...SHORT.slice(9)],
  bun: [...BUN.slice(0, 4), ".ohhhhhhhho.", ".ohhhhhhhho.", ".ohhhhhhhho.", "..ohhhhhho..", "..occcccco..", ...SHORT.slice(9)],
}

/** In profile, facing left (facing right is the mirror). */
const SIDE_SHORT = [
  "....oooooo..",
  "...ohhhhhho.",
  "..ohhhhhhhho",
  "..ohhhhhhhho",
  ".ossshhhhhho",
  ".osesshhhhho",
  ".orssshhhhho",
  "..osssshhho.",
  "...occcco...",
  "...occccco..",
  "...oscccco..",
  "...occccco..",
  "...occccco..",
  "...ollllo...",
  "...ollllo...",
  "...ozzzzo...",
  "....oooo....",
]
const SIDE_LONG = [
  ...SIDE_SHORT.slice(0, 7),
  "..osssshhhho",
  "...occcchhho",
  "...occccchho",
  "...oscccchho",
  ...SIDE_SHORT.slice(11),
]

/** Sitting, from behind: from the waist up, the legs behind the desk. */
const SIT = [
  "...oooooo...",
  "..ohhhhhho..",
  ".ohhhhhhhho.",
  ".ohhhhhhhho.",
  ".ohhhhhhhho.",
  ".ohhhhhhhho.",
  "..ohhhhhho..",
  "..occcccco..",
  ".occcccccco.",
  ".occcccccco.",
  ".occcccccco.",
  "..oooooooo..",
]

/** Rows 13–16, the legs: standing, then a step with each foot. */
const FRONT_LEGS = [
  ["..ollllllo..", "..olloollo..", "..ozzoozzo..", "...oo..oo..."],
  ["..ollllllo..", "..olloollo..", "..ozzoollo..", "...oo.ozzo.."],
  ["..ollllllo..", "..olloollo..", "..olloozzo..", "..ozzo.oo..."],
]
const SIDE_LEGS = [
  ["...ollllo...", "...ollllo...", "...ozzzzo...", "....oooo...."],
  ["...ollllo...", "..ollo.ollo.", ".ozzo...ozzo", ".oo......oo."],
  ["...ollllo...", "...ollllo...", "...ozzzzo...", "....oooo...."],
]

const legs = (rows: string[], with_: string[]) => [...rows.slice(0, 13), ...with_]
const mirror = (rows: string[]) => rows.map((r) => [...r].reverse().join(""))

const HAIR = ["#2e2830", "#5b3a29", "#8a5a36", "#e2b45f", "#b44a2c", "#6a58b0", "#3d6e8f"]
const SKIN = ["#f6d2ae", "#e5b38b", "#c68a5f", "#93603d", "#6b4329"]
const SHIRT = ["#4f9de3", "#e3635b", "#4cbf78", "#f2b33d", "#8f72d9", "#f0eee9", "#2f3b55", "#ef8fb1"]
const PANTS = ["#3a3f5c", "#5b4636", "#2c2c34", "#4a6d8c"]

export const AVATARS = 12
export type Facing = "down" | "up" | "left" | "right"

/** Someone's look, `i`, sitting at a desk: from the waist up, seen from behind. */
function sitting(i: number): Sprite {
  const skin = SKIN[(i * 3) % SKIN.length]!
  return Sprite.of(SIT, {
    o: OUTLINE,
    h: HAIR[(i * 5 + 1) % HAIR.length]!,
    s: skin,
    c: SHIRT[(i * 7 + 2) % SHIRT.length]!,
  })
}

/** Someone's look, `i`, facing `dir`, in walk frame `frame` (0 standing, 1 and 2 a step). */
function avatar(i: number, dir: Facing = "down", frame = 0): Sprite {
  const style = (["short", "long", "bun"] as const)[i % 3]
  const front = { short: SHORT, long: LONG, bun: BUN }[style]
  const side = style === "long" ? SIDE_LONG : SIDE_SHORT
  const rows =
    dir === "down"
      ? legs(front, FRONT_LEGS[frame]!)
      : dir === "up"
        ? legs(BACK[style]!, FRONT_LEGS[frame]!)
        : dir === "left"
          ? legs(side, SIDE_LEGS[frame]!)
          : mirror(legs(side, SIDE_LEGS[frame]!))
  const skin = SKIN[(i * 3) % SKIN.length]!
  return Sprite.of(rows, {
    o: OUTLINE,
    h: HAIR[(i * 5 + 1) % HAIR.length]!,
    s: skin,
    e: OUTLINE,
    r: blush(skin),
    c: SHIRT[(i * 7 + 2) % SHIRT.length]!,
    l: PANTS[i % PANTS.length]!,
    z: "#1d1a22",
  })
}

function blush(skin: string): string {
  const n = Number.parseInt(skin.slice(1), 16)
  const r = Math.min(255, ((n >> 16) & 255) + 10)
  const g = Math.max(0, ((n >> 8) & 255) - 40)
  const b = Math.max(0, (n & 255) - 30)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

// ── Speech bubbles: what an agent is doing ──────────────────────────────────────────────────

const GLYPHS: Record<string, string[]> = {
  // "Typing…", drawn a dot at a time.
  "working-0": ["wwwwwwwwww", "wggwwwwwww", "wggwwwwwww", "wwwwwwwwww"],
  "working-1": ["wwwwwwwwww", "wggwggwwww", "wggwggwwww", "wwwwwwwwww"],
  working: ["wwwwwwwwww", "wggwggwggw", "wggwggwggw", "wwwwwwwwww"],
  blocked: ["wwwwrrwwww", "wwwwrrwwww", "wwwwwwwwww", "wwwwrrwwww"],
  error: ["wwrrwwrrww", "wwwrrrrwww", "wwwrrrrwww", "wwrrwwrrww"],
  done: ["wwwwwwwwkk", "wkkwwwwkkw", "wwkkwkkwww", "wwwkkkwwww"],
  idle: ["wwggggwwww", "wwwwgwwwww", "wwwgwwwwww", "wwggggwwww"],
}

function bubble(glyph: string[]): Sprite {
  const rows = [".oooooooooo.", ...glyph.map((g) => `o${g}o`), ".owoooooooo.", ".owo........", ".oo........."]
  return Sprite.of(rows, { o: OUTLINE, w: "#ffffff", g: "#5b5866", r: "#e5484d", k: "#16a34a" })
}

// ── Decor ───────────────────────────────────────────────────────────────────────────────────

function plant(): Sprite {
  return Sprite.of(
    [
      ".....gg.....",
      "..g.gLLg.g..",
      ".gLggLGggLg.",
      ".gGLgGGgLGg.",
      "gGGGgGgGGLGg",
      "gGgGGgGGgGGg",
      ".gGgGLGGgGg.",
      "..ggGgGgGgg.",
      "...ggGGgg...",
      ".....gg.....",
      "..oooooooo..",
      "..oPPPPPPo..",
      "..oPpPPPPo..",
      "...oPPPPo...",
      "...oPPPPo...",
      "....oooo....",
    ],
    { g: "#2f7a45", G: "#4fae5c", L: "#7fd17a", o: OUTLINE, P: "#d9825b", p: "#efa47e" },
  )
}

// ── The desk and the room's furniture ──────────────────────────────────────────────────────

/** The office chair, seen from behind: how someone sitting at a desk looks from here. */
function chair(): Sprite {
  return Sprite.of(
    [
      "..oooooooooooo..",
      ".oCCCCCCCCCCCCo.",
      "oCCCCCCCCCCCCCCo",
      "oCCccccccccCCCCo",
      "oCCCCCCCCCCCCCCo",
      "oCCccccccccCCCCo",
      "oCCCCCCCCCCCCCCo",
      ".oCCCCCCCCCCCCo.",
      "..oooooooooooo..",
      "...o..o..o..o...",
      "...o..o..o..o...",
    ],
    { o: "#8a4b22", C: "#e0824a", c: "#c4633a" },
  )
}

/** A keyboard on the desk: a dark slab of keys. */
function keyboard(): Sprite {
  const s = new Sprite(30, 9, "#3a3f52")
  s.rect(0, 0, 30, 9, "#272b3a")
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 13; i++) {
      s.rect(2 + i * 2, 2 + row * 3, 1, 2, "#c9cede")
    }
  s.rect(6, 7, 18, 1, "#c9cede")
  return s
}

/** The mug on the desk. */
function mug(): Sprite {
  return Sprite.of(
    ["..ooooo..", ".oMMMMMoo", "oMmmmmMo.", "oMmmmmMoo", "oMmmmmMo.", ".oMMMMMo.", "..ooooo.."],
    { o: "#8a4b22", M: "#e8823c", m: "#f2a065" },
  )
}

/** A sticky note on the desk. */
function sticky(): Sprite {
  const s = new Sprite(9, 9, "#f6e4a1")
  s.rect(0, 0, 9, 1, "#d9b95c")
  s.rect(0, 0, 1, 9, "#d9b95c")
  for (let x = 2; x < 7; x++) s.set(x, 3, "#c9a94a")
  for (let x = 2; x < 6; x++) s.set(x, 5, "#c9a94a")
  s.rect(6, 8, 3, 1, "#d9b95c")
  return s
}



/** The aquarium by a wall, the office's fish. */
function aquarium(): Sprite {
  const s = new Sprite(34, 30, "#2b3a55")
  s.rect(0, 0, 34, 30, "#2b3a55")
  s.rect(2, 3, 30, 20, "#8fd3e8")
  s.rect(2, 19, 30, 4, "#f2dfa8")
  s.rect(2, 3, 30, 1, "#cdeef8")
  for (const [x, y, c] of [[8, 10, "#e8823c"], [18, 15, "#f2b33d"], [24, 9, "#e05b5b"]] as const) {
    s.rect(x, y, 3, 2, c)
    s.set(x - 1, y + 1, c)
  }
  s.rect(12, 6, 1, 6, "#4fae5c")
  s.rect(13, 6, 1, 4, "#4fae5c")
  s.rect(0, 24, 34, 6, "#1c2740")
  return s
}

/** The sofa along a room's edge. */
function sofa(): Sprite {
  const s = new Sprite(40, 22)
  s.rect(0, 0, 40, 12, "#7a5232")
  s.rect(1, 1, 38, 10, "#d9a86a")
  s.rect(1, 10, 38, 8, "#7a5232")
  s.rect(3, 11, 15, 7, "#e8c290")
  s.rect(21, 11, 15, 7, "#e8c290")
  s.rect(19, 11, 2, 7, "#c08b52")
  s.rect(1, 17, 38, 2, "#b8814b")
  s.rect(4, 19, 2, 2, "#5b3a29")
  s.rect(34, 19, 2, 2, "#5b3a29")
  return s
}

// ── Preview: Settings → Appearance's card ───────────────────────────────────────────────────

function preview(): string {
  const f = FLOORS.light
  const pill = (x: number, y: number, w: number, label: string, dot?: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="14" rx="5" fill="#27262c"/>` +
    (dot ? `<circle cx="${x + 7}" cy="${y + 7}" r="2.5" fill="${dot}"/>` : "") +
    `<text x="${x + (dot ? 13 : 6)}" y="${y + 10}" font-family="-apple-system,Helvetica" font-size="8" fill="#fff">${label}</text>`
  const planks = Array.from({ length: 30 }, (_, r) =>
    Array.from({ length: 10 }, (_, i) => `<rect x="${i * 36 - (r % 2) * 18}" y="${r * 8}" width="36" height="8" fill="${(i + r) % 3 ? f.wood[0] : f.wood[1]}" stroke="${f.wood[2]}" stroke-width="1"/>`).join(""),
  ).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200" shape-rendering="crispEdges">
<rect width="320" height="200" fill="${f.wood[0]}"/>${planks}
<rect width="320" height="28" fill="#6c7b7f"/><rect width="320" height="3" fill="#c3ccd2"/><rect y="26" width="320" height="2" fill="#55646a"/>
<rect x="200" y="6" width="26" height="16" fill="#3e4458"/><rect x="202" y="8" width="10" height="12" fill="#b9e3ee"/><rect x="214" y="8" width="10" height="12" fill="#b9e3ee"/>
<rect x="250" y="6" width="26" height="16" fill="#3e4458"/><rect x="252" y="8" width="10" height="12" fill="#b9e3ee"/><rect x="264" y="8" width="10" height="12" fill="#b9e3ee"/>
${pill(40, 7, 44, "pumi", "#03c345")}${pill(90, 7, 34, "zsh")}${pill(128, 7, 40, "build")}
<rect x="0" y="28" width="78" height="150" fill="${f.tile[0]}"/><rect x="74" y="28" width="4" height="150" fill="#6c7b7f"/>
${pill(8, 40, 52, "claude", "#5aa9e6")}${pill(8, 70, 46, "codex", "#03c345")}
<rect x="88" y="38" width="128" height="134" fill="${f.rug[0]}"/><rect x="96" y="58" width="112" height="106" rx="3" fill="#ffffff"/>
<rect x="224" y="38" width="88" height="134" fill="${f.carpet[0]}"/><rect x="232" y="58" width="72" height="106" rx="3" fill="#ffffff"/>
<rect x="128" y="43" width="48" height="11" rx="5.5" fill="#f5f1eb"/><rect x="246" y="43" width="44" height="11" rx="5.5" fill="#f5f1eb"/>
<rect x="8" y="182" width="304" height="14" rx="7" fill="#ffffff"/>
</svg>
`
}

// ── Out ─────────────────────────────────────────────────────────────────────────────────────

function write(path: string, svg: string) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, svg)
}

for (const look of ["light", "dark"] as const) {
  const f = FLOORS[look]
  const dir = join(root, "art", look)
  write(join(dir, "wood.svg"), wood(f.wood).svg(1))
  write(join(dir, "carpet.svg"), zigzag(f.carpet).svg())
  write(join(dir, "rug.svg"), zigzag(f.rug).svg())
  write(join(dir, "tile.svg"), tiles(f.tile).svg())
}
for (let i = 0; i < AVATARS; i++) {
  write(join(root, "art", `avatar-${i}.svg`), avatar(i).svg())
  write(join(root, "art", "sit", `${i}.svg`), sitting(i).svg())
  for (const dir of ["down", "up", "left", "right"] as const)
    for (const frame of [0, 1, 2]) write(join(root, "art", "walk", `${i}-${dir}-${frame}.svg`), avatar(i, dir, frame).svg())
}
for (const [name, sprite] of [
  ["chair", chair()],
  ["keyboard", keyboard()],
  ["mug", mug()],
  ["sticky", sticky()],
  ["plant", plant()],
  ["aquarium", aquarium()],
  ["sofa", sofa()],
] as const)
  write(join(root, "art", `${name}.svg`), sprite.svg())
for (const [name, glyph] of Object.entries(GLYPHS)) write(join(root, "art", `bubble-${name}.svg`), bubble(glyph).svg())
write(join(root, "preview.svg"), preview())
console.log(`wrote ${root}/art and preview.svg`)
