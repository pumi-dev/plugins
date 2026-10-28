// file-tree: the project tree in the left sidebar. It shows the repository the current tab's
// directory is in, its folders and files with their icons and git's marks, and lets them be opened,
// renamed, trashed, dragged out and dropped into, and searched. It reads the tree again whenever the
// disk changes.
//
//   cmd+shift+e                          show the sidebar the tree is in
//   pumi call pumi_dev.file_tree.reveal  the current tab's file, shown in the tree
//
// What is here is the logic: the panel (`panel.ts`, which decides), what a gesture carries out
// (`intent.ts`, which acts), the watch on the disk, and the options. `ui.tsx` draws the rows it is
// answered with, and asks again as the tab in front moves, on a slow clock, and after every gesture.
import { dirname } from "node:path";
import { call, fn, on, option, self, workspace } from "pumi";

import { perform } from "./intent.ts";
import { panel, type Panel } from "./panel.ts";
import type { Row } from "./row.ts";
import { watch } from "./watch.ts";

/** The tree as the window draws it: the repository, its rows, and what the user is doing to them. */
export interface View {
  root: string;
  rows: Row[];
  /** What the filter box holds; not empty means it is showing. */
  filter: string;
  /** The filter box has the keyboard. */
  filtering: boolean;
  /** The row under the cursor, by key. */
  selection: string | null;
  /** The row being typed into, and what has been typed. */
  naming: { name: string; isDir: boolean } | null;
  /** An item of a row's menu, as the row's `actions` name them. */
  actions: string[];
  /** Goes up whenever what the view says changes: the clock's `reread` is answered `null` for the
   *  version the window has already. */
  version: number;
}

/** The panel as it is now. */
function view(): View {
  const state = panel();
  const rows = state.rows();
  const row = state.selection === null ? undefined : rows.find((each) => each.key === state.selection);
  const next: Omit<View, "version"> = {
    root: state.root,
    rows,
    filter: state.filter,
    filtering: state.filtering,
    selection: state.selection,
    naming: state.edit === null ? null : { name: state.edit.name, isDir: state.edit.isDir },
    actions: row?.actions ?? [],
  };
  const sig = JSON.stringify(next);
  if (sig !== drawn) {
    drawn = sig;
    version += 1;
  }
  return { ...next, version };
}

/** The last view as JSON, and its version. */
let drawn = "";
let version = 0;

/** The directory the tree was last pointed at, and the watch on that project. */
let lastCwd: string | null = null;
let unwatch: (() => void) | null = null;
let watched: string | null = null;

/** Points the tree at `cwd`, watching the project it lands in. The same one again is a no-op. */
function root(cwd: string): Panel {
  const state = panel(cwd || process.cwd());
  if (cwd === lastCwd) return state;
  lastCwd = cwd;
  state.refresh(cwd);
  void state.refreshGit();
  if (watched !== state.root) {
    unwatch?.();
    watched = state.root;
    unwatch = watch(state.root, (paths) => heard(state.root, paths));
  }
  return state;
}

/** The watch heard a change the tree shows since it was last read: the next tick reads it again. */
let stale = true;

/** The project changed: read it again on the next tick, unless every path of the burst is one the
 *  tree leaves out (a build inside an ignored folder). */
function heard(at: string, paths: string[]): void {
  const state = panel();
  if (state.root !== at) return;
  // The search's list of the project is read again when it is next used, whatever changed.
  state.forgetIndex();
  if (paths.length > 0 && paths.every((path) => state.tree.changeIsUnseen(path))) return;
  stale = true;
}

/** Every gesture answers the tree as it is afterwards, so one round trip draws the result. */
async function followed(state: Panel, intent: Parameters<typeof perform>[1]): Promise<View> {
  await perform(state, intent);
  return view();
}

// ---- what the window asks for

/** The tree at `cwd`: what it holds, and what the user is doing to it. */
export async function load(cwd: string): Promise<View> {
  root(cwd);
  return view();
}

/** A key the tree answers (`down`, `enter`, `f2`, `cmd+c`, …), as the panel names them. */
export async function pressed(chord: string): Promise<View> {
  const state = panel();
  return followed(state, state.key(chord));
}

/** A row pressed: a folder folds, a file opens. */
export async function activate(key: string): Promise<View> {
  const state = panel();
  return followed(state, state.activate(key));
}

/** A folder's triangle pressed: it opens or closes. */
export async function toggle(key: string): Promise<View> {
  const state = panel();
  return followed(state, state.toggle(key));
}

/** An item of a row's menu (`Rename`, `Trash`, …), for the row `key`. */
export async function chose(action: string, key: string): Promise<View> {
  const state = panel();
  return followed(state, state.action(action, key));
}

/** What a drag dropped onto a row comes to: paths, into or onto it. */
export async function dropped(key: string, paths: string[]): Promise<View> {
  const state = panel();
  return followed(state, state.dropPaths(key, paths));
}

/** A name typed into a row, and its commit (Enter, or the field losing the keyboard). */
export function named(name: string): View {
  panel().setName(name);
  return view();
}

export async function committed(): Promise<View> {
  const state = panel();
  return followed(state, state.commitEdit());
}

/** Escape while renaming: nothing is kept. */
export function cancelled(): View {
  panel().cancelEdit();
  return view();
}

/** What the search box holds, which is what the tree keeps: the whole project is searched (read
 *  once, and again after the disk changes), the first match under the cursor. */
export async function filtered(text: string): Promise<View> {
  const state = panel();
  state.filter = text;
  state.filtering = true;
  state.selection = null;
  if (text !== "") {
    await state.ensureIndex().catch((err) => console.error(`file-tree: reading the project for the search: ${err}`));
    // Another keystroke came while it was read: that one answers.
    if (state.filter !== text) return view();
    state.selection = state.rows()[0]?.key ?? null;
  }
  return view();
}

/** Enter in the search box: the match under the cursor (the first, unless the arrows moved it),
 *  opened, and shown in the tree. */
export async function firstMatch(): Promise<View> {
  const state = panel();
  const rows = state.rows();
  const pick = rows.find((row) => row.key === state.selection) ?? rows[0];
  return pick ? followed(state, state.activate(pick.key)) : view();
}

/** The filter box opened or closed (`cmd+f`, Escape). */
export function searching(on: boolean): View {
  const state = panel();
  state.filtering = on;
  if (!on) state.filter = "";
  return view();
}

/** A new file, or folder, in the directory of the row under the cursor. */
export async function adding(isDir: boolean): Promise<View> {
  const state = panel();
  return followed(state, state.addEntry(state.selection ?? "", isDir));
}

/** When the disk and git were last read by a tick: they are read again at least this often, for
 *  what the watch did not say (a watch that failed, git's state changed from outside the tree). */
let readAt = 0;
const READ_ANYWAY = 10_000;

/** The window's clock: the disk and git read again when the watch heard a change (or every
 *  `READ_ANYWAY`), and `null` when the tree is still the version `had` the window draws — so an
 *  idle tick costs nothing, and does not hold the worker while a click waits. */
export async function reread(had = -1): Promise<View | null> {
  const state = panel();
  const quiet = !stale && Date.now() - readAt < READ_ANYWAY;
  if (quiet && had === version) return null;
  if (!quiet) {
    stale = false;
    readAt = Date.now();
    state.rescan();
    await state.refreshGit();
  }
  const next = view();
  return next.version === had ? null : next;
}

// ---- what the app reaches

/** `cmd+shift+e`, as the app's own key does: the sidebar, which is where the page is. */
fn.set("toggle", { desc: "Open the files sidebar." }, () => call("toggle_sidebar"));

/** The current tab's file, shown in the tree: its folders opened and the cursor on it. A file
 *  outside the project the tree shows points the tree at the file's folder first. */
fn.set("reveal", { desc: "Show the current tab's file in the project tree." }, async () => {
  await workspace.ready.catch(() => undefined);
  const path = workspace.currentTab?.options?.["path"];
  if (typeof path !== "string" || path === "") return null;
  if (!panel().revealPath(path)) {
    root(dirname(path));
    panel().revealPath(path);
  }
  return null;
});

/** `cmd+f`: the filter box, and the keyboard in it. */
fn.set("filter", { desc: "Open the files sidebar and filter its tree." }, async () => {
  await call("toggle_sidebar");
  searching(true);
});

/** Every option the panel reads, followed: a change reads the tree again as the options say. */
on(
  "option.changed",
  {
    match: ["hide_gitignore", "hide_hidden", "file_icons", "folder_icons", "git_status", "auto_fold_dirs", "indent_size", "open_with", "editor"].map(
      (key) => self.plugin.prefixed(key),
    ),
    desc: "the tree follows its options",
  },
  async () => {
    await panel().readSettings((name) => option.get(name));
    panel().forgetIndex();
  },
);

void panel()
  .readSettings((name) => option.get(name))
  .catch((err) => console.error(`file-tree: reading its options: ${err instanceof Error ? err.message : err}`));
