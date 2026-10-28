// The project panel. It keeps what the user is doing — the open directories, the row under the cursor, what was cut or
// copied, the row being typed into — and answers every gesture with an `Intent`, which is what
// `intent.ts` carries out. Nothing here calls the API: the panel can be driven by a test.
import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import * as editDraft from "./edit.ts";
import type { Edit } from "./edit.ts";
import * as git from "./git.ts";
import * as icons from "./icons.ts";
import * as menu from "./menu.ts";
import type { Intent } from "./intent.ts";
import * as relpath from "./relpath.ts";
import { listProject, searched, type Indexed } from "./search.ts";
import { DEFAULT_INDENT, NEW_ENTRY_KEY, entryKey, entryRel, plainRow, type Row } from "./row.ts";
import {
  Tree,
  depthAndDifference,
  initialState,
  unflatten,
  visibleEntries,
  type NewEntry,
  type State,
  type TreeEntry,
} from "./tree.ts";

/** What was cut or copied in the tree: a path in the project, kept for a paste. */
export type Clip = { kind: "empty" } | { kind: "copied"; rel: string } | { kind: "cut"; rel: string };

/** What the panel's options say it does. */
export interface Settings {
  /** Leave out what `.gitignore` hides. */
  hideGitignore: boolean;
  /** Leave out what starts with a dot. */
  hideHidden: boolean;
  /** Draw a file's icon. */
  fileIcons: boolean;
  /** Draw a folder's icon. */
  folderIcons: boolean;
  /** Tint a row by what git says of it. */
  gitStatus: boolean;
  /** Fold a directory that holds one directory into one row. */
  autoFoldDirs: boolean;
  /** Pixels a level of the tree takes. */
  indentSize: number;
  /** What a click on a file does: a view of its own, a file tab on the right, the user's editor in a
   *  terminal tab, or the system's app. */
  openWith: "tab" | "beside" | "editor" | "system";
  /** The editor to open it with; `$EDITOR` when it is empty. */
  editor: string;
}

export const DEFAULT_SETTINGS: Settings = {
  hideGitignore: false,
  hideHidden: false,
  fileIcons: true,
  folderIcons: true,
  gitStatus: true,
  autoFoldDirs: true,
  indentSize: DEFAULT_INDENT,
  openWith: "tab",
  editor: "",
};

/** How many rows the search shows: the best of them, which is all a list of matches is read for. */
const FILTER_LIMIT = 500;

/** How many projects the panel remembers the open folders of, besides the one it shows. */
const LEFT_PROJECTS = 20;

export class Panel {
  tree: Tree;
  state: State = initialState();
  settings: Settings = { ...DEFAULT_SETTINGS };
  /** The key of the row under the cursor, or of the row being typed into. */
  selection: string | null = null;
  clipboard: Clip = { kind: "empty" };
  /** The row being renamed, or the file or folder about to be made. */
  edit: Edit | null = null;
  /** What the filter box holds; `""` shows the tree. */
  filter = "";
  /** Every path of the project, for the search (`search.ts`); null until read, or after the disk
   *  changed. Read for the root it says. */
  private index: { root: string; paths: Indexed[] } | null = null;
  private indexing: Promise<void> | null = null;
  /** The last search's answer, kept while neither the query nor the index changes. */
  private found: { query: string; paths: Indexed[]; hits: Indexed[]; fits: Indexed[] } | null = null;
  /** The filter box is showing: the command asked for it, or it has something in it. */
  filtering = false;
  private listeners = new Set<() => void>();
  /** Whether a tab's directory has pointed the panel anywhere yet: until then its root is only
   *  where the worker started, which holds nothing. */
  private pointed = false;
  /** The projects shown before, by root, as they were left: oldest first. */
  private left = new Map<string, { state: State; selection: string | null }>();

  constructor(root: string) {
    this.tree = new Tree(root);
  }

  /** Where the project is: the repository's root, or the directory the panel was pointed at. */
  get root(): string {
    return this.tree.root;
  }

  /**
   * Reads every option the panel has, through `read` — the package's own options by their bare key —
   * and clamps what needs it. What reads them is the API's `option.get`; a test hands it its own.
   */
  async readSettings(read: (name: string) => Promise<unknown>): Promise<void> {
    const value = async (name: string) => read(name).catch(() => undefined);
    const [hideGitignore, hideHidden, fileIcons, folderIcons, gitStatus, autoFoldDirs, indentSize, openWith, editor] =
      await Promise.all(
        [
          "hide_gitignore",
          "hide_hidden",
          "file_icons",
          "folder_icons",
          "git_status",
          "auto_fold_dirs",
          "indent_size",
          "open_with",
          "editor",
        ].map(value),
      );
    this.settings = {
      hideGitignore: hideGitignore === true,
      hideHidden: hideHidden === true,
      fileIcons: fileIcons !== false,
      folderIcons: folderIcons !== false,
      gitStatus: gitStatus !== false,
      autoFoldDirs: autoFoldDirs !== false,
      indentSize: Math.min(64, Math.max(4, Number(indentSize) || DEFAULT_INDENT)),
      openWith: openWith === "system" || openWith === "editor" || openWith === "beside" ? openWith : "tab",
      editor: typeof editor === "string" ? editor : "",
    };
    this.announce();
  }

  /** Calls `fn` whenever the panel changes; gives back what stops it. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Says the panel changed: the view draws again. */
  announce(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Points the panel at `cwd`: the same project is only read again, another one is a new tree with
   * the same settings and clipboard. A project shown before comes back as it was left: its open
   * folders and its cursor.
   */
  refresh(cwd: string): void {
    const wanted = new Tree(cwd);
    // The same project, or a folder inside it that is no repository of its own (a file opened from
    // a project that is not in git has its folder as its pane's directory): the tree stays.
    const inside = this.pointed && !wanted.hasGitRepo && holds(this.tree.root, wanted.root);
    this.pointed = true;
    if (wanted.root === this.tree.root || inside) {
      this.rescan();
      return;
    }
    this.left.set(this.tree.root, { state: this.state, selection: this.selection });
    const back = this.left.get(wanted.root);
    this.left.delete(wanted.root);
    this.tree = wanted;
    this.state = back?.state ?? initialState();
    this.selection = back?.selection ?? null;
    // Kept for the most recent projects only.
    while (this.left.size > LEFT_PROJECTS) this.left.delete(this.left.keys().next().value!);
  }

  /** Reads git's state and the disk again. */
  rescan(): void {
    this.tree.rescan();
    this.update();
    const selection = this.selection;
    if (selection !== null && !this.state.visible.some((visible) => rowKeyOf(visible) === selection)) {
      this.selection = null;
    }
  }

  /** Reads git's state of the project again. */
  async refreshGit(): Promise<void> {
    this.tree.setSummaries(await git.summaries(this.tree.root));
  }

  /** The rows the view draws: the open tree, or the filter's matches. */
  rows(): Row[] {
    if (this.filter !== "") return this.filteredRows(this.filter);
    this.update();
    const visible = new Set(this.state.visible.filter((entry) => !entry.isNewEntry).map((entry) => entry.entry.rel));
    const rows: Row[] = [];
    for (const item of this.state.visible) {
      rows.push(this.rowOf(item, visible));
    }
    return rows;
  }

  /** Reads the visible entries again, from the directories that are open. */
  private update(): void {
    this.state = visibleEntries(this.tree, this.state, this.settings, this.newEntry());
  }

  /** The row being typed into, as the traversal needs it. */
  private newEntry(): NewEntry | null {
    const edit = this.edit;
    if (edit === null || !editDraft.isNewEntry(edit)) return null;
    return { parent: edit.entry, isDir: edit.isDir, temporarilyUnfolded: edit.temporarilyUnfolded };
  }

  private rowOf(item: State["visible"][number], visible: Set<string>): Row {
    const entry = item.entry;
    const key = rowKeyOf(item);
    const selected = this.selection === key;
    const [depth, difference] = depthAndDifference(entry.rel, visible);
    const isExpanded = this.state.expanded.has(entry.rel);
    const row = plainRow(key);
    row.kind = entry.kind === "dir" ? "folder" : "file";
    row.depth = item.isNewEntry ? Math.min(depth + 1, 255) : depth;
    row.open = entry.kind === "dir" && isExpanded;
    row.text = item.isNewEntry
      ? ""
      : difference > 1
        ? (relpath.lastComponents(entry.rel, difference) ?? "")
        : entry.rel === ""
          ? this.tree.rootName
          : relpath.fileName(entry.rel);
    row.color = this.settings.gitStatus
      ? git.labelColor(entry.git, entry.isIgnored, selected)
      : selected
        ? "selected"
        : "muted";
    row.icon = item.isNewEntry
      ? ""
      : entry.kind === "file"
        ? this.settings.fileIcons
          ? icons.fileIcon(entry.rel)
          : ""
        : this.settings.folderIcons && entry.rel !== ""
          ? icons.folderIcon(entry.rel, isExpanded)
          : "";
    row.selected = selected;
    row.indent = this.settings.indentSize;
    row.actions = item.isNewEntry ? [] : this.actionsFor(key);
    row.editing = this.editingHere(item);
    row.path = item.isNewEntry ? "" : this.tree.abs(entry.rel);
    return row;
  }

  /** Whether the row being typed into is this one. */
  private editingHere(item: State["visible"][number]): boolean {
    const edit = this.edit;
    if (edit === null) return false;
    if (editDraft.isNewEntry(edit)) return item.isNewEntry;
    return !item.isNewEntry && item.entry.rel === edit.entry;
  }

  // ---- the filter

  /** Reads the project's paths for the search, unless they are read already. */
  async ensureIndex(): Promise<void> {
    const root = this.tree.root;
    if (this.index?.root === root) return;
    if (this.indexing) return this.indexing;
    this.indexing = (async () => {
      try {
        const paths = await listProject(root, { inRepo: this.tree.hasGitRepo, hideHidden: this.settings.hideHidden });
        if (this.tree.root === root) this.index = { root, paths };
      } finally {
        this.indexing = null;
      }
    })();
    return this.indexing;
  }

  /** The disk changed: the search reads the project again the next time it is asked. */
  forgetIndex(): void {
    this.index = null;
  }

  /** The search's matches: the paths of the whole project the query fits, best first, as a flat
   * list. Before the project is
   * read (`ensureIndex`), what the tree has listed is searched. */
  private filteredRows(query: string): Row[] {
    const paths = this.index?.root === this.tree.root ? this.index.paths : this.listedPaths();
    const was = this.found;
    if (was?.query !== query || was.paths !== paths) {
      // A query that only grew (the next keystroke) fits nothing the shorter one did not.
      const among = was && was.paths === paths && query.startsWith(was.query) && !was.query.includes(" ") ? was.fits : paths;
      this.found = { query, paths, ...searched(among, query, FILTER_LIMIT) };
    }
    const found = this.found!;
    const out: TreeEntry[] = found.hits.map(
      (hit) =>
        this.tree.entry(hit.rel) ?? {
          rel: hit.rel,
          kind: hit.dir ? "dir" : "file",
          isIgnored: false,
          isHidden: relpath.fileName(hit.rel).startsWith("."),
          git: this.tree.summary(hit.rel),
        },
    );
    return out.map((entry) => {
      const key = entryKey(entry.rel);
      const row = plainRow(key);
      row.kind = entry.kind === "dir" ? "folder" : "file";
      row.text = entry.rel;
      row.color = this.settings.gitStatus
        ? git.labelColor(entry.git, entry.isIgnored, this.selection === key)
        : this.selection === key
          ? "selected"
          : "muted";
      row.icon =
        entry.kind === "file"
          ? this.settings.fileIcons
            ? icons.fileIcon(entry.rel)
            : ""
          : this.settings.folderIcons
            ? icons.folderIcon(entry.rel, false)
            : "";
      row.selected = this.selection === key;
      row.indent = this.settings.indentSize;
      row.actions = this.actionsFor(key);
      row.path = this.tree.abs(entry.rel);
      return row;
    });
  }

  /** What the tree has listed so far, as the search reads it. */
  private listedPaths(): Indexed[] {
    const out: Indexed[] = [];
    const stack = [relpath.ROOT];
    while (stack.length > 0) {
      const at = stack.pop()!;
      for (const child of this.tree.listedChildren(at)) {
        if (this.settings.hideGitignore && child.isIgnored) continue;
        if (this.settings.hideHidden && child.isHidden) continue;
        out.push({ rel: child.rel, dir: child.kind === "dir" });
        if (child.kind === "dir") stack.push(child.rel);
      }
    }
    return out;
  }

  // ---- the cursor

  /** The path of the row under the cursor, unfolded out of a chain. */
  private selectedRel(): string | null {
    const at = this.selection === null ? null : entryRel(this.selection);
    return at === null ? null : unflatten(this.state, at);
  }

  select(delta: number): Intent {
    this.update();
    const keys = this.filter !== "" ? this.rows().map((row) => row.key) : this.state.visible.map(rowKeyOf);
    if (keys.length === 0) {
      this.selection = null;
      return { kind: "redraw" };
    }
    const at = this.selection === null ? undefined : keys.indexOf(this.selection);
    const next =
      at === undefined ? (delta >= 0 ? 0 : keys.length - 1) : Math.min(Math.max(at + delta, 0), keys.length - 1);
    this.selection = keys[next]!;
    return { kind: "redraw" };
  }

  selectFirst(): Intent {
    this.update();
    const first = this.state.visible[0];
    if (first) this.selection = rowKeyOf(first);
    return { kind: "redraw" };
  }

  selectLast(): Intent {
    this.update();
    const last = this.state.visible[this.state.visible.length - 1];
    if (last) this.selection = rowKeyOf(last);
    return { kind: "redraw" };
  }

  // ---- opening and closing

  /** A click on a row: a folder opens or closes, a file opens. */
  activate(key: string): Intent {
    this.discardEdit();
    const at = entryRel(key);
    if (at === null) {
      this.selection = key;
      return { kind: "redraw" };
    }
    if (this.filter !== "") {
      const shown = this.reveal(at);
      return this.tree.entry(at)?.kind === "file" || isFile(this.tree.abs(at)) ? { kind: "open", rel: at } : shown;
    }
    const path = unflatten(this.state, at);
    this.selection = entryKey(path);
    const entry = this.tree.entry(path);
    if (!entry) return { kind: "redraw" };
    if (entry.kind === "dir") {
      this.toggleExpanded(path);
      return { kind: "redraw" };
    }
    return { kind: "open", rel: path };
  }

  /** The disclosure triangle: a folder opens or closes and nothing else changes. */
  toggle(key: string): Intent {
    const at = entryRel(key);
    if (at === null) return { kind: "none" };
    this.toggleExpanded(unflatten(this.state, at));
    return { kind: "redraw" };
  }

  private toggleExpanded(path: string): void {
    if (!this.state.expanded.delete(path)) this.state.expanded.add(path);
  }

  /** A row of the filter, picked: the filter goes and the tree shows it. */
  private reveal(path: string): Intent {
    this.filter = "";
    this.filtering = false;
    for (const above of relpath.ancestors(path).slice(1)) this.state.expanded.add(above);
    this.state.expanded.add(path);
    this.selection = entryKey(path);
    return { kind: "redraw" };
  }

  /** Shows the file at `abs` in the tree, its folders open and the cursor on it. False when it is
   *  not in the project. */
  revealPath(abs: string): boolean {
    const rel = this.tree.relOf(abs);
    if (rel === null || rel === "") return false;
    this.reveal(rel);
    this.announce();
    return true;
  }

  private discardEdit(): void {
    this.edit = null;
  }

  // ---- what a row's menu can do

  actionsFor(key: string): string[] {
    const at = entryRel(key);
    if (at === null) return [];
    const path = unflatten(this.state, at);
    return menu.contextMenu({
      isDir: this.tree.entry(path)?.kind === "dir",
      isRoot: path === relpath.ROOT,
      isFoldable: this.tree.isFoldable(path),
      isUnfoldable: this.tree.isUnfoldable(path, this.state.unfolded),
      hasGitRepo: this.tree.hasGitRepo,
      hasPasteableContent: this.clipboard.kind !== "empty",
    });
  }

  /** One of a row's menu items, chosen. */
  action(name: string, key: string): Intent {
    this.update();
    this.discardEdit();
    const at = entryRel(key);
    if (at === null) return { kind: "none" };
    const path = unflatten(this.state, at);
    this.selection = entryKey(path);
    switch (name) {
      case "New File":
        return this.addEntry(path, false);
      case "New Folder":
        return this.addEntry(path, true);
      case "Rename":
        return this.renameEntry(path);
      case "Trash":
        return { kind: "trash", rel: path };
      case "Delete":
        return { kind: "delete", rel: path };
      case "Reveal in Finder":
        return { kind: "reveal", rel: path };
      case "Open in Default App":
        return { kind: "systemOpen", rel: path };
      case "Copy Path":
        return { kind: "clipboard", text: this.tree.abs(path) };
      case "Copy Relative Path":
        return { kind: "clipboard", text: path };
      case "Cut":
        this.clipboard = { kind: "cut", rel: path };
        return { kind: "redraw" };
      case "Copy":
        this.clipboard = { kind: "copied", rel: path };
        return { kind: "redraw" };
      case "Duplicate":
        this.clipboard = { kind: "copied", rel: path };
        return this.paste();
      case "Paste":
        return this.paste();
      case "Add to .gitignore":
        return { kind: "ignore", file: "gitignore", rel: path, isDir: this.tree.entry(path)?.kind === "dir" };
      case "Add to .git/info/exclude":
        return { kind: "ignore", file: "exclude", rel: path, isDir: this.tree.entry(path)?.kind === "dir" };
      case "Unfold Directory":
        this.unfoldDirectory(path);
        return { kind: "redraw" };
      case "Fold Directory":
        this.foldDirectory(path);
        return { kind: "redraw" };
      case "Expand All":
        if (path === relpath.ROOT) return this.expandAll();
        this.expandAllFor(path);
        return { kind: "redraw" };
      case "Collapse All":
        if (path === relpath.ROOT) return this.collapseAll();
        this.collapseAllFor(path);
        return { kind: "redraw" };
      default:
        return { kind: "none" };
    }
  }

  // ---- the keys of the tree

  /** A key the tree answers; the view binds them, the panel acts on them. */
  key(chord: string): Intent {
    this.update();
    switch (chord) {
      case "down":
      case "tab":
      case "ctrl+n":
        return this.select(1);
      case "up":
      case "shift+tab":
      case "ctrl+p":
        return this.select(-1);
      case "home":
      case "pageup":
      case "shift+pageup":
      case "cmd+up":
        return this.selectFirst();
      case "end":
      case "pagedown":
      case "shift+pagedown":
      case "cmd+down":
        return this.selectLast();
      case "left":
        return this.collapseSelected();
      case "cmd+left":
        return this.collapseAll();
      case "right":
        return this.expandSelected();
      case "cmd+right":
        return this.expandAll();
      case "space":
        return this.openSelected();
      case "enter":
      case "f2":
        return this.renameSelected();
      case "backspace":
        return this.selectedAction("Trash");
      case "delete":
        return this.selectedAction("Delete");
      case "cmd+c":
        return this.copySelected("Copy");
      case "cmd+x":
        return this.copySelected("Cut");
      case "cmd+v":
        return this.paste();
      case "escape":
        this.selection = null;
        return { kind: "redraw" };
      default:
        return { kind: "none" };
    }
  }

  private openSelected(): Intent {
    const selected = this.selectedRel();
    if (selected === null) return this.select(1);
    const entry = this.tree.entry(selected);
    if (!entry) return { kind: "none" };
    if (entry.kind === "dir") {
      this.toggleExpanded(selected);
      return { kind: "redraw" };
    }
    return { kind: "open", rel: selected };
  }

  private selectedAction(name: string): Intent {
    const selected = this.selectedRel();
    if (selected === null) return { kind: "none" };
    return this.action(name, entryKey(selected));
  }

  /** `cmd+c` and `cmd+x`: the path goes to the clipboard, and the row is remembered for a paste. */
  private copySelected(name: "Copy" | "Cut"): Intent {
    const selected = this.selectedRel();
    if (selected === null) return { kind: "none" };
    this.clipboard = { kind: name === "Copy" ? "copied" : "cut", rel: selected };
    return { kind: "clipboard", text: this.tree.abs(selected) };
  }

  private expandSelected(): Intent {
    const selected = this.selection === null ? null : entryRel(this.selection);
    if (selected === null) return { kind: "none" };
    const folded = this.state.ancestors.get(selected);
    if (folded && folded.currentAncestorDepth > 0) {
      folded.currentAncestorDepth--;
      return { kind: "redraw" };
    }
    const path = unflatten(this.state, selected);
    const entry = this.tree.entry(path);
    if (!entry || entry.kind !== "dir") return { kind: "none" };
    if (this.state.expanded.has(path)) return this.select(1);
    this.state.expanded.add(path);
    return { kind: "redraw" };
  }

  private collapseSelected(): Intent {
    const selected = this.selection === null ? null : entryRel(this.selection);
    if (selected === null) return { kind: "none" };
    const folded = this.state.ancestors.get(selected);
    if (folded && folded.currentAncestorDepth + 1 < folded.ancestors.length) {
      folded.currentAncestorDepth++;
      return { kind: "redraw" };
    }
    let path = unflatten(this.state, selected);
    for (;;) {
      if (this.state.expanded.delete(path)) {
        this.selection = entryKey(path);
        return { kind: "redraw" };
      }
      if (path === relpath.ROOT) return { kind: "none" };
      path = relpath.parent(path);
    }
  }

  // ---- folded chains

  /** A chain folded back into one row, as far as it goes. */
  foldDirectory(path: string): void {
    this.state.unfolded.delete(path);
    let at = path;
    for (;;) {
      const children = this.tree.childEntries(at);
      const last = children.pop();
      if (last === undefined || children.length > 0 || last.kind !== "dir") break;
      this.state.unfolded.delete(last.rel);
      at = last.rel;
    }
  }

  /** One directory of a chain opened out, as far up as it is the only child. */
  unfoldDirectory(path: string): void {
    this.state.unfolded.add(path);
    let at = path;
    for (;;) {
      const above = at === relpath.ROOT ? relpath.ROOT : relpath.parent(at);
      if (above === relpath.ROOT) break;
      if (this.tree.childEntries(above).length > 1) break;
      this.state.unfolded.add(above);
      at = above;
    }
  }

  expandAll(): Intent {
    this.expandAllFor(relpath.ROOT);
    return { kind: "redraw" };
  }

  /** Every directory under `path` opened. */
  expandAllFor(path: string): void {
    const stack = [path];
    while (stack.length > 0) {
      const at = stack.pop()!;
      this.state.expanded.add(at);
      for (const child of this.tree.childEntries(at)) if (child.kind === "dir") stack.push(child.rel);
    }
  }

  collapseAll(): Intent {
    this.state.expanded.clear();
    this.state.expanded.add(relpath.ROOT);
    this.selection = entryKey(relpath.ROOT);
    return { kind: "redraw" };
  }

  /** Every directory under `path` closed. */
  collapseAllFor(path: string): void {
    const stack = [path];
    while (stack.length > 0) {
      const at = stack.pop()!;
      this.state.expanded.delete(at);
      for (const child of this.tree.childEntries(at)) if (child.kind === "dir") stack.push(child.rel);
    }
  }

  // ---- renaming, and making something new

  private renameSelected(): Intent {
    const selected = this.selectedRel();
    return selected === null ? { kind: "none" } : this.renameEntry(selected);
  }

  /** The row's own name, ready to be typed over. */
  renameEntry(path: string): Intent {
    const entry = this.tree.entry(path);
    if (!entry) return { kind: "none" };
    this.edit = {
      entry: path,
      leaf: path,
      isDir: entry.kind === "dir",
      name: relpath.fileName(path),
      temporarilyUnfolded: null,
    };
    return { kind: "redraw" };
  }

  /** The row being typed into, under the directory `selected` is in. */
  addEntry(selected: string, isDir: boolean): Intent {
    const directory = this.directoryForNewEntry(selected);
    if (directory === null) return { kind: "none" };
    this.state.expanded.add(directory);
    this.edit = {
      entry: directory,
      leaf: null,
      isDir,
      name: "",
      temporarilyUnfolded: directory === selected ? null : selected,
    };
    this.selection = NEW_ENTRY_KEY;
    return { kind: "redraw" };
  }

  /** The directory a new entry goes in: the row itself when it is one, else the one above it. */
  private directoryForNewEntry(selected: string): string | null {
    let at = unflatten(this.state, selected);
    for (;;) {
      const entry = this.tree.entry(at);
      if (!entry) return null;
      if (entry.kind === "dir") return at;
      if (at === relpath.ROOT) return null;
      at = relpath.parent(at);
    }
  }

  /** The name of the row being typed into was submitted: what to do about it. */
  commitEdit(): Intent {
    const edit = this.edit;
    if (edit === null) return { kind: "none" };
    const draft = editDraft.draftOf(edit);
    if (draft === null) return { kind: "redraw" };
    const target = editDraft.targetOf(edit, draft.name);
    if (target === null) return { kind: "none" };
    if (editDraft.isNewEntry(edit)) {
      if (existsSync(this.tree.abs(target.to))) return { kind: "redraw" };
      this.edit = null;
      this.selection = entryKey(target.to);
      return { kind: "create", path: target.to, isDir: draft.isDir };
    }
    this.edit = null;
    if (target.to === target.from) return { kind: "redraw" };
    if (existsSync(this.tree.abs(target.to))) {
      this.edit = edit;
      return { kind: "redraw" };
    }
    this.selection = entryKey(target.to);
    return { kind: "rename", from: target.from, to: target.to, paste: false };
  }

  /** The name being typed changed. */
  setName(name: string): void {
    if (this.edit !== null) this.edit.name = name;
  }

  /** The typing stopped without a name: nothing is made, nothing is renamed. */
  cancelEdit(): void {
    this.edit = null;
  }

  // ---- pasting, and dropping

  private paste(): Intent {
    if (this.clipboard.kind === "empty") return { kind: "none" };
    const source = this.clipboard.rel;
    const selected = this.selectedRel();
    if (selected === null) return { kind: "none" };
    const entry = this.tree.entry(selected);
    const target = entry === undefined ? null : entry.kind === "dir" ? selected : relpath.parent(selected);
    if (target === null) return { kind: "none" };
    const to = this.createPastePath(source, target);
    const isFile = this.tree.entry(source)?.kind === "file";
    this.selection = entryKey(to);
    if (this.clipboard.kind === "cut") {
      this.clipboard = { kind: "copied", rel: source };
      return { kind: "rename", from: source, to, paste: true };
    }
    return { kind: "copy", from: source, to, isFile };
  }

  /** Where a paste of `source` into `target` goes, never over something that is there. */
  private createPastePath(source: string, target: string): string {
    const targetEntry = this.tree.entry(target);
    const into = targetEntry?.kind === "file" || target === source ? relpath.parent(target) : target;
    return this.freePath(into, relpath.fileName(source), this.tree.entry(source)?.kind === "file");
  }

  /** `name` in `path`, with ` copy` added until it is a name nothing has: `main copy 1.rs`. */
  private freePath(path: string, name: string, isFile: boolean): string {
    const extension = isFile ? relpath.extension(name) : null;
    const stem = isFile ? relpath.fileStem(name) : name;
    let candidate = relpath.join(path, name);
    let round = 0;
    while (existsSync(this.tree.abs(candidate))) {
      const next = `${stem} copy${round > 0 ? ` ${round}` : ""}${extension === null ? "" : `.${extension}`}`;
      candidate = relpath.join(path, next);
      round++;
    }
    return candidate;
  }

  /** Paths dropped on a row: moves within the project, copies from outside it. */
  dropPaths(key: string, paths: string[]): Intent {
    this.update();
    this.discardEdit();
    const at = entryRel(key);
    if (at === null) return { kind: "none" };
    const path = unflatten(this.state, at);
    const entry = this.tree.entry(path);
    if (!entry) return { kind: "none" };
    const target = entry.kind === "dir" ? path : relpath.parent(path);
    const targetAbs = this.tree.abs(target);
    const transfers: import("./ops.ts").Transfer[] = [];
    for (const from of paths) {
      const name = relpath.fileName(from);
      if (name === "" || holds(from, targetAbs)) continue;
      const source = this.tree.relOf(from);
      if (source !== null && relpath.parent(source) === target) continue;
      if (source !== null) {
        const to = relpath.join(target, name);
        this.carryExpansion(source, to);
        transfers.push({ from, to, copy: false });
      } else {
        const isDir = isDirectory(from);
        transfers.push({ from, to: this.freePath(target, name, !isDir), copy: true });
      }
    }
    const last = transfers[transfers.length - 1];
    if (!last) return { kind: "none" };
    this.selection = entryKey(last.to);
    this.state.expanded.add(target);
    return { kind: "drop", transfers };
  }

  /** Was open before a move, open after it. */
  private carryExpansion(from: string, to: string): void {
    for (const set of [this.state.expanded, this.state.unfolded]) {
      const moved = [...set].filter((path) => path === from || path.startsWith(`${from}/`));
      for (const path of moved) {
        set.delete(path);
        set.add(`${to}${path.slice(from.length)}`);
      }
    }
  }
}

/** The key a visible row is drawn by. */
export function rowKeyOf(item: State["visible"][number]): string {
  return item.isNewEntry ? NEW_ENTRY_KEY : entryKey(item.entry.rel);
}

/** Whether `path` is `folder` or inside it, whatever it is called on disk. */
function holds(folder: string, path: string): boolean {
  const inside = relative(folder, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The panel, made the first time anything asks for one. */
let current: Panel | null = null;

/** The panel, pointed at `cwd` the first time it is asked for. */
export function panel(cwd?: string): Panel {
  current ??= new Panel(cwd ?? process.cwd());
  return current;
}

/** Whether `abs` is a file on disk. */
function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}
