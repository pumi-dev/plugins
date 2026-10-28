// The search over the whole project: what it reads, and how it ranks what fits.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { listProject, score, search, withFolders } from "../src/search.ts";
import { scratch, write } from "./scratch.ts";

const rels = (paths: { rel: string }[]) => paths.map((each) => each.rel);

test("a query fits when its letters are all there, in order, whatever their case", () => {
  expect(score("mn", "src/main.rs")).not.toBeNull();
  expect(score("MAIN", "src/main.rs")).not.toBeNull();
  expect(score("nm", "src/main.rs")).toBeNull();
  expect(score("", "anything")).toBe(0);
  // A jump to a word's start that strands the rest falls back to the plain hits.
  expect(score("bc", "xbc_b")).not.toBeNull();
});

test("the file's own name, a word's start and a run of letters rank first", () => {
  const paths = withFolders(["src/panel.ts", "src/ui/panelView.tsx", "docs/plan/annex.md", "crates/pumi-panel/lib.rs", "a/p/a/n/e/l.txt"]);
  const best = rels(search(paths, "panel", 10));
  expect(best[0]).toBe("src/panel.ts");
  expect(best.at(-1)).toBe("a/p/a/n/e/l.txt");
  expect(rels(search(paths, "pv", 10))[0]).toBe("src/ui/panelView.tsx");
  expect(rels(search(paths, "ui/pan", 10))[0]).toBe("src/ui/panelView.tsx");
  expect(search(paths, "panel", 2)).toHaveLength(2);
});

test("folders come with the files under them, once", () => {
  expect(withFolders(["a/b/c.ts", "a/b/d.ts", "e.ts"])).toEqual([
    { rel: "a/b/c.ts", dir: false },
    { rel: "a/b/d.ts", dir: false },
    { rel: "e.ts", dir: false },
    { rel: "a/b", dir: true },
    { rel: "a", dir: true },
  ]);
});

test("a repository is git's list, without what it ignores; elsewhere the disk, without .git", async () => {
  const dir = scratch("search");
  Bun.spawnSync(["git", "init"], { cwd: dir, stdout: "ignore", stderr: "ignore" });
  write(dir, ".gitignore", "target/\n");
  write(dir, "src/lib.rs", "x");
  write(dir, "target/debug/out", "x");
  write(dir, ".hidden/x", "x");
  const inRepo = rels(await listProject(dir, { inRepo: true, hideHidden: false }));
  expect(inRepo).toContain("src/lib.rs");
  expect(inRepo).toContain("src");
  expect(inRepo).not.toContain("target/debug/out");
  expect(inRepo).toContain(".hidden/x");
  expect(rels(await listProject(dir, { inRepo: true, hideHidden: true }))).not.toContain(".hidden/x");
  const walked = rels(await listProject(join(dir, "src"), { inRepo: false, hideHidden: false }));
  expect(walked).toEqual(["lib.rs"]);
});
