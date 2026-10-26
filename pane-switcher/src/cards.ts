// The cards the switcher shows: what one card is made of, and the order the cards go in. What a
// card says of its pane is read from the app (`panes.ts`); the shape of a card and how the cards
// are ranked is here, where it is read without the app.
import type { PaneId } from "pumi";

/** How many cards are worth drawing, and how many are worth a screen: a switcher with more panes
 * than this is a picker's job. */
export const MAX_CARDS = 40;
export const MAX_PREVIEWS = 20;

/** One pane, as a card shows it. */
export interface Card {
  /** The pane it is. */
  pane: PaneId;
  /** Its block (`terminal`, `amresyd.browser.page`, …). */
  kind: string;
  /** Its title, or what it runs, or its block. */
  title: string;
  /** Its `tab.pane` number and its directory, or its page. */
  detail: string;
  /** An agent's state, when one reported its pane (`@agent.status`). */
  status: string;
  /** Whether the card draws its pane's screen. */
  preview: boolean;
}

/** `/Users/me/x` as `~/x`, for a card's detail line. */
export function tilde(path: string): string {
  const home = process.env.HOME ?? "";
  return home !== "" && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** The icon a pane's block is drawn with. */
export function kindIcon(kind: string): string {
  if (kind === "terminal") return "terminal";
  if (kind === "browser") return "tool_web";
  if (kind === "editor" || kind === "files") return "code";
  if (kind === "agents" || kind.endsWith(".agents")) return "sparkle";
  return "blocks";
}

/** `cards` in the order to show them: the most recent first when `byRecent`, and the rest as they
 * came (a tab's layout order). Sorting is stable, so a pane nobody has visited keeps its place. */
export function ordered<T extends { pane: PaneId }>(cards: T[], recent: PaneId[], byRecent: boolean): T[] {
  if (!byRecent) return [...cards];
  const rank = (at: PaneId) => {
    const seen = recent.indexOf(at);
    return seen < 0 ? Number.MAX_SAFE_INTEGER : seen;
  };
  return [...cards].sort((a, b) => rank(a.pane) - rank(b.pane));
}
