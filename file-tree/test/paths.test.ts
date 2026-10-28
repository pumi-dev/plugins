// Relative paths and the order they sort in.
import { expect, test } from "bun:test";
import { compareRelPaths } from "../src/paths.ts";
import * as rel from "../src/relpath.ts";

const entry = (path: string, isFile: boolean) => ({ rel: path, isFile });
const sorted = (paths: [string, boolean][], mode: "directoriesFirst" | "mixed" | "filesFirst") =>
  paths.map(([path, isFile]) => entry(path, isFile)).sort((a, b) => compareRelPaths(a, b, mode));

test("a path's parts", () => {
  expect(rel.components("")).toEqual([]);
  expect(rel.components("a/b")).toEqual(["a", "b"]);
  expect(rel.ancestors("a/b/c")).toEqual(["a/b/c", "a/b", "a", ""]);
  expect(rel.parent("src/main.rs")).toBe("src");
  expect(rel.parent("main.rs")).toBe("");
  expect(rel.join("", "name")).toBe("name");
  expect(rel.join("src", "main.rs")).toBe("src/main.rs");
  expect(rel.fileName("src/main.rs")).toBe("main.rs");
  expect(rel.fileStem("main.rs")).toBe("main");
  expect(rel.extension("main.rs")).toBe("rs");
  expect(rel.extension(".gitignore")).toBeNull();
  expect(rel.lastComponents("a/b/c", 2)).toBe("b/c");
  expect(rel.lastComponents("a/b/c", 3)).toBe("a/b/c");
  expect(rel.lastComponents("a/b/c", 4)).toBeNull();
  expect(rel.isRel("/etc")).toBe(false);
  expect(rel.isRel("src/main.rs")).toBe(true);
});

test("extensions come from the file name", () => {
  expect(rel.extensionOrHiddenFileName("auth.module.js")).toBe("js");
  expect(rel.extensionOrHiddenFileName(".gitignore")).toBe("gitignore");
  expect(rel.extensionOrHiddenFileName("LICENSE")).toBe("LICENSE");
  expect(rel.multipleExtensions("Component.stories.tsx")).toBe("stories.tsx");
  expect(rel.multipleExtensions("auth.module.js")).toBe("module.js");
  expect(rel.multipleExtensions("main.rs")).toBeNull();
});

test("directories first is the panel's order", () => {
  expect(
    sorted(
      [
        ["src/main.rs", true],
        ["Cargo.toml", true],
        ["src", false],
        [".gitignore", true],
      ],
      "directoriesFirst",
    ),
  ).toEqual([entry("src", false), entry("src/main.rs", true), entry(".gitignore", true), entry("Cargo.toml", true)]);
});

test("names compare naturally, numbers as numbers", () => {
  expect(
    sorted(
      [
        ["file10.txt", true],
        ["dir2", false],
        ["file2.txt", true],
        ["dir10", false],
        ["file1.txt", true],
      ],
      "filesFirst",
    ),
  ).toEqual([
    entry("file1.txt", true),
    entry("file2.txt", true),
    entry("file10.txt", true),
    entry("dir2", false),
    entry("dir10", false),
  ]);
});

test("files first, and mixed, put the folders where they say", () => {
  expect(
    sorted(
      [
        ["file2.txt", true],
        ["Dir1", false],
        ["file1.txt", true],
        ["dir2", false],
      ],
      "mixed",
    ),
  ).toEqual([entry("Dir1", false), entry("dir2", false), entry("file1.txt", true), entry("file2.txt", true)]);
  expect(
    sorted(
      [
        ["src/lib.rs", true],
        ["README.md", true],
        ["src", false],
        ["tests", false],
      ],
      "filesFirst",
    ),
  ).toEqual([entry("README.md", true), entry("src", false), entry("src/lib.rs", true), entry("tests", false)]);
});

test("the same name in two cases sorts one way, whatever order it is given in", () => {
  const a = sorted(
    [
      ["Hello.txt", true],
      ["hello", false],
    ],
    "mixed",
  );
  const b = sorted(
    [
      ["hello", false],
      ["Hello.txt", true],
    ],
    "mixed",
  );
  expect(a).toEqual([entry("hello", false), entry("Hello.txt", true)]);
  expect(b).toEqual(a);
});
