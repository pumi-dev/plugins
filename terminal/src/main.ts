// terminal: a shell in a tab. pumid runs every terminal (the PTY, the program, its screen and
// scrollback, carried across a restart); the block here says so (`engine: "terminal"`) and
// `ui.tsx` draws it. Pick it in Settings ▸ General ▸ New tabs open to make every new tab a shell.
//
//   pumi call pumi_dev.terminal.open                              # a shell beside this tab
//   pumi call pumi_dev.terminal.open '{"command":["make","test"]}'
//   pumi tab open pumi_dev.terminal.shell '{"cwd":"/src"}' --split right
import { fn, self, workspace } from "pumi";

import { opening } from "./open.ts";

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
