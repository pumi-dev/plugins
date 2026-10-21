// The dog's state machine, on its own: a step is a function of the dog, its settings and the seed,
// so every walk, rest and bark below is the same on every run.
import { expect, test } from "bun:test";
import { DEFAULTS, scale, width, type Settings } from "../src/settings.ts";
import { bark, barking, born, Rng, step, type Walker } from "../src/walker.ts";

/** The dog after `n` steps. */
function stepped(dog: Walker, n: number, rng: Rng, settings: Settings = DEFAULTS): Walker {
  for (let i = 0; i < n; i++) dog = step(dog, settings, rng);
  return dog;
}

test("the dog comes out sitting at the start of its track, facing right", () => {
  expect(born()).toEqual({ x: 0, left: false, mode: { kind: "sit", steps: 12 }, pose: "wag-a", tick: 0 });
});

test("it stays on its track", () => {
  const settings = DEFAULTS;
  let dog = born();
  const rng = new Rng(42);
  for (let i = 0; i < 10_000; i++) {
    dog = step(dog, settings, rng);
    expect(dog.x).toBeGreaterThanOrEqual(0);
    expect(dog.x + width(settings)).toBeLessThanOrEqual(settings.track + 0.01);
  }
});

test("it walks both ways and rests", () => {
  let dog = born();
  const rng = new Rng(7);
  const seen = { left: 0, right: 0, sit: 0, bark: 0 };
  for (let i = 0; i < 5_000; i++) {
    dog = step(dog, DEFAULTS, rng);
    if (dog.mode.kind === "sit") seen.sit++;
    else if (dog.mode.kind === "bark") seen.bark++;
    else if (dog.left) seen.left++;
    else seen.right++;
  }
  expect(seen.left).toBeGreaterThan(0);
  expect(seen.right).toBeGreaterThan(0);
  expect(seen.sit).toBeGreaterThan(0);
});

test("a walk takes two frames, and turns around at the end of its track", () => {
  const settings = DEFAULTS;
  const room = settings.track - width(settings);
  const rng = new Rng(1);
  let dog: Walker = { ...born(), mode: { kind: "walk" }, x: 0 };
  dog = step(dog, settings, rng);
  expect([dog.pose, dog.left, dog.tick]).toEqual(["walk-b", false, 1]);
  expect(dog.x).toBeCloseTo(1.3333, 3);
  dog = step(dog, settings, rng);
  expect([dog.pose, dog.tick]).toEqual(["walk-a", 2]);
  // A step past the end of the track is taken as a step back, not off it.
  let turned: Walker = { ...born(), mode: { kind: "walk" }, x: room - scale(settings) / 2 };
  turned = step(turned, settings, rng);
  expect([turned.left, turned.x]).toEqual([true, room]);
});

test("a walk can end in a rest", () => {
  // The longest walk the dog takes before it rests: it looks up its mind every step, one in 40.
  let dog: Walker = { ...born(), mode: { kind: "walk" } };
  const rng = new Rng(3);
  let steps = 0;
  while (dog.mode.kind === "walk" && steps < 1_000) {
    dog = step(dog, DEFAULTS, rng);
    steps++;
  }
  expect(steps).toBeLessThan(1_000);
  expect(dog.mode.kind).toBe("sit");
  if (dog.mode.kind === "sit") expect(dog.mode.steps).toBeGreaterThanOrEqual(16);
});

test("a rest counts down, then the dog walks", () => {
  let dog: Walker = { ...born(), mode: { kind: "sit", steps: 1 }, tick: 0 };
  const rng = new Rng(1);
  dog = step(dog, DEFAULTS, rng);
  expect(dog.mode).toEqual({ kind: "sit", steps: 0 });
  dog = step(dog, DEFAULTS, rng);
  expect(dog.mode).toEqual({ kind: "walk" });
  expect(dog.pose).toBe("walk-a");
});

test("a bark ends in a rest", () => {
  let dog = bark(born());
  expect(barking(dog)).toBe(true);
  const rng = new Rng(1);
  for (let i = 0; i < 9; i++) dog = step(dog, DEFAULTS, rng);
  expect(barking(dog)).toBe(false);
  expect(dog.mode.kind).toBe("sit");
  // A rest it comes out of with a wag or a blink, not a bark.
  expect(["wag-a", "wag-b", "blink"]).toContain(dog.pose);
});

test("the mouth opens and shuts, two frames at a time", () => {
  let dog = bark(born());
  const rng = new Rng(1);
  const mouths: string[] = [];
  for (let i = 0; i < 9; i++) {
    dog = step(dog, DEFAULTS, rng);
    mouths.push(dog.pose === "bark" ? "#" : ".");
  }
  expect(mouths.join("")).toBe(".##..##..");
});

test("a dog that is barking does not walk", () => {
  const dog = stepped(bark(born()), 4, new Rng(2));
  expect(dog.x).toBe(0);
  expect(barking(dog)).toBe(true);
});

test("the same seed makes the same mind up", () => {
  const walks = (seed: number) =>
    [0, 1, 2].map(() => {
      const rng = new Rng(seed);
      let dog = born();
      const seen: string[] = [];
      for (let i = 0; i < 300; i++) {
        dog = step(dog, DEFAULTS, rng);
        seen.push(`${dog.pose} ${dog.x.toFixed(2)}`);
      }
      return seen.join(",");
    });
  const [first, second, third] = walks(99);
  expect(second).toBe(first);
  expect(third).toBe(first);
  expect(walks(100)[0]).not.toBe(first);
});

test("the seed's numbers stay in their ranges", () => {
  const rng = new Rng(5);
  let heads = 0;
  for (let i = 0; i < 1_000; i++) {
    if (rng.oneIn(2)) heads++;
    const n = rng.between(8, 20);
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(20);
  }
  expect(heads).toBeGreaterThan(300);
  expect(heads).toBeLessThan(700);
});
