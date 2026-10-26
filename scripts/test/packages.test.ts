// The package half of the page: the manager that runs a package's scripts, the group its
// `package.json` makes, and the walk that finds the packages. The walk itself is `script-panel`'s;
// this is what it asks of a directory.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { groupScripts, type Finder } from "../../lib/script-panel/src/finder.ts";

import { manager, packageGroup, packageGroups } from "../src/packages.ts";
import { defaults, finder } from "../src/read.ts";
import { manifest, temp, write } from "./files.ts";

let repo = "";

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = "";
});

/** A repository to put packages in. */
function repository(): string {
  repo = temp("finder");
  mkdirSync(join(repo, ".git"), { recursive: true });
  return repo;
}

/** The page's finder, shell scripts out of the way: the packages' groups only. */
function packages(depth = 4): Finder {
  return finder(defaults({ depth, shells: false }));
}

test("a package's manager is the one its packageManager field names", () => {
  const root = repository();
  expect(manager({ packageManager: "pnpm@9.1.0" }, root, root)).toBe("pnpm");
  expect(manager({ packageManager: "yarn@4.5.0" }, root, root)).toBe("yarn");
});

test("else the first lockfile, from its directory up to the root", () => {
  const root = repository();
  write(root, "yarn.lock");
  write(root, "package-lock.json");
  const tools = join(root, "tools/a");
  mkdirSync(tools, { recursive: true });
  expect(manager({}, tools, root)).toBe("yarn");
  write(tools, "package-lock.json");
  expect(manager({}, tools, root)).toBe("npm");
  expect(manager({}, root, root)).toBe("yarn");
});

test("with no lockfile anywhere, the manager is npm", () => {
  const root = repository();
  expect(manager({}, root, root)).toBe("npm");
  // A lockfile above the repository is not looked at.
  write(root, "pnpm-lock.yaml");
  const inside = join(root, "tools");
  mkdirSync(inside);
  expect(manager({}, inside, inside)).toBe("npm");
});

test("a package's scripts are its group, labelled by its package.json", () => {
  const root = repository();
  write(root, "package.json", manifest({ test: "bun test", build: "tsc -p .", broken: 7 }));
  expect(packageGroup(root, root)).toEqual({
    label: "package.json",
    dir: root,
    icon: "box",
    items: [
      { name: "build", detail: "tsc -p .", command: "npm run build" },
      { name: "test", detail: "bun test", command: "npm run test" },
    ],
  });
});

test("a package of another directory is labelled by its path in the repository", () => {
  const root = repository();
  write(root, "package.json", manifest({}));
  write(root, "packages/ui/package.json", manifest({ "test:unit": "vitest" }));
  write(root, "packages/ui/bun.lock", "");
  expect(packageGroup(join(root, "packages/ui"), root)).toEqual({
    label: "packages/ui/package.json",
    dir: join(root, "packages/ui"),
    icon: "box",
    items: [{ name: "test:unit", detail: "vitest", command: "bun run test:unit" }],
  });
});

test("a directory without scripts is no group", () => {
  const root = repository();
  expect(packageGroups(root, root)).toEqual([]);
  expect(packageGroup(join(root, "nowhere"), root)).toBeNull();
  write(root, "package.json", JSON.stringify({ name: "no scripts" }));
  expect(packageGroup(root, root)).toBeNull();
  write(root, "package.json", manifest({}));
  expect(packageGroup(root, root)).toBeNull();
  write(root, "package.json", JSON.stringify({ scripts: ["build"] }));
  expect(packageGroup(root, root)).toBeNull();
  write(root, "package.json", "{ not json");
  expect(packageGroup(root, root)).toBeNull();
});

test("the walk finds every package with scripts, node_modules left out", () => {
  const root = repository();
  write(root, "package.json", manifest({ build: "tsc -p ." }, { workspaces: ["packages/*"] }));
  write(root, "packages/ui/package.json", manifest({ test: "vitest" }));
  write(root, "packages/ui/node_modules/x/package.json", manifest({ x: "x" }));
  write(root, "packages/empty/package.json", JSON.stringify({ name: "no scripts" }));
  const found: [string, number][] = groupScripts(packages(), root).map((group) => [group.label, group.items.length]);
  expect(found).toEqual([
    ["package.json", 1],
    ["packages/ui/package.json", 1],
  ]);
});

test("the depth says how far below the repository to look", () => {
  const root = repository();
  write(root, "package.json", manifest({ build: "tsc -p ." }));
  write(root, "packages/ui/package.json", manifest({ test: "vitest" }));
  expect(groupScripts(packages(1), root).map((group) => group.label)).toEqual(["package.json"]);
  expect(groupScripts(packages(2), root).map((group) => group.label)).toEqual(["package.json", "packages/ui/package.json"]);
});

test("the order is by path, or the packages with most scripts first", () => {
  const root = repository();
  write(root, "package.json", manifest({ build: "tsc -p ." }));
  write(root, "packages/ui/package.json", manifest({ test: "vitest", lint: "eslint ." }));
  const labels = (by: "path" | "scripts"): string[] => groupScripts(finder(defaults({ sort: by, shells: false })), root).map((group) => group.label);
  expect(labels("path")).toEqual(["package.json", "packages/ui/package.json"]);
  expect(labels("scripts")).toEqual(["packages/ui/package.json", "package.json"]);
});
