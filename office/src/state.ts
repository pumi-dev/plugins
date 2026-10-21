// What the office keeps while it draws a window: where you stand, what is open, which desk is
// being dragged — and, across runs, where each desk was moved to and where you stood.
import { app, storage, type AppSpace, type AppTab, type ThemeContext } from "pumi";
import type { MenuState } from "./parts.ts";
import { spot, type Cell, type Pt } from "./plan.ts";

/** How long a walk takes: the CSS `#you` transition, and the timer that ends it. */
export const WALK_MS = 650;
/** The storage key what the office keeps across runs is at. */
export const KEPT = "office";

/** What the office keeps across runs: where you were standing, and where each desk was moved to. */
export interface Kept {
  you?: Pt | null;
  desks?: Record<string, Pt>;
}

export interface OfficeState extends MenuState {
  /** Where you stand, in the floor's pixels; the plan's centre until you walk. */
  you: Pt | null;
  /** You are walking there: the sprite bounces, and the timer ends it. */
  walking: boolean;
  /** The tab you sat at, by id; `null` standing up. */
  sitting: number | null;
  /** The bookshelf is open. */
  shelf: boolean;
  /** The bookshelf's page (an `app.pages` id), or the first. */
  page: string | null;
  /** The desk whose screen is open, by key. */
  peek: string | null;
  /** The desk being dragged, by key. */
  dragging: string | null;
  /** How far the pointer moved since it was pressed on a desk: a drag, not a click. */
  moved: number;
  /** What the rename field holds. */
  typed: string | null;
  /** Where a desk was moved to, by key; its place in the rows without one. */
  desks: Record<string, Pt>;
  /** A divider's ratio while it is dragged, by its path. */
  ratios: Record<string, number>;
  /** The walk's timer, and the walk it belongs to (an older one's callback does nothing). */
  walk: ReturnType<typeof setTimeout> | null;
  walked: number;
}

export const fresh = (): OfficeState => ({
  menuHl: null,
  menuFor: "",
  you: null,
  walking: false,
  sitting: null,
  shelf: false,
  page: null,
  peek: null,
  dragging: null,
  moved: 0,
  typed: null,
  desks: {},
  ratios: {},
  walk: null,
  walked: 0,
});

/** What the office kept last run, read: where you stood and where each desk was moved to. */
export async function restore(cx: ThemeContext<OfficeState>): Promise<void> {
  const kept = await storage.get<Kept>(KEPT);
  const st = cx.state;
  st.desks = kept?.desks ?? {};
  if (kept?.you) st.you = kept.you;
  cx.notify();
}

/** What it keeps for next run: the desks that were moved, and where you stand. */
export function keep(st: OfficeState): void {
  void storage.set(KEPT, { you: st.you, desks: st.desks } satisfies Kept);
}

/** Ends a walk under way, as the window (or the theme, closing) does. */
export function stand(st: OfficeState): void {
  if (st.walk) clearTimeout(st.walk);
  st.walk = null;
  st.walking = false;
}

/** You walk to `to`: the sprite moves by its CSS transition, and a timer ends the walk (runs
 * `after`, where sitting down happens) — the only timer the office needs, since everything else it
 * draws the app pushes to it as patches. */
export function walkTo(cx: ThemeContext<OfficeState>, to: Pt, after?: () => void): void {
  const st = cx.state;
  st.you = to;
  st.walking = true;
  keep(st);
  const walk = ++st.walked;
  if (st.walk) clearTimeout(st.walk);
  st.walk = setTimeout(() => {
    if (st.walked !== walk) return;
    st.walking = false;
    st.walk = null;
    after?.();
    cx.notify();
  }, WALK_MS);
}

/** Go to a desk: its session, its tab, and — once you are there — sit at its monitor. */
export function sitAt(cx: ThemeContext<OfficeState>, tab: AppTab, space: AppSpace, cell: Cell, pane?: string): void {
  app.selectSpace(space.id);
  app.selectTab(tab.id);
  if (pane !== undefined) app.focusPane(pane);
  const st = cx.state;
  const to = spot(cell);
  if (st.you !== null && st.you.x === to.x && st.you.y === to.y && !st.walking) {
    st.sitting = tab.id;
  } else {
    st.sitting = null;
    walkTo(cx, to, () => {
      st.sitting = tab.id;
    });
  }
}

/** Where a desk is: where it was moved to, else its place in the rows. */
export const deskAt = (st: OfficeState, key: string, cell: Cell): Cell => st.desks[key] ?? cell;
