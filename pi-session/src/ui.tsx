// What a pi pane's strip draws, in the window's React tree: the two buttons at the row's end, on
// the panes pi's hook reported and (with `focused_only`) on the one in front alone. What they do is
// the worker's (`main.ts`): Fork opens `pi --fork <session>` beside the pane, Copy puts the session
// on the clipboard.
import { Icon, useFocusedPane, useMetrics, useOption, usePane, usePlugin, useTheme, type Ref } from "pumi";

import { copy, fork } from "./main.ts";

/** A throw the strip cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`pi-session: ${err instanceof Error ? err.message : String(err)}`);
}

/** One of the strip's buttons: one of the app's icons, with what it does in its label. */
function Button({ icon, tip, onClick }: { icon: string; tip: string; onClick(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      aria-label={tip}
      onClick={(e: any) => {
        e?.stopPropagation?.();
        onClick();
      }}
      style={{ display: "flex", width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
    >
      <Icon name={icon} size={12} color={t.muted} />
    </div>
  );
}

/** The `pane.strip` slot's view: Fork and Copy, on a pi pane. */
export function Strip({ pane }: { pane: Ref }) {
  const t = useTheme();
  const plugin = usePlugin() ?? "";
  // The options are the plugin's own, under `owner.name.` (`-` as `_`), as the worker names them.
  const prefix = plugin ? `${plugin.replace("/", ".").replaceAll("-", "_")}.` : "";
  const each = usePane(pane);
  const focused = useFocusedPane();
  const only = useOption<boolean>(`${prefix}focused_only`) === true;
  const options = (each?.options ?? {}) as Record<string, unknown>;
  const agent = options["@agent"];
  const session = options["@agent_session"];
  if (agent !== "pi" || typeof session !== "string" || session === "") return null;
  const here = focused !== undefined && focused.id === pane.id && focused.server === pane.server;
  if (only && !here) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, height: "100%", color: t.muted }}>
      <Button icon="git_branch" tip="Fork: open pi --fork <session> beside this pane" onClick={() => void fork(pane.id).catch(swallow)} />
      <Button
        icon="copy"
        tip="Copy the session's id, path and directory"
        onClick={() => void copy(pane.id).then((summary) => console.info(`pi-session: copied\n${summary}`), swallow)}
      />
    </div>
  );
}
