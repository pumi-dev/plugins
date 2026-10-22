// `shell-scripts`: every shell script in the current pane's repository, grouped by directory, each
// run in a terminal with the shell its `#!` names. Its page is `script-panel`'s, its finder the
// shell scripts of `src/scripts.ts`.
import { page, type Page } from "script-panel/main.ts";

import { read } from "./scripts.ts";

/** The page of the directory `cwd`: what `ui.tsx` asks for as the current pane moves. */
export function load(cwd: string): Promise<Page> {
  return page(read, cwd);
}
