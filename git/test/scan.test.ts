import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nested, tooWide } from "../src/scan.ts";

/** A directory with a `.git` in it, as `nested` tells a repository. */
function repo(at: string): void {
  mkdirSync(join(at, ".git"), { recursive: true });
}

test("the repositories a level or two down, not inside one, nor under hidden or dependency directories", async () => {
  const dir = mkdtempSync(join(tmpdir(), "git-scan-"));
  try {
    repo(join(dir, "b"));
    repo(join(dir, "a"));
    repo(join(dir, "a", "inner"));
    repo(join(dir, "group", "c"));
    repo(join(dir, "group", "deep", "d"));
    repo(join(dir, ".hidden", "e"));
    repo(join(dir, "node_modules", "f"));
    expect(await nested(dir)).toEqual([join(dir, "a"), join(dir, "b"), join(dir, "group", "c")]);
    expect(await nested(dir, 1)).toEqual([join(dir, "a"), join(dir, "b")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("at most `limit` of them, the shallowest kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "git-scan-"));
  try {
    repo(join(dir, "a", "deep"));
    repo(join(dir, "z"));
    repo(join(dir, "y"));
    expect(await nested(dir, 2, 2)).toEqual([join(dir, "y"), join(dir, "z")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the home directory and the root are too wide to look under", () => {
  expect(tooWide("/")).toBe(true);
  expect(tooWide("/Users/me", "/Users/me")).toBe(true);
  expect(tooWide("/Users/me/", "/Users/me")).toBe(true);
  expect(tooWide("/Users/me/code", "/Users/me")).toBe(false);
});
