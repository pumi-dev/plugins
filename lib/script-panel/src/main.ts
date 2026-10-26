// The page's logic, in the worker: the repository around the current pane, the scripts a package's
// `Finder` finds in it, and a script run in a terminal beside it. What it draws — the groups, the
// folding, the toolbar — is `ui.tsx`'s; this answers it as plain data.
import { call, request } from "pumi";

import { groupScripts, repoRoot, type Finder, type Group } from "./finder.ts";

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

/** Opens a terminal beside the current pane in `dir` and types `command` into it. */
export async function run(dir: string, command: string): Promise<void> {
  try {
    const opened: string = await call("pane.open", "terminal", { cwd: dir }, {});
    await call("pane.call", opened, "input", { text: `${command}\r` });
  } catch (err) {
    await request.open({ kind: "notification", title: `${command}: ${err instanceof Error ? err.message : String(err)}`, level: "error" });
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
