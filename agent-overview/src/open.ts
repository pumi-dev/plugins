// Opening the dashboard: go to the pane it is already in, else make the tab.
import { self, workspace } from "pumi";

/** The block, as the manifest's `pumi.contributes.blocks` lists it (`agent-overview.overview`). */
export const VIEW = "overview";

/** Open the overview in a tab of its own: go to the one that is open, else make the tab. */
export async function open(): Promise<boolean> {
  try {
    const [there] = await workspace.panes({ block: self.plugin.prefixed(VIEW) });
    if (there !== undefined) {
      await there.focus();
      return true;
    }
    await workspace.openPane(self.plugin.prefixed(VIEW), {}, { kind: "tab", name: "agents" });
    return true;
  } catch (err) {
    await workspace.openRequest({ kind: "notification", title: `agent overview: ${message(err)}`, level: "error" });
    return false;
  }
}

/** What an error says, for a notice. */
export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
