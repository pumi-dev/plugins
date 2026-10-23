// The panel both pages read: the repository the current pane is in, what git says of it, the folded
// directories, the cursor, the filter and the draft in the commit message box. One of these runs
// per worker (`src/core/git/src/lib.rs`'s `Panel`), and both views follow it: whichever page is open
// draws what it says, and asks for it again when it changes.
//
// It looks again when the work tree changes (`watch.ts`), when the current pane or its directory
// does, when its options change, and after every action it takes.
import { fs, option, pane, tab } from "pumi";
import * as git from "./git.ts";
import type { Change, Commit } from "./git.ts";
import * as state from "./state.ts";
import { relevant, watch } from "./watch.ts";

/** Everything the pages draw, as one look at the repository. */
export interface Snapshot {
  staged: Change[];
  changes: Change[];
  conflicts: Change[];
  branch: string;
  /** The commit `HEAD` is at; empty in a repository with no commit yet. */
  headId: string;
  /** The history, or `null` while it is being read. */
  commits: Commit[] | null;
  /** Why there is no repository, when there is none. */
  error: string | null;
}

const EMPTY: Snapshot = {
  staged: [],
  changes: [],
  conflicts: [],
  branch: "",
  headId: "",
  commits: null,
  error: null,
};

/** What the two options say. */
export interface Settings {
  dates: "relative" | "absolute";
  author: boolean;
}

/** The commit message box's id, and the row the cursor is on while it is being typed into. */
export const COMMIT_ROW = "commit:message";

/** What pressing enter or space on a row does, best first — the core plugin's `PRIMARY`. */
const PRIMARY = ["stage", "unstage", "ours", "theirs"];

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class Panel {
  /** The directory the repository is looked for from: where the user is working. */
  cwd = "";
  /** The work tree's root, when the directory is in a repository. */
  root: string | null = null;
  snapshot: Snapshot = EMPTY;
  settings: Settings = { dates: "relative", author: true };
  /** The ids of the rows the tree has folded away. */
  collapsed = new Set<string>();
  cursor: string | null = null;
  filter = "";
  filtering = false;
  /** The last thing an action said, until the next one. */
  notice: { ok: boolean; text: string } | null = null;
  /** What is typed in the commit message box, and whether it has the keyboard. */
  message = "";
  composing = false;
  /** The first look at the repository is behind it: before that the pages have nothing to say. */
  looked = false;

  /** The views drawing it now. */
  private readonly listeners = new Set<() => void>();
  private stopWatching: (() => void) | null = null;
  private watched: string | null = null;
  /** Where its folded directories are kept; given at start, from the package's own state directory. */
  private stateDir: string | null = null;
  private scanning = false;
  /** A look at the repository was asked for while one was running, and is still owed. */
  private owed = false;

  /** Has `view` draw again whenever the panel changes; undo it when the view goes. */
  watch(draw: () => void): () => void {
    this.listeners.add(draw);
    return () => this.listeners.delete(draw);
  }

  /** Draws both pages again. */
  changed(): void {
    for (const draw of [...this.listeners]) draw();
  }

  /** Starts it: its options, and where its folded directories are kept (`null`: nowhere). */
  async start(stateDir: string | null): Promise<void> {
    this.stateDir = stateDir;
    await this.reread();
  }

  /** The options changed: read them again, and draw with them. */
  async reread(): Promise<void> {
    this.settings = await read();
    this.changed();
  }

  /** Where the user is now: looks at the repository around that directory. */
  async follow(): Promise<void> {
    const cwd = await directory();
    if (cwd !== this.cwd) {
      this.cwd = cwd;
      this.cursor = null;
      this.filter = "";
      this.filtering = false;
      this.notice = null;
      this.composing = false;
    }
    await this.refresh();
  }

  /** Looks at the repository again, and draws it. */
  async refresh(): Promise<void> {
    if (this.scanning) {
      this.owed = true;
      return;
    }
    this.scanning = true;
    try {
      await this.scan();
    } catch (err) {
      console.error(`git: ${message(err)}`);
    } finally {
      this.scanning = false;
      if (this.owed) {
        this.owed = false;
        void this.refresh();
      }
    }
  }

  private async scan(): Promise<void> {
    const previous = this.root;
    if (this.cwd === "") this.cwd = await directory();
    try {
      const root = await git.repository(this.cwd);
      const collected = await git.collect(root);
      // A file git cannot merge is a conflict of its own, above the two groups; the rest of the
      // work tree's side is the Changes group.
      const conflicts = collected.changes.filter((change) => change.color === "conflict");
      const changes = collected.changes.filter((change) => change.color !== "conflict");
      const headId = await git.headId(root);
      const branch = await git.branch(root);
      // The history is worth keeping while the commit it was read at is the one there is now.
      const commits = root === previous && headId === this.snapshot.headId ? this.snapshot.commits : null;
      this.snapshot = { staged: collected.staged, changes, conflicts, branch, headId, commits, error: null };
      this.root = root;
    } catch (err) {
      this.snapshot = { ...EMPTY, error: message(err) };
      this.root = null;
    }
    if (this.root !== previous) {
      this.collapsed = await this.folded();
      this.cursor = null;
      this.followRoot();
    }
    this.looked = true;
    this.changed();
    if (this.snapshot.commits === null) void this.loadHistory();
  }

  /** Reads the history, which a big repository takes a moment over, and draws it. */
  private async loadHistory(): Promise<void> {
    const root = this.root;
    const head = this.snapshot.headId;
    if (root === null) {
      this.snapshot = { ...this.snapshot, commits: [] };
      this.changed();
      return;
    }
    let commits: Commit[] = [];
    try {
      commits = await git.history(root);
    } catch (err) {
      console.error(`git: history: ${message(err)}`);
    }
    // A commit in between: what was read is out of date, and the next look reads it again.
    if (this.root !== root || this.snapshot.headId !== head) return;
    this.snapshot = { ...this.snapshot, commits };
    this.changed();
  }

  /** The directories the repository's tree had folded, from the last run. */
  private async folded(): Promise<Set<string>> {
    if (this.root === null || this.stateDir === null) return new Set();
    return state.load(this.stateDir, this.root);
  }

  /** Watches the repository now, and stops watching the one before it. */
  private followRoot(): void {
    if (this.watched === this.root) return;
    this.stopWatching?.();
    this.stopWatching = null;
    this.watched = this.root;
    if (this.root === null) return;
    this.stopWatching = watch(this.root, (paths) => {
      if (relevant(paths)) void this.refresh();
    });
  }

  /** Folds a directory's children away, or opens them, and keeps the choice. */
  async toggle(id: string): Promise<void> {
    if (!this.collapsed.delete(id)) this.collapsed.add(id);
    this.cursor = id;
    this.changed();
    if (this.root !== null && this.stateDir !== null) {
      await state.save(this.stateDir, this.root, this.collapsed).catch((err) => console.error(`git: ${message(err)}`));
    }
  }

  /** Puts the cursor on a row, and draws it there. */
  select(id: string | null): void {
    this.cursor = id;
    this.changed();
  }

  /** The commit message box has the keyboard, with the cursor on it. */
  compose(): void {
    this.composing = true;
    this.cursor = COMMIT_ROW;
    this.changed();
  }

  /** Types the whole message, as the field said it; the field keeps the cursor. */
  setMessage(text: string): void {
    this.message = text;
    this.changed();
  }

  /** Whether the tree is showing what the filter found, every directory open. */
  get revealing(): boolean {
    return this.filter !== "";
  }

  /** What an action on a row says it is doing, for its notice. */
  private say(ok: boolean, text: string): void {
    this.notice = { ok, text };
  }

  /**
   * Runs the action `name` on row `id`, which is `staged:file:src/main.ts`, `changes:dir:src`, or
   * nothing for the whole repository.
   */
  async act(name: string, id: string): Promise<void> {
    if (name === "commit") {
      await this.commit();
      return;
    }
    // The core plugin's Publish button returns at once; pushing is `git push`, not this page.
    if (name === "publish") return;
    if (id === "" && (name === "stage-all" || name === "unstage-all")) {
      await this.wholeTree(name);
      return;
    }
    const file = filePath(id);
    const dir = dirPath(id);
    if (file === null && dir === null) return;
    if (file === null && name !== "stage" && name !== "unstage") return;
    const target = file ?? dir!;
    const root = this.root;
    if (root === null) return;
    try {
      await run(root, name, target);
      this.say(true, `${name} · ${target}`);
    } catch (err) {
      this.say(false, `${name} failed: ${message(err)}`);
    }
    await this.refresh();
  }

  /** Stage or unstage the whole repository, the header's checkbox. */
  private async wholeTree(name: "stage-all" | "unstage-all"): Promise<void> {
    const root = this.root;
    if (root === null) return;
    try {
      if (name === "stage-all") await git.stageAll(root);
      else await git.unstageAll(root);
      this.say(true, name);
    } catch (err) {
      this.say(false, `${name} failed: ${message(err)}`);
    }
    await this.refresh();
  }

  /** Commit what is staged, with the message in the box; a commit in the repository is `HEAD`. */
  async commit(): Promise<void> {
    const root = this.root;
    const text = this.message.trim();
    if (text === "") {
      this.say(false, "commit needs a message");
      this.changed();
      return;
    }
    if (root === null) return;
    try {
      const sha = await git.commit(root, text);
      this.message = "";
      this.composing = false;
      this.say(true, `committed ${git.short(sha)}`);
      await this.refresh();
    } catch (err) {
      this.say(false, `commit failed: ${message(err)}`);
      this.changed();
    }
  }

  /**
   * Opens a file's work tree path in whatever this machine opens it with. The app's editor and its
   * document tabs are the app's own, which a package cannot ask for (see the port's report), so the
   * nearest honest thing is the system's own.
   */
  async open(path: string): Promise<void> {
    const root = this.root;
    if (root === null) return;
    try {
      await fs.open({ path: `${root}/${path}` });
    } catch (err) {
      this.say(false, `open failed: ${message(err)}`);
      this.changed();
    }
  }
}

/** What the actions do to a path on disk, one git call each. */
async function run(root: string, name: string, path: string): Promise<void> {
  switch (name) {
    case "stage":
      return git.stage(root, path);
    case "unstage":
      return git.unstage(root, path);
    case "discard":
      return git.discard(root, path);
    case "ignore":
      return git.ignore(root, path);
    case "ours":
      return git.resolve(root, "ours", path);
    case "theirs":
      return git.resolve(root, "theirs", path);
    default:
      throw new Error(`unknown action ${name}`);
  }
}

/** The path of a file row (`staged:file:src/main.ts`), or nothing when the row is not one. */
export function filePath(id: string): string | null {
  const parts = id.split(":");
  if (parts.length < 3) return null;
  const path = parts.slice(2).join(":");
  return parts[1] === "file" && path !== "" ? path : null;
}

/** The path of a directory row (`changes:dir:src`), or nothing when the row is not one. */
export function dirPath(id: string): string | null {
  const parts = id.split(":");
  if (parts.length < 3) return null;
  const path = parts.slice(2).join(":");
  return parts[1] === "dir" && path !== "" ? path : null;
}

/** Whether the row `id` is one enter or space does the first thing of a row too. */
export function primary(id: string, actions: readonly string[]): string | null {
  if (dirPath(id) !== null) return null;
  return actions.find((name) => PRIMARY.includes(name)) ?? null;
}

/** The two options, as they are now. */
async function read(): Promise<Settings> {
  const format = await option.get("date_format").catch(() => null);
  const author = await option.get("show_author").catch(() => null);
  return {
    dates: format === "absolute" ? "absolute" : "relative",
    author: author !== false,
  };
}

/**
 * The directory the user is working in: the pane the app has current, and when that is not a
 * terminal (a page, a browser) the tab's own pane. A pane is tiled or float now, so where it is has
 * nothing to say about whether its directory counts.
 */
export async function directory(): Promise<string> {
  const pathOf = async (at: number): Promise<string | null> => {
    const path = await option.get("pane_current_path", { pane: at }).catch(() => null);
    return typeof path === "string" && path !== "" ? path : null;
  };
  try {
    const current = await pane.get();
    const path = await pathOf(current.id);
    if (path !== null) return path;
    const here = await tab.get();
    for (const each of await pane.list({ tab: here.id })) {
      const path = await pathOf(Number(each));
      if (path !== null) return path;
    }
  } catch (err) {
    console.error(`git: ${message(err)}`);
  }
  return process.cwd();
}

/** The panel the worker runs: one, whichever pages are open. */
export const panel = new Panel();
