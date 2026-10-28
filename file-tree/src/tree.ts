// The project as a tree, the half that reads the disk. A directory is listed
// the first time it is needed and not again until a rescan; what is listed is sorted the panel's
// way; what git says of a path is kept beside it; and a chain of directories that hold exactly one
// directory is folded into one row (`a/b/c`), which unfolds a level at a time.
//
// `visibleEntries` is the other half: which rows the tree shows now, walking only the directories
// that are open.
import { readdirSync } from "node:fs";
import { join as joinPath, sep } from "node:path";
import * as git from "./git.ts";
import { IgnoreStack } from "./ignore.ts";
import { compareRelPaths } from "./paths.ts";
import * as relpath from "./relpath.ts";

/** What an entry is. */
export type Kind = "dir" | "file";

/** One entry of the tree, as the panel draws it: where it is, what it is, and what git says. */
export interface TreeEntry {
  rel: string;
  kind: Kind;
  isIgnored: boolean;
  isHidden: boolean;
  git: git.GitSummary;
}

/** What the panel's settings say the tree does. */
export interface TreeSettings {
  /** Leave out what `.gitignore` hides. */
  hideGitignore: boolean;
  /** Leave out what starts with a dot. */
  hideHidden: boolean;
  /** Fold a directory that holds one directory into one row. */
  autoFoldDirs: boolean;
}

interface Node {
  kind: Kind;
  isIgnored: boolean;
  isHidden: boolean;
  /** Its children's paths, sorted; `null` until it has been listed. */
  children: string[] | null;
}

/** A chain of directories folded into one row, and how much of it shows. */
export interface FoldedAncestors {
  /** How many of `ancestors` are hidden by the fold now; 0 shows the deepest. */
  currentAncestorDepth: number;
  /** The chain, deepest first. */
  ancestors: string[];
}

/** The row being typed into: a file or folder that does not exist yet. */
export interface NewEntry {
  /** The directory it will be made in. */
  parent: string;
  isDir: boolean;
  /** The folded chain a new entry is typed into, opened for as long as it is being typed. */
  temporarilyUnfolded: string | null;
}

/** What the panel keeps between renders: which directories are open, and the rows that show. */
export interface State {
  /** Rows folded from a chain, by the row that stands for them. */
  ancestors: Map<string, FoldedAncestors>;
  /** The rows that show, in order. */
  visible: VisibleEntry[];
  /** Directories taken out of a folded chain, by the panel's "Unfold Directory". */
  unfolded: Set<string>;
  /** Directories the user has opened. The root is always one. */
  expanded: Set<string>;
}

export interface VisibleEntry {
  entry: TreeEntry;
  /** The row being typed into, drawn under the directory it will be made in. */
  isNewEntry: boolean;
}

/** A tree of one project: the directory the panel shows, and what it has read so far. */
export class Tree {
  /** Where the tree starts: the repository's work tree when `cwd` is in one, `cwd` itself else. */
  readonly root: string;
  /** The root's own name, the row of the root. */
  readonly rootName: string;
  /** Whether the project is in a repository, for the menu's git entries. */
  readonly hasGitRepo: boolean;
  private readonly nodes = new Map<string, Node>();
  private readonly stacks = new Map<string, IgnoreStack>();
  private summaries: Map<string, git.GitSummary>;

  constructor(cwd: string, summaries: Map<string, git.GitSummary> = new Map()) {
    const repository = git.repositoryRoot(cwd);
    this.root = repository ?? cwd;
    this.rootName = relpath.fileName(this.root) || this.root;
    this.hasGitRepo = repository !== null;
    this.summaries = summaries;
    this.nodes.set(relpath.ROOT, { kind: "dir", isIgnored: false, isHidden: false, children: null });
    this.stacks.set(relpath.ROOT, IgnoreStack.root(this.root));
  }

  /** Where `rel` is on disk. */
  abs(rel: string): string {
    return rel === "" ? this.root : joinPath(this.root, ...rel.split("/"));
  }

  /** Where `abs` is in the project; `null` for a path outside it, or the root itself. */
  relOf(abs: string): string | null {
    const inside = abs === this.root ? "" : abs.startsWith(this.root + sep) ? abs.slice(this.root.length + 1) : null;
    if (inside === null || inside === "") return null;
    return inside.split(sep).join("/");
  }

  /** Forgets what was listed, so the next rows are read from the disk again. */
  rescan(): void {
    for (const node of this.nodes.values()) node.children = null;
  }

  /** Takes git's new summaries; the next rows are drawn with them. */
  setSummaries(summaries: Map<string, git.GitSummary>): void {
    this.summaries = summaries;
  }

  /** What git says of `rel`, itself and everything under it. */
  summary(rel: string): git.GitSummary {
    return this.summaries.get(rel) ?? git.UNCHANGED;
  }

  /** `rel` as an entry, when the tree has read it. */
  entry(rel: string): TreeEntry | undefined {
    const node = this.nodes.get(rel);
    if (!node) return undefined;
    return { rel, kind: node.kind, isIgnored: node.isIgnored, isHidden: node.isHidden, git: this.summary(rel) };
  }

  /** `rel`'s children as far as they have been listed: none for a directory not read yet. */
  listedChildren(rel: string): TreeEntry[] {
    const node = this.nodes.get(rel);
    if (!node || node.kind !== "dir" || node.children === null) return [];
    return node.children.map((child) => this.entry(child)).filter((entry): entry is TreeEntry => entry !== undefined);
  }

  /** `rel`'s children, listing the directory the first time it is asked. */
  childEntries(rel: string): TreeEntry[] {
    const node = this.nodes.get(rel);
    if (!node || node.kind !== "dir") return [];
    if (node.children === null) this.list(rel);
    const out: TreeEntry[] = [];
    for (const child of this.nodes.get(rel)?.children ?? []) {
      const entry = this.entry(child);
      if (entry) out.push(entry);
    }
    return out;
  }

  /** Whether `rel` is a directory holding exactly one directory: a chain to fold. */
  isFoldable(rel: string): boolean {
    if (this.nodes.get(rel)?.kind !== "dir") return false;
    const children = this.childEntries(rel);
    const last = children.pop();
    return children.length === 0 && last !== undefined && last.kind === "dir";
  }

  /** Whether `rel` is a chain of directories nobody has unfolded yet. */
  isUnfoldable(rel: string, unfolded: Set<string>): boolean {
    if (this.nodes.get(rel)?.kind !== "dir" || unfolded.has(rel)) return false;
    if (rel === "") return false;
    const siblings = this.childEntries(relpath.parent(rel));
    const last = siblings.pop();
    return siblings.length === 0 && last !== undefined && last.kind === "dir";
  }

  /**
   * Whether a change to `abs` is one the tree cannot show: it is a path the tree does not list, and
   * it is inside a directory the tree leaves out. The watch asks, so that a build writing into an
   * ignored folder does not redraw the panel.
   */
  changeIsUnseen(abs: string): boolean {
    const at = this.relOf(abs);
    if (at === null) return false;
    const listed = (path: string) => this.nodes.get(path)?.children !== null && this.nodes.get(path) !== undefined;
    if (at === ".git" || at.startsWith(".git/") || listed(at) || listed(relpath.parent(at))) return false;
    let walk = at;
    for (;;) {
      const node = this.nodes.get(walk);
      if (node) return node.isIgnored;
      if (walk === "") return false;
      walk = relpath.parent(walk);
    }
  }

  /** Reads one directory: its entries, what `.gitignore` says of them, and their order. */
  private list(rel: string): void {
    const dir = this.abs(rel);
    const above = rel === "" ? null : relpath.parent(rel);
    const stack = rel === "" ? (this.stacks.get(rel) ?? IgnoreStack.none()) : (this.stacks.get(above!) ?? IgnoreStack.none());
    const forChildren = IgnoreStack.child(stack, dir);
    this.stacks.set(rel, forChildren);
    const dirIgnored = this.nodes.get(rel)?.isIgnored ?? false;
    const children: string[] = [];
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.error(`file-tree: cannot list ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name === ".git") continue;
      const isDir = entry.isDirectory();
      const isIgnored = dirIgnored || forChildren.isIgnored(joinPath(dir, name), isDir);
      const child = rel === "" ? name : `${rel}/${name}`;
      this.nodes.set(child, { kind: isDir ? "dir" : "file", isIgnored, isHidden: name.startsWith("."), children: null });
      children.push(child);
    }
    children.sort((a, b) => {
      const isFile = (path: string) => this.nodes.get(path)?.kind === "file";
      return compareRelPaths({ rel: a, isFile: isFile(a) }, { rel: b, isFile: isFile(b) });
    });
    const node = this.nodes.get(rel);
    if (node) node.children = children;
  }
}

/** A state with nothing open but the root. */
export function initialState(): State {
  return { ancestors: new Map(), visible: [], unfolded: new Set(), expanded: new Set([relpath.ROOT]) };
}

/** Whether a chain's row is unfolded, so the traversal goes into it rather than folding it again. */
function isUnfolded(state: State, path: string, newEntry: NewEntry | null): boolean {
  return state.unfolded.has(path) || newEntry?.temporarilyUnfolded === path;
}

/** The row a chain is drawn as now: the one at the fold's current depth, or the entry itself. */
export function unflatten(state: State, leaf: string): string {
  const folded = state.ancestors.get(leaf);
  if (!folded) return leaf;
  return folded.ancestors[folded.currentAncestorDepth] ?? leaf;
}

/** How deep a row is drawn, and how many components of its path it shows: a folded chain is one
 * row, drawn where the deepest visible directory above it is. */
export function depthAndDifference(path: string, visible: Set<string>): [number, number] {
  if (!relpath.isRel(path)) return [0, 0];
  const above = relpath.ancestors(path).slice(1);
  const at = above.find((ancestor) => visible.has(ancestor));
  if (at === undefined) return [0, relpath.componentCount(path)];
  const difference = relpath.componentCount(path) - relpath.componentCount(at);
  const depth = above.filter((ancestor) => visible.has(ancestor)).length;
  return [depth, difference];
}

/** A depth-first walk of the tree, knowing each level's siblings so it can step back out. */
class Walk {
  private readonly stack: { siblings: string[]; at: number }[] = [];
  current: string | null = relpath.ROOT;

  constructor(private readonly tree: Tree) {}

  entry(): TreeEntry | undefined {
    return this.current === null ? undefined : this.tree.entry(this.current);
  }

  /** The next sibling of the level it is on, out as far as need be. */
  advanceToSibling(): boolean {
    for (;;) {
      const top = this.stack[this.stack.length - 1];
      if (!top) break;
      if (top.at + 1 < top.siblings.length) {
        top.at++;
        this.current = top.siblings[top.at]!;
        return true;
      }
      this.stack.pop();
    }
    this.current = null;
    return false;
  }

  /** Into the first child of the directory it is on, else to its next sibling. */
  advance(): boolean {
    const at = this.current;
    if (at !== null && this.tree.entry(at)?.kind === "dir") {
      const children = this.tree.childEntries(at).map((child) => child.rel);
      const first = children[0];
      if (first !== undefined) {
        this.stack.push({ siblings: children, at: 0 });
        this.current = first;
        return true;
      }
    }
    return this.advanceToSibling();
  }
}

/**
 * The rows the tree shows: a depth-first walk of the open directories, single-child chains folded
 * into one row each, and the entries the settings hide left out.
 */
export function visibleEntries(tree: Tree, state: State, settings: TreeSettings, newEntry: NewEntry | null): State {
  const next: State = {
    ancestors: new Map(),
    visible: [],
    unfolded: new Set(state.unfolded),
    expanded: new Set(state.expanded),
  };
  const hidden = (entry: TreeEntry) =>
    (settings.hideGitignore && entry.isIgnored) || (settings.hideHidden && entry.isHidden);
  const walk = new Walk(tree);
  let chain: string[] = [];
  while (walk.entry()) {
    const entry = walk.entry()!;
    if (settings.autoFoldDirs && entry.kind === "dir") {
      chain.push(entry.rel);
      if (!isUnfolded(next, entry.rel, newEntry) && entry.rel !== "") {
        const children = tree.childEntries(entry.rel);
        const only = children[0];
        if (children.length === 1 && only !== undefined && only.kind === "dir") {
          // A chain: this row is not the one drawn, and the walk goes on from its child.
          walk.advance();
          continue;
        }
      }
      const depth = Math.min(state.ancestors.get(entry.rel)?.currentAncestorDepth ?? 0, chain.length);
      const ancestors = [...chain].reverse();
      if (ancestors.length > 1) next.ancestors.set(entry.rel, { currentAncestorDepth: depth, ancestors });
    }
    chain = [];
    if (!hidden(entry)) next.visible.push({ entry, isNewEntry: false });
    if (newEntry !== null && newEntry.parent === entry.rel && !hidden(entry)) {
      next.visible.push({
        entry: {
          rel: entry.rel,
          kind: newEntry.isDir ? "dir" : "file",
          isIgnored: entry.isIgnored,
          isHidden: entry.isHidden,
          git: entry.git,
        },
        isNewEntry: true,
      });
    }
    if (!next.expanded.has(entry.rel) && walk.advanceToSibling()) continue;
    walk.advance();
  }
  next.visible.sort((a, b) =>
    compareRelPaths(
      { rel: a.entry.rel, isFile: a.entry.kind === "file" },
      { rel: b.entry.rel, isFile: b.entry.kind === "file" },
    ),
  );
  return next;
}
