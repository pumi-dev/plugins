// `scripts`: one page in the left sidebar for everything a repository can run — the scripts of every
// `package.json`, workspaces included, and its shell scripts — each run in a terminal beside the
// current pane. The page itself is `script-panel`'s; this package is the finder
// (`src/packages.ts` and `src/shells.ts`, joined by `src/read.ts`) and the calls the window makes.
import { page, run as open, type Page } from "../../lib/script-panel/src/main.ts";

import { read } from "./read.ts";

/** Runs an item of the page: a terminal beside the current pane, in `dir`, typing `command`. */
export function run(dir: string, command: string): Promise<void> {
  return open(dir, command);
}

/** The page of the directory `cwd`: what `ui.tsx` asks for as the current pane moves. */
export function load(cwd: string): Promise<Page> {
  return page(read, cwd);
}
