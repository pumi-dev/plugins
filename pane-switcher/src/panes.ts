// Which panes the switcher's scope and order ask for, and what each pane says of itself — its block
// (which picks the card's icon), its title or the program in it, its `tab.pane` number and
// directory, and its agent's state.
import { format, option, pane, plugin, session, tab } from "pumi";

import { kindIcon, MAX_CARDS, MAX_PREVIEWS, ordered, tilde, type Card } from "./cards.ts";
import type { Settings } from "./settings.ts";

/** A pane's option `name` as text; empty when it is unset. */
async function said(at: number, name: string): Promise<string> {
  const value = await option.get(name, { pane: at });
  return typeof value === "string" ? value : "";
}

/** The tabs the scope asks for. */
async function tabs(settings: Settings): Promise<number[]> {
  if (settings.scope === "tab") return [(await tab.get()).id];
  if (settings.scope === "all") {
    const found: number[] = [];
    for (const one of await session.list()) for (const each of await one.tabs()) found.push(each.id);
    return found;
  }
  return (await session.get()).tabs.map(([, at]) => at);
}

/** The panes the settings ask for, with the block each holds: laid out in a tab or floating over
 * it, never its chrome (a slot) or a detached pane, and never the switcher itself. */
async function panes(settings: Settings): Promise<{ pane: number; block: string }[]> {
  const found: { pane: number; block: string }[] = [];
  const own = plugin.prefixed("switcher");
  for (const at of await tabs(settings)) {
    for (const each of await pane.list({ tab: at })) {
      if (typeof each !== "number") continue;
      const { block, place } = await pane.get(each);
      if (place.kind !== "tiled" && place.kind !== "float") continue;
      if (block === own) continue;
      found.push({ pane: each, block });
    }
  }
  return found;
}

/** A pane's card, or `null` when it cannot be shown (a pane closed between the listing and now). */
async function card(at: number, block: string, numbered: boolean, preview: boolean): Promise<Card | null> {
  const title = [await said(at, "title"), await said(at, "pane_current_command"), block].find((text) => text !== "");
  if (title === undefined) return null;
  // Where it is: its number in the tab, when the switcher shows more than that tab.
  const index = numbered ? await format.eval("#{window_index}.#{pane_index}", { pane: at }).catch(() => "") : "";
  let detail = typeof index === "string" ? index : "";
  const cwd = tilde(await said(at, "pane_current_path"));
  if (cwd !== "") detail = detail === "" ? cwd : `${detail}  ${cwd}`;
  return { pane: at, kind: block, title, detail, status: await said(at, "@agent_status"), preview };
}

/** Every card the switcher shows, in order. */
export async function cards(settings: Settings, recent: number[]): Promise<Card[]> {
  const listed = ordered(await panes(settings), recent, settings.order === "recent");
  const made = await Promise.all(
    listed
      .slice(0, MAX_CARDS)
      .map(({ pane: at, block }, i) => card(at, block, settings.scope !== "tab", settings.preview && i < MAX_PREVIEWS)),
  );
  return made.filter((made): made is Card => made !== null);
}
