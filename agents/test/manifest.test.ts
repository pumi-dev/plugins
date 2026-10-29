// The manifest against what it names: the app loads a slot's component and a block's renderer by
// the export named in `package.json`, so a rename that misses one is a tab that draws nothing. The
// manifest also has one shape (`blocks`, `renderers`, `slots`): `views` and `points` are refused.
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
    expect(Object.keys(manifest.contributes).sort()).toEqual(["commands", "options", "renderers", "settings", "slots", "traits"]);
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

  test("gives its Settings page and section from ui.tsx, and draws every option there", () => {
    const names = exported(ui);
    const { pages, sections } = manifest.contributes.settings as { pages: { id: string; component: string }[]; sections: { page: string; component: string }[] };
    expect(pages.map((page) => page.component)).toEqual(["SettingsPage"]);
    expect(sections.map((section) => [section.page, section.component])).toEqual([["settings", "HooksSection"]]);
    for (const each of [...pages, ...sections]) expect(names.has(each.component)).toBe(true);
    // A plugin with pages of its own gets no page made of its options: each is drawn by one of them.
    for (const key of Object.keys(manifest.contributes.options)) expect(settings).toContain(`"${key}"`.replace(/^"(permissions|restore)"$/, "${PREFIX}$1"));
  });

  test("names a command the toggle runs", () => {
    expect(manifest.contributes.commands.map((command: { id: string }) => command.id)).toEqual(["toggle"]);
  });

  test("is the plugin whose prefix the hooks call and its trait is named by", () => {
    expect(PREFIX).toBe(`${manifest.owner}.${manifest.name.replaceAll("-", "_")}.`);
    const traits: { id: string; fields: string[] }[] = manifest.contributes.traits;
    expect(traits.map((each) => `@${PREFIX}${each.id}`)).toEqual([AGENT]);
    expect(traits[0]!.fields).toEqual(["session", "model", "transcript", "accepts", "conversation"]);
  });
});
