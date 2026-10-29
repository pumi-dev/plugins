// The patch made from a file's two texts, as `git diff` would say it.
import { expect, test } from "bun:test";

import { diffLines, unifiedDiff } from "../../src/conversation/diff.ts";

test("one line changed, with its context", () => {
  const old = "a\nb\nc\nd\ne\nf\ng\nh\n";
  const next = "a\nb\nc\nd\nE\nf\ng\nh\n";
  expect(unifiedDiff("x.ts", old, next)).toBe(["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -2,7 +2,7 @@", " b", " c", " d", "-e", "+E", " f", " g", " h", ""].join("\n"));
});

test("a new file is all additions from /dev/null", () => {
  expect(unifiedDiff("new.ts", undefined, "one\ntwo\n")).toBe(["diff --git a/new.ts b/new.ts", "--- /dev/null", "+++ b/new.ts", "@@ -0,0 +1,2 @@", "+one", "+two", ""].join("\n"));
});

test("emptying a file is all deletions", () => {
  expect(unifiedDiff("f", "x\ny\n", "")).toContain("@@ -1,2 +0,0 @@\n-x\n-y\n");
});

test("the same texts have no patch", () => {
  expect(unifiedDiff("f", "same\n", "same\n")).toBe("");
});

test("changes far apart are two hunks; near ones are one", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `l${i}`);
  const far = lines.map((line, i) => (i === 2 || i === 25 ? `${line}!` : line));
  expect(unifiedDiff("f", lines.join("\n"), far.join("\n")).match(/^@@/gm)?.length).toBe(2);
  const near = lines.map((line, i) => (i === 10 || i === 15 ? `${line}!` : line));
  expect(unifiedDiff("f", lines.join("\n"), near.join("\n")).match(/^@@/gm)?.length).toBe(1);
});

test("the edit is a shortest one, and replays to the new text", () => {
  const a = ["x", "a", "b", "c", "y", "d"];
  const b = ["a", "b", "z", "c", "d", "w"];
  const ops = diffLines(a, b);
  // The longest common run is a, b, c, d: two lines out and two in.
  expect(ops.filter((op) => op.kind !== " ").length).toBe(4);
  expect(ops.filter((op) => op.kind !== "-").map((op) => op.line)).toEqual(b);
  expect(ops.filter((op) => op.kind !== "+").map((op) => op.line)).toEqual(a);
  let seed = 3;
  const random = () => (seed = (seed * 48271) % 2147483647) % 4;
  for (let round = 0; round < 100; round++) {
    const left = Array.from({ length: 20 }, () => String(random()));
    const right = Array.from({ length: 18 }, () => String(random()));
    const edit = diffLines(left, right);
    expect(edit.filter((op) => op.kind !== "-").map((op) => op.line)).toEqual(right);
    expect(edit.filter((op) => op.kind !== "+").map((op) => op.line)).toEqual(left);
  }
});
