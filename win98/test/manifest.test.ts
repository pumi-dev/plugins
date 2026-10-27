// What the package contributes without running, as the app reads it: Settings shows its four
// settings, and the window knows which theme it draws.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pumi = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;

test("it is a theme, with no worker and no page of its own", () => {
  expect(pumi.name).toBe("win98");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.api).toBe(1);
  expect(pumi.main).toBeUndefined();
  expect(pumi.uses).toBeUndefined();
  expect(pumi.themes).toEqual(["themes/win98"]);
  expect(existsSync(join(dir, "themes/win98/theme.tsx"))).toBe(true);
});

test("its four settings are declared for Settings, each with what it says", () => {
  const options = pumi.contributes.options;
  expect(Object.keys(options)).toEqual(["pane_titles", "pane_equalize", "animate", "haptics"]);
  const groups: Record<string, string> = { pane_titles: "Panes", pane_equalize: "Panes", animate: "Motion and feedback", haptics: "Motion and feedback" };
  for (const [key, spec] of Object.entries<any>(options)) {
    expect({ key, type: spec.type, group: spec.group, default: spec.default }).toEqual({ key, type: "boolean", group: groups[key], default: true });
    expect(spec.label).toBeTruthy();
    expect(spec.desc).toBeTruthy();
  }
});

test("it contributes nothing else: every part is the theme's own", () => {
  expect(Object.keys(pumi.contributes)).toEqual(["options"]);
  expect(pumi.contributes.slots).toBeUndefined();
  expect(pumi.contributes.commands).toBeUndefined();
  expect(pumi.contributes.keys).toBeUndefined();
});
