// What the package contributes without running, as the app reads it: Settings shows its two
// options, and the window knows which export draws the bar it puts on every pane.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pumi = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;

test("its two options are declared for Settings, each with what it says", () => {
  const options = pumi.contributes.options;
  expect(Object.keys(options)).toEqual(["keep", "notify"]);
  for (const [key, spec] of Object.entries<any>(options)) {
    expect({ key, type: spec.type }).toEqual({ key, type: "boolean" });
    expect(spec.label).toBeTruthy();
    expect(spec.desc).toBeTruthy();
  }
  expect(options.keep.default).toBe(true);
  expect(options.notify.default).toBe(true);
});

test("its bar is a view in the strip above every pane", () => {
  expect(pumi.name).toBe("queue");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.api).toBe(1);
  expect(pumi.contributes.slots).toEqual({ "pane.strip": { view: "Bar" } });
  expect(pumi.contributes.points).toBeUndefined();
  expect(pumi.contributes.blocks).toBeUndefined();
  expect(pumi.activation).toEqual(["onStartup"]);
});
