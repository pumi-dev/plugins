// Opening the dashboard: go to the pane it is already in, else make the tab.
import { notify, pane, plugin } from "pumi";

/** The block, as the manifest's `pumi.contributes.blocks` lists it (`agent-overview.overview`). */
export const VIEW = "overview";

/** Whether `name` is a pane's id: `pane.list` answers with ids, or with closed panes when asked. */
function id(name: unknown): number | undefined {
  return typeof name === "number" ? name : undefined;
}

/** Open the overview in a tab of its own: go to the one that is open, else make the tab. */
export async function open(): Promise<boolean> {
  try {
    const [there] = await pane.list({ block: plugin.prefixed(VIEW) });
    const found = id(there);
    if (found !== undefined) {
      await pane.select({ pane: found });
      return true;
    }
    await pane.open(plugin.prefixed(VIEW), {}, { kind: "tab", name: "agents" });
    return true;
  } catch (err) {
    await notify(`agent overview: ${message(err)}`, "error");
    return false;
  }
}

/** What an error says, for a notice. */
export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
