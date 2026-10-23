// What the package contributes without running, as the app reads it: Settings shows the options, and
// the app knows where the buttons go without starting the package.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pumi = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;

test("its options are declared for Settings, each with what it says", () => {
  expect(Object.keys(pumi.contributes.options)).toEqual(["side", "focused_only", "command"]);
  for (const [key, spec] of Object.entries<any>(pumi.contributes.options)) {
    expect({ key, type: spec.type }).toEqual({ key, type: expect.stringMatching(/^(boolean|number|string|table|secret)$/) });
    expect(spec.desc).toBeTruthy();
  }
  expect(pumi.contributes.options.side.choices).toEqual(["right", "down"]);
  expect(pumi.contributes.options.command.default).toBe("pi");
});

test("it contributes the buttons to the strip of a pi pane", () => {
  expect(pumi.name).toBe("pi-session");
  expect(pumi.contributes.slots).toEqual({ "pane.strip": { view: "Strip" } });
  expect(pumi.contributes.blocks).toBeUndefined();
});
