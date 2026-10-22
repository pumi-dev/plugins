// The dog, as pixel art. Each frame is a grid of characters, one per pixel, drawn facing right;
// left-facing frames are the same rows reversed. The view draws the grid as divs, one per run of a
// colour, in the theme's colours.
import type { Tokens } from "pumi";

/** Width and height of every frame, in art pixels. */
export const W = 22;
export const H = 15;

/** A character's colour, as the name of one of the theme's tokens: the art was drawn in Catppuccin
 * Mocha's, and these are the nearest the theme has, so it is the same dog in every appearance. `.`
 * is transparent. */
const PALETTE: Record<string, string> = {
  o: "editor", // outline, the darkest fur
  d: "border", // shaded fur, the ears
  g: "muted", // fur
  l: "text", // light fur: muzzle, brows, chest
  e: "surface", // eye
  w: "accentText", // the eye's glint
  n: "surface", // nose
  t: "error", // tongue
  m: "active", // open mouth
};

/** The colour a character of the art is drawn in, or `undefined` for `.` (nothing). */
export function colour(c: string, t: Tokens): string | undefined {
  const token = PALETTE[c];
  return token === undefined ? undefined : t[token];
}

/** The head, body and curled tail, rows 0..=10. */
const BODY: string[] = [
  "............d...d.....",
  "...........dd..dd.....",
  "...........dggggggd...",
  "..gg......dgglglgggd..",
  ".gllg.....dgllllllllg.",
  ".glllg....dglllewlllll",
  "..ggl.....dgllleelllnn",
  "....ggggggdggllllllt..",
  "....dglglglgglllllgg..",
  "....dglllllllllllgg...",
  ".....dgllllllllllg....",
];

/** The tail swung back, drawn over the body's columns 0..6, rows 3..=7. */
const TAIL_SIDE: string[] = ["......", ".gg...", "gllg..", "glllg.", ".ggggg"];

/** Legs, rows 11..=14. */
const LEGS_STAND: string[] = [
  "......gg..gg..gg..gg..",
  "......gg..gg..gg..gg..",
  "......gl..gl..gl..gl..",
  "......oo..oo..oo..oo..",
];
const LEGS_STRIDE: string[] = [
  ".....gg..gg...gg..gg..",
  "....gg....gg.gg....gg.",
  "....gl.....glgl.....gl",
  "....oo.....oooo.....oo",
];
const LEGS_TUCK: string[] = [
  "......gg.gg....gg.gg..",
  "......gg.gg....gg.gg..",
  "......gl.gl....gl.gl..",
  "......oo.oo....oo.oo..",
];

/** A frame the dog is drawn in. */
export type Pose = "walk-a" | "walk-b" | "wag-a" | "wag-b" | "blink" | "bark";

export const POSES: Pose[] = ["walk-a", "walk-b", "wag-a", "wag-b", "blink", "bark"];

/** The frame's pixels, facing right: `H` rows of `W` characters. */
export function grid(pose: Pose): string[] {
  const rows = [...BODY];
  const legs = pose === "walk-a" ? LEGS_STRIDE : pose === "walk-b" ? LEGS_TUCK : LEGS_STAND;
  rows.push(...legs);
  if (pose === "wag-b") {
    // The tail swung back over the body.
    TAIL_SIDE.forEach((tail, i) => {
      rows[3 + i] = tail + rows[3 + i]!.slice(tail.length);
    });
  }
  const set = (y: number, x: number, c: string) => {
    const row = rows[y]!;
    rows[y] = row.slice(0, x) + c + row.slice(x + 1);
  };
  if (pose === "blink") {
    set(5, 15, "l");
    set(5, 16, "l");
    set(6, 15, "o");
    set(6, 16, "o");
  } else if (pose === "bark") {
    // Mouth open, tongue out.
    set(7, 17, "m");
    set(7, 18, "m");
    set(7, 19, "t");
    set(7, 20, "t");
    set(8, 18, "t");
  }
  return rows;
}

/** A run of one colour in a frame, in art pixels: `x` from the left of the frame facing right. */
export interface Run {
  x: number;
  y: number;
  w: number;
  /** The palette's character, `.` for nothing drawn. */
  c: string;
}

/** The frame's runs of one colour, from `x`, facing right or left (the rows reversed). */
export function runs(pose: Pose, left: boolean): Run[] {
  const out: Run[] = [];
  grid(pose).forEach((row, y) => {
    for (let x = 0; x < W; ) {
      const c = row[left ? W - 1 - x : x]!;
      let end = x + 1;
      while (end < W && row[left ? W - 1 - end : end] === c) end++;
      out.push({ x, y, w: end - x, c });
      x = end;
    }
  });
  return out;
}

/** A rect of one colour, in screen pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** The frame as rects, `scale` screen pixels per art pixel. Runs of one colour are one rect, which
 * keeps the drawing small; `.` runs are left out. */
export function paint(pose: Pose, left: boolean, scale: number, t: Tokens): Rect[] {
  const out: Rect[] = [];
  for (const run of runs(pose, left)) {
    const drawn = colour(run.c, t);
    if (!drawn) continue;
    out.push({ x: run.x * scale, y: run.y * scale, w: run.w * scale, h: scale, color: drawn });
  }
  return out;
}
