// The panel over a real directory: the rows it draws, the order they are in, what a key or a click
// comes to, and what a drop or a paste plans to do.
import { expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { Panel } from "../src/panel.ts";
import { entryKey, NEW_ENTRY_KEY } from "../src/row.ts";
import { keys, rowOf, scratch, write } from "./scratch.ts";

function panelIn(dir: string): Panel {
  return new Panel(dir);
}

test("directories are listed lazily", () => {
  const dir = scratch("lazy");
  write(dir, "a.rs", "a");
  write(dir, "src/main.rs", "main");
  const panel = panelIn(dir);
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("src"), entryKey("a.rs")]);
  panel.state.expanded.add("src");
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("src"), entryKey("src/main.rs"), entryKey("a.rs")]);
});

test("changes under closed ignored directories are unseen", () => {
  const dir = scratch("unseen");
  write(dir, ".gitignore", "target/\n");
  write(dir, "target/debug/deps/x.o", "o");
  write(dir, "target/release/y.o", "o");
  write(dir, "src/main.rs", "main");
  const panel = panelIn(dir);
  panel.rows();
  const unseen = (rel: string) => panel.tree.changeIsUnseen(join(dir, rel));
  expect(unseen("target/debug/deps/x.o")).toBe(true);
  expect(unseen("target/debug/deps/new.o")).toBe(true);
  expect(unseen("target")).toBe(false);
  expect(unseen("src/main.rs")).toBe(false);
  expect(unseen(".gitignore")).toBe(false);
  expect(panel.tree.changeIsUnseen("/elsewhere/target/x.o")).toBe(false);
  panel.state.expanded.add("target");
  panel.state.expanded.add("target/debug");
  panel.rows();
  expect(unseen("target/debug/new.o")).toBe(false);
  expect(unseen("target/debug/deps/x.o")).toBe(false);
  expect(unseen("target/debug/deps/inner/z.o")).toBe(true);
});

test("single-child directory chains are folded", () => {
  const dir = scratch("fold");
  write(dir, "a/b/c/file.rs", "x");
  const panel = panelIn(dir);
  const rows = panel.rows();
  expect(keys(rows)).toEqual([entryKey(""), entryKey("a/b/c")]);
  expect(rows[1]!.text).toBe("a/b/c");
  expect(rows[1]!.kind).toBe("folder");
  expect(rows[1]!.depth).toBe(1);
  panel.unfoldDirectory("a/b/c");
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("a")]);
  panel.state.expanded.add("a");
  panel.state.expanded.add("a/b");
  panel.state.expanded.add("a/b/c");
  expect(keys(panel.rows())).toEqual([
    entryKey(""),
    entryKey("a"),
    entryKey("a/b"),
    entryKey("a/b/c"),
    entryKey("a/b/c/file.rs"),
  ]);
  panel.foldDirectory("a");
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("a/b/c"), entryKey("a/b/c/file.rs")]);
});

test("opening a folded row lists the chain", () => {
  const dir = scratch("foldopen");
  write(dir, "a/b/c/file.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.selection = entryKey("a/b/c");
  expect(panel.key("right")).toEqual({ kind: "redraw" });
  expect(panel.state.expanded.has("a/b/c")).toBe(true);
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("a/b/c"), entryKey("a/b/c/file.rs")]);
  for (let round = 0; round < 2; round++) {
    panel.selection = entryKey("a/b/c");
    expect(panel.key("left")).toEqual({ kind: "redraw" });
    expect(panel.state.expanded.has("a/b/c")).toBe(true);
  }
  panel.selection = entryKey("a/b/c");
  expect(panel.key("left")).toEqual({ kind: "redraw" });
  expect(panel.state.expanded.has("")).toBe(false);
  expect(keys(panel.rows())).toEqual([entryKey("")]);
});

test("left closes an expanded directory", () => {
  const dir = scratch("collapse");
  write(dir, "src/main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.selection = entryKey("src");
  expect(panel.key("right")).toEqual({ kind: "redraw" });
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("src"), entryKey("src/main.rs")]);
  expect(panel.key("left")).toEqual({ kind: "redraw" });
  expect(panel.state.expanded.has("src")).toBe(false);
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("src")]);
  expect(panel.selection).toBe(entryKey("src"));
});

test("entries are sorted the original way", () => {
  const dir = scratch("sort");
  write(dir, "file10.rs", "x");
  write(dir, "file2.rs", "x");
  write(dir, ".gitignore", "x");
  write(dir, "zebra", "x");
  write(dir, "apple/src/main.rs", "x");
  const panel = panelIn(dir);
  expect(keys(panel.rows())).toEqual([
    entryKey(""),
    entryKey("apple/src"),
    entryKey(".gitignore"),
    entryKey("file2.rs"),
    entryKey("file10.rs"),
    entryKey("zebra"),
  ]);
});

test("ignored entries are shown dimmed or hidden", () => {
  const dir = scratch("ignored");
  write(dir, ".gitignore", "target\n");
  write(dir, "target/debug/out", "x");
  write(dir, "src/main.rs", "x");
  const panel = panelIn(dir);
  expect(rowOf(panel.rows(), entryKey("target/debug")).color).toBe("ignored");
  expect(rowOf(panel.rows(), entryKey("target/debug")).text).toBe("target/debug");
  panel.settings.hideGitignore = true;
  expect(keys(panel.rows())).not.toContain(entryKey("target/debug"));
});

test("the git directory is never listed", () => {
  const dir = scratch("gitdir");
  write(dir, ".git/HEAD", "ref: refs/heads/main\n");
  write(dir, "a.rs", "x");
  const panel = panelIn(dir);
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("a.rs")]);
});

test("hidden entries follow hide_hidden", () => {
  const dir = scratch("hidden");
  write(dir, ".env", "x");
  const panel = panelIn(dir);
  expect(rowOf(panel.rows(), entryKey(".env")).color).toBe("muted");
  panel.settings.hideHidden = true;
  expect(keys(panel.rows())).not.toContain(entryKey(".env"));
});

test("rows carry their key, their icon and where they are", () => {
  const dir = scratch("rows");
  write(dir, "src/main.rs", "x");
  const panel = panelIn(dir);
  panel.state.expanded.add("src");
  const rows = panel.rows();
  expect(rows[0]!.key).toBe(entryKey(""));
  expect(rows[0]!.kind).toBe("folder");
  expect(rows[0]!.open).toBe(true);
  expect(rows[0]!.text).toBe(`pumi-files-rows-${dir.slice(dir.lastIndexOf("-") + 1)}`);
  expect(rows[1]!.icon).toBe("folder-src-open");
  expect(rows[2]!.icon).toBe("rust");
  expect(rows[2]!.text).toBe("main.rs");
  expect(rows[2]!.path).toBe(join(dir, "src/main.rs"));
});

test("the cursor walks the visible rows", () => {
  const dir = scratch("cursor");
  write(dir, "a.rs", "x");
  write(dir, "b.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  expect(panel.key("down")).toEqual({ kind: "redraw" });
  expect(panel.selection).toBe(entryKey(""));
  panel.key("down");
  expect(panel.selection).toBe(entryKey("a.rs"));
  panel.key("down");
  panel.key("down");
  expect(panel.selection).toBe(entryKey("b.rs"));
  panel.key("up");
  expect(panel.selection).toBe(entryKey("a.rs"));
  panel.key("end");
  expect(panel.selection).toBe(entryKey("b.rs"));
  panel.key("home");
  expect(panel.selection).toBe(entryKey(""));
  const rows = panel.rows();
  expect(rows[0]!.selected).toBe(true);
  expect(rows[1]!.selected).toBe(false);
});

test("space opens a file and a folder opens itself", () => {
  const dir = scratch("open");
  write(dir, "src/main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.key("down");
  panel.key("down");
  expect(panel.key("space")).toEqual({ kind: "redraw" });
  expect(panel.state.expanded.has("src")).toBe(true);
  panel.key("down");
  expect(panel.key("space")).toEqual({ kind: "open", rel: "src/main.rs" });
});

test("a click opens a folder and a file", () => {
  const dir = scratch("click");
  write(dir, "src/main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  expect(panel.activate(entryKey("src"))).toEqual({ kind: "redraw" });
  expect(panel.state.expanded.has("src")).toBe(true);
  expect(panel.activate(entryKey("src/main.rs"))).toEqual({ kind: "open", rel: "src/main.rs" });
  expect(panel.selection).toBe(entryKey("src/main.rs"));
});

test("a folder's triangle toggles it without moving the cursor", () => {
  const dir = scratch("toggle");
  write(dir, "src/main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.selection = entryKey("src/main.rs");
  expect(panel.toggle(entryKey("src"))).toEqual({ kind: "redraw" });
  expect(panel.state.expanded.has("src")).toBe(true);
  expect(panel.selection).toBe(entryKey("src/main.rs"));
  expect(keys(panel.rows())).toContain(entryKey("src/main.rs"));
});

test("rename asks for the move", () => {
  const dir = scratch("rename");
  write(dir, "main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.key("down");
  panel.key("down");
  panel.key("enter");
  expect(panel.edit?.name).toBe("main.rs");
  expect(rowOf(panel.rows(), entryKey("main.rs")).editing).toBe(true);
  panel.setName("M.rs");
  expect(panel.commitEdit()).toEqual({ kind: "rename", from: "main.rs", to: "M.rs", paste: false });
  expect(panel.edit).toBeNull();
});

test("escape cancels the draft", () => {
  const dir = scratch("escape");
  write(dir, "main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.selection = entryKey("main.rs");
  panel.key("enter");
  panel.cancelEdit();
  expect(panel.edit).toBeNull();
  expect(rowOf(panel.rows(), entryKey("main.rs")).editing).toBe(false);
});

test("a rename onto an existing name is refused", () => {
  const dir = scratch("rename-clash");
  write(dir, "main.rs", "x");
  write(dir, "other.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.selection = entryKey("main.rs");
  panel.renameEntry("main.rs");
  panel.setName("other.rs");
  expect(panel.commitEdit()).toEqual({ kind: "redraw" });
  expect(panel.edit?.name).toBe("other.rs");
  expect(existsSync(join(dir, "main.rs"))).toBe(true);
});

test("new files are typed into a draft row", () => {
  const dir = scratch("newfile");
  write(dir, "src/main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.state.expanded.add("src");
  panel.rows();
  expect(panel.action("New File", entryKey("src"))).toEqual({ kind: "redraw" });
  const draft = rowOf(panel.rows(), NEW_ENTRY_KEY);
  expect(draft.kind).toBe("file");
  expect(draft.text).toBe("");
  expect(draft.selected).toBe(true);
  expect(draft.depth).toBe(2);
  expect(draft.actions).toEqual([]);
  panel.setName("n");
  expect(panel.commitEdit()).toEqual({ kind: "create", path: "src/n", isDir: false });
});

test("a trailing slash creates a directory", () => {
  const dir = scratch("newdir");
  const panel = panelIn(dir);
  panel.rows();
  panel.action("New Folder", entryKey(""));
  panel.setName("ui/");
  expect(panel.commitEdit()).toEqual({ kind: "create", path: "ui", isDir: true });
});

test("an empty name keeps the field", () => {
  const dir = scratch("emptyname");
  const panel = panelIn(dir);
  panel.rows();
  panel.action("New File", entryKey(""));
  expect(panel.commitEdit()).toEqual({ kind: "redraw" });
  expect(panel.edit).not.toBeNull();
});

test("the context menu follows the original order", () => {
  const dir = scratch("menu");
  write(dir, "main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  expect(panel.actionsFor(entryKey("main.rs"))).toEqual([
    "New File",
    "New Folder",
    "Reveal in Finder",
    "Open in Default App",
    "Cut",
    "Copy",
    "Duplicate",
    "Copy Path",
    "Copy Relative Path",
    "Rename",
    "Trash",
    "Delete",
  ]);
  const root = panel.actionsFor(entryKey(""));
  expect(root).not.toContain("Trash");
  expect(root).not.toContain("Delete");
  expect(root).not.toContain("Paste");
  expect(root).toContain("Rename");
  expect(root).toContain("Expand All");
  expect(root).toContain("Collapse All");
  panel.clipboard = { kind: "copied", rel: "main.rs" };
  expect(panel.actionsFor(entryKey(""))).toContain("Paste");
  panel.selection = entryKey("");
  expect(panel.action("Paste", entryKey(""))).toEqual({
    kind: "copy",
    from: "main.rs",
    to: "main copy.rs",
    isFile: true,
  });
  write(dir, "main copy.rs", "x");
  panel.selection = entryKey("");
  expect(panel.action("Paste", entryKey(""))).toEqual({
    kind: "copy",
    from: "main.rs",
    to: "main copy 1.rs",
    isFile: true,
  });
  panel.action("Cut", entryKey("main.rs"));
  panel.selection = entryKey("");
  expect(panel.action("Paste", entryKey(""))).toEqual({
    kind: "rename",
    from: "main.rs",
    to: "main copy 1.rs",
    paste: true,
  });
});

test("backspace trashes the row under the cursor, delete deletes it", () => {
  const dir = scratch("trash");
  write(dir, "main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.selection = entryKey("main.rs");
  expect(panel.key("backspace")).toEqual({ kind: "trash", rel: "main.rs" });
  expect(panel.key("delete")).toEqual({ kind: "delete", rel: "main.rs" });
});

test("copy path is a clipboard write", () => {
  const dir = scratch("copypath");
  write(dir, "src/main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.selection = entryKey("src/main.rs");
  expect(panel.action("Copy Path", entryKey("src/main.rs"))).toEqual({ kind: "clipboard", text: join(dir, "src/main.rs") });
  expect(panel.action("Copy Relative Path", entryKey("src/main.rs"))).toEqual({ kind: "clipboard", text: "src/main.rs" });
  expect(panel.key("cmd+c")).toEqual({ kind: "clipboard", text: join(dir, "src/main.rs") });
  expect(panel.clipboard).toEqual({ kind: "copied", rel: "src/main.rs" });
  panel.key("cmd+x");
  expect(panel.clipboard).toEqual({ kind: "cut", rel: "src/main.rs" });
});

test("reveal and open are the system's", () => {
  const dir = scratch("reveal");
  write(dir, "main.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  expect(panel.action("Reveal in Finder", entryKey("main.rs"))).toEqual({ kind: "reveal", rel: "main.rs" });
  expect(panel.action("Open in Default App", entryKey("main.rs"))).toEqual({ kind: "systemOpen", rel: "main.rs" });
});

test("expand all and collapse all", () => {
  const dir = scratch("expandall");
  write(dir, "a/b/c/file.rs", "x");
  write(dir, "x/y.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  panel.unfoldDirectory("a/b/c");
  panel.rows();
  panel.action("Expand All", entryKey("a"));
  expect(panel.state.expanded.has("a")).toBe(true);
  expect(panel.state.expanded.has("a/b")).toBe(true);
  expect(panel.state.expanded.has("a/b/c")).toBe(true);
  expect(panel.state.expanded.has("x")).toBe(false);
  panel.action("Collapse All", entryKey("a"));
  expect(panel.state.expanded.has("a/b/c")).toBe(false);
  panel.action("Collapse All", entryKey(""));
  expect([...panel.state.expanded]).toEqual([""]);
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("a"), entryKey("x")]);
});

test("the fold entries need a chain", () => {
  const dir = scratch("foldmenu");
  write(dir, "a/b/c/file.rs", "x");
  write(dir, "plain/file.rs", "x");
  const panel = panelIn(dir);
  panel.rows();
  expect(panel.actionsFor(entryKey("a/b/c"))).toContain("Unfold Directory");
  expect(panel.actionsFor(entryKey("a/b/c"))).not.toContain("Fold Directory");
  expect(panel.actionsFor(entryKey("plain"))).not.toContain("Fold Directory");
  panel.unfoldDirectory("a/b/c");
  expect(panel.actionsFor(entryKey("a"))).toContain("Fold Directory");
});

test("a rescan picks up a new file", () => {
  const dir = scratch("rescan");
  write(dir, "a.rs", "x");
  const panel = panelIn(dir);
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("a.rs")]);
  write(dir, "b.rs", "x");
  panel.rescan();
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("a.rs"), entryKey("b.rs")]);
});

test("a drop in the project moves, and carries what was open", () => {
  const dir = scratch("drop-move");
  write(dir, "a.rs", "a");
  write(dir, "lib/inner/x.rs", "x");
  write(dir, "src/main.rs", "main");
  const panel = panelIn(dir);
  panel.settings.autoFoldDirs = false;
  panel.state.expanded.add("lib");
  panel.state.expanded.add("lib/inner");
  panel.rows();
  expect(panel.dropPaths(entryKey("src"), [join(dir, "a.rs")])).toEqual({
    kind: "drop",
    transfers: [{ from: join(dir, "a.rs"), to: "src/a.rs", copy: false }],
  });
  expect(panel.selection).toBe(entryKey("src/a.rs"));
  expect(panel.dropPaths(entryKey("src/main.rs"), [join(dir, "lib")])).toEqual({
    kind: "drop",
    transfers: [{ from: join(dir, "lib"), to: "src/lib", copy: false }],
  });
  expect(panel.state.expanded.has("src/lib/inner")).toBe(true);
  expect(panel.state.expanded.has("lib")).toBe(false);
});

test("a drop never loses anything", () => {
  const dir = scratch("drop-refused");
  write(dir, "src/main.rs", "main");
  write(dir, "src/ui/view.rs", "view");
  const panel = panelIn(dir);
  panel.settings.autoFoldDirs = false;
  panel.state.expanded.add("src");
  panel.rows();
  expect(panel.dropPaths(entryKey("src"), [join(dir, "src/main.rs")])).toEqual({ kind: "none" });
  expect(panel.dropPaths(entryKey("src/ui"), [join(dir, "src")])).toEqual({ kind: "none" });
  expect(panel.dropPaths(entryKey("src"), [join(dir, "src")])).toEqual({ kind: "none" });
  expect(panel.dropPaths(entryKey("src"), [dir])).toEqual({ kind: "none" });
});

test("a drop from outside the project is copied in", () => {
  const dir = scratch("drop-copy");
  const outside = scratch("drop-copy-outside");
  write(dir, "notes.md", "mine");
  write(outside, "notes.md", "theirs");
  write(outside, "assets/logo.svg", "svg");
  const panel = panelIn(dir);
  panel.rows();
  expect(panel.dropPaths(entryKey("notes.md"), [join(outside, "notes.md"), join(outside, "assets")])).toEqual({
    kind: "drop",
    transfers: [
      { from: join(outside, "notes.md"), to: "notes copy.md", copy: true },
      { from: join(outside, "assets"), to: "assets", copy: true },
    ],
  });
});

test("the search lists what matches in the whole project, flat, and picking one shows it in the tree", async () => {
  const dir = scratch("filter");
  write(dir, "src/main.rs", "x");
  write(dir, "src/ui/view.rs", "x");
  write(dir, "docs/readme.md", "x");
  const panel = panelIn(dir);
  panel.rows();
  // Nothing under `src` is listed yet: the search reads the project for itself.
  await panel.ensureIndex();
  panel.filter = "main";
  expect(keys(panel.rows())).toEqual([entryKey("src/main.rs")]);
  panel.filter = ".rs";
  const found = keys(panel.rows());
  expect(found).toContain(entryKey("src/main.rs"));
  expect(found).toContain(entryKey("src/ui/view.rs"));
  expect(found).not.toContain(entryKey("docs/readme.md"));
  panel.filter = "ui";
  expect(panel.activate(entryKey("src/ui"))).toEqual({ kind: "redraw" });
  expect(panel.filter).toBe("");
  expect(panel.state.expanded.has("src")).toBe(true);
  expect(panel.selection).toBe(entryKey("src/ui"));
  // A file picked opens, and is shown in the tree too.
  panel.filter = "view";
  expect(panel.activate(entryKey("src/ui/view.rs"))).toEqual({ kind: "open", rel: "src/ui/view.rs" });
  expect(panel.state.expanded.has("src/ui")).toBe(true);
});

test("a project inside a repository starts at its root, and git's state is on the rows", async () => {
  const dir = scratch("repo");
  Bun.spawnSync(["git", "init"], { cwd: dir, stdout: "ignore", stderr: "ignore" });
  write(dir, "crates/one/src/lib.rs", "x");
  const panel = panelIn(join(dir, "crates/one"));
  expect(panel.root).toBe(realpathSync(dir));
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("crates/one/src")]);
  await panel.refreshGit();
  panel.state.expanded.add("crates/one/src");
  expect(rowOf(panel.rows(), entryKey("crates/one/src/lib.rs")).color).toBe("added");
  expect(rowOf(panel.rows(), entryKey("crates/one/src")).color).toBe("added");
});

test("a project shown again comes back with the folders it had open", () => {
  const one = scratch("one");
  write(one, "src/main.rs", "main");
  const two = scratch("two");
  write(two, "lib/x.rs", "x");
  const panel = panelIn(one);
  panel.refresh(one);
  panel.state.expanded.add("src");
  // A folder deeper in the same project is the same tree: nothing closes.
  panel.refresh(join(one, "src"));
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("src"), entryKey("src/main.rs")]);
  panel.refresh(two);
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("lib")]);
  panel.refresh(one);
  expect(keys(panel.rows())).toEqual([entryKey(""), entryKey("src"), entryKey("src/main.rs")]);
});
