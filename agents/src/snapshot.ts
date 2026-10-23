// The snapshot the rows read: every space, tab and pane with the options that say what they are,
// as `tree.ts` and `status.ts` expect it — numeric ids, and one record per space, tab and pane.
//
// Both halves build it from `read`: the window from the app's own state (`adapt.ts`), and the
// worker from the API (`main.ts`'s `readState`: `session.get`, `tab.get`, `pane.list` and each
// pane's options under it), so a row reads the same whichever half made the model.
//
// What the app's window has and the server's own read does not: a window's focus as opposed to
// the server's current one, and the sessions of other servers (`server.list` + `server.call` reach
// those, unimplemented here).

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
  /** The block it holds: `terminal`, or a package's (`owner.name.id`). */
  block: string;
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
  /** Its place in its session, from 0, as the server counts it (`tab.index` in the window is 1). */
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

/** A pane before the model is built: where it is, and what its options say. */
export interface PaneGiven {
  id: number;
  block: string;
  /** The tab it is tiled in, or `null` for a float, a slot or a detached pane. */
  tab: number | null;
  /** The session its tab is in. */
  space: number | null;
  /** Its `title` option. */
  title: string;
  /** Its `pane_current_path`. */
  cwd: string;
  /** Its `@label`. */
  label: string;
  /** Its options: `@agent`, `@agent_status`, `@program_status`, … */
  options: Record<string, unknown>;
  focused: boolean;
}

/** A tab before the model is built. */
export interface TabGiven {
  id: number;
  space: number;
  index: number;
  label: string;
  focused: boolean;
}

/** A space before the model is built. */
export interface SpaceGiven {
  id: number;
  label: string;
  current: number | null;
  focused: boolean;
}

/** What both halves know before the model is built: the window's state, or the server's. */
export interface Given {
  spaces: SpaceGiven[];
  tabs: TabGiven[];
  /** Every pane, in the order its tab lays it out. */
  panes: PaneGiven[];
}

export const EMPTY: Snapshot = { spaces: [], tabs: [], panes: [], focus: { space: null, tab: null, pane: null } };

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

/** The panes, tabs and spaces as the rows read them: one nesting, and what each pane says. */
export function read(given: Given): Snapshot {
  const inTab = new Map<number, Pane[]>();
  const panes: Pane[] = given.panes.map((each) => {
    const said = obj(each.options);
    const made: Pane = {
      id: each.id,
      tab: each.tab,
      space: each.space,
      block: each.block,
      title: each.title,
      stripped: strip(each.title),
      cwd: each.cwd,
      label: each.label,
      agent: str(said["@agent"]),
      status: str(said["@agent_status"]),
      program: programs(said["@program_status"]),
      focused: each.focused,
    };
    if (each.tab !== null) inTab.set(each.tab, [...(inTab.get(each.tab) ?? []), made]);
    return made;
  });

  const tabs: Tab[] = given.tabs
    .map((each) => ({
      id: each.id,
      space: each.space,
      index: each.index,
      label: each.label,
      panes: inTab.get(each.id) ?? [],
      focused: each.focused,
    }))
    .sort((a, b) => a.space - b.space || a.index - b.index);

  const spaces: Space[] = given.spaces
    .map((each) => ({
      id: each.id,
      label: each.label,
      current: each.current,
      focused: each.focused,
      tabs: tabs.filter((tab) => tab.space === each.id),
    }))
    .sort((a, b) => a.id - b.id);

  const focus: Focus = {
    space: given.spaces.find((each) => each.focused)?.id ?? null,
    tab: given.tabs.find((each) => each.focused)?.id ?? null,
    pane: given.panes.find((each) => each.focused)?.id ?? null,
  };

  return { spaces, tabs, panes, focus };
}
