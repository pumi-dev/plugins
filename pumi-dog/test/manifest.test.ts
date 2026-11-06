// What the package contributes without running, as the app reads it: Settings shows its three
// options, and the window knows which export draws the dog in the side bar.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pumi = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;

test("its three options are declared for Settings, each with what it says", () => {
  const options = pumi.contributes.options;
  expect(Object.keys(options)).toEqual(["speed", "track", "size"]);
  for (const [key, spec] of Object.entries<any>(options)) {
    expect({ key, type: spec.type, group: spec.group }).toEqual({ key, type: "number", group: "Pumi dog" });
    expect(spec.desc).toBeTruthy();
    expect(spec.min).toBeLessThan(spec.max);
  }
  expect(options.speed).toMatchObject({ default: 8, min: 2, max: 16 });
  expect(options.speed.unit).toBe("fps");
});

test("its dog is a section of the side bar, put away and back by a command", () => {
  expect(pumi.name).toBe("pumi-dog");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.contributes.slots).toEqual({ panel: { component: "Dog", title: "Pumi dog", icon: "sparkle" } });
  expect(pumi.contributes.points).toBeUndefined();
  expect(pumi.contributes.blocks).toBeUndefined();
  expect(pumi.contributes.commands).toEqual([{ id: "toggle", title: "Pumi dog: take it away, or bring it back" }]);
  expect(pumi.activation).toEqual(["onStartup"]);
});
