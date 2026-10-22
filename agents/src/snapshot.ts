// The snapshot: what the core agents plugin is handed in `{type: "refresh", snapshot}` — every
// space, tab and pane with the options that say what they are — rebuilt from the API.
//
// `server.getState` answers the whole model as `client.attach` sends it, and `read` maps it the way
// the app's own `read()` does (src/runtime/pumid/wire.rs), so the rows read the fields the Rust
// sidebar read: a pane's `title`, `@label`, `@agent`, `@agent_status`, `@program_status` and
// `pane_current_path`; a tab's name, index and layout; a session's name and tabs.
//
// What the app's snapshot carries and this cannot: the app's own leaves (`tab.leaves`, the doc tabs
// and browsers it draws itself — a package cannot see them, and never gets a doc tab), a window's
// focus as opposed to the server's current one, and sessions on other servers (`server.list` +
// `server.call` reach those, unimplemented here).
import { server } from "pumi";

/** One program's report of what it is doing, as OSC 7501 carries it (`@program_status`). */
export interface Program {
  id: string;
  state: string;
  kind?: string;
  app?: string;
  title?: string;
  msg?: string;
}

/** A pane: `%3`, and what it is. */
export interface Pane {
  /** `%3`. */
  id: number;
  /** `@2` it is tiled in, or `null` for a float, a slot or a detached pane. */
  tab: number | null;
  /** `$1` its tab is in. */
  space: number | null;
  /** Its type: `terminal`, a browser, or a view a package draws. */
  kind: string;
  /** Its `title` option, as the program wrote it. */
  title: string;
  /** The same without the program's decoration (a shell's prompt mark, a spinner). */
  stripped: string;
  /** Its `pane_current_path`. */
  cwd: string;
  /** `@label`: what the user named it. */
  label: string;
  /** `@agent`: the agent's own name for itself (`pi`, `claude`, …). */
  agent: string;
  /** `@agent_status`: one word, the most urgent of its programs'. */
  status: string;
  /** `@program_status`: what each program in it said. */
  program: Program[];
  /** It is the pane in front. */
  focused: boolean;
}

/** A tab: `@2`. */
export interface Tab {
  id: number;
  space: number;
  index: number;
  label: string;
  /** Its panes, in the order its layout lays them out. */
  panes: Pane[];
  focused: boolean;
}

/** A space (a session): `$1`. */
export interface Space {
  id: number;
  label: string;
  /** The tab it shows. */
  current: number | null;
  focused: boolean;
  tabs: Tab[];
}

/** What is in front. */
export interface Focus {
  space: number | null;
  tab: number | null;
  pane: number | null;
}

export interface Snapshot {
  spaces: Space[];
  tabs: Tab[];
  panes: Pane[];
  focus: Focus;
}

export const EMPTY: Snapshot = { spaces: [], tabs: [], panes: [], focus: { space: null, tab: null, pane: null } };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * `title` without the decoration a program puts round it — a leading prompt mark, an emoji, the
 * spinner a shell turns — as the app strips it (src/runtime/pumid/wire.rs `strip_title`).
 */
export function strip(title: string): string {
  let at = 0;
  for (const c of title) {
    const kept = /[\p{L}\p{N}]/u.test(c) || /[!-/:-@[-`{-~]/.test(c);
    if (kept) break;
    at += c.length;
  }
  return title.slice(at).trim();
}

/** The panes of a tab's layout, in the order it lays them out: `["leaf", 3]`, `["row", [...]]`. */
export function leaves(layout: unknown): number[] {
  const node = array(layout);
  switch (node[0]) {
    case "leaf": {
      const id = num(node[1]);
      return id === null ? [] : [id];
    }
    case "row":
    case "col":
      return array(node[1]).flatMap(leaves);
    default:
      return [];
  }
}

/** The programs a pane reports: `@program_status` is an array of records, or nothing. */
export function programs(value: unknown): Program[] {
  return array(value).map((each) => {
    const record = obj(each);
    const out: Program = { id: str(record.id), state: str(record.state) };
    for (const key of ["kind", "app", "title", "msg"] as const) {
      const text = str(record[key]);
      if (text !== "") out[key] = text;
    }
    return out;
  });
}

/** The model as `server.getState` answers it, mapped to the snapshot. */
export function read(reply: unknown): Snapshot {
  const outer = obj(reply);
  const state = "state" in outer ? obj(outer.state) : outer;
  const current = obj(state.current);
  const focus: Focus = { space: num(current.session), tab: num(current.tab), pane: num(current.pane) };

  // Which session lists which tabs, and where: the first session that has one, as the app reads it.
  const where = new Map<number, { space: number; index: number }>();
  const owned = new Map<number, { index: number; tab: number }[]>();
  for (const each of array(state.sessions)) {
    const session = obj(each);
    const id = num(session.id);
    if (id === null) continue;
    const pairs = array(session.tabs).map((pair) => {
      const listed = array(pair);
      return { index: num(listed[0]) ?? 0, tab: num(listed[1]) ?? 0 };
    });
    owned.set(id, pairs);
    for (const pair of pairs) if (!where.has(pair.tab)) where.set(pair.tab, { space: id, index: pair.index });
  }

  const tabs = new Map<number, Record<string, unknown>>();
  for (const each of array(state.tabs)) {
    const tab = obj(each);
    const id = num(tab.id);
    if (id !== null) tabs.set(id, tab);
  }

  const panes: Pane[] = [];
  const inTab = new Map<number, Pane[]>();
  for (const each of array(state.panes)) {
    const raw = obj(each);
    const id = num(raw.id);
    if (id === null) continue;
    const place = obj(raw.place);
    const tab = place.kind === "tiled" ? num(place.tab) : null;
    const options = obj(raw.options);
    const title = str(options.title);
    const pane: Pane = {
      id,
      tab,
      space: tab === null ? null : (where.get(tab)?.space ?? null),
      kind: str(raw.type) || "terminal",
      title,
      stripped: strip(title),
      cwd: str(options.pane_current_path),
      label: str(options["@label"]),
      agent: str(options["@agent"]),
      status: str(options["@agent_status"]),
      program: programs(options["@program_status"]),
      focused: id === focus.pane,
    };
    panes.push(pane);
    if (tab !== null) inTab.set(tab, [...(inTab.get(tab) ?? []), pane]);
  }

  // A tab's panes as its layout says, then any it keeps but does not lay out.
  for (const [tab, list] of inTab) {
    const order = leaves(tabs.get(tab)?.layout);
    const rank = (pane: Pane) => {
      const at = order.indexOf(pane.id);
      return at === -1 ? order.length : at;
    };
    list.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  }

  const ordered: Tab[] = [];
  for (const [space, pairs] of owned) {
    for (const pair of pairs) {
      ordered.push({
        id: pair.tab,
        space,
        index: pair.index,
        label: str(tabs.get(pair.tab)?.name),
        panes: inTab.get(pair.tab) ?? [],
        focused: pair.tab === focus.tab && space === focus.space,
      });
    }
  }
  ordered.sort((a, b) => a.space - b.space || a.index - b.index);

  const spaces: Space[] = [];
  for (const each of array(state.sessions)) {
    const session = obj(each);
    const id = num(session.id);
    if (id === null) continue;
    spaces.push({
      id,
      label: str(session.name),
      current: num(session.current),
      focused: id === focus.space,
      tabs: ordered.filter((tab) => tab.space === id),
    });
  }
  spaces.sort((a, b) => a.id - b.id);

  return { spaces, tabs: ordered, panes, focus };
}

/** Read the model, and map it. */
export async function readState(): Promise<Snapshot> {
  return read(await server.getState());
}
