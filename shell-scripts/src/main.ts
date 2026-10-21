// `shell-scripts`: every shell script in the current pane's repository, grouped by directory, each
// run in a terminal with the shell its `#!` names. Its page is `script-panel`'s, its finder the
// shell scripts of `src/scripts.ts`.
import { pane, pkg, view } from "pumi";
import { scriptPanel } from "script-panel";

import { read } from "./scripts.ts";

// Its page, drawn for each pane with that pane's options read.
view("scripts", scriptPanel(read, "script"));

/** Its page in the left sidebar, beside the core plugins', unless a reload left one there. */
async function place(): Promise<void> {
  const type = pkg.prefixed("scripts");
  try {
    const there = await pane.list({ type });
    if (there.length > 0) return;
    const page = await pane.open(type, {}, { kind: "slot", slot: "sidebar.left", order: 31, focus: false });
    await page.options.set("title", "Shell Scripts");
    await page.options.set("@icon", "terminal");
  } catch (err) {
    console.error(`shell-scripts: ${err instanceof Error ? err.message : String(err)}`);
  }
}

void place();
