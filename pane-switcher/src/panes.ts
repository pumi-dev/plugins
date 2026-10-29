// Which panes the switcher's scope and order ask for, and what each pane says of itself — its block
// (which picks the card's icon), its title or the program in it, its `tab.pane` number and
// directory, and its tab's agent state.
import { option, self, workspace, type Layout, type PaneId, type TabId } from "pumi";

import { kindIcon, MAX_CARDS, MAX_PREVIEWS, ordered, tilde, type Card } from "./cards.ts";
import type { Settings } from "./settings.ts";

/** A pane's option `name` as text; empty when it is unset. */
async function said(at: PaneId, name: string): Promise<string> {
  const value = await option.get(name, { scope: "pane", id: at });
  return typeof value === "string" ? value : "";
}

/** A tab's `@status` as text — any tab's state, so a card says what the agent in it is doing; empty
 * when the tab says nothing. */
async function saidStatus(at: TabId): Promise<string> {
  const value = await option.get("@status", { scope: "tab", id: at });
  return typeof value === "string" ? value : "";
}

/** A tab's panes' ids, in layout order. */
function leaves(layout: Layout | undefined, out: PaneId[]): void {
  if (layout === undefined || typeof layout === "string" || layout === null) return;
  if ("pane" in layout) {
    if (layout.pane !== "") out.push(layout.pane);
    return;
  }
  if (!("axis" in layout)) return;
  leaves(layout.first, out);
  leaves(layout.second, out);
}

/** The tabs the scope asks for. */
async function tabs(settings: Settings): Promise<TabId[]> {
  await workspace.ready;
  if (settings.scope === "tab") {
    const here = workspace.currentTab;
    return here === null ? [] : [here.id];
  }
  if (settings.scope === "all") return workspace.sessions.flatMap((session) => session.tabs.map((tab) => tab.id));
  return (workspace.currentSession?.tabs ?? []).map((tab) => tab.id);
}

/** The panes the settings ask for, with the block each holds and its tab's state: laid out in a tab
 * or floating over it, never its chrome (a slot) or a detached pane, and never the switcher
 * itself. */
async function panes(settings: Settings): Promise<{ pane: PaneId; block: string; status: string }[]> {
  const found: { pane: PaneId; block: string; status: string }[] = [];
  const own = self.plugin.prefixed("switcher");
  for (const tab of await tabs(settings)) {
    const status = await saidStatus(tab);
    for (const pane of await workspace.panes({ tab })) {
      if (pane.place?.kind !== "tiled" && pane.place?.kind !== "float") continue;
      if (pane.block === own) continue;
      found.push({ pane: pane.id, block: pane.block, status });
    }
  }
  return found;
}

/** Where `at` is, as tmux writes it (`tab.pane`, both from 0): the tab's index and the pane's in
 * its layout; empty when the switcher shows one tab. */
async function where(at: PaneId, numbered: boolean): Promise<string> {
  if (!numbered) return "";
  try {
    await workspace.ready;
    const pane = workspace.getPane(at);
    const tab = pane?.tab;
    if (!pane || tab === null || tab === undefined) return "";
    const found: PaneId[] = [];
    leaves(tab.layout, found);
    return `${tab.index}.${found.indexOf(at)}`;
  } catch {
    return "";
  }
}

/** A pane's card, or `null` when it cannot be shown (a pane closed between the listing and now). */
async function card(
  at: PaneId,
  block: string,
  status: string,
  numbered: boolean,
  preview: boolean,
): Promise<Card | null> {
  const title = [await said(at, "title"), await said(at, "pane_current_command"), block].find((text) => text !== "");
  if (title === undefined) return null;
  // Where it is: its number in the tab, when the switcher shows more than that tab.
  let detail = await where(at, numbered);
  const cwd = tilde(await said(at, "pane_current_path"));
  if (cwd !== "") detail = detail === "" ? cwd : `${detail}  ${cwd}`;
  return { pane: at, kind: block, title, detail, status, preview };
}

/** Every card the switcher shows, in order. */
export async function cards(settings: Settings, recent: PaneId[]): Promise<Card[]> {
  const listed = ordered(await panes(settings), recent, settings.order === "recent");
  const made = await Promise.all(
    listed
      .slice(0, MAX_CARDS)
      .map(({ pane: at, block, status }, i) =>
        card(at, block, status, settings.scope !== "tab", settings.preview && i < MAX_PREVIEWS),
      ),
  );
  return made.filter((made): made is Card => made !== null);
}
