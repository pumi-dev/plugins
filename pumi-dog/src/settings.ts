// What the dog reads of its options, and the numbers the walker and the view are made of.
import { option } from "pumi";
import { H, W } from "./sprite.ts";

/** The dog's three options, as numbers. `speed` is the frame rate, `track` the room it walks along
 * and `size` its height, all in screen pixels (but the frames per second). */
export interface Settings {
  fps: number;
  track: number;
  height: number;
}

/** The dog as its options leave it when none of them was set: the manifest's own defaults. */
export const DEFAULTS: Settings = { fps: 8, track: 140, height: 20 };

/** The three options' keys. */
export type Key = "speed" | "track" | "size";

/** `n` held between `low` and `high`. */
function clamp(n: number, low: number, high: number): number {
  return Math.min(Math.max(n, low), high);
}

/** The settings `number` answers for each key, within the ranges the options are declared with. The
 * ranges are wider than the manifest's, so an option set past its slider still leaves a dog that
 * moves and fits. */
export function read(number: (key: Key) => number | null | undefined): Settings {
  return {
    fps: clamp(number("speed") ?? DEFAULTS.fps, 1, 20),
    track: clamp(number("track") ?? DEFAULTS.track, 40, 600),
    height: clamp(number("size") ?? DEFAULTS.height, 10, 48),
  };
}

/** The value of an option, as a number, when it is one. */
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The settings its options say now. */
export async function current(): Promise<Settings> {
  const [speed, track, size] = await Promise.all([option.get("speed"), option.get("track"), option.get("size")]);
  return read((key) => numeric({ speed, track, size }[key]));
}

/** How long between two frames, in milliseconds. */
export function interval(settings: Settings): number {
  return 1000 / settings.fps;
}

/** Screen pixels per art pixel. */
export function scale(settings: Settings): number {
  return settings.height / H;
}

/** How wide the dog is, in screen pixels. */
export function width(settings: Settings): number {
  return W * scale(settings);
}
