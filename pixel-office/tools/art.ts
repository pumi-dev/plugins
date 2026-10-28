#!/usr/bin/env bun
// Draws the office's furniture and its wall styles as pixel-art SVGs: `bun tools/art.ts` writes
// themes/pixel-office/images/furniture/*.svg and images/walls/*.svg. A sprite is a grid of art
// pixels, each two points on screen, drawn as crisp rects, the same way the room's own sprites are
// drawn, so they sit together. The rest of images/ (the floors, the people, the bubbles, the
// things on a desk, the sofa and the aquarium) is kept as it was drawn.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const SCALE = 2
const images = join(import.meta.dir, "..", "themes", "pixel-office", "images")

type Color = string | null

class Sprite {
  px: Color[][]
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = Array.from({ length: h }, () => Array<Color>(w).fill(null))
  }
  set(x: number, y: number, c: Color) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y]![x] = c
  }
  rect(x: number, y: number, w: number, h: number, c: Color) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c)
  }
  /** A filled box with a one-pixel outline. */
  box(x: number, y: number, w: number, h: number, fill: Color, line: Color = INK) {
    this.rect(x, y, w, h, line)
    this.rect(x + 1, y + 1, w - 2, h - 2, fill)
  }
  /** A filled ellipse inside the box, with an outline. */
  oval(x: number, y: number, w: number, h: number, fill: Color, line: Color = INK) {
    const cx = x + w / 2 - 0.5
    const cy = y + h / 2 - 0.5
    const rx = w / 2
    const ry = h / 2
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        const d = ((i - cx) / rx) ** 2 + ((j - cy) / ry) ** 2
        if (d <= 1) this.set(i, j, fill)
      }
    }
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        if (this.px[j]?.[i] !== fill) continue
        const edge = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const n = this.px[j + dy!]?.[i + dx!]
          return n === undefined || n === null || (n !== fill && n !== line && !(i + dx! >= x && i + dx! < x + w && j + dy! >= y && j + dy! < y + h))
        })
        if (edge) this.set(i, j, line)
      }
    }
  }
  svg(): string {
    const out: string[] = []
    for (let y = 0; y < this.h; y++) {
      let x = 0
      while (x < this.w) {
        const c = this.px[y]![x]
        let end = x + 1
        while (end < this.w && this.px[y]![end] === c) end++
        if (c) out.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${c}"/>`)
        x = end
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w * SCALE}" height="${this.h * SCALE}" viewBox="0 0 ${this.w} ${this.h}" shape-rendering="crispEdges">${out.join("")}</svg>`
  }
}

const INK = "#2b2433"
const SHADOW = "#00000022"

function write(path: string, body: string) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, body)
}

// ── Furniture ───────────────────────────────────────────────────────────────────────────────

function pingpong(): Sprite {
  const s = new Sprite(46, 30)
  s.rect(2, 26, 42, 3, SHADOW)
  s.rect(4, 20, 2, 8, INK)
  s.rect(40, 20, 2, 8, INK)
  s.box(0, 2, 46, 20, "#2f9e6b")
  s.rect(1, 19, 44, 2, "#23774f")
  s.rect(1, 11, 44, 1, "#ffffff")
  s.rect(22, 1, 2, 21, "#e9eaf2")
  s.rect(22, 0, 2, 2, INK)
  s.rect(22, 21, 2, 2, INK)
  // Two paddles and a ball resting on it.
  s.oval(7, 5, 5, 5, "#e5484d")
  s.rect(9, 9, 1, 2, "#8b5a3c")
  s.oval(34, 13, 5, 5, "#3b82f6")
  s.rect(36, 12, 1, 2, "#8b5a3c")
  s.oval(28, 6, 2, 2, "#ffffff", "#ffffff")
  return s
}

function beanbag(fill: string, shade: string): Sprite {
  const s = new Sprite(16, 14)
  s.rect(2, 12, 12, 2, SHADOW)
  s.oval(0, 2, 16, 12, fill)
  s.oval(3, 0, 10, 8, fill)
  s.rect(3, 9, 10, 2, shade)
  s.rect(5, 2, 3, 1, "#ffffff55")
  return s
}

function lamp(): Sprite {
  const s = new Sprite(12, 28)
  s.rect(2, 26, 8, 2, SHADOW)
  s.rect(3, 25, 6, 2, INK)
  s.rect(5, 8, 2, 18, "#6b6f80")
  s.rect(1, 0, 10, 1, INK)
  s.rect(0, 1, 12, 7, INK)
  s.rect(1, 1, 10, 6, "#ffd166")
  s.rect(1, 6, 10, 1, "#f0b43a")
  s.rect(2, 2, 2, 3, "#fff3c4")
  return s
}

function cooler(): Sprite {
  const s = new Sprite(14, 26)
  s.rect(1, 24, 12, 2, SHADOW)
  // The bottle.
  s.box(3, 0, 8, 9, "#8fd3f4")
  s.rect(4, 1, 2, 6, "#c9ecfb")
  s.rect(5, 8, 4, 2, INK)
  // The stand.
  s.box(1, 9, 12, 16, "#e9eaf2")
  s.rect(2, 22, 10, 2, "#c4c7d4")
  s.rect(3, 13, 2, 2, "#e5484d")
  s.rect(9, 13, 2, 2, "#3b82f6")
  s.rect(4, 17, 6, 1, "#9a9db3")
  return s
}

function arcade(): Sprite {
  const s = new Sprite(18, 30)
  s.rect(1, 28, 16, 2, SHADOW)
  s.box(1, 0, 16, 29, "#6d3fc4")
  s.rect(2, 1, 14, 3, "#ff4fa3")
  s.rect(4, 2, 10, 1, "#ffd166")
  s.box(3, 5, 12, 9, "#14161f")
  s.rect(5, 7, 2, 2, "#4ade80")
  s.rect(9, 9, 3, 1, "#ffd166")
  s.rect(11, 7, 1, 1, "#e5484d")
  s.rect(2, 15, 14, 4, "#4d2c8f")
  s.rect(4, 16, 2, 2, "#e5484d")
  s.rect(9, 16, 1, 1, "#ffd166")
  s.rect(11, 16, 1, 1, "#3b82f6")
  s.rect(13, 16, 1, 1, "#4ade80")
  s.rect(6, 22, 6, 2, INK)
  return s
}

function rug(): Sprite {
  const s = new Sprite(60, 40)
  s.box(0, 0, 60, 40, "#7c6fd6", "#5a4fb0")
  for (let y = 3; y < 38; y += 6) s.rect(2, y, 56, 2, "#9387e3")
  s.rect(2, 2, 56, 1, "#b3a9f0")
  // Tassels.
  for (let x = 2; x < 58; x += 4) {
    s.set(x, 0, "#e9eaf2")
    s.set(x, 39, "#e9eaf2")
  }
  return s
}

function roundTable(): Sprite {
  const s = new Sprite(28, 18)
  s.rect(3, 15, 22, 3, SHADOW)
  s.rect(12, 9, 4, 7, "#8b5a3c")
  s.oval(0, 0, 28, 12, "#e7c08a", "#8b5a3c")
  s.oval(3, 2, 22, 7, "#f0d3a6", "#f0d3a6")
  // A mug and a book on it.
  s.box(7, 3, 4, 4, "#7c6fd6")
  s.box(15, 4, 7, 3, "#e5484d")
  return s
}

function whiteboard(): Sprite {
  const s = new Sprite(34, 28)
  s.rect(4, 22, 2, 6, INK)
  s.rect(28, 22, 2, 6, INK)
  s.box(0, 0, 34, 23, "#ffffff", "#6b6f80")
  s.rect(1, 21, 32, 1, "#c4c7d4")
  // Somebody's plan.
  s.rect(4, 4, 10, 1, "#3b82f6")
  s.rect(4, 7, 14, 1, "#3b82f6")
  s.rect(4, 10, 8, 1, "#3b82f6")
  s.box(20, 4, 9, 7, "#ffd166", "#e5484d")
  s.rect(6, 14, 18, 1, "#2f9e6b")
  s.rect(23, 13, 2, 3, "#2f9e6b")
  s.rect(8, 18, 4, 2, "#e5484d")
  s.rect(14, 18, 4, 2, "#3b82f6")
  return s
}

function bamboo(): Sprite {
  const s = new Sprite(24, 32)
  s.rect(1, 30, 22, 2, SHADOW)
  for (const [x, top] of [
    [3, 4],
    [7, 0],
    [11, 2],
    [15, 1],
    [19, 5],
  ] as const) {
    s.rect(x, top, 2, 22 - top, "#3f8f3a")
    s.rect(x, top + 6, 2, 1, "#2c6b29")
    s.rect(x, top + 13, 2, 1, "#2c6b29")
    s.rect(x - 2, top + 3, 2, 1, "#5fbf4f")
    s.rect(x + 2, top + 9, 3, 1, "#5fbf4f")
  }
  s.box(0, 21, 24, 10, "#4b5063")
  s.rect(1, 22, 22, 2, "#6b6f80")
  return s
}

function monstera(): Sprite {
  const s = new Sprite(20, 26)
  s.rect(3, 24, 14, 2, SHADOW)
  const leaf = (x: number, y: number, w: number, h: number) => {
    s.oval(x, y, w, h, "#3f9f4a", "#2c6b29")
    s.rect(x + Math.floor(w / 2), y + 1, 1, h - 2, "#2c6b29")
  }
  leaf(1, 3, 9, 8)
  leaf(10, 2, 9, 8)
  leaf(5, 0, 10, 9)
  leaf(2, 9, 8, 7)
  leaf(10, 9, 8, 7)
  s.box(4, 16, 12, 9, "#d9734e", "#8b4a2e")
  s.rect(5, 17, 10, 1, "#e99470")
  return s
}

function armchair(fill: string, shade: string): Sprite {
  const s = new Sprite(18, 16)
  s.rect(1, 14, 16, 2, SHADOW)
  s.box(1, 0, 16, 8, shade)
  s.box(0, 5, 4, 10, fill)
  s.box(14, 5, 4, 10, fill)
  s.box(3, 7, 12, 7, fill)
  s.rect(4, 8, 10, 1, "#ffffff44")
  return s
}

function vending(): Sprite {
  const s = new Sprite(20, 32)
  s.rect(1, 30, 18, 2, SHADOW)
  s.box(0, 0, 20, 31, "#e5484d")
  s.box(2, 2, 12, 22, "#cfe9f7", "#6b6f80")
  const cans = ["#ffd166", "#3b82f6", "#4ade80", "#ff4fa3"]
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) s.rect(3 + col * 4, 4 + row * 5, 3, 3, cans[(row + col) % cans.length]!)
  s.rect(15, 4, 3, 2, INK)
  s.rect(15, 8, 3, 6, "#c43a3f")
  s.box(3, 25, 10, 4, "#14161f")
  return s
}

function bookcase(): Sprite {
  const s = new Sprite(30, 32)
  s.rect(1, 30, 28, 2, SHADOW)
  s.box(0, 0, 30, 31, "#8b5a3c", "#5a3a26")
  const books = ["#e5484d", "#3b82f6", "#ffd166", "#4ade80", "#7c6fd6", "#ff8a3d"]
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 2 + shelf * 9
    s.rect(1, y + 7, 28, 1, "#5a3a26")
    for (let x = 2, i = shelf; x < 27; i++) {
      const w = 2 + (i % 2)
      const h = 5 + (i % 3)
      s.rect(x, y + 7 - h, w, h, books[i % books.length]!)
      x += w + (i % 4 === 0 ? 2 : 0)
    }
  }
  return s
}

function tv(): Sprite {
  const s = new Sprite(36, 26)
  s.rect(2, 24, 32, 2, SHADOW)
  s.box(0, 16, 36, 9, "#6b6f80")
  s.rect(4, 19, 6, 3, "#4b5063")
  s.rect(26, 19, 6, 3, "#4b5063")
  s.rect(16, 13, 4, 4, INK)
  s.box(2, 0, 32, 14, "#14161f")
  s.rect(4, 2, 28, 10, "#2a4d8f")
  s.rect(6, 3, 8, 3, "#5aa9ff")
  s.rect(18, 7, 12, 1, "#e9eaf2")
  return s
}

const FURNITURE: Record<string, () => Sprite> = {
  pingpong,
  "beanbag-blue": () => beanbag("#3b82f6", "#2563c9"),
  "beanbag-pink": () => beanbag("#ff4fa3", "#d93a86"),
  lamp,
  cooler,
  arcade,
  rug,
  "round-table": roundTable,
  whiteboard,
  bamboo,
  monstera,
  "armchair-orange": () => armchair("#ff8a3d", "#d96a24"),
  "armchair-teal": () => armchair("#2bb5a0", "#1f8a7a"),
  vending,
  bookcase,
  tv,
}

for (const [name, draw] of Object.entries(FURNITURE)) write(join(images, "furniture", `${name}.svg`), draw().svg())

// ── Walls ───────────────────────────────────────────────────────────────────────────────────

/** The office's wall, its paint swapped: the band and the panelling below the windows. */
const wall = readFileSync(join(images, "wall.svg"), "utf8")
const PAINTS: Record<string, Record<string, string>> = {
  sage: { "#3c4266": "#3d5a45", "#4f567f": "#4f735a", "#585f8f": "#5b8466", "#6c74a8": "#7aa384" },
  brick: { "#3c4266": "#6b2f2a", "#4f567f": "#8a3d34", "#585f8f": "#9c4a3d", "#6c74a8": "#b85c48" },
  night: { "#3c4266": "#1d1f2b", "#4f567f": "#2b2d42", "#585f8f": "#33364d", "#6c74a8": "#3f4360" },
  peach: { "#3c4266": "#a85d4a", "#4f567f": "#c47a5f", "#585f8f": "#d68b6d", "#6c74a8": "#eaa985" },
}
for (const [name, swaps] of Object.entries(PAINTS)) {
  let out = wall
  for (const [from, to] of Object.entries(swaps)) out = out.replaceAll(from, to)
  write(join(images, "walls", `${name}.svg`), out)
}

console.log(`wrote ${Object.keys(FURNITURE).length} furniture, ${Object.keys(PAINTS).length} walls`)
