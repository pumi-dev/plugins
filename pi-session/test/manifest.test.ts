// What the package contributes without running, as the app reads it: Settings shows the options, and
// the app knows the view whose panes the buttons are.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dir } from "./fake.ts";

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

test("it contributes its view, and starts with the app", () => {
  expect(pumi.name).toBe("pi-session");
  expect(pumi.contributes.views).toEqual([{ id: "strip", title: "Pi session", icon: "git_branch" }]);
  expect(pumi.activation).toEqual(["onStartup"]);
});
