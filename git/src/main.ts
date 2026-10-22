// git: the repository in the left sidebar — its changes as a path tree you can stage, unstage,
// discard and commit from, and its history — for whichever repository the pane you are working in
// is in. The app's own git plugin drawn as a package, on the `git` binary and a watch of the work
// tree.
//
//   ctrl+shift+g                    show the app's sidebar, which is where the page is
//   pumi call amresyd.git.toggle    the same from anywhere
//
// The repository is `panel.ts`, the rows `tree.ts`'s, the git work `git.ts`. What is here is the
// logic: the page's own model, kept fresh as the pane in front moves and the work tree changes, and
// the exports `ui.tsx` asks for — the rows, and every gesture it makes.
import { action, command, on, option, paths, pkg } from "pumi";

import { panel, type Snapshot } from "./panel.ts";
import type { Change, Group } from "./git.ts";
import { diffTotals, rows, stageStates, visible, type Checkbox, type Row } from "./tree.ts";

/** A group's rows, as the page draws them: its name, its rows, and its own staging state. */
export interface GroupView {
  group: Group;
  label: string;
  state: Checkbox;
  rows: Row[];
}

/** The changes page: the repository, its three groups, and what the user is doing to them. */
export interface ChangesView {
  root: string | null;
  branch: string;
  error: string | null;
  /** Before the first look there is nothing to say, and "no changes" would be a guess. */
  looked: boolean;
  groups: GroupView[];
  notice: { ok: boolean; text: string } | null;
  /** The commit box, and what is typed in it. */
  composing: boolean;
  message: string;
  /** The filter box, and what it holds. */
  filtering: boolean;
  filter: string;
  /** `+12 -3`, over every group. */
  added: number;
  deleted: number;
  /** A conflicted file's own `ours`/`theirs` rows are in its group, as the tree draws them. */
  cursor: string | null;
}

/** The history page: the commits, newest first. */
export interface HistoryView {
  root: string | null;
  branch: string;
  error: string | null;
  commits: { sha: string; subject: string; author: string; timestamp: number; tags: string[]; unpushed: boolean }[] | null;
}

const GROUPS: { group: Group; label: string }[] = [
  { group: "staged", label: "Staged" },
  { group: "changes", label: "Unstaged" },
];

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Where the repository is looked for: the directory the window says the user is in. */
let lastCwd: string | null = null;

/** Points the panel at `cwd`, reading the repository when it moved. */
async function at(cwd: string): Promise<void> {
  if (cwd === lastCwd) return;
  lastCwd = cwd;
  panel.cwd = cwd;
  panel.cursor = null;
  await panel.refresh();
}

/** The rows of a group, folded as the user left them. */
function groupRows(group: Group, changes: readonly Change[], at: ReturnType<typeof stageStates>, state: Checkbox): Row[] {
  return rows(group, changes, panel.collapsed, panel.revealing, panel.cursor, at.dirStage, at.both);
}

// ---- what the window asks for

/** The changes page at `cwd`: the groups, the commit box, and the notice the last action left. */
export async function changes(cwd: string): Promise<ChangesView> {
  await at(cwd);
  const snapshot: Snapshot = panel.snapshot;
  const { staged, changes: unstaged, conflicts } = snapshot;
  const states = stageStates(staged, unstaged, conflicts);
  const shown = (all: readonly Change[]) => visible(all, panel.filter);
  const groups: GroupView[] = [];
  const conflictsShown = shown(conflicts);
  if (conflictsShown.length > 0) {
    groups.push({ group: "changes", label: "Conflicts", state: "off", rows: groupRows("changes", conflictsShown, states, "off") });
  }
  for (const { group, label } of GROUPS) {
    const all = group === "staged" ? staged : unstaged;
    const kept = shown(all);
    if (kept.length === 0) continue;
    const state: Checkbox = all.some((change) => states.both.has(change.path)) ? "partial" : group === "staged" ? "on" : "off";
    groups.push({ group, label, state, rows: groupRows(group, kept, states, state) });
  }
  const [added, deleted] = diffTotals(staged, unstaged, conflicts);
  return {
    root: panel.root,
    branch: snapshot.branch,
    error: snapshot.error,
    looked: panel.looked,
    groups,
    notice: panel.notice,
    composing: panel.composing,
    message: panel.message,
    filtering: panel.filtering,
    filter: panel.filter,
    added,
    deleted,
    cursor: panel.cursor,
  };
}

/** The history page at `cwd`: the commits, when git has been asked for them. */
export async function history(cwd: string): Promise<HistoryView> {
  await at(cwd);
  const snapshot = panel.snapshot;
  return {
    root: panel.root,
    branch: snapshot.branch,
    error: snapshot.error,
    commits: snapshot.commits,
  };
}

/** A row pressed: a folder folds, a file is opened for its diff (nothing here: the app shows it). */
export async function picked(id: string): Promise<void> {
  if (id.startsWith("changes:dir:") || id.startsWith("staged:dir:")) await panel.toggle(id);
  else panel.select(id);
}

/** An action of a row's menu (`stage`, `unstage`, `discard`, `stage-all`, …). */
export async function chose(name: string, id: string): Promise<void> {
  await panel.act(name, id);
}

/** What is typed in the commit box. */
export function typed(text: string): void {
  panel.setMessage(text);
  if (text !== "" && !panel.composing) panel.compose();
}

/** The commit box opened (`c`), or closed. */
export function composing(on: boolean): void {
  panel.composing = on;
  if (on) panel.compose();
}

/** The filter box: what it holds, which is what the tree keeps. */
export function filtered(text: string): void {
  panel.filtering = text !== "";
  panel.filter = text;
}

/** A key the page answers: `next`, `previous`, the commit box, the filter. Returns whether it was
 * one of them. */
export async function pressed(key: string): Promise<boolean> {
  switch (key) {
    case "c":
      panel.compose();
      return true;
    case "/":
      panel.filtering = true;
      panel.filter = "";
      return true;
    case "escape":
      panel.filtering = false;
      panel.filter = "";
      panel.composing = false;
      panel.select(null);
      return true;
    case "enter":
      if (panel.composing) await panel.act("commit", "");
      return true;
    case "j":
    case "down":
      if (!panel.composing) panel.select(next(1));
      return true;
    case "k":
    case "up":
      if (!panel.composing) panel.select(next(-1));
      return true;
    default:
      return false;
  }
}

/** The row `step` rows away from the cursor, in the order the page draws them. */
function next(step: number): string | null {
  const { staged, changes, conflicts } = panel.snapshot;
  const states = stageStates(staged, changes, conflicts);
  const all = [
    ...rows("changes", conflicts, panel.collapsed, panel.revealing, panel.cursor, states.dirStage, states.both),
    ...rows("staged", staged, panel.collapsed, panel.revealing, panel.cursor, states.dirStage, states.both),
    ...rows("changes", changes, panel.collapsed, panel.revealing, panel.cursor, states.dirStage, states.both),
  ];
  const order = all.filter((row) => row.kind !== "note").map((row) => row.id);
  if (order.length === 0) return null;
  const at = panel.cursor === null ? -1 : order.indexOf(panel.cursor);
  const to = Math.min(order.length - 1, Math.max(0, at + step));
  return order[to] ?? null;
}

// ---- what the app reaches

/** `ctrl+shift+g`, as the app's own key does: the sidebar, which is where the page is. */
command("toggle", () => action.run("toggle_sidebar"));

/** Its options changed: read them again, and draw with them. */
on("option.changed", { match: pkg.prefixed("*"), desc: "the git page's options" }, () => void panel.reread());

/** The pane in front may be in another repository. */
on(["pane.focused", "cwd.changed", "tab.focused", "session.focused"], { desc: "the git page follows the pane the user works in" }, () => {
  lastCwd = null;
});

/** Starts the panel, with where its folded directories are kept. */
async function start(): Promise<void> {
  let state: string | null = null;
  try {
    state = paths.state;
  } catch (err) {
    // A host that gives packages no directories of their own: the folded directories are the run's only.
    console.error(`git: no state directory: ${message(err)}`);
  }
  await panel.start(state);
}

void start().catch((err) => console.error(`git: starting threw:`, err));
void option.get("dates").catch(() => undefined);
