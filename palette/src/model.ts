// The palette's model, in the worker: what is typed, the rows a query keeps, and what ↑ walks. It
// is the core plugin's `lib.rs` moved to a package — the same two modes and the way between them
// (`>` typed on an empty files query, backspace on an empty commands one), the same scoring, the
// same history walking with ↑, the same 200 rows:
//
//   commands  cmd+shift+p: the commands there are, from `menu.list` and the keys there are
//   files     cmd+p: the project's files, walked as the core walks them (see walk.ts)
//
// `ui.tsx` draws what `view()` answers; every gesture comes back here (a key typed, a row picked),
// and answers the rows as they are afterwards.
import { homedir } from "node:os";
import { on, option, pane } from "pumi";

import { Index, dirOf, nameOf, relativePath, rootFor, type Hit } from "./files.ts";
import { openChosen } from "./open.ts";
import { MAX_ROWS, matchLabel, normalizeActionQuery, segments } from "./score.ts";
import { type Store, load, recent, remember, save, used } from "./store.ts";
import { type Action, vocabulary } from "./vocabulary.ts";

/** What the input is for when it holds commands. */
const PLACEHOLDER = "Execute a command...";
/** And when it holds files. */
const FILES_PLACEHOLDER = "Search files by name (type > for commands)";
/** The character that turns an empty files query into a commands one. */
const COMMANDS_PREFIX = ">";

export type Mode = "commands" | "files";

/** A row as the window draws it: what it says, what is highlighted in it, and what it runs. */
export interface Row {
  /** Where it is in the list it came from: commands by index, files by path. */
  id: string;
  label: string;
  /** The keys a command answers to, or the directory a file is in. */
  detail: string;
  /** The stretches of the label a query matched: `[text, matched]`. */
  parts: [string, boolean][];
}

/** What the palette is now: the mode, the query, and the rows it keeps. */
export interface PaletteView {
  mode: Mode;
  query: string;
  placeholder: string;
  rows: Row[];
  /** Which row is highlighted. */
  selected: number;
  /** It is still walking the project (files mode). */
  walking: boolean;
  /** Nothing to run, and why: "Searching files…", "No matching commands". */
  said: string;
  /** It remembers the query: ↑ walks what was run. */
  history: string[];
}

/** A command a query kept, and how well it scored. */
interface Candidate {
  action: number;
  score: number;
  marks: number[];
}

/** The one palette that is up: its state lives here, in the worker, and the view reads it. */
class Model {
  mode: Mode = "commands";
  query = "";
  selected = 0;
  /** What was typed before, as ↑ walks it: a cursor into `history`, or null for the query itself. */
  cursor: number | null = null;
  /** What was in the input when ↑ began walking the history. */
  keep = "";
  ready = false;
  readonly store: Store = { used: {}, history: [], files: [] };
  actions: Action[] = [];
  matches: Candidate[] = [];
  readonly index = new Index();
  hits: Hit[] = [];
  recent = new Map<string, number>();
  cwd = "";
  /** It was opened with a mode: what `ui.tsx` starts in. */
  opening: Mode | null = null;
  /** The panel was closed: nothing more is written. */
  done = false;
  private narrowed: { query: string; generation: number } | null = null;

  /** Reads what it remembers, the commands, and the directory to search; then settles the mode. */
  async start(): Promise<void> {
    const [store, actions] = await Promise.all([load(), vocabulary()]);
    this.store.used = store.used;
    this.store.history = store.history;
    this.store.files = store.files;
    this.actions = actions;
    this.cwd = await this.directory();
    this.ready = true;
    this.switch(this.opening ?? "commands");
    on("menu.changed", { desc: "the palette follows the commands there are" }, () => void this.refresh());
  }

  /** The commands changed under it: they are listed again. */
  async refresh(): Promise<void> {
    this.actions = await vocabulary();
    this.refilter();
  }

  /** The palette starts in `mode`, with nothing typed. */
  switch(mode: Mode): void {
    this.mode = mode;
    this.query = "";
    this.selected = 0;
    this.cursor = null;
    this.narrowed = null;
    if (mode === "files") void this.startWalk();
    this.refilter();
  }

  /** `go_to_file`'s hands: in files mode a step down, in commands mode the way to files. */
  goToFile(): void {
    if (this.mode === "files") this.step(1);
    else this.switch("files");
  }

  /** The directory the palette searches: the one the current pane is in. */
  private async directory(): Promise<string> {
    try {
      const current = await pane.get();
      const id = typeof current?.id === "number" ? current.id : undefined;
      const path = await option.get("pane_current_path", id === undefined ? {} : { pane: id });
      return typeof path === "string" ? path : "";
    } catch {
      return "";
    }
  }

  /** The files opened lately, by their path from the root, and where they rank. */
  private recentsOf(): Map<string, number> {
    const rank = new Map<string, number>();
    const root = this.index.root;
    if (root === null) return rank;
    this.store.files.forEach((path, at) => {
      const rel = relativePath(root, path);
      if (rel !== null && !rank.has(rel)) rank.set(rel, at);
    });
    return rank;
  }

  /** Starts walking the project, unless it was walked a moment ago. */
  private async startWalk(): Promise<void> {
    const root = rootFor(this.cwd, homedir());
    if (!this.index.start(root)) return;
    this.recent = this.recentsOf();
    // A step at a time, so the palette answers while the tree is read.
    while (await this.index.step()) {
      if (this.done) return;
      this.recent = this.recentsOf();
      if (this.mode === "files") this.refilter();
      await new Promise((done) => setTimeout(done, 0));
    }
  }

  /** What is typed: an empty files query that starts with `>` is a commands query. */
  typed(value: string): void {
    const typed = value.replace(/[\r\n]/g, "");
    if (this.mode === "files" && this.query === "" && typed.startsWith(COMMANDS_PREFIX)) {
      this.mode = "commands";
      this.selected = 0;
      this.set(typed.slice(COMMANDS_PREFIX.length));
      return;
    }
    this.set(typed);
  }

  /** The query is this now, so the rows are new. */
  private set(query: string): void {
    this.query = query;
    this.cursor = null;
    this.narrowed = null;
    this.refilter();
  }

  /** Recomputes what the query keeps, and keeps the row in range. */
  private refilter(): void {
    if (this.mode === "commands") this.filterCommands();
    else this.filterFiles();
    this.selected = Math.min(this.selected, Math.max(0, this.rowCount() - 1));
  }

  /** The commands the query keeps: by their label, then the ones used most, then the alphabet. */
  private filterCommands(): void {
    const query = normalizeActionQuery(this.query);
    const found: Candidate[] = [];
    if (query === "") {
      for (let action = 0; action < this.actions.length; action++) found.push({ action, score: 0, marks: [] });
    } else {
      for (const [action, entry] of this.actions.entries()) {
        const match = matchLabel(entry.label, query);
        if (match !== null) found.push({ action, score: match.score, marks: match.marks });
      }
    }
    found.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const left = this.actions[a.action]!;
      const right = this.actions[b.action]!;
      const byUse = used(this.store, right.name) - used(this.store, left.name);
      if (byUse !== 0) return byUse;
      if (left.label === right.label) return 0;
      return left.label < right.label ? -1 : 1;
    });
    this.matches = found;
    this.narrowed = null;
  }

  /** The files the query keeps. A query typed on from the last one only looks at what that found. */
  private filterFiles(): void {
    const query = this.query.trim();
    const generation = this.index.generation;
    const narrowing =
      this.narrowed !== null && this.narrowed.generation === generation && this.narrowed.query !== "" && query.startsWith(this.narrowed.query);
    const pool = narrowing ? this.hits.map((hit) => hit.file) : undefined;
    this.hits = this.index.search(query, this.recent, pool);
    this.narrowed = { query, generation };
  }

  /** How many rows there are. */
  rowCount(): number {
    return this.mode === "commands" ? this.matches.length : Math.min(this.hits.length, MAX_ROWS);
  }

  /** Moves the highlight `direction` rows, round the ends. */
  step(direction: number): void {
    const count = this.rowCount();
    if (count === 0) return;
    this.selected = (((this.selected + direction) % count) + count) % count;
  }

  /** ↑ and ↓ in the input: walking the commands history, as the core does, until a query is typed. */
  history(direction: number): boolean {
    if (this.mode !== "files" || !this.ready) return false;
    const said = this.store.history;
    if (said.length === 0) return false;
    if (this.cursor === null) {
      this.keep = this.query;
      this.cursor = said.length;
    }
    const next = this.cursor + direction;
    if (next >= said.length) {
      this.cursor = null;
      this.set(this.keep);
      return true;
    }
    if (next < 0) return true;
    this.cursor = next;
    this.set(said[next] ?? "");
    return true;
  }

  /** The row under the highlight: a command's index, or a file's path. */
  picked(): Row | null {
    return this.rows()[this.selected] ?? null;
  }

  /** The rows as the window draws them. */
  rows(): Row[] {
    const out: Row[] = [];
    if (this.mode === "commands") {
      for (const candidate of this.matches.slice(0, MAX_ROWS)) {
        const action = this.actions[candidate.action];
        if (!action) continue;
        out.push({
          id: action.name,
          label: action.label,
          detail: action.keys.join("  "),
          parts: segments(action.label, candidate.marks),
        });
      }
      return out;
    }
    for (const hit of this.hits.slice(0, MAX_ROWS)) {
      const file = this.index.files[hit.file];
      if (!file) continue;
      const name = nameOf(file);
      out.push({ id: file.rel, label: name, detail: dirOf(file), parts: segments(name, []) });
    }
    return out;
  }

  /** What the palette says when there is nothing to run. */
  said(): string {
    if (!this.ready) return "Reading the commands…";
    if (this.mode === "files") {
      if (this.index.root === null) return "No project here: open a file by its path, from a repository";
      if (this.rowCount() === 0) return this.index.walking ? "Searching files…" : "No matching files";
      return "";
    }
    return this.rowCount() === 0 ? "No matching commands" : "";
  }

  /** Runs what is highlighted: the command, or the file. Whether there was anything to run. */
  async run(): Promise<boolean> {
    const row = this.picked();
    if (!row) return false;
    remember(this.store, this.query);
    if (this.mode === "commands") {
      const action = this.actions.find((each) => each.name === row.id);
      if (!action) return false;
      this.store.used[action.name] = (this.store.used[action.name] ?? 0) + 1;
      void save(this.store);
      await action.run();
      return true;
    }
    recent(this.store, `${this.index.root ?? ""}/${row.id}`);
    void save(this.store);
    await openChosen(`${this.index.root ?? ""}/${row.id}`);
    return true;
  }

  /** The view, as it is now. */
  view(): PaletteView {
    return {
      mode: this.mode,
      query: this.query,
      placeholder: this.mode === "commands" ? PLACEHOLDER : FILES_PLACEHOLDER,
      rows: this.rows(),
      selected: this.selected,
      walking: this.index.walking,
      said: this.said(),
      history: this.store.history,
    };
  }
}

export const model = new Model();
