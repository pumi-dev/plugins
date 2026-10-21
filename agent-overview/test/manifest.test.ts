// What the package contributes without running, as the app reads it: Settings shows its options,
// the palette its command, and the app knows the view it draws.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dir } from "./fake.ts";

const pumi = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;

test("its four options are declared for Settings, each with what it says", () => {
  expect(Object.keys(pumi.contributes.options)).toEqual(["poll_secs", "hide_idle", "rail_width", "key"]);
  for (const [key, spec] of Object.entries<any>(pumi.contributes.options)) {
    expect({ key, type: spec.type }).toEqual({ key, type: expect.stringMatching(/^(boolean|number|string|table|secret)$/) });
    expect(spec.desc).toBeTruthy();
    expect(spec.group).toBe("Agent overview");
  }
  expect(pumi.contributes.options.poll_secs).toMatchObject({ type: "number", default: 15, min: 2, max: 600, unit: "s" });
  expect(pumi.contributes.options.hide_idle).toMatchObject({ type: "boolean", default: false });
  expect(pumi.contributes.options.rail_width).toMatchObject({ type: "number", default: 248, min: 180, max: 380, unit: "px" });
  expect(pumi.contributes.options.key).toMatchObject({ type: "string", default: "", placeholder: "<M-a>" });
});

test("it contributes its view and its command, and starts with the app", () => {
  expect(pumi.name).toBe("agent-overview");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.api).toBe(1);
  expect(pumi.contributes.views).toEqual([{ id: "overview", title: "Agent overview", icon: "blocks" }]);
  expect(pumi.contributes.commands).toEqual([{ id: "open", title: "Open the agent overview" }]);
  expect(pumi.activation).toEqual(["onStartup"]);
});
