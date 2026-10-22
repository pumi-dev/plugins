// The walk that finds a repository's scripts: the root, the labels, the quoting of a command, and
// the directories it goes into.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupScripts, label, quote, repoRoot, SKIP, type Group } from "../src/finder.ts";
import { runs } from "./runs.ts";

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

/** A directory to make a repository in, removed after the test. */
function temp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `script-panel-${name}-`));
  made.push(dir);
  return dir;
}

/** Writes a file, making its directories. */
function write(root: string, path: string, text = "") {
  const at = join(root, path);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text);
}

test("a word is quoted only when it must be", () => {
  expect(quote("build")).toBe("build");
  expect(quote("test:unit")).toBe("test:unit");
  expect(quote("it's")).toBe("'it'\\''s'");
  expect(quote("a b")).toBe("'a b'");
  expect(quote("")).toBe("''");
});

test("the root is the repository, and labels are inside it", () => {
  const root = temp("root");
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "tools/a"), { recursive: true });
  expect(repoRoot(join(root, "tools/a"))).toBe(root);
  expect(label(join(root, "tools/a"), root)).toBe("tools/a");
  expect(label(root, root)).toBe(".");
});

test("without a .git the directory itself is the root", () => {
  const root = temp("nogit");
  mkdirSync(join(root, "tools"), { recursive: true });
  expect(repoRoot(join(root, "tools"))).toBe(join(root, "tools"));
});

test("groups are found below the root, by label, skipping what it skips", () => {
  const root = temp("found");
  mkdirSync(join(root, ".git"));
  write(root, "build.run");
  write(root, "tools/a/test.run");
  write(root, "tools/b/one.run");
  write(root, "tools/b/two.run");
  for (const skip of SKIP) write(root, join(skip, "x/nope.run"));
  write(root, ".hidden/nope.run");
  write(root, "empty/notes.txt");
  const found: [string, number][] = groupScripts(runs(), root).map((group) => [group.label, group.items.length]);
  expect(found).toEqual([
    [".", 1],
    ["tools/a", 1],
    ["tools/b", 2],
  ]);
});

test("the walk stops at the finder's depth", () => {
  const root = temp("depth");
  mkdirSync(join(root, ".git"));
  write(root, "one/a.run");
  write(root, "one/two/b.run");
  expect(groupScripts(runs(1), root).map((group) => group.label)).toEqual(["one"]);
  expect(groupScripts(runs(2), root).map((group) => group.label)).toEqual(["one", "one/two"]);
});

test("a symlinked directory is not walked into", () => {
  const root = temp("symlink");
  const outside = temp("outside");
  mkdirSync(join(root, ".git"));
  write(outside, "nope.run");
  symlinkSync(outside, join(root, "linked"));
  expect(groupScripts(runs(), root)).toEqual([]);
});

test("the finder's sort decides the order; by label without one", () => {
  const root = temp("sorted");
  mkdirSync(join(root, ".git"));
  write(root, "a/one.run");
  write(root, "b/two.run");
  write(root, "b/three.run");
  expect(groupScripts(runs(), root).map((group) => group.label)).toEqual(["a", "b"]);
  const byCount = (groups: Group[]) => groups.sort((x, y) => y.items.length - x.items.length);
  expect(groupScripts(runs(4, byCount), root).map((group) => group.label)).toEqual(["b", "a"]);
});
