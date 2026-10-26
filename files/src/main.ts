// `files`: the project tree in the left sidebar, as core/files' project panel is — the repository the
// current pane's directory is in, its folders and files with the icons and git's marks, opened,
// renamed, trashed, dragged out and dropped into, filtered, and read again whenever the disk changes.
//
// A package cannot open the app's own document tabs, so a click on a file opens it where a package
// can: in a terminal pane running the user's editor, or in whatever app owns the file (`open_with`).
// What is here is the logic: the panel (`panel.ts`, which decides), what a gesture carries out
// (`intent.ts`, which acts), the watch on the disk, and the options. `ui.tsx` draws the rows it is
// answered with, and asks again as the pane in front moves, on a slow clock, and after every gesture.
import { call, fn, on, option, self } from "pumi";

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
}

/** The panel as it is now. */
function viewOf(_state?: Panel): View {
  return view();
}

/** The panel as it is now. */
function view(): View {
  const state = panel();
  const row = state.selection === null ? undefined : state.rows().find((each) => each.key === state.selection);
  return {
    root: state.root,
    rows: state.rows(),
    filter: state.filter,
    filtering: state.filtering,
    selection: state.selection,
    naming: state.edit === null ? null : { name: state.edit.name, isDir: state.edit.isDir },
    actions: row?.actions ?? [],
  };
}

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

/** The project changed: read it again, unless every path of the burst is one the tree leaves out. */
function heard(at: string, paths: string[]): void {
  const state = panel();
  if (state.root !== at) return;
  if (paths.length > 0 && paths.every((path) => state.tree.changeIsUnseen(path))) return;
  state.rescan();
  void state.refreshGit();
}

/** Every gesture answers the tree as it is afterwards, so one round trip draws the result. */
async function followed(state: Panel, intent: Parameters<typeof perform>[1]): Promise<View> {
  await perform(state, intent);
  return view();
}

// ---- what the window asks for

/** The tree at `cwd`: what it holds, and what the user is doing to it. */
export async function load(cwd: string): Promise<View> {
  return viewOf(at(cwd));
}

/** The tree pointed at `cwd`, for the calls that come before a load (they need a root). */
function at(cwd: string): Panel {
  return root(cwd);
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

/** What the filter box holds, which is what the tree keeps. */
export function filtered(text: string): View {
  const state = panel();
  state.filter = text;
  state.selection = null;
  return view();
}

/** Enter in the filter box: the first row it found, opened. */
export async function firstMatch(): Promise<View> {
  const state = panel();
  const first = state.rows()[0];
  return first ? followed(state, state.activate(first.key)) : view();
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

/** Reads the tree again now (the window's own clock, and after a gesture that reads the disk). */
export async function reread(): Promise<View> {
  const state = panel();
  state.rescan();
  await state.refreshGit();
  return view();
}

// ---- what the app reaches

/** `cmd+shift+e`, as the app's own key does: the sidebar, which is where the page is. */
fn.set("toggle", { desc: "Open the files sidebar." }, () => call("toggle_sidebar"));

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
  },
);

void panel()
  .readSettings((name) => option.get(name))
  .catch((err) => console.error(`files: reading its options: ${err instanceof Error ? err.message : err}`));
