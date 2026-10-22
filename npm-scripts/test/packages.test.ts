// The package's own half of the page: the manager that runs a package's scripts, the group its
// `package.json` makes, and the order the page lists them in. The walk itself is `script-panel`'s;
// `read()` asks the app for the options, so it is not here — a test runs without one.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { groupScripts, type Finder, type Group } from "script-panel/finder.ts";

import { manager, order, packageGroup } from "../src/packages.ts";
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

/** The finder of a page that looks `depth` directories down, its groups the packages' own. */
function finder(depth = 4): Finder {
  return { depth, showDetail: true, empty: "No package.json with scripts found", group: packageGroup };
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
    items: [{ name: "test:unit", detail: "vitest", command: "bun run test:unit" }],
  });
});

test("a directory without scripts is no group", () => {
  const root = repository();
  expect(packageGroup(root, root)).toBeNull();
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
  const found: [string, number][] = groupScripts(finder(), root).map((group) => [group.label, group.items.length]);
  expect(found).toEqual([
    ["package.json", 1],
    ["packages/ui/package.json", 1],
  ]);
});

test("the depth says how far below the repository to look", () => {
  const root = repository();
  write(root, "package.json", manifest({ build: "tsc -p ." }));
  write(root, "packages/ui/package.json", manifest({ test: "vitest" }));
  expect(groupScripts(finder(1), root).map((group) => group.label)).toEqual(["package.json"]);
  expect(groupScripts(finder(2), root).map((group) => group.label)).toEqual(["package.json", "packages/ui/package.json"]);
});

test("the order is by path, or the packages with most scripts first", () => {
  const root = repository();
  write(root, "package.json", manifest({ build: "tsc -p ." }));
  write(root, "packages/ui/package.json", manifest({ test: "vitest", lint: "eslint ." }));
  const groups = (by: "path" | "scripts"): string[] => {
    const found = groupScripts(finder(), root);
    order(found, by);
    return found.map((group: Group) => group.label);
  };
  expect(groups("path")).toEqual(["package.json", "packages/ui/package.json"]);
  expect(groups("scripts")).toEqual(["packages/ui/package.json", "package.json"]);
});
