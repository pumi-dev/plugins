// The files mode's data: the walk (what it leaves out) and the search (what comes first).
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Index, dirOf, nameOf, rootFor } from "../../src/files/files.ts";

const made: string[] = [];
afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A directory of a project, made on disk. */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pumi-palette-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

/** Everything a walk of `root` finds, sorted. */
async function walked(root: string): Promise<string[]> {
  const index = new Index();
  index.start(root);
  while (await index.step()) {
    // one step at a time, as the palette takes it
  }
  return index.files.map((entry) => entry.rel).sort();
}

test("a file knows its name and its directory", () => {
  const entry = { rel: "src/ui/shell.rs", nameAt: 7 };
  expect(nameOf(entry)).toBe("shell.rs");
  expect(dirOf(entry)).toBe("src/ui");
  expect(dirOf({ rel: "Cargo.toml", nameAt: 0 })).toBe("");
});

test("the root is the repository", () => {
  const root = project({ "src/deep/a.rs": "" });
  mkdirSync(join(root, ".git"), { recursive: true });
  expect(rootFor(join(root, "src/deep"), null)).toBe(root);
  expect(rootFor("", null)).toBeNull();
  expect(rootFor("/", null)).toBeNull();
  expect(rootFor(root, root)).toBeNull();
});

test("the walk honours gitignore and skips .git", async () => {
  const root = project({
    ".gitignore": "target/\n*.log\n",
    ".git/HEAD": "ref",
    "src/lib.rs": "",
    "src/debug.log": "",
    "target/debug/out": "",
    ".github/ci.yml": "# it",
    "README.md": "# it",
  });
  expect(await walked(root)).toEqual([".github/ci.yml", ".gitignore", "README.md", "src/lib.rs"]);
});

test("a deeper gitignore says its own directory's rules, and a rule can take something back", async () => {
  const root = project({
    ".gitignore": "*.txt\n!keep.txt\n",
    "notes.txt": "",
    "keep.txt": "",
    "src/.gitignore": "*.rs\n",
    "src/lib.rs": "",
    "src/main.ts": "",
  });
  expect(await walked(root)).toEqual([".gitignore", "keep.txt", "src/.gitignore", "src/main.ts"]);
});

test("a name match beats a path match, and what was opened lately leads", () => {
  const index = new Index();
  index.root = "/repo";
  index.files = ["crates/libfoo/mod.rs", "src/lib.rs", "src/main.rs"].map((rel) => ({
    rel,
    nameAt: rel.lastIndexOf("/") + 1,
  }));
  const found = index.search("lib", new Map());
  expect(index.files[found[0]!.file]!.rel).toBe("src/lib.rs");
  expect(index.marks(found[0]!.file, "lib")).toEqual([0, 1, 2]);
  expect(found.map((hit) => index.files[hit.file]!.rel)).not.toContain("src/main.rs");
});

test("recent files lead an empty search and break a tie", () => {
  const index = new Index();
  index.root = "/repo";
  index.files = ["a/one.rs", "b/one.rs", "c.rs"].map((rel) => ({ rel, nameAt: rel.lastIndexOf("/") + 1 }));
  const recent = new Map([
    ["b/one.rs", 0],
    ["c.rs", 1],
  ]);
  const names = (hits: { file: number }[]) => hits.map((hit) => index.files[hit.file]!.rel);
  expect(names(index.search("", recent))).toEqual(["b/one.rs", "c.rs", "a/one.rs"]);
  expect(names(index.search("one", recent))).toEqual(["b/one.rs", "a/one.rs"]);
});

test("a query can run through directories, and its marks are the name's", () => {
  const index = new Index();
  index.root = "/repo";
  index.files = ["src/ui/shell.rs", "src/store.rs", "README.md"].map((rel) => ({
    rel,
    nameAt: rel.lastIndexOf("/") + 1,
  }));
  const found = index.search("uishell", new Map());
  expect(found.map((hit) => index.files[hit.file]!.rel)).toEqual(["src/ui/shell.rs"]);
  expect(index.marks(found[0]!.file, "uishell")).toEqual([0, 1, 2, 3, 4]);
});

test("a shorter query searches everything again", () => {
  const index = new Index();
  index.root = "/repo";
  index.files = ["src/main.rs", "src/lib.rs", "docs/manual.md"].map((rel) => ({ rel, nameAt: rel.lastIndexOf("/") + 1 }));
  expect(index.search("m", new Map()).length).toBe(2);
  const narrowed = index.search("manu", new Map(), index.search("m", new Map()).map((hit) => hit.file));
  expect(narrowed.map((hit) => index.files[hit.file]!.rel)).toEqual(["docs/manual.md"]);
});
