// Which panes the switcher's scope and order ask for, and what each pane says of itself — its block
// (which picks the card's icon), its title or the program in it, its `tab.pane` number and
// directory, and its agent's state.
import { call, option, self, type Layout, type PaneId, type SessionId, type TabId } from "pumi";

import { kindIcon, MAX_CARDS, MAX_PREVIEWS, ordered, tilde, type Card } from "./cards.ts";
import type { Settings } from "./settings.ts";

/** A pane's option `name` as text; empty when it is unset. */
async function said(at: PaneId, name: string): Promise<string> {
  const value = await option.get(name, { scope: "pane", id: at });
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
  if (settings.scope === "tab") return [(await call("tab.get", [null])).id];
  if (settings.scope === "all") {
    const found: TabId[] = [];
    for (const one of (await call("session.list", [])) as SessionId[]) {
      found.push(...((await call("session.get", [one])).tabs as TabId[]));
    }
    return found;
  }
  return (await call("session.get", [null])).tabs as TabId[];
}

/** The panes the settings ask for, with the block each holds: laid out in a tab or floating over
 * it, never its chrome (a slot) or a detached pane, and never the switcher itself. */
async function panes(settings: Settings): Promise<{ pane: PaneId; block: string }[]> {
  const found: { pane: PaneId; block: string }[] = [];
  const own = self.plugin.prefixed("switcher");
  for (const at of await tabs(settings)) {
    for (const each of (await call("pane.list", [{ tab: at }])) as PaneId[]) {
      const { block, place } = await call("pane.get", [each]);
      if (place.kind !== "tiled" && place.kind !== "float") continue;
      if (block === own) continue;
      found.push({ pane: each, block });
    }
  }
  return found;
}

/** Where `at` is, as tmux writes it (`tab.pane`, both from 0): the tab's index and the pane's in
 * its layout; empty when the switcher shows one tab. */
async function where(at: PaneId, numbered: boolean): Promise<string> {
  if (!numbered) return "";
  try {
    const pane = await call("pane.get", [at]);
    if (pane.tab === null) return "";
    const tab = await call("tab.get", [pane.tab]);
    const found: PaneId[] = [];
    leaves(tab.layout as Layout, found);
    return `${tab.index}.${found.indexOf(at)}`;
  } catch {
    return "";
  }
}

/** A pane's card, or `null` when it cannot be shown (a pane closed between the listing and now). */
async function card(at: PaneId, block: string, numbered: boolean, preview: boolean): Promise<Card | null> {
  const title = [await said(at, "title"), await said(at, "pane_current_command"), block].find((text) => text !== "");
  if (title === undefined) return null;
  // Where it is: its number in the tab, when the switcher shows more than that tab.
  let detail = await where(at, numbered);
  const cwd = tilde(await said(at, "pane_current_path"));
  if (cwd !== "") detail = detail === "" ? cwd : `${detail}  ${cwd}`;
  return { pane: at, kind: block, title, detail, status: await said(at, "@agent.status"), preview };
}

/** Every card the switcher shows, in order. */
export async function cards(settings: Settings, recent: PaneId[]): Promise<Card[]> {
  const listed = ordered(await panes(settings), recent, settings.order === "recent");
  const made = await Promise.all(
    listed
      .slice(0, MAX_CARDS)
      .map(({ pane: at, block }, i) => card(at, block, settings.scope !== "tab", settings.preview && i < MAX_PREVIEWS)),
  );
  return made.filter((made): made is Card => made !== null);
}
