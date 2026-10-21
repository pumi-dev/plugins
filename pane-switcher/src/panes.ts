// The cards the switcher shows: which panes its scope and order ask for, and what each pane says of
// itself — its type (which picks the card's icon), its title or the program in it, its `tab.pane`
// number and directory, its agent's state, and whether its screen is drawn.
import { format, option, pane, pkg, session, tab } from "pumi";

import type { Settings } from "./settings.ts";

/** How many cards are worth drawing, and how many are worth a screen: a switcher with more panes
 * than this is a picker's job. */
export const MAX_CARDS = 40;
export const MAX_PREVIEWS = 20;

/** One pane, as a card shows it. */
export interface Card {
  /** The pane it is. */
  pane: number;
  /** Its type (`terminal`, `browser`, …). */
  kind: string;
  /** Its title, or what it runs, or its type. */
  title: string;
  /** Its `tab.pane` number and its directory, or its page. */
  detail: string;
  /** An agent's state, when one reported its pane (`@agent_status`). */
  status: string;
  /** Whether the card draws its pane's screen. */
  preview: boolean;
}

/** A pane's option `name` as text; empty when it is unset. */
async function said(at: number, name: string): Promise<string> {
  const value = await option.get(name, { pane: at });
  return typeof value === "string" ? value : "";
}

/** `/Users/me/x` as `~/x`, for a card's detail line. */
export function tilde(path: string): string {
  const home = process.env.HOME ?? "";
  return home !== "" && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** The icon a pane type's card is drawn with. */
export function kindIcon(kind: string): string {
  if (kind === "terminal") return "terminal";
  if (kind === "browser") return "globe";
  if (kind === "editor" || kind === "files") return "code";
  if (kind === "agents" || kind.endsWith(".agents")) return "sparkle";
  return "blocks";
}

/** `cards` in the order to show them: the most recent first when `byRecent`, and the rest as they
 * came (a tab's layout order). Sorting is stable, so a pane nobody has visited keeps its place. */
export function ordered<T extends { pane: number }>(cards: T[], recent: number[], byRecent: boolean): T[] {
  if (!byRecent) return [...cards];
  const rank = (at: number) => {
    const seen = recent.indexOf(at);
    return seen < 0 ? Number.MAX_SAFE_INTEGER : seen;
  };
  return [...cards].sort((a, b) => rank(a.pane) - rank(b.pane));
}

/** The tabs the scope asks for. */
async function tabs(settings: Settings): Promise<number[]> {
  if (settings.scope === "tab") return [(await tab.current()).id];
  if (settings.scope === "all") {
    const found: number[] = [];
    for (const one of await session.list()) for (const each of await one.tabs()) found.push(each.id);
    return found;
  }
  return (await (await session.current()).tabs()).map((each) => each.id);
}

/** The panes the settings ask for: laid out in a tab or floating over it, never its chrome (a slot)
 * or a detached pane, and never one of ours. */
async function panes(settings: Settings): Promise<number[]> {
  const found: number[] = [];
  const own = pkg.prefixed("switcher");
  for (const at of await tabs(settings)) {
    for (const each of await pane.list({ tab: at })) {
      const place = await each.getPlace();
      if (place.kind !== "tiled" && place.kind !== "float") continue;
      if ((await said(each.id, "pane_type")) === own) continue;
      found.push(each.id);
    }
  }
  return found;
}

/** A pane's card, or `null` when it cannot be shown (a pane closed between the listing and now). */
async function card(at: number, numbered: boolean, preview: boolean): Promise<Card | null> {
  const kind = await said(at, "pane_type");
  const title = [await said(at, "title"), await said(at, "pane_current_command"), kind].find((text) => text !== "");
  if (title === undefined) return null;
  // Where it is: its number in the tab, when the switcher shows more than that tab.
  let detail = numbered ? await format.eval("#{window_index}.#{pane_index}", { pane: at }).catch(() => "") : "";
  const cwd = tilde(await said(at, "pane_current_path"));
  if (cwd !== "") detail = detail === "" ? cwd : `${detail}  ${cwd}`;
  return { pane: at, kind, title, detail, status: await said(at, "@agent_status"), preview };
}

/** Every card the switcher shows, in order. */
export async function cards(settings: Settings, recent: number[]): Promise<Card[]> {
  const listed = ordered((await panes(settings)).map((at) => ({ pane: at })), recent, settings.order === "recent");
  const made = await Promise.all(
    listed
      .slice(0, MAX_CARDS)
      .map(({ pane: at }, i) => card(at, settings.scope !== "tab", settings.preview && i < MAX_PREVIEWS)),
  );
  return made.filter((made): made is Card => made !== null);
}
