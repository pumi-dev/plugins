// A patch, read: git's multi-file diffs, a bare one, renames, new and binary files, long lines, folding.
import { expect, test } from "bun:test";

import { diffRows, diffStats, foldedAtFirst, MAX_LINE, parsePatch, patchItems, widestNumber } from "../../src/diff/patch.ts";

const GIT = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -3,2 +3,3 @@ fn main",
  " keep",
  "-old",
  "+new",
  "+more",
  "@@ -40 +41 @@",
  "-x",
  "+y",
  "\\ No newline at end of file",
  "diff --git a/new.md b/new.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/new.md",
  "@@ -0,0 +1 @@",
  "+hello",
  "diff --git a/old.txt b/renamed.txt",
  "similarity index 90%",
  "rename from old.txt",
  "rename to renamed.txt",
  "diff --git a/img.png b/img.png",
  "Binary files a/img.png and b/img.png differ",
  "",
].join("\n");

test("git's files: their paths, how they changed, their numbered lines", () => {
  const files = parsePatch(GIT);
  expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
    ["src/a.ts", "modified", 3, 2],
    ["new.md", "added", 1, 0],
    ["renamed.txt", "renamed", 0, 0],
    ["img.png", "binary", 0, 0],
  ]);
  expect(files[2]!.from).toBe("old.txt");
  expect(files[0]!.rows).toEqual([
    { kind: "hunk", text: "fn main" },
    { kind: "context", text: "keep", old: 3, new: 3 },
    { kind: "del", text: "old", old: 4 },
    { kind: "add", text: "new", new: 4 },
    { kind: "add", text: "more", new: 5 },
    { kind: "hunk", text: "" },
    { kind: "del", text: "x", old: 40 },
    { kind: "add", text: "y", new: 41 },
    { kind: "note", text: "No newline at end of file" },
  ]);
  expect(files[3]!.rows).toEqual([{ kind: "note", text: "Binary file" }]);
  expect(widestNumber(files)).toBe(41);
});

test("a bare patch, and a line beginning with --- inside a hunk is the hunk's", () => {
  const bare = "--- a.ts\n+++ a.ts\n@@ -1,2 +1,2 @@\n--- not a header\n+++ nor this\n";
  const files = parsePatch(bare);
  expect(files.length).toBe(1);
  expect(files[0]!.path).toBe("a.ts");
  expect(diffRows(bare).map((r) => r.kind)).toEqual(["hunk", "del", "add"]);
  expect(diffStats(bare)).toEqual({ added: 1, removed: 1 });
  expect(parsePatch("")).toEqual([]);
});

test("a very long line is cut, and says how much", () => {
  const rows = diffRows(`@@ -1 +1 @@\n+${"x".repeat(MAX_LINE + 5)}`);
  expect(rows[1]!.text.length).toBe(MAX_LINE);
  expect(rows[1]!.cut).toBe(5);
});

test("lock files and long files start folded; a folded file shows only its head", () => {
  const long = Array.from({ length: 3001 }, (_, i) => `+${i}`).join("\n");
  const files = parsePatch(`diff --git a/bun.lock b/bun.lock\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/big.txt b/big.txt\n@@ -0,0 +1,3001 @@\n${long}\ndiff --git a/s.ts b/s.ts\n@@ -1 +1 @@\n-a\n+b`);
  const folded = foldedAtFirst(files);
  expect([...folded]).toEqual(["bun.lock", "big.txt"]);
  expect(patchItems(files, folded).map((i) => (i.type === "file" ? `file ${i.file.path}${i.folded ? " folded" : ""}` : i.row.kind))).toEqual(["file bun.lock folded", "file big.txt folded", "file s.ts", "hunk", "del", "add"]);
});

test("a patch of a million lines reads fast", () => {
  const body = Array.from({ length: 1_000_000 }, (_, i) => (i % 2 ? `+line ${i}` : `-line ${i}`)).join("\n");
  const began = performance.now();
  const files = parsePatch(`diff --git a/a b/a\n@@ -1,500000 +1,500000 @@\n${body}`);
  expect(files[0]!.rows.length).toBe(1_000_001);
  expect(performance.now() - began).toBeLessThan(2000);
});

test("a bare patch of two files: a hunk ends when its lines are in", () => {
  const files = parsePatch("--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-a\n+b\n--- b.ts\n+++ b.ts\n@@ -1 +1,2 @@\n x\n+y\n");
  expect(files.map((f) => [f.path, f.added, f.removed])).toEqual([["a.ts", 1, 1], ["b.ts", 1, 0]]);
});
