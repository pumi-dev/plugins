// terminal: a shell in a tab. pumid runs every terminal (the PTY, the program, its screen and
// scrollback, carried across a restart); the block here says so (`engine: "terminal"`) and
// `ui.tsx` draws it. What is the plugin's is that a shell is what a new tab holds: on its first run
// it sets `new_tab` to its block, unless something else is set there already.
//
//   pumi call pumi_dev.terminal.open                              # a shell beside this tab
//   pumi call pumi_dev.terminal.open '{"command":["make","test"]}'
//   pumi tab open pumi_dev.terminal.shell '{"cwd":"/src"}' --split right
import { fn, option, self, workspace } from "pumi";

import { claims, opening } from "./open.ts";

/** The block a terminal is: `pumi_dev.terminal.shell`. */
const BLOCK = self.plugin.prefixed("shell");

fn.set(
  "open",
  {
    desc: "Open a terminal beside this tab (or `tab`, at `place`), running `command` in `cwd` if given, else a shell.",
    effect: "write",
    examples: [{ args: [] }, { args: [{ command: ["make", "test"] }] }],
    returns: "The tab it opened.",
    returns_schema: { type: "string" },
  },
  async (given?: unknown) => {
    const { args, place } = opening(given);
    const opened = await workspace.openTab(BLOCK, args, place);
    return opened.id;
  },
);

const newTab = await option.get("new_tab", { scope: "global" }).catch(() => null);
const claimed = await option.get("claimed", { scope: "global" }).catch(() => null);
if (claims(newTab, claimed)) {
  await option.set("new_tab", BLOCK, { scope: "global" });
  await option.set("claimed", true, { scope: "global" });
}
