// The files the picker lists: what a path knows of itself, and what a walk of a directory finds.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Entry, walk } from "../src/entries.ts";

test("a path knows its name and its directory", () => {
  const nested = new Entry("crates/a/src/lib.rs", false);
  expect(nested.name).toBe("lib.rs");
  expect(nested.parent).toBe("crates/a/src");
  expect(nested.extension).toBe("rs");
  const top = new Entry("Cargo.toml", false);
  expect(top.name).toBe("Cargo.toml");
  expect(top.parent).toBe("");
  expect(top.dir).toBe(false);
  expect(new Entry(".env", false).extension).toBeNull();
  expect(new Entry("Makefile", false).extension).toBeNull();
  expect(new Entry("src", true).extension).toBeNull();
});

test("the walk skips what is built and installed", () => {
  const dir = mkdtempSync(join(tmpdir(), "insert-path-walk-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
  mkdirSync(join(dir, ".git/objects"), { recursive: true });
  writeFileSync(join(dir, "src/main.rs"), "");
  writeFileSync(join(dir, "Cargo.toml"), "");
  writeFileSync(join(dir, "node_modules/pkg/index.js"), "");
  writeFileSync(join(dir, ".git/HEAD"), "");
  const found = walk(dir);
  expect(found.map((entry) => entry.rel)).toEqual(["Cargo.toml", "src", "src/main.rs"]);
  expect(found.find((entry) => entry.rel === "src")?.dir).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});
