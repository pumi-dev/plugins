// The plan: a session is a pod on the carpet with its name on it, and a desk for each of its tabs
// — or, with "A desk for every pane" on, for each of their panes, wrapped into another column when
// there are more than a pod takes. Pods go next to each other, onto the next row when the floor
// runs out, and the rows in the middle of the room.
import type { AppPane, AppSpace, AppState, AppTab } from "pumi";

/** A desk's place on the carpet. */
export const CELL_W = 176;
export const CELL_H = 156;
/** A pod's carpet around its desks, and its name above them. */
export const CARPET = 22;
export const LABEL_H = 34;
/** The floor's own margin, left and right. */
export const MARGIN = 24;
/** The wall along the top, the bar along the bottom. */
export const WALL = 56;
export const HUD = 56;
/** Between two pods. */
export const POD_GAP = 18;

export interface Pt {
  x: number;
  y: number;
}
/** A desk's place: its pod's, and its own in it. */
export type Cell = Pt;
/** A desk's seat: the tab it holds, and — a desk of its own — the pane. */
export interface Seat {
  tab: AppTab;
  pane?: AppPane;
  /** The pane's place in its tab (1-based); 1 for a tab's own desk. */
  i: number;
}
/** A session: its carpet, its name, and the places its desks stand in. */
export interface Pod {
  space: AppSpace;
  cols: number;
  down: number;
  seats: Seat[];
  w: number;
  h: number;
  /** `cells[i]` is seat `i + 1`'s place, relative to the pod; the last one is the free desk's. */
  cells: Cell[];
  x: number;
  y: number;
}
export interface Plan {
  w: number;
  h: number;
  /** The whole floor: the room, and the plants below it. */
  floor_h: number;
  pods: Pod[];
  /** Where the last pod ends. */
  bottom: number;
  centre: Pt;
}

/** A desk for every pane of a split tab, instead of one desk holding the whole tab. */
export const perPane = (app: AppState): boolean => app.settings?.desk_per_pane === true;

/** A tab's desks: the tab itself, or — with "A desk for every pane" on — one for each of its panes. */
export function desksOf(tab: AppTab, per: boolean): Seat[] {
  const out: Seat[] = [];
  if (per) {
    tab.panes.forEach((pane, n) => {
      if (!pane.hidden) out.push({ tab, pane, i: n + 1 });
    });
  }
  if (out.length === 0) out.push({ tab, i: 1 });
  return out;
}

export function plan(app: AppState): Plan {
  const w = app.window.width;
  const h = app.window.height - HUD;
  const per = perPane(app);
  const pods: Pod[] = [];
  for (const space of app.spaces) {
    const seats: Seat[] = [];
    for (const tab of space.tab_list ?? []) for (const seat of desksOf(tab, per)) seats.push(seat);
    // Its desks, and always a free one.
    const n = Math.max(seats.length + 1, 1);
    const down = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n / 1.4))));
    const cols = Math.ceil(n / down);
    const pod: Pod = {
      space,
      cols,
      down,
      seats,
      w: cols * CELL_W + 2 * CARPET,
      h: LABEL_H + Math.min(n, down) * CELL_H + CARPET,
      cells: [],
      x: 0,
      y: 0,
    };
    for (let i = 1; i <= n; i++) {
      const c = Math.floor((i - 1) / down);
      const r = (i - 1) % down;
      pod.cells.push({ x: CARPET + c * CELL_W, y: LABEL_H + r * CELL_H });
    }
    pods.push(pod);
  }
  // Pods next to each other, onto the next row when the floor runs out.
  const rows: { pods: Pod[]; w: number; h: number }[] = [];
  let row = { pods: [] as Pod[], w: 0, h: 0 };
  for (const pod of pods) {
    let extra = pod.w + (row.pods.length > 0 ? POD_GAP : 0);
    if (row.w + extra > w - 2 * MARGIN && row.pods.length > 0) {
      rows.push(row);
      row = { pods: [], w: 0, h: 0 };
      extra = pod.w;
    }
    row.w += extra;
    row.h = Math.max(row.h, pod.h);
    row.pods.push(pod);
  }
  if (row.pods.length > 0) rows.push(row);
  // Each row in the middle of the floor, and the rows in the middle of the room.
  let tall = 0;
  for (const r of rows) tall += r.h;
  tall += Math.max(0, rows.length - 1) * POD_GAP;
  let y = WALL + Math.max(34, Math.floor((h - WALL - tall) / 2));
  for (const r of rows) {
    let x = Math.floor((w - r.w) / 2);
    for (const pod of r.pods) {
      pod.x = x;
      pod.y = y;
      for (const cell of pod.cells) {
        cell.x += pod.x;
        cell.y += pod.y;
      }
      x += pod.w + POD_GAP;
    }
    y += r.h + POD_GAP;
  }
  let bottom = WALL;
  for (const pod of pods) bottom = Math.max(bottom, pod.y + pod.h);
  const floor_h = Math.max(h, bottom + 150);
  return { w, h, floor_h, pods, bottom, centre: { x: Math.floor(w / 2) - 12, y: Math.floor((WALL + bottom) / 2) } };
}

/** Where you stand at a desk: beside its chair. */
export const spot = (cell: Cell): Pt => ({ x: cell.x + 122, y: cell.y + 70 });
