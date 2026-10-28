// The operations on the disk: what a new file, a rename, a copy and a drop leave behind, and the
// ignore file a row can be added to.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendPattern, copy, create, drop, rename } from "../src/ops.ts";
import { scratch, write } from "./scratch.ts";

test("a file is made, and a folder with everything above it", () => {
  const dir = scratch("op-create");
  create(dir, "src/main.rs", false);
  expect(readFileSync(join(dir, "src/main.rs"), "utf8")).toBe("");
  create(dir, "docs/api/reference", true);
  expect(existsSync(join(dir, "docs/api/reference"))).toBe(true);
});

test("a rename moves it, and a copy copies a folder's everything", () => {
  const dir = scratch("op-rename");
  write(dir, "main.rs", "x");
  rename(dir, "main.rs", "lib.rs");
  expect(existsSync(join(dir, "main.rs"))).toBe(false);
  expect(existsSync(join(dir, "lib.rs"))).toBe(true);
  write(dir, "src/a/b.rs", "b");
  copy(dir, "src", "copy");
  expect(readFileSync(join(dir, "copy/a/b.rs"), "utf8")).toBe("b");
});

test("a drop moves within the project and copies into it, and never over something", () => {
  const dir = scratch("op-drop");
  const outside = scratch("op-drop-outside");
  write(dir, "a.rs", "a");
  write(dir, "lib/kept.rs", "kept");
  write(dir, "lib/taken.rs", "mine");
  write(outside, "new.rs", "new");
  drop(dir, [
    { from: join(dir, "a.rs"), to: "lib/a.rs", copy: false },
    // The name is taken: the move is refused and nothing is lost.
    { from: join(outside, "new.rs"), to: "lib/taken.rs", copy: false },
    { from: join(outside, "new.rs"), to: "new.rs", copy: true },
  ]);
  expect(existsSync(join(dir, "a.rs"))).toBe(false);
  expect(readFileSync(join(dir, "lib/a.rs"), "utf8")).toBe("a");
  expect(readFileSync(join(dir, "lib/taken.rs"), "utf8")).toBe("mine");
  expect(readFileSync(join(outside, "new.rs"), "utf8")).toBe("new");
  expect(readFileSync(join(dir, "new.rs"), "utf8")).toBe("new");
});

test("a pattern is appended to an ignore file once", () => {
  const dir = scratch("op-ignore");
  const file = join(dir, ".gitignore");
  write(dir, ".gitignore", "target\n");
  appendPattern(file, "src/generated.rs");
  expect(readFileSync(file, "utf8")).toBe("target\nsrc/generated.rs\n");
  appendPattern(file, "src/generated.rs");
  expect(readFileSync(file, "utf8")).toBe("target\nsrc/generated.rs\n");
});

test("the last line of an ignore file is not joined", () => {
  const dir = scratch("op-ignore-join");
  const file = join(dir, "exclude");
  write(dir, "exclude", "target");
  appendPattern(file, "build/");
  expect(readFileSync(file, "utf8")).toBe("target\nbuild/\n");
});
