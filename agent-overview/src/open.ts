// Opening the dashboard: go to the pane it is already in, else make the tab.
import { notify, pane, pkg } from "pumi";

/** The view, as the manifest's `pumi.contributes.views` lists it (`agent-overview.overview`). */
export const VIEW = "overview";

/** Open the overview in a tab of its own: go to the one that is open, else make the tab. */
export async function open(): Promise<boolean> {
  try {
    const [there] = await pane.list({ type: pkg.prefixed(VIEW) });
    if (there) {
      await pane.select({ to: there.id });
      return true;
    }
    await pane.open(pkg.prefixed(VIEW), {}, { kind: "tab", name: "agents" });
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
