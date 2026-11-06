// The page's logic, in the worker: the repository around the current tab, the scripts a package's
// `Finder` finds in it, and a script run in a terminal beside it. What it draws — the groups, the
// folding, the toolbar — is `ui.tsx`'s; this answers it as plain data.
import { workspace } from "pumi";

import { groupScripts, repoRoot, type Finder, type Group } from "./finder.ts";

/** What a finder finds, and what a page lists: `ui.tsx` draws these. */
export type { Finder, Group, Item } from "./finder.ts";

/** A page as the window draws it: the repository, its groups, and what the finder says of them. */
export interface Page {
  /** The repository's top: the nearest directory with a `.git`, else the directory looked in. */
  root: string;
  groups: Group[];
  /** What the page says when there is nothing to run. */
  empty: string;
  /** Whether an item's command shows beside its name. */
  showDetail: boolean;
}

/** Opens a terminal beside the current tab in `dir` and types `command` into it. */
export async function run(dir: string, command: string): Promise<void> {
  try {
    const opened = await workspace.openTab("terminal", { cwd: dir }, { kind: "tiled", split: "right" });
    await opened.input({ text: `${command}\r` });
  } catch (err) {
    await workspace.openRequest({ kind: "notification", title: `${command}: ${err instanceof Error ? err.message : String(err)}`, level: "error" });
  }
}

/**
 * The page of `cwd`: `make` reads the finder (its options with it), and the repository around
 * `cwd` is walked for what it finds.
 */
export async function page(make: () => Finder | Promise<Finder>, cwd: string): Promise<Page> {
  const finder = await make();
  const root = repoRoot(cwd || "/");
  return { root, groups: groupScripts(finder, root), empty: finder.empty, showDetail: finder.showDetail };
}
