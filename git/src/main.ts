// git: the repository in the left sidebar — its changes as a path tree you can stage, unstage,
// discard and commit from, and its history — for whichever repository the tab you are working in
// is in, on the `git` binary and a watch of the work tree. In a directory that is in no repository
// (a folder of checkouts), each repository under it is a section of its own.
//
//   ctrl+shift+g                    show the app's sidebar, which is where the page is
//   pumi call pumi_dev.git.toggle   the same from anywhere
//
// The repositories are `projects.ts`, each one's `panel.ts`, the rows `tree.ts`'s, the git work
// `git.ts`. What is here is the page's model and the exports `ui.tsx` calls. The page is pushed,
// not asked for: each time a panel changes the whole view is posted (`ui.post`, at most once a
// tick), and the window draws the last one it has the moment the sidebar opens — nothing is read
// on the way.
import { call, fn, on, option, paths, self, ui, workspace } from "pumi";

import type { Panel } from "./panel.ts";
import { changed, projects } from "./projects.ts";
import * as git from "./git.ts";
import type { Change, Commit, CommitMode, DiffSpec, Remote, Sync } from "./git.ts";
import { diffTotals, rows, stageStates, visible, type Checkbox, type Row } from "./tree.ts";

/** One line of the changes list: a repository's header, a group's, its empty note, or a row of its tree. */
export interface Line {
  /** `group:staged`, `staged:file:src/main.ts`, `changes:dir:src`, `empty:staged`; with several
   * repositories, each starts with its repository's index (`1>staged:file:a.ts`, `1>repo`). */
  id: string;
  kind: "repo" | "header" | "empty" | Row["kind"];
  depth: number;
  open: boolean;
  text: string;
  /** What git says of a file (`added`, `modified`, `deleted`, `renamed`, `untracked`, `conflict`). */
  status: string;
  /** A repository's branch. */
  detail: string;
  checkbox: Checkbox;
  /** A header's count of files. */
  count: number;
  selected: boolean;
  /** What its menu offers, best first. */
  actions: string[];
}

/** The changes page: the repository, its lines, and what the user is doing to them. */
export interface ChangesView {
  version: number;
  root: string | null;
  /** The selected repository's path from the directory, when the page lists several. */
  repo: string | null;
  branch: string;
  error: string | null;
  /** Before the first look there is nothing to say, and "no changes" would be a guess. */
  looked: boolean;
  lines: Line[];
  /** Every changed file of the selected repository, each counted once. */
  total: number;
  /** Every changed file of every repository listed. */
  all: number;
  staged: number;
  /** Files with a change in the work tree that `commit -a` takes: tracked, not new. */
  tracked: number;
  notice: { ok: boolean; text: string } | null;
  filter: string;
  /** The draft in the commit box, for a box drawn again. */
  message: string;
  added: number;
  deleted: number;
  remote: Remote;
  busy: string | null;
}

/** The history page: the commits, newest first. */
export interface HistoryView {
  version: number;
  root: string | null;
  /** The repository's path from the directory, when the page lists several. */
  repo: string | null;
  error: string | null;
  commits: Commit[] | null;
  dates: "relative" | "absolute";
  author: boolean;
}

export interface Views {
  changes: ChangesView;
  history: HistoryView;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Rises with each post. It starts at the clock, not at 0, so a worker started again (a reload, a
 * crash) posts pages newer than what the last one answered, and the window draws them. */
let version = Date.now();

/** Where a repository's lines go, and what they are named and indented by. */
interface Section {
  panel: Panel;
  index: number;
  /** The levels its lines sit under: 1 under a repository's header, 0 alone. */
  depth: number;
}

function line(at: Section, inner: string, fields: Partial<Line> & Pick<Line, "kind" | "text">): Line {
  return {
    id: projects.id(at.index, inner),
    depth: at.depth,
    open: false,
    status: "",
    detail: "",
    checkbox: "",
    count: 0,
    selected: at.panel.cursor === inner,
    actions: [],
    ...fields,
  };
}

/** A group's lines: its header, then its tree, or the note that it is empty. */
function group(
  lines: Line[],
  at: Section,
  key: "conflicts" | "staged" | "changes",
  label: string,
  all: readonly Change[],
  state: Checkbox,
  states: ReturnType<typeof stageStates>,
  empty: string | null,
): void {
  const { panel } = at;
  const kept = visible(all, panel.filter);
  if (kept.length === 0 && empty === null) return;
  const id = `group:${key}`;
  const open = panel.revealing || !panel.collapsed.has(id);
  lines.push(line(at, id, { kind: "header", open, text: label, checkbox: kept.length === 0 ? "" : state, count: kept.length }));
  if (!open) return;
  if (kept.length === 0) {
    lines.push(line(at, `empty:${key}`, { kind: "empty", text: empty ?? "", selected: false }));
    return;
  }
  const tree = rows(key === "staged" ? "staged" : "changes", kept, panel.collapsed, panel.revealing, panel.cursor, states.dirStage, states.both);
  for (const row of tree) {
    lines.push({ ...line(at, row.id, { kind: row.kind, text: row.text }), depth: at.depth + row.depth, open: row.open, status: row.color, checkbox: row.checkbox, selected: row.selected, actions: row.actions });
  }
}

/** A repository's groups. Answers whether it had anything to show. */
function groups(lines: Line[], at: Section): boolean {
  const { staged, changes: unstaged, conflicts } = at.panel.snapshot;
  if (staged.length + unstaged.length + conflicts.length === 0) return false;
  const states = stageStates(staged, unstaged, conflicts);
  group(lines, at, "conflicts", "Conflicts", conflicts, "", states, null);
  group(lines, at, "staged", "Staged", staged, staged.some((change) => states.both.has(change.path)) ? "partial" : "on", states, "No staged changes yet");
  group(lines, at, "changes", "Unstaged", unstaged, unstaged.some((change) => states.both.has(change.path)) ? "partial" : "off", states, "No unstaged changes");
  return true;
}

/** Every repository's section: its header — name, branch, how many files it changed — and, open, its groups. */
function sections(lines: Line[]): void {
  projects.panels.forEach((panel, index) => {
    const { staged, error, branch } = panel.snapshot;
    const total = changed(panel);
    // A filter shows only the repositories with something that matches.
    const matches = projects.filter === "" || [...panel.snapshot.staged, ...panel.snapshot.changes, ...panel.snapshot.conflicts].some((change) => visible([change], projects.filter).length > 0);
    if (!matches) return;
    const open = projects.isOpen(index);
    const both = stageStates(staged, panel.snapshot.changes, panel.snapshot.conflicts).both;
    const checkbox: Checkbox = total === 0 ? "" : staged.length === total && both.size === 0 ? "on" : staged.length > 0 ? "partial" : "off";
    const at: Section = { panel, index, depth: 0 };
    lines.push(line(at, "repo", { kind: "repo", open, text: projects.names[index] ?? panel.root ?? "", detail: branch, checkbox, count: total, selected: projects.cursor === projects.id(index, "repo") }));
    if (!open) return;
    const inside: Section = { panel, index, depth: 1 };
    if (error !== null) lines.push(line(inside, "empty:error", { kind: "empty", text: error, selected: false }));
    else if (!groups(lines, inside)) lines.push(line(inside, "empty:none", { kind: "empty", text: panel.looked ? "No changes" : "", selected: false }));
  });
}

/** The changes page as the panels have it now. */
function changesView(): ChangesView {
  const panel = projects.panel;
  const snapshot = panel.snapshot;
  const { staged, changes: unstaged, conflicts } = snapshot;
  const lines: Line[] = [];
  if (projects.multi) sections(lines);
  else groups(lines, { panel, index: 0, depth: 0 });
  const [added, deleted] = diffTotals(staged, unstaged, conflicts);
  return {
    version,
    root: panel.root,
    repo: projects.multi ? (projects.names[projects.active] ?? null) : null,
    branch: snapshot.branch,
    // With several repositories, each says its own error in its section.
    error: projects.multi ? null : snapshot.error,
    looked: projects.looked && projects.panels.every((each) => each.looked),
    lines,
    total: changed(panel),
    all: projects.panels.reduce((sum, each) => sum + changed(each), 0),
    staged: staged.length,
    tracked: unstaged.filter((change) => change.glyph !== "?").length,
    notice: panel.notice,
    filter: projects.filter,
    message: projects.message,
    added,
    deleted,
    remote: snapshot.remote,
    busy: panel.busy,
  };
}

function historyView(): HistoryView {
  const panel = projects.panel;
  return {
    version,
    root: panel.root,
    repo: projects.multi ? (projects.names[projects.active] ?? null) : null,
    error: panel.snapshot.error,
    commits: panel.snapshot.commits,
    dates: panel.settings.dates,
    author: panel.settings.author,
  };
}

function views(): Views {
  return { changes: changesView(), history: historyView() };
}

// ---- what the window hears

/** What the history was last posted with: it is posted again only when one of them changed. */
let postedHistory: { commits: Commit[] | null; dates: string; author: boolean; root: string | null } | null = null;
let queued = false;

/** Posts the page to the window, once however many times the panels changed in this tick. */
function post(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    version += 1;
    ui.post("changes", changesView());
    const panel = projects.panel;
    const { commits } = panel.snapshot;
    const { dates, author } = panel.settings;
    const had = postedHistory;
    if (had === null || had.commits !== commits || had.dates !== dates || had.author !== author || had.root !== panel.root) {
      postedHistory = { commits, dates, author, root: panel.root };
      ui.post("history", historyView());
    }
  });
}
projects.watch(post);

// ---- what the window asks for

/** Whether the window has said where the user is (`follow` with a directory): from then on, the
 * worker's own guess at startup is not looked at. */
let told = false;

/** The user is in `cwd`: the repository around it, and the page as it is (for a window the posts
 * do not reach, and the first draw of one that has none yet). With no directory yet, the page as
 * it is, after the first look. */
export async function follow(cwd: string | null): Promise<Views> {
  if (cwd !== null) {
    // The window's word wins over the worker's own guess at startup, whichever lands last.
    told = true;
    await projects.follow(cwd);
  } else if (!projects.looked) await projects.refresh();
  return views();
}

/** A line pressed: a header or a folder folds, a file takes the cursor. */
export async function picked(id: string): Promise<void> {
  const { panel, index, inner } = projects.resolve(id);
  if (inner === "repo") return projects.toggleRepo(index);
  projects.select(id);
  if (inner.startsWith("group:") || inner.includes(":dir:")) await panel.toggle(inner);
}

/** A file line opened (double click): the file, in a pane beside the current one. */
export async function opened(id: string): Promise<void> {
  const { panel, inner } = projects.resolve(id);
  const at = inner.indexOf(":file:");
  if (at >= 0) await panel.open(inner.slice(at + ":file:".length));
}

/** An action of a line's menu or checkbox (`stage`, `unstage`, `discard`, `stage-all`, …). An
 * action with no line is the selected repository's. */
export async function chose(name: string, id: string): Promise<void> {
  if (id === "") return projects.panel.act(name, "");
  const { panel, index, inner } = projects.resolve(id);
  projects.active = index;
  await panel.act(name, inner === "repo" ? "" : inner);
}

/** What is typed in the commit box: kept, not drawn (the box draws its own text). */
export function typed(text: string): void {
  projects.message = text;
}

/** Commits `text`: what is staged, every tracked change, or onto the last commit. */
export async function committed(text: string, mode: CommitMode): Promise<boolean> {
  const done = await projects.panel.commit(text, mode);
  if (done) projects.message = "";
  return done;
}

/** The branch button: fetch, pull, push or publish. */
export async function synced(what: Sync): Promise<void> {
  await projects.panel.sync(what);
}

/** What the filter box holds, which is what the tree keeps. */
export function filtered(text: string): void {
  projects.setFilter(text);
}

/** The notice's close button: what an action said goes away, the repository as it is stays. */
export function dismissed(): void {
  projects.panel.dismiss();
}

// ---- the diff tab

/** What a diff tab is told to show: the spec, and the repository it is of. */
export type Shown = DiffSpec & { root: string; title: string };

/** The diff tab the page opened last: the next diff is drawn in it, not in another — while the user
 * is still in that view. */
let diffPane: string | null = null;

/** Shows `spec` of the repository at `root` in the diff tab, opening one beside the tab the user is
 * in when there is none. */
async function showDiff(root: string | null, spec: DiffSpec, title: string): Promise<void> {
  if (root === null) return;
  const value = JSON.stringify({ ...spec, root, title } satisfies Shown);
  try {
    const here = workspace.currentTab;
    const view = here?.place.kind === "tiled" ? here.place.view ?? null : null;
    if (diffPane !== null) {
      const there = workspace.getTab(diffPane);
      if (there && there.block === self.plugin.prefixed("diff") && there.place.kind === "tiled" && (view === null || there.place.view === view)) {
        await option.set("diff", value, { scope: "tab", id: diffPane });
        await option.set("title", title, { scope: "tab", id: diffPane });
        return;
      }
    }
    const opened = (await workspace.openTab(self.plugin.prefixed("diff"), {}, { kind: "view", name: title })).id;
    diffPane = opened;
    await option.set("diff", value, { scope: "tab", id: opened });
    await option.set("title", title, { scope: "tab", id: opened });
  } catch (err) {
    console.error(`git: diff: ${message(err)}`);
  }
}

/** The selected repository's whole diff, staged and not, new files with it. */
export async function diff(): Promise<void> {
  const repo = projects.multi ? projects.names[projects.active] : undefined;
  await showDiff(projects.panel.root, { kind: "work", side: "all" }, repo ? `Changes · ${repo}` : "Changes");
}

/** A file line's diff: its staged side, or its work tree's (`staged:file:src/a.ts`). */
export async function diffed(id: string): Promise<void> {
  const { panel, inner } = projects.resolve(id);
  const at = inner.indexOf(":file:");
  if (at < 0) return;
  const group = inner.slice(0, at);
  const path = inner.slice(at + ":file:".length);
  const side = group === "staged" ? "staged" : "changes";
  const change = (side === "staged" ? panel.snapshot.staged : [...panel.snapshot.changes, ...panel.snapshot.conflicts]).find((each) => each.path === path);
  const name = path.split("/").at(-1) ?? path;
  await showDiff(panel.root, { kind: "work", side, path, untracked: change?.glyph === "?" }, `${name}${side === "staged" ? " (staged)" : ""}`);
}

/** A commit of the selected repository's history, as a diff. */
export async function shown(sha: string): Promise<void> {
  if (!/^[0-9a-f]{4,64}$/.test(sha)) return;
  const panel = projects.panel;
  const commit = panel.snapshot.commits?.find((each) => each.sha === sha);
  await showDiff(panel.root, { kind: "commit", sha }, commit ? `${sha.slice(0, 7)} ${commit.subject}` : sha.slice(0, 7));
}

/** The patch a diff tab draws, read now. The view asks again when the repository changes. */
export async function patchOf(value: string): Promise<{ patch: string; error: string | null }> {
  let spec: Shown;
  try {
    spec = JSON.parse(value) as Shown;
  } catch {
    return { patch: "", error: "nothing to show" };
  }
  try {
    return { patch: await git.patch(spec.root, spec), error: null };
  } catch (err) {
    return { patch: "", error: message(err) };
  }
}

/** A line of a diff pressed: the file, at that line, in the editor. */
export async function reveal(root: string, path: string, line: number | null): Promise<void> {
  try {
    await workspace.openTab("file", { path: `${root}/${path}`, ...(line === null ? {} : { line }) }, { kind: "tiled", split: "right" });
  } catch (err) {
    console.error(`git: open: ${message(err)}`);
  }
}

/** A key the page answers: the cursor, the filter, and a line's first action. Answers whether it
 * was one of them. */
export async function pressed(key: string): Promise<boolean> {
  switch (key) {
    case "/":
      filtered("");
      return true;
    case "escape": {
      // Escape backs out of what the page last put in front of the user: the filter, the cursor, and
      // then the notice under the toolbar, which is otherwise only dismissed by its close button.
      const had = projects.filter !== "" || projects.cursor !== null;
      const panel = projects.panel;
      projects.setFilter("");
      projects.select(null);
      if (!had && panel.notice !== null) panel.dismiss();
      return true;
    }
    case "j":
    case "down":
      projects.select(step(1));
      return true;
    case "k":
    case "up":
      projects.select(step(-1));
      return true;
    case "enter":
    case "space": {
      const line = changesView().lines.find((each) => each.id === projects.cursor);
      if (!line) return false;
      if (line.kind === "repo" || line.kind === "header" || line.kind === "folder") await picked(line.id);
      else if (line.kind === "file") await chose(line.checkbox === "on" ? "unstage" : "stage", line.id);
      return true;
    }
    default:
      return false;
  }
}

/** The line `by` lines away from the cursor, in the order the page draws them. */
function step(by: number): string | null {
  const order = changesView()
    .lines.filter((line) => line.kind !== "note" && line.kind !== "empty")
    .map((line) => line.id);
  if (order.length === 0) return null;
  const at = projects.cursor === null ? -1 : order.indexOf(projects.cursor);
  const to = Math.min(order.length - 1, Math.max(0, at + by));
  return order[to] ?? null;
}

// ---- what the app reaches

/** `ctrl+shift+g`, as the app's own key does: the sidebar, which is where the page is. */
fn.set("toggle", { desc: "Open the git sidebar." }, () => call("toggle_sidebar"));

/** Its options changed: read them again, and draw with them. */
on("option.changed", { match: self.plugin.prefixed("*"), desc: "the git page's options" }, () => void projects.reread());

/** Starts the panels, with where their folded directories are kept, and reads the repository the
 * worker started in, so the page has something to draw before it is first shown. */
async function start(): Promise<void> {
  let state: string | null = null;
  try {
    state = paths.state;
  } catch (err) {
    // A host that gives packages no directories of their own: the folded directories are the run's only.
    console.error(`git: no state directory: ${message(err)}`);
  }
  await projects.start(state);
  // The page may have asked while this was starting (the window opens with the app): what it said
  // stays, rather than the guess below pointing the panel back at `/`.
  const guess = await directory();
  if (!told && guess !== null) await projects.follow(guess);
}

/** The directory of the tab the user is in, as the window will ask for it when the page opens. */
async function directory(): Promise<string | null> {
  try {
    // The workspace fills in after the worker starts: without waiting, there is no tab yet.
    await workspace.ready;
    const current = workspace.currentTab;
    if (current !== null) {
      const path = await option.get("tab_current_path", { scope: "tab", id: current.id });
      if (typeof path === "string" && path !== "" && path !== "/") return path;
    }
  } catch {
    // No tab in front yet: the worker's own directory.
  }
  // An app opened from the Finder starts its workers in `/`, which is nowhere the user went.
  const own = process.cwd();
  return own === "/" ? null : own;
}

void start().catch((err) => console.error(`git: starting threw:`, err));
