// Where the dog is and what it is doing, apart from the view so it can be tested: a step is a
// function of the dog, its settings and the seed, and nothing else.
import type { Pose } from "./sprite.ts";
import { scale, width, type Settings } from "./settings.ts";

/** How far the dog moves per step, in art pixels. */
const STEP = 1;

/** What the dog is doing. */
export type Mode =
  | { kind: "walk" }
  /** Standing still for this many more steps. */
  | { kind: "sit"; steps: number }
  /** Barking for this many more steps. */
  | { kind: "bark"; steps: number };

export interface Walker {
  /** Left edge, in screen pixels from the track's start. */
  x: number;
  /** Whether it faces left. */
  left: boolean;
  mode: Mode;
  pose: Pose;
  /** How many steps it has taken: the walk's two poses and the wag's follow it. */
  tick: number;
}

/** A tiny xorshift (the art's, in 64 bits), enough to make the dog's mind up. */
export class Rng {
  private state: bigint;

  constructor(seed: number | bigint) {
    this.state = BigInt(seed) & 0xffffffffffffffffn;
  }

  private next(): bigint {
    const mask = 0xffffffffffffffffn;
    this.state ^= (this.state << 13n) & mask;
    this.state ^= this.state >> 7n;
    this.state ^= (this.state << 17n) & mask;
    return this.state;
  }

  /** True one time in `n`. */
  oneIn(n: number): boolean {
    return this.next() % BigInt(n) === 0n;
  }

  /** A number from `low` to `high`, both included. */
  between(low: number, high: number): number {
    return low + Number(this.next() % BigInt(high - low + 1));
  }
}

/** A seed from the clock, never zero (xorshift stays at zero once it is there). */
export function seeded(): Rng {
  return new Rng(BigInt(Bun.nanoseconds()) | 1n);
}

/** The dog as it comes out: sitting at the start of its track, facing right. */
export function born(): Walker {
  return { x: 0, left: false, mode: { kind: "sit", steps: 12 }, pose: "wag-a", tick: 0 };
}

/** One step of the dog's life: where it walks, when it rests, and the frame it is drawn in. */
export function step(dog: Walker, settings: Settings, rng: Rng): Walker {
  const tick = dog.tick + 1;
  const room = Math.max(settings.track - width(settings), 0);
  let x = Math.min(Math.max(dog.x, 0), room);
  let left = dog.left;
  switch (dog.mode.kind) {
    case "walk": {
      const pace = STEP * scale(settings);
      x += left ? -pace : pace;
      if (x <= 0 || x >= room) {
        x = Math.min(Math.max(x, 0), room);
        left = !left;
      }
      const pose: Pose = tick % 2 === 0 ? "walk-a" : "walk-b";
      const mode: Mode = rng.oneIn(40) ? { kind: "sit", steps: rng.between(16, 48) } : { kind: "walk" };
      return { x, left, pose, tick, mode };
    }
    case "sit":
      if (dog.mode.steps === 0) {
        if (rng.oneIn(3)) left = !left;
        return { x, left, pose: "walk-a", tick, mode: { kind: "walk" } };
      }
      return {
        x,
        left,
        tick,
        pose: rng.oneIn(25) ? "blink" : (tick >> 1) % 2 === 0 ? "wag-a" : "wag-b",
        mode: { kind: "sit", steps: dog.mode.steps - 1 },
      };
    case "bark":
      if (dog.mode.steps === 0) {
        return { x, left, pose: "wag-a", tick, mode: { kind: "sit", steps: rng.between(8, 20) } };
      }
      // Mouth opens and shuts: two barks.
      return {
        x,
        left,
        tick,
        pose: Math.trunc(dog.mode.steps / 2) % 2 === 1 ? "bark" : "wag-a",
        mode: { kind: "bark", steps: dog.mode.steps - 1 },
      };
  }
}

/** The dog barks: clicked, or `bark` called. It goes on standing where it is. */
export function bark(dog: Walker): Walker {
  return { ...dog, mode: { kind: "bark", steps: 8 }, pose: "bark" };
}

/** Whether the dog is barking now, which is when it says so. */
export function barking(dog: Walker): boolean {
  return dog.mode.kind === "bark";
}
