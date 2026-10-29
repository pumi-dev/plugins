// Going back to before a message: how each agent does it, and the pi extension this plugin ships.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AGENTS, EXTENSION_MARK, extensionCurrent, extensionFile, rewindCommand } from "../src/agents.ts";

const shipped = readFileSync(join(import.meta.dir, "..", "pi", "pumi-chat.ts"), "utf8");

test("pi and omp go to the very message, through the plugin's own extension; the others in their terminal", () => {
  expect([AGENTS.pi!.rewind, AGENTS.omp!.rewind, AGENTS.claude!.rewind, AGENTS.codex!.rewind]).toEqual(["command", "command", "picker", "backtrack"]);
  expect(extensionFile(AGENTS.pi!)).toBe(".pi/agent/extensions/pumi-chat.ts");
  expect(rewindCommand("e1")).toBe("/pumi-rewind e1");
});

test("the shipped extension registers the command and carries the version an installed copy is checked by", () => {
  expect(shipped).toContain(EXTENSION_MARK);
  expect(shipped).toContain('registerCommand("pumi-rewind"');
  expect(extensionCurrent(shipped, shipped)).toBe(true);
  expect(extensionCurrent(shipped.replace("v1", "v0"), shipped)).toBe(false);
  expect(extensionCurrent(undefined, shipped)).toBe(false);
});
