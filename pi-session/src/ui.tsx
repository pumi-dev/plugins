// What a pi tab's strip gets, in the window's React tree: two buttons beside its split and close,
// on the tabs pi's hook reported and (with `focused_only`) on the one in front alone. They are the
// theme's own buttons (`IconButton`), so they look like the tab's. What they do is the worker's
// (`main.ts`): Fork opens `pi --fork <session>` beside the tab, Copy puts the session on the
// clipboard.
import { IconButton, useOption, usePlugin, useTab, type TabId } from "pumi";

import { copy, fork } from "./main.ts";

/** A throw the buttons cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`pi-session: ${err instanceof Error ? err.message : String(err)}`);
}

/** The `tab.toolbar` slot's component: Fork and Copy, on a pi tab. */
export function Toolbar({ tab }: { tab: TabId }) {
  const plugin = usePlugin() ?? "";
  // The options are the plugin's own, under `owner.name.` (`-` as `_`), as the worker names them.
  const prefix = plugin ? `${plugin.replace("/", ".").replaceAll("-", "_")}.` : "";
  const each = useTab(tab);
  const [only] = useOption<boolean>(`${prefix}focused_only`);
  const options = (each?.options ?? {}) as Record<string, unknown>;
  const agent = options["@pumi_dev.agents.agent"];
  const session = options["@pumi_dev.agents.agent.session"];
  if (agent !== "pi" || typeof session !== "string" || session === "") return null;
  if (only && each?.isFocused !== true) return null;
  return (
    <>
      <IconButton icon="git_branch" title="Fork: open pi --fork <session> beside this tab" onClick={() => void fork(tab).catch(swallow)} />
      <IconButton
        icon="copy"
        title="Copy the session's id, path and directory"
        onClick={() => void copy(tab).then((summary) => console.info(`pi-session: copied\n${summary}`), swallow)}
      />
    </>
  );
}
