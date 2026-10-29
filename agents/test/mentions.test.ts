// What an `@` finds in a project: its files and directories, best first, and the ignored ones left out.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mentions, searchPaths } from "../src/mentions.ts";

const root = mkdtempSync(join(tmpdir(), "agents-mentions-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function file(path: string, text = ""): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

file(join(root, "src/ui/composer.tsx"), "x");
file(join(root, "src/main.ts"), "x");
file(join(root, ".gitignore"), "dist/\n");
file(join(root, "dist/out.js"), "x");

test("the files and directories under a directory, best first", async () => {
  const hits = await mentions(root, "composer");
  expect(hits[0]).toEqual({ path: "src/ui/composer.tsx" });
  const dirs = await mentions(root, "u");
  expect(dirs.some((hit) => hit.dir && hit.path === "src/ui")).toBe(true);
  // What a .gitignore leaves out is left out.
  expect((await mentions(root, "out")).map((hit) => hit.path)).not.toContain("dist/out.js");
  // Nothing to find, and nowhere to look.
  expect(await mentions(root, "nothing-like-this")).toEqual([]);
  expect(await mentions(undefined, "x")).toEqual([]);
});

test("an empty query: the shallowest paths, directories before files", () => {
  const paths = [
    { path: "src/main.ts", dir: false, nameAt: 4 },
    { path: "src", dir: true, nameAt: 0 },
    { path: "src/ui/composer.tsx", dir: false, nameAt: 7 },
    { path: "src/ui", dir: true, nameAt: 4 },
    { path: "README.md", dir: false, nameAt: 0 },
  ];
  // At the same depth a directory comes first: the tree is browsed one part at a time.
  expect(searchPaths(paths, "").map((hit) => hit.path)).toEqual(["src", "README.md", "src/ui", "src/main.ts", "src/ui/composer.tsx"]);
  expect(searchPaths(paths, "", 2).length).toBe(2);
});
