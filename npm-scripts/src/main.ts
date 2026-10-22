// `npm-scripts`: the page in the left sidebar that lists a repository's `package.json` scripts —
// workspaces included — each run in a terminal beside the current pane, by the manager that owns
// it. The page itself is `script-panel`'s; this package is its finder (`src/packages.ts`) and the
// call the window makes to read it.
import { page, type Page } from "script-panel/main.ts";

import { read } from "./packages.ts";

/** The page of the directory `cwd`: what `ui.tsx` asks for as the current pane moves. */
export function load(cwd: string): Promise<Page> {
  return page(read, cwd);
}
