// What the dog reads of its options: the defaults the manifest declares, the ranges the art needs,
// and the numbers the frame is drawn at.
import { expect, test } from "bun:test";
import manifest from "../package.json";
import { DEFAULTS, interval, read, scale, width, type Key } from "../src/settings.ts";
import { H, W } from "../src/sprite.ts";

/** The settings of `values`, as `read` reads them. */
function of(values: Partial<Record<Key, number>>) {
  return read((key) => values[key]);
}

test("the defaults are the manifest's", () => {
  const options = manifest.pumi.contributes.options;
  expect({ fps: options.speed.default, track: options.track.default, height: options.size.default }).toEqual(DEFAULTS);
});

test("its options are clamped to the ranges a dog moves in", () => {
  expect(of({ speed: 500, track: 1, size: 2 })).toEqual({ fps: 20, track: 40, height: 10 });
  expect(of({ speed: 0, track: 10_000, size: 100 })).toEqual({ fps: 1, track: 600, height: 48 });
});

test("a value in range is kept", () => {
  expect(of({ speed: 12, track: 300, size: 32 })).toEqual({ fps: 12, track: 300, height: 32 });
});

test("the frame rate is an interval between frames", () => {
  expect(interval(DEFAULTS)).toBe(125);
  expect(interval(of({ speed: 20 }))).toBe(50);
  expect(interval(of({ speed: 1 }))).toBe(1000);
});

test("the dog is drawn at its height, and as wide as the art makes it", () => {
  expect(scale(DEFAULTS)).toBe(DEFAULTS.height / H);
  expect(width(DEFAULTS)).toBe((W * DEFAULTS.height) / H);
  expect(width(of({ size: 30 }))).toBe(44);
});
