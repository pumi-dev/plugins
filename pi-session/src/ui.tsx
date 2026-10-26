// What a pi pane's title bar gets, in the window's React tree: two buttons beside its split and
// close, on the panes pi's hook reported and (with `focused_only`) on the one in front alone. They
// are the theme's own buttons (`IconButton`), so they look like the pane's. What they do is the
// worker's (`main.ts`): Fork opens `pi --fork <session>` beside the pane, Copy puts the session on
// the clipboard.
import { IconButton, useOption, usePane, usePlugin, useTab, type PaneId } from "pumi";

import { copy, fork } from "./main.ts";

/** A throw the buttons cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`pi-session: ${err instanceof Error ? err.message : String(err)}`);
}

/** The `pane.toolbar` slot's view: Fork and Copy, on a pi pane. */
export function Toolbar({ pane }: { pane: PaneId }) {
  const plugin = usePlugin() ?? "";
  // The options are the plugin's own, under `owner.name.` (`-` as `_`), as the worker names them.
  const prefix = plugin ? `${plugin.replace("/", ".").replaceAll("-", "_")}.` : "";
  const each = usePane(pane);
  const focused = useTab()?.activePane;
  const [only] = useOption<boolean>(`${prefix}focused_only`);
  const options = (each?.options ?? {}) as Record<string, unknown>;
  const agent = options["@agent"];
  const session = options["@agent.session"];
  if (agent !== "pi" || typeof session !== "string" || session === "") return null;
  const here = focused !== undefined && focused !== null && focused.id === pane;
  if (only && !here) return null;
  return (
    <>
      <IconButton icon="git_branch" title="Fork: open pi --fork <session> beside this pane" onClick={() => void fork(pane).catch(swallow)} />
      <IconButton
        icon="copy"
        title="Copy the session's id, path and directory"
        onClick={() => void copy(pane).then((summary) => console.info(`pi-session: copied\n${summary}`), swallow)}
      />
    </>
  );
}
