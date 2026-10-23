// The dog's art: every frame is the same size, every pixel is a colour or nothing, a frame paints
// as runs of one colour inside its box, and a left-facing frame is the right-facing one reversed.
import { expect, test } from "bun:test";
import type { Tokens } from "pumi";
import { colour, grid, H, paint, POSES, runs, W } from "../src/sprite.ts";

/** A theme to paint with: the art asks for the theme's token names, and every one of them is a
 * colour (the window hands `useTheme()`'s own in). */
const THEME: Tokens = {
  window: "#282c34",
  surface: "#26282b",
  editor: "#1e1f22",
  text: "#dfe1e5",
  muted: "#b0b1b3",
  faint: "#888a8f",
  border: "#393b41",
  hover: "#3c3e41",
  active: "#494a4d",
  selected: "#4a4d54",
  accent: "#3474f0",
  accentText: "#ffffff",
  warning: "#f0c674",
  error: "#cc6666",
  success: "#a6e3a1",
  overlay: "#26282bf2",
  "agent.working": "#89b4fa",
  "agent.blocked": "#fab387",
  "agent.error": "#f38ba8",
  "agent.done": "#a6e3a1",
  "agent.idle": "#9399b2",
  "agent.unknown": "#6c7086",
};

test("every frame is the same size", () => {
  for (const pose of POSES) {
    const rows = grid(pose);
    expect(rows.length).toBe(H);
    for (const row of rows) expect(row.length).toBe(W);
  }
});

test("every pixel has a colour", () => {
  for (const pose of POSES) {
    for (const row of grid(pose)) {
      for (const c of row) expect(c === "." || colour(c, THEME) !== undefined).toBe(true);
    }
  }
});

test("a row's runs cover it, left to right", () => {
  for (const pose of POSES) {
    const covered = new Map<number, number>();
    for (const run of runs(pose, false)) covered.set(run.y, (covered.get(run.y) ?? 0) + run.w);
    expect([...covered.values()]).toEqual(Array.from({ length: H }, () => W));
  }
});

test("a left-facing frame is the right-facing one mirrored", () => {
  for (const pose of POSES) {
    const mirrored = runs(pose, false)
      .map((run) => ({ ...run, x: W - run.x - run.w }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    expect(runs(pose, true)).toEqual(mirrored);
  }
});

test("a painted frame stays in the dog's box, at its scale", () => {
  const scale = 2;
  for (const pose of POSES) {
    for (const command of paint(pose, false, scale, THEME)) {
      expect(command.x).toBeGreaterThanOrEqual(0);
      expect(command.y).toBeGreaterThanOrEqual(0);
      expect(command.x + command.w).toBeLessThanOrEqual(W * scale);
      expect(command.y + command.h).toBeLessThanOrEqual(H * scale);
      expect(typeof command.color).toBe("string");
    }
  }
});

test("nothing is painted where the art is transparent", () => {
  const painted = paint("walk-a", false, 1, THEME);
  expect(painted.length).toBeLessThan(runs("walk-a", false).length);
  for (const command of painted) expect(command.color).not.toBe("");
});

test("the bark frame has the tongue out, and the blink's eye is shut", () => {
  const barked = grid("bark");
  expect([barked[7]!.slice(17, 21), barked[8]![18]]).toEqual(["mmtt", "t"]);
  const blinked = grid("blink");
  expect(blinked[5]!.slice(15, 17)).toBe("ll");
  expect(blinked[6]!.slice(15, 17)).toBe("oo");
});
