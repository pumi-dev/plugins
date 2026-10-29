// The manifest against what it names: the app loads a slot's component and a block's renderer by
// the export named in `package.json`, so a rename that misses one is a tab that draws nothing. The
// manifest also has one shape (`blocks`, `slots`): `views` and `points` are refused.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AGENT, PREFIX } from "../src/names.ts";

const dir = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;
const ui = readFileSync(join(dir, "src", "ui.tsx"), "utf8");

const settings = readFileSync(join(dir, "src", "settings.tsx"), "utf8");

/** The names `ui.tsx` exports as functions or consts, or passes on from another file (`export { A } from`). */
function exported(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) names.add(match[1]!);
  for (const match of source.matchAll(/export\s*\{([^}]*)\}\s*from/g)) for (const name of match[1]!.split(",")) if (name.trim()) names.add(name.trim());
  return names;
}

describe("the manifest", () => {
  test("contributes what pumi reads, and nothing it refuses", () => {
    expect(Object.keys(manifest.contributes).sort()).toEqual(["blocks", "commands", "keys", "options", "settings", "slots", "traits"]);
    expect(manifest.activation).toEqual(["onStartup"]);
  });

  test("an agent's tab is a block of its own: its terminal on the terminal engine, or a chat tab, each drawn by an export of ui.tsx", () => {
    const blocks: { id: string; engine?: string }[] = manifest.contributes.blocks;
    expect(blocks.map((b) => [b.id, b.engine])).toEqual([
      ["term", "terminal"],
      ["session", undefined],
    ]);
    // A block is drawn by the export named for it: `term` by `Term`, `session` by `Session`.
    expect(exported(ui).has("Term")).toBe(true);
    expect(exported(ui).has("Session")).toBe(true);
  });

  test("gives its slot components from ui.tsx", () => {
    const names = exported(ui);
    const slots: Record<string, { component?: string }> = manifest.contributes.slots;
    expect(Object.keys(slots)).toEqual(["tab.toolbar"]);
    for (const slot of Object.values(slots)) expect(names.has(slot.component!)).toBe(true);
  });

  test("gives its one Settings page from ui.tsx, and draws every option there", () => {
    const names = exported(ui);
    const { pages, sections } = manifest.contributes.settings as { pages: { id: string; component: string }[]; sections?: unknown[] };
    expect(pages.map((page) => page.component)).toEqual(["SettingsPage"]);
    expect(sections).toBeUndefined();
    expect(names.has("SettingsPage")).toBe(true);
    // A plugin with a page of its own gets no page made of its options: each is on it. The modes
    // are the agents' switches.
    for (const key of Object.keys(manifest.contributes.options)) {
      if (key === "modes") expect(settings).toContain("${PREFIX}modes");
      else expect(settings).toContain(`<OptionRow name={\`\${PREFIX}${key}\`} />`);
    }
  });

  test("names the commands it serves", () => {
    expect(manifest.contributes.commands.map((command: { id: string }) => command.id)).toEqual(["toggle", "handoff", "back"]);
  });

  test("declares the options main.ts and tell.ts read", () => {
    expect(Object.keys(manifest.contributes.options).sort()).toEqual(["context", "hooks", "modes", "permissions", "prefer"]);
  });

  test("is the plugin whose prefix the hooks call and its trait is named by", () => {
    expect(PREFIX).toBe(`${manifest.owner}.${manifest.name.replaceAll("-", "_")}.`);
    const traits: { id: string; fields: string[] }[] = manifest.contributes.traits;
    expect(traits.map((each) => `@${PREFIX}${each.id}`)).toEqual([AGENT]);
    expect(traits[0]!.fields).toEqual(["session", "model", "transcript", "accepts", "conversation"]);
  });
});
