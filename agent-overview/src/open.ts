// Opening the dashboard: go to the pane it is already in, else make the tab.
import { call, self } from "pumi";

/** The block, as the manifest's `pumi.contributes.blocks` lists it (`agent-overview.overview`). */
export const VIEW = "overview";

/** Open the overview in a tab of its own: go to the one that is open, else make the tab. */
export async function open(): Promise<boolean> {
  try {
    const [there]: string[] = await call("pane.list", { block: self.plugin.prefixed(VIEW) });
    if (there !== undefined) {
      await call("pane.focus", there, {});
      return true;
    }
    await call("pane.open", self.plugin.prefixed(VIEW), {}, { kind: "tab", name: "agents" });
    return true;
  } catch (err) {
    await call("request.open", { kind: "notification", title: `agent overview: ${message(err)}`, level: "error" });
    return false;
  }
}

/** What an error says, for a notice. */
export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
