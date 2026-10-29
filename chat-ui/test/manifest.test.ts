// The manifest against what it names: the app loads a slot's component and a block's renderer by
// the export named in `package.json`, so a rename that misses one is a tab that draws nothing. The
// manifest also has one shape (`blocks`, `renderers`, `slots`): `views` and `points` are refused.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;
const ui = readFileSync(join(dir, "src", "ui.tsx"), "utf8");

/** The names `ui.tsx` exports as functions or consts, or passes on from another file (`export { Session } from`). */
function exported(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) names.add(match[1]!);
  for (const match of source.matchAll(/export\s+\{([^}]*)\}\s+from/g)) for (const name of match[1]!.split(",")) names.add(name.trim());
  return names;
}

describe("the manifest", () => {
  test("contributes what pumi reads, and nothing it refuses", () => {
    expect(Object.keys(manifest.contributes).sort()).toEqual(["blocks", "commands", "options", "renderers", "settings", "slots"]);
    expect(manifest.activation).toEqual(["onStartup"]);
  });

  test("draws terminals with an export of ui.tsx", () => {
    const names = exported(ui);
    const renderers: Record<string, string> = manifest.contributes.renderers;
    expect(Object.keys(renderers)).toEqual(["terminal"]);
    for (const name of Object.values(renderers)) expect(names.has(name)).toBe(true);
  });

  test("gives its slot components from ui.tsx", () => {
    const names = exported(ui);
    const slots: Record<string, { component?: string }> = manifest.contributes.slots;
    expect(Object.keys(slots)).toEqual(["tab.toolbar"]);
    for (const slot of Object.values(slots)) expect(names.has(slot.component!)).toBe(true);
  });

  test("names the commands it serves", () => {
    expect(manifest.contributes.commands.map((command: { id: string }) => command.id)).toEqual(["toggle", "handoff", "back"]);
  });

  test("draws its own block and its Settings page with exports of ui.tsx", () => {
    const names = exported(ui);
    expect(manifest.contributes.blocks.map((block: { id: string }) => block.id)).toEqual(["session"]);
    expect(names.has("Session")).toBe(true);
    for (const page of manifest.contributes.settings.pages) expect(names.has(page.component)).toBe(true);
  });

  test("declares the options main.ts reads", () => {
    expect(Object.keys(manifest.contributes.options).sort()).toEqual(["bun", "history_mb", "key", "modes"]);
  });
});
