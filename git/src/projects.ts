// The repositories the page shows: the one the user's directory is in, or, in a directory that is in
// none (a folder of checkouts), each repository under it, at most two levels down. One `Panel` each.
// The filter, the cursor and the commit box are the page's, not a repository's: the toolbar, the
// branch, the commit box and the history are of the repository selected last.
import { relative } from "node:path";
import * as git from "./git.ts";
import { Panel } from "./panel.ts";
import { nested, tooWide } from "./scan.ts";

/** A line id of one repository's (`2>staged:file:a.ts`): its index, and the panel's own id. */
const PREFIXED = /^(\d+)>(.*)$/s;

export class Projects {
  /** The directory the user is in. */
  cwd = "";
  /** One panel per repository shown: in one repository, that one (or none, as an error). */
  panels: Panel[];
  /** The directory is in no repository, and the page lists those under it. */
  multi = false;
  /** Each repository's path from `cwd` (`pumi`, `worktrees/api`), in `panels` order, when `multi`. */
  names: string[] = [];
  /** The index in `panels` of the repository the toolbar, the branch, the commit box and the history are of. */
  active = 0;
  /** Whether each repository's section is open, by its root. */
  open = new Map<string, boolean>();
  cursor: string | null = null;
  filter = "";
  /** What is typed in the commit box. */
  message = "";
  /** The first look is behind it. */
  looked = false;

  private readonly listeners = new Set<() => void>();
  private stateDir: string | null = null;
  private started = false;
  private moving: Promise<void> = Promise.resolve();

  constructor() {
    this.panels = [this.make()];
  }

  /** The panel of the selected repository. */
  get panel(): Panel {
    return this.panels[this.active] ?? this.panels[0]!;
  }

  watch(draw: () => void): () => void {
    this.listeners.add(draw);
    return () => this.listeners.delete(draw);
  }

  changed(): void {
    for (const draw of [...this.listeners]) draw();
  }

  async start(stateDir: string | null): Promise<void> {
    this.stateDir = stateDir;
    this.started = true;
    await Promise.all(this.panels.map((panel) => panel.start(stateDir)));
  }

  async reread(): Promise<void> {
    await Promise.all(this.panels.map((panel) => panel.reread()));
  }

  private make(): Panel {
    const panel = new Panel();
    panel.watch(() => this.changed());
    if (this.started) void panel.start(this.stateDir);
    return panel;
  }

  /** The user is in `cwd`: the repository around it, or those under it. One move at a time. */
  follow(cwd: string): Promise<void> {
    const next = this.moving.then(() => this.move(cwd)).catch((err) => console.error(`git: ${err instanceof Error ? err.message : String(err)}`));
    this.moving = next;
    return next;
  }

  /** Looks at every repository again. */
  async refresh(): Promise<void> {
    await Promise.all(this.panels.map((panel) => panel.refresh()));
    this.looked = true;
  }

  private async move(cwd: string): Promise<void> {
    if (cwd === this.cwd && this.looked) return;
    this.cwd = cwd;
    let inside = true;
    try {
      await git.repository(cwd);
    } catch {
      inside = false;
    }
    const roots = inside || tooWide(cwd) ? [] : await nested(cwd);
    const multi = roots.length > 0;
    const before = this.panels.map((panel) => panel.root).join("\n");
    const reuse = (dir: string) => this.panels.find((panel) => panel.root === dir || panel.cwd === dir);
    const next = multi ? roots.map((dir) => reuse(dir) ?? this.make()) : [(!this.multi ? this.panels[0] : reuse(cwd)) ?? this.make()];
    for (const panel of this.panels) if (!next.includes(panel)) panel.dispose();
    this.panels = next;
    this.multi = multi;
    this.names = multi ? roots.map((dir) => relative(cwd, dir)) : [];
    const targets = multi ? roots : [cwd];
    await Promise.all(next.map((panel, i) => panel.follow(targets[i]!)));
    if (next.map((panel) => panel.root).join("\n") !== before) {
      this.filter = "";
      this.cursor = null;
      for (const panel of next) {
        panel.filter = "";
        panel.cursor = null;
      }
      // The first repository with something to commit, else the first.
      this.active = Math.max(0, next.findIndex((panel) => changed(panel) > 0));
    }
    // A section starts open when its repository has changes, and stays as the user leaves it.
    for (const panel of next) if (panel.root !== null && !this.open.has(panel.root)) this.open.set(panel.root, changed(panel) > 0);
    this.looked = true;
    this.changed();
  }

  /** The panel a line is of, its index, and the line's id in it. */
  resolve(id: string): { panel: Panel; index: number; inner: string } {
    const found = this.multi ? PREFIXED.exec(id) : null;
    if (found) {
      const index = Number(found[1]);
      const panel = this.panels[index];
      if (panel) return { panel, index, inner: found[2]! };
    }
    return { panel: this.panel, index: this.active, inner: id };
  }

  /** A line's id as the page has it: its repository's index first, when there are several. */
  id(index: number, inner: string): string {
    return this.multi ? `${index}>${inner}` : inner;
  }

  /** Whether a repository's section shows its lines. */
  isOpen(index: number): boolean {
    const root = this.panels[index]?.root;
    return this.filter !== "" || root == null || (this.open.get(root) ?? true);
  }

  /** Puts the cursor on a line, and selects its repository. */
  select(id: string | null): void {
    this.cursor = id;
    const where = id === null ? null : this.resolve(id);
    if (where) this.active = where.index;
    this.panels.forEach((panel, index) => {
      panel.cursor = where && index === where.index ? where.inner : null;
    });
    this.changed();
  }

  /** Folds a repository's section away, or opens it. */
  toggleRepo(index: number): void {
    const root = this.panels[index]?.root;
    if (root == null) return;
    this.open.set(root, !this.isOpen(index));
    this.select(this.id(index, "repo"));
  }

  setFilter(text: string): void {
    this.filter = text;
    for (const panel of this.panels) panel.filter = text;
    this.changed();
  }
}

/** How many files a panel's repository has changed, each counted once. */
export function changed(panel: Panel): number {
  const { staged, changes, conflicts } = panel.snapshot;
  return new Set([...staged, ...changes, ...conflicts].map((change) => change.path)).size;
}

export const projects = new Projects();
