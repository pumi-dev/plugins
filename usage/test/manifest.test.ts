// What the package contributes without running, as the app reads it: Settings shows every option
// with a label and a reason, the status bar has its view and a button, and the side bar a section.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
const pumi = pkg.pumi;

test("it is the `usage` plan bar", () => {
  expect(pumi.name).toBe("usage");
  expect(pumi.owner).toBe("amresyd");
  expect(pumi.api).toBe(1);
  expect(pumi.activation).toEqual(["onStartup"]);
  expect(pumi.uses).toEqual(["network", "files", "processes"]);
});

test("every option is declared for Settings, with its label, its reason and its default", () => {
  const options = pumi.contributes.options;
  expect(Object.keys(options).sort()).toEqual(
    [
      "alert",
      "claude",
      "codex",
      "copilot",
      "crit_at",
      "every",
      "label",
      "layout",
      "meter",
      "openrouter",
      "openrouter_key",
      "resets",
      "show",
      "copilot_token",
      "tint",
      "warn_at",
      "windows",
    ].sort(),
  );
  for (const [key, spec] of Object.entries<any>(options)) {
    expect({ key, type: spec.type }).toMatchObject({ key, type: expect.stringMatching(/boolean|number|string|table|secret/) });
    expect(spec.label, key).toBeTruthy();
    expect(spec.desc, key).toBeTruthy();
    if (spec.type !== "secret") expect(spec).toHaveProperty("default");
    if (spec.choices) expect(spec.labels, key).toHaveLength(spec.choices.length);
  }
  expect(options.show.default).toBe(true);
  expect(options.layout.default).toBe("detailed");
  expect(options.warn_at.default).toBe(70);
  expect(options.crit_at.default).toBe(90);
  expect(options.copilot_token.type).toBe("secret");
  expect(options.openrouter_key.type).toBe("secret");
});

test("the bar is a view in the status bar, with the button that reads the plans again", () => {
  expect(pumi.contributes.slots.status).toEqual({
    view: "Segments",
    actions: [{ id: "refresh", title: "Read the plans again", icon: "rotate_cw", command: "refresh" }],
  });
  expect(pumi.contributes.commands.map((c: any) => c.id)).toEqual(["refresh", "toggle"]);
  for (const command of pumi.contributes.commands) expect(command.title).toStartWith("Usage:");
  // Every action runs a command that is declared.
  const declared = pumi.contributes.commands.map((c: any) => c.id);
  for (const action of pumi.contributes.slots.status.actions) expect(declared).toContain(action.command);
});

test("the side bar has its section, drawn by the plugin", () => {
  expect(pumi.contributes.slots.panel).toEqual({ view: "Details", title: "Usage", icon: "zap" });
  expect(pumi.contributes.blocks).toBeUndefined();
});
