// The list's rows, built the way the core sidebar builds its lines (core/agents/src/sidebar.rs
// `build_tree` and `attention`): a space (a session), its tabs, and the panes in them — a tab
// folded to one row when it holds one pane or one agent — and the attention section on top for the
// panes that want you. Nothing is drawn here: `sidebar.ts` turns a row into an element.
import type { Pane, Snapshot, Space, Tab } from "./snapshot.ts";
import { badge, isAgent, program, reason, state, urgency, waiting, type State } from "./status.ts";

/** What the list is folded and filtered by. It lives as long as the page does. */
export interface Shape {
  /** What the search field holds. */
  query: string;
  /** The spaces folded shut, by id. */
  spaces: Set<number>;
  /** The tabs folded shut, by id. */
  tabs: Set<number>;
  /** The attention section folded shut. */
  attention: boolean;
}

export const OPEN: Shape = { query: "", spaces: new Set(), tabs: new Set(), attention: false };

/** A pane in the list: an agent, or a plain terminal. */
export interface Entry {
  pane: Pane;
  agent: boolean;
  depth: number;
}

export type Row =
  | { kind: "attention-header"; lead: State; count: number; folded: boolean }
  | { kind: "attention"; pane: Pane; state: State; said: string }
  | { kind: "space"; space: Space; folded: boolean; active: boolean }
  | {
      kind: "tab";
      tab: Tab;
      label: string;
      detail: string;
      icon: string;
      /** `space`: nothing below it (its only pane, or none); `open` and `closed`: its panes. */
      disclosure: "space" | "open" | "closed";
      single: Pane | null;
      /** What its panes are, for a tab drawn shut. */
      marks: State[];
    }
  | ({ kind: "pane" } & Entry)
  | { kind: "note"; text: string };

/** A space's name: its own, or its id as tmux writes it. */
export function spaceLabel(space: Space): string {
  const label = space.label.trim();
  return label === "" ? `$${space.id}` : label;
}

/** A tab's name, or its number: `Tab 2`, as the core says it. */
export function tabLabel(tab: Tab): string {
  const label = tab.label.trim();
  return label === "" ? `Tab ${tab.index + 1}` : label;
}

/** A pane's title: its label, its title without decoration, the agent's name, else its directory. */
export function title(pane: Pane): string {
  for (const candidate of [pane.label, pane.stripped, pane.title, pane.agent]) {
    if (candidate.trim() !== "") return candidate;
  }
  const cwd = pane.cwd.replace(/\/+$/, "");
  return cwd === "" ? "terminal" : cwd;
}

/** The last part of a directory: what a row can afford to show of one. */
export function folder(cwd: string): string {
  return cwd.split("/").filter((leaf) => leaf !== "").at(-1) ?? cwd;
}

/** A pane's detail line: its folder, when that is not already its title. */
export function detail(pane: Pane): string {
  const name = title(pane);
  const cwd = pane.cwd.replace(/\/+$/, "");
  if (cwd === "" || cwd === name) return "";
  const leaf = folder(cwd);
  return leaf === name ? "" : leaf;
}

/** Where a pane is: its space, and its tab when the space has more than one. */
export function place(snapshot: Snapshot, pane: Pane): string {
  const space = snapshot.spaces.find((each) => each.id === pane.space);
  if (!space) return "";
  const tab = space.tabs.find((each) => each.id === pane.tab);
  return tab && space.tabs.length > 1 ? `${spaceLabel(space)} › ${tabLabel(tab)}` : spaceLabel(space);
}

/** The icon a pane's row carries: its type's. */
export function icon(pane: Pane): string {
  switch (pane.kind) {
    case "browser":
    case "web":
      return "globe";
    case "document":
      return "code";
    case "terminal":
      return "terminal";
    default:
      return "dot";
  }
}

/** The most urgent of some panes' states: what a tab drawn shut says in one mark. */
function lead(panes: Pane[]): State {
  let best: State = "idle";
  for (const pane of panes) {
    const word = state(pane);
    if (urgency(word) > urgency(best)) best = word;
  }
  return best;
}

/** The attention section: what is blocked or failed, and why, on top of the list. */
function attentionRows(snapshot: Snapshot, shape: Shape): Row[] {
  const want = waiting(snapshot);
  if (want.length === 0) return [];
  const rows: Row[] = [{ kind: "attention-header", lead: want[0]!.state, count: want.length, folded: shape.attention }];
  if (shape.attention) return rows;
  for (const { pane, state: word } of want) {
    const said = program(pane);
    const parts = [reason(word, said), said?.msg ?? "", place(snapshot, pane)].filter((part) => part.trim() !== "");
    rows.push({ kind: "attention", pane, state: word, said: parts.join(" · ") });
  }
  return rows;
}

/**
 * Every row, in order: the attention section, then each space with its tabs and panes. With a
 * search, only what matches stays, the spaces the search emptied are left out, and nothing stays
 * folded — as the core does it.
 */
export function rows(snapshot: Snapshot, shape: Shape): Row[] {
  const query = shape.query.toLowerCase();
  const matches = (text: string) => query === "" || text.toLowerCase().includes(query);
  const searching = query !== "";

  const out: Row[] = [];
  if (!searching) out.push(...attentionRows(snapshot, shape));

  /** Which panes a tab has listed, so one that is in no tab is not listed twice. */
  const placed = new Set<number>();
  for (const space of snapshot.spaces) {
    const members: { tab: Tab; entries: Entry[]; total: number }[] = [];
    for (const tab of space.tabs) {
      const entries: Entry[] = tab.panes.map((pane) => ({ pane, agent: isAgent(pane), depth: 1 }));
      for (const entry of entries) placed.add(entry.pane.id);
      const total = entries.length;
      const named = matches(tabLabel(tab));
      const kept = named ? entries : entries.filter((entry) => matches(title(entry.pane)));
      if (searching && kept.length === 0 && !named) continue;
      members.push({ tab, entries: kept, total });
    }
    const loose: Entry[] = snapshot.panes
      .filter((pane) => pane.space === space.id && pane.tab === null)
      .map((pane) => ({ pane, agent: isAgent(pane), depth: 0 }))
      .filter((entry) => matches(title(entry.pane)));
    for (const entry of loose) placed.add(entry.pane.id);

    if (searching && members.length === 0 && loose.length === 0) continue;
    const folded = shape.spaces.has(space.id) && !searching;
    out.push({ kind: "space", space, folded, active: space.focused });
    if (folded) continue;
    if (members.length === 0 && loose.length === 0) out.push({ kind: "note", text: "No tabs yet" });

    // A space of one tab is that tab's panes, and a tab of one agent is that agent: neither name
    // is drawn, as the core draws them.
    const lone = space.tabs.length === 1;
    for (const { tab, entries, total } of members) {
      const single = total === 1 ? (entries[0] ?? null) : null;
      if (lone || (single && single.agent)) {
        for (const entry of entries) out.push({ kind: "pane", ...entry, depth: 0 });
        continue;
      }
      const shut = single === null && shape.tabs.has(tab.id) && !searching;
      out.push(tabRow(tab, entries, total, single, shut));
      if (single === null && !shut) for (const entry of entries) out.push({ kind: "pane", ...entry, depth: 1 });
    }
    for (const entry of loose) out.push({ kind: "pane", ...entry, depth: 0 });
  }

  // Panes no space lists: a pane whose tab closed under it. A float, a slot pane and a detached
  // pane are in no tab, and the core's list never had them.
  const orphans = snapshot.panes
    .filter((pane) => pane.space !== null && !placed.has(pane.id))
    .map((pane) => ({ pane, agent: isAgent(pane), depth: 0 }))
    .filter((entry) => matches(title(entry.pane)));
  for (const entry of orphans) out.push({ kind: "pane", ...entry, depth: 0 });

  if (out.length === 0) out.push({ kind: "note", text: searching ? "No agents match your search." : "No agents yet" });
  return out;
}

/** A tab's row: its name, and what it stands for or holds. */
function tabRow(tab: Tab, entries: Entry[], total: number, single: Entry | null, shut: boolean): Row {
  let mark = "square-dot";
  let said = "";
  if (single) {
    mark = icon(single.pane);
    const name = title(single.pane);
    said = name === tabLabel(tab) ? "" : name;
  } else if (shut) {
    mark = "split";
  } else if (total > 1) {
    mark = "split";
    said = `${total} panes`;
  }
  return {
    kind: "tab",
    tab,
    label: tabLabel(tab),
    detail: said,
    icon: mark,
    disclosure: total === 0 || single !== null ? "space" : shut ? "closed" : "open",
    single: single?.pane ?? null,
    marks: shut ? entries.map((entry) => badge(entry.pane)) : [],
  };
}
