// The page of both kinds at once: one walk of the repository asking each half what a directory
// holds, the kinds the options turn on and off, and what the page says when there is nothing.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groupScripts } from "../../lib/script-panel/src/finder.ts";

import { defaults, finder, nothingToShow, order } from "../src/read.ts";
import { manifest, temp } from "./files.ts";

let repo = "";

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = "";
});

/** A repository with a `package.json` of two scripts, a shell script beside it, and `tools/run.sh`. */
function repository(): string {
  repo = temp("both");
  mkdirSync(join(repo, ".git"));
  writeFileSync(join(repo, "package.json"), manifest({ build: "tsc -p .", test: "bun test" }));
  writeFileSync(join(repo, "deploy.sh"), "#!/bin/bash\n");
  mkdirSync(join(repo, "tools"), { recursive: true });
  writeFileSync(join(repo, "tools/run.sh"), "#!/bin/sh\n");
  return repo;
}

/** The page's groups, as `label: icon: how many`, in the order it lists them. */
function page(over: Parameters<typeof defaults>[0] = {}): string[] {
  return groupScripts(finder(defaults(over)), repo).map((group) => `${group.label}: ${group.icon}: ${group.items.length}`);
}

test("a directory's package scripts and its own shell scripts are two groups", () => {
  repository();
  expect(page()).toEqual([".: terminal: 1", "package.json: box: 2", "tools: terminal: 1"]);
});

test("each kind is listed only while its option is on", () => {
  repository();
  expect(page({ shells: false })).toEqual(["package.json: box: 2"]);
  expect(page({ packages: false })).toEqual([".: terminal: 1", "tools: terminal: 1"]);
  expect(page({ packages: false, shells: false })).toEqual([]);
});

test("the page says what it looked for when it found nothing", () => {
  expect(nothingToShow({ packages: true, shells: true })).toBe("No scripts found");
  expect(nothingToShow({ packages: true, shells: false })).toBe("No package.json with scripts found");
  expect(nothingToShow({ packages: false, shells: true })).toBe("No shell scripts found");
  expect(nothingToShow({ packages: false, shells: false })).toContain("Both kinds are off");
});

test("the finder says how deep to look, and shows the command only when told to", () => {
  repository();
  const find = finder(defaults({ depth: 2, showCommand: false }));
  expect(find.depth).toBe(2);
  expect(find.showDetail).toBe(false);
  expect(find.empty).toBe("No scripts found");
});

test("the order is by label, or the groups with most scripts first", () => {
  repository();
  const labels = (by: "path" | "scripts"): string[] => groupScripts(finder(defaults({ sort: by })), repo).map((group) => group.label);
  expect(labels("path")).toEqual([".", "package.json", "tools"]);
  expect(labels("scripts")).toEqual(["package.json", ".", "tools"]);
});

test("by order's last word, groups of as many scripts stay in label order", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `s${i}`, detail: "", command: `run s${i}` }));
  const groups = [
    { label: "b", dir: repo, items: items(1) },
    { label: "a", dir: repo, items: items(1) },
    { label: "c", dir: repo, items: items(3) },
  ];
  order(groups, "path");
  expect(groups.map((group) => group.label)).toEqual(["a", "b", "c"]);
  order(groups, "scripts");
  expect(groups.map((group) => group.label)).toEqual(["c", "a", "b"]);
});
