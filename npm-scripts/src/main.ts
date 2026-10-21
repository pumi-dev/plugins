// `npm-scripts`: the page in the left sidebar that lists a repository's `package.json` scripts —
// workspaces included — each run in a terminal beside the current pane, by the manager that owns it.
//
// The page itself is `script-panel`'s; this package is its finder (`src/packages.ts`), its view, and
// the place it takes in the sidebar.
import { option, pane, pkg, view } from "pumi";
import { scriptPanel } from "script-panel";

import { read } from "./packages.ts";

/** The view's type, as the manifest names it. */
const PAGE = pkg.prefixed("scripts");
/** Where the page goes: the left sidebar, below the files page. */
const PLACE = { kind: "slot", slot: "sidebar.left", order: 30, focus: false } as const;

view("scripts", scriptPanel(read, "script"));

/** Its page in the left sidebar, unless one is there already (a reload leaves one open). */
async function place(): Promise<void> {
  try {
    if ((await pane.list({ type: PAGE })).length > 0) return;
    const opened = await pane.open(PAGE, {}, PLACE);
    await option.set("title", "NPM Scripts", { pane: opened.id });
    await option.set("@icon", "package", { pane: opened.id });
  } catch (err) {
    console.error(`npm-scripts: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The page is there from startup, with the rest of the sidebar.
void place();
