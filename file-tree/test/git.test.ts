// What git says of a path, and the colour a row takes from it, from the
// two-letter codes `git status --porcelain` gives.
import { expect, test } from "bun:test";
import { CONFLICT, UNCHANGED, UNTRACKED, isUnchanged, labelColor, parse, plus, summaryOf } from "../src/git.ts";

test("a status code becomes a summary", () => {
  expect(summaryOf("?", "?")).toEqual(UNTRACKED);
  expect(summaryOf(" ", " ")).toEqual(UNCHANGED);
  expect(summaryOf("U", "U")).toEqual(CONFLICT);
  expect(summaryOf("D", "D")).toEqual(CONFLICT);
  expect(summaryOf("D", "U")).toEqual(CONFLICT);
  expect(summaryOf("A", "D")).toEqual({
    index: { added: 1, modified: 0, deleted: 0 },
    worktree: { added: 0, modified: 0, deleted: 1 },
    conflict: 0,
    untracked: 0,
  });
  expect(summaryOf(" ", "M").worktree).toEqual({ added: 0, modified: 1, deleted: 0 });
  expect(summaryOf("A", "M").index).toEqual({ added: 1, modified: 0, deleted: 0 });
  expect(summaryOf("R", " ")).toEqual(UNCHANGED);
});

test("summaries add up", () => {
  const sum = plus(plus(UNCHANGED, UNTRACKED), summaryOf(" ", "M"));
  expect(sum.untracked).toBe(1);
  expect(sum.worktree.modified).toBe(1);
  expect(isUnchanged(sum)).toBe(false);
  expect(isUnchanged(UNCHANGED)).toBe(true);
});

test("the label colour follows the status", () => {
  expect(labelColor(CONFLICT, false, false)).toBe("conflict");
  expect(labelColor(summaryOf(" ", "D"), false, false)).toBe("deleted");
  expect(labelColor(summaryOf(" ", "M"), false, false)).toBe("modified");
  expect(labelColor(UNTRACKED, false, false)).toBe("added");
  expect(labelColor(summaryOf("A", " "), false, false)).toBe("added");
  expect(labelColor(UNCHANGED, true, false)).toBe("ignored");
  expect(labelColor(UNCHANGED, false, false)).toBe("muted");
  expect(labelColor(UNCHANGED, false, true)).toBe("selected");
  expect(labelColor(summaryOf(" ", "M"), false, true)).toBe("modified");
});

test("porcelain's records are read, a rename's two for one", () => {
  // A rename is two records: where the path is now, then where it came from.
  const text = [" M src/a.rs", "?? new file.rs", "RM src/new.rs", "src/old.rs", "UU split.rs", ""].join("\0");
  expect(parse(text)).toEqual([
    { path: "src/a.rs", summary: summaryOf(" ", "M") },
    { path: "new file.rs", summary: UNTRACKED },
    { path: "src/new.rs", summary: summaryOf("R", "M") },
    { path: "split.rs", summary: CONFLICT },
  ]);
});
