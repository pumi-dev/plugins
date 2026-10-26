// The manifest against what it names: the app draws a block with the `ui.tsx` export named for it
// (`chat` is `Chat`), so a rename that misses one is a pane that draws nothing. The manifest also
// has one shape (`blocks`, `renderers`, `slots`): `views` and `points` are refused.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;
const ui = readFileSync(join(dir, "src", "ui.tsx"), "utf8");

/** The names `ui.tsx` exports as functions or consts. */
function exported(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) names.add(match[1]!);
  return names;
}

/** The export that draws block `id`: its first letter in capitals (`chat` is `Chat`). */
function rendererOf(id: string): string {
  return `${id[0]!.toUpperCase()}${id.slice(1)}`;
}

describe("the manifest", () => {
  test("contributes what pumi reads, and nothing it refuses", () => {
    expect(Object.keys(manifest.contributes).sort()).toEqual(["blocks", "commands", "options"]);
    expect(manifest.activation).toEqual(["onStartup"]);
  });

  test("its chat block is drawn by the export named for it", () => {
    const names = exported(ui);
    const blocks: { id: string }[] = manifest.contributes.blocks;
    expect(blocks.map((block) => block.id)).toEqual(["chat"]);
    for (const block of blocks) expect(names.has(rendererOf(block.id))).toBe(true);
  });

  test("names the commands a pane is opened, handed off and given back by", () => {
    expect(manifest.contributes.commands.map((command: { id: string }) => command.id)).toEqual(["new", "open", "handoff", "back"]);
  });
});
