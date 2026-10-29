// The model the map is made from: every session, its views, their panes and each pane's tabs, with
// the options that say what a tab is — numeric ids, one record each.
//
// It is built from `read`: the worker reads the API (`session.list`, then `session.get` with
// `deep`, which carries a session's whole tree in one call), so a row reads the same whichever
// half made the model, and the map can be tested with no pumi running.
//
// What the server's own read does not have: the sessions of other servers (`server.list` +
// `server.call` reach those, unimplemented here).
import { AGENT, STATUS } from "../names.ts";
import { num } from "./ids.ts";

/** One program's report of what it is doing, as OSC 7501 carries it (`@program_status`). */
export interface Program {
  id: string;
  state: string;
  kind?: string;
  app?: string;
  title?: string;
  msg?: string;
}

/** A tab (`%3`): the thing pumi shows, in a pane or floating over a view. */
export interface Tab {
  /** `%3`. */
  id: number;
  /** `$1` its session is in. */
  session: number;
  /** `@2` its view. */
  view: number;
  /** `:4` its pane, or `null` for a float or a hidden tab. */
  pane: number | null;
  /** Its place in its pane's strip, from 0. */
  index: number;
  /** Its block: `terminal`, `file`, or a plugin's (`owner.name.page`). */
  block: string;
  /** Its title, as the program wrote it. */
  title: string;
  /** The same without the program's decoration (a shell's prompt mark, a spinner). */
  stripped: string;
  /** Its directory. */
  cwd: string;
  /** The agent's id, as the trait names it (`pi`, `claude`, …). */
  agent: string;
  /** `@status`: one word, the most urgent of its programs'. */
  status: string;
  /** `@program_status`: what each program in it said. */
  program: Program[];
  /** It has the focus: the front tab of its view's active pane. */
  focused: boolean;
}

/** A pane (`:4`): an area of a view's layout, holding tabs with one in front. */
export interface Pane {
  /** `:4`. */
  id: number;
  /** `$1` its view's session. */
  session: number;
  /** `@2` its view. */
  view: number;
  /** Its place in its view's layout, from 0, as the layout lays it out. */
  index: number;
  /** Its tabs, in its strip's order. */
  tabs: Tab[];
  /** It has its view's focus. */
  focused: boolean;
  /** It fills its view. */
  zoomed: boolean;
}

/** A view (`@2`): a layout of panes, each holding tabs. */
export interface View {
  /** `@2`. */
  id: number;
  /** `$1` its session. */
  session: number;
  /** Its place in its session, from 0, as the server counts it. */
  index: number;
  /** The name it was given, or `""` while it takes its active tab's title. */
  name: string;
  /** Its panes, in layout order. */
  panes: Pane[];
  /** The tabs that float over it, or are hidden: in no pane. */
  floating: Tab[];
  /** It is its session's active view. */
  focused: boolean;
}

/** A session (`$1`): its views, and how pumi names it. */
export interface Session {
  /** `$1`. */
  id: number;
  /** Its name, or `""` when it has none. */
  label: string;
  /** It is the session in front. */
  focused: boolean;
  /** Its views, in index order. */
  views: View[];
}

export interface Snapshot {
  sessions: Session[];
  views: View[];
  panes: Pane[];
  tabs: Tab[];
}

/** A tab as `session.get` with `deep` carries it. */
export interface GivenTab {
  id: string;
  /** `$1` its session, `@2` its view: what the tab itself says, which the view it is under repeats. */
  session?: string;
  view?: string | null;
  block?: string;
  title?: string | null;
  cwd?: string | null;
  /** Where it is: tiled in a pane, floating over a view, hidden. */
  place?: { kind?: string; pane?: string | null; view?: string | null } | null;
  /** The trait, `@status`, `@program_status`, … */
  options?: Record<string, unknown> | null;
  isFocused?: boolean;
}

/** A view as `session.get` with `deep` carries it: its layout, and every tab in it. */
export interface GivenView {
  id: string;
  /** `$1` its session, as the view says it. */
  session?: string;
  name?: string | null;
  index?: number;
  /** Its panes as they split: `{pane, tabs}`, or `{axis, ratio, first, second}`. */
  layout?: unknown;
  tabs?: GivenTab[] | null;
  activeTab?: string | null;
  activePane?: string | null;
  zoom?: string | null;
}

/** A session as `session.get` with `deep` carries it. */
export interface GivenSession {
  id: string;
  name?: string | null;
  views?: string[] | null;
  activeView?: string | null;
  /** With `deep`: every view, each with its tabs. */
  tree?: GivenView[] | null;
}

/** A pane of a layout, as the layout names it: its id, and the strip it holds. */
export interface GivenPane {
  pane: number;
  tabs: number[];
}

export const EMPTY: Snapshot = { sessions: [], views: [], panes: [], tabs: [] };

const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * `title` without the decoration a program puts round it — a leading prompt mark, an emoji, the
 * spinner a shell turns — as the app strips it (`strip_title` in the host's title handling).
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

/** The programs a tab reports: `@program_status` is an array of records, or nothing. */
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

/**
 * The panes a view's layout lays out, in its order: a leaf names a pane, a node splits into `first`
 * and `second` (`row` left to right, a `column` top to bottom).
 */
export function panesIn(layout: unknown, out: GivenPane[] = []): GivenPane[] {
  const node = obj(layout);
  if (typeof node.pane === "string") {
    out.push({ pane: num(node.pane), tabs: array(node.tabs).map((id) => num(str(id))) });
    return out;
  }
  if (node.first !== undefined) panesIn(node.first, out);
  if (node.second !== undefined) panesIn(node.second, out);
  return out;
}

/** One tab, as the map reads it. */
function tabOf(given: GivenTab, session: number, view: number, pane: number | null, index: number): Tab {
  const said = obj(given.options);
  const title = str(given.title);
  return {
    id: num(given.id),
    session,
    view,
    pane,
    index,
    block: str(given.block),
    title,
    stripped: strip(title),
    cwd: str(given.cwd),
    // The plugin's trait and pumi-host's `@status`; a tab from before, the core's own names.
    agent: str(said[AGENT]) || str(said["@agent"]),
    status: str(said[STATUS]) || str(said["@agent.status"]),
    program: programs(said["@program_status"]),
    focused: given.isFocused === true,
  };
}

/** Every session, view, pane and tab, as the map reads them: one nesting, and what each tab says. */
export function read(given: GivenSession[], here: number | null): Snapshot {
  const sessions: Session[] = [];
  const views: View[] = [];
  const panes: Pane[] = [];
  const tabs: Tab[] = [];

  for (const each of given) {
    const session = num(each.id);
    const activeView = str(each.activeView) === "" ? null : num(str(each.activeView));
    const madeViews: View[] = [];

    array(each.tree).forEach((raw, at) => {
      const givenView = raw as GivenView;
      const view = num(givenView.id);
      const givenTabs = array(givenView.tabs) as GivenTab[];
      const leaves = panesIn(givenView.layout);

      // Each tab's home: the pane its place names, when the layout has one; else it floats.
      const homes = new Map<number, GivenTab[]>();
      const floating: GivenTab[] = [];
      for (const tab of givenTabs) {
        const named = str(obj(tab.place).pane);
        const pane = named === "" ? null : num(named);
        if (pane !== null && (leaves.length === 0 || leaves.some((leaf) => leaf.pane === pane))) {
          homes.set(pane, [...(homes.get(pane) ?? []), tab]);
        } else {
          floating.push(tab);
        }
      }

      const strips = new Map(leaves.map((leaf) => [leaf.pane, leaf.tabs]));
      const ids = [...new Set([...leaves.map((leaf) => leaf.pane), ...homes.keys()])];
      const madePanes: Pane[] = ids.map((id, index) => {
        const held = homes.get(id) ?? [];
        const strip = strips.get(id) ?? [];
        // The strip's order, and then any tab it did not name.
        const ordered = [
          ...strip.map((one) => held.find((tab) => num(tab.id) === one)).filter((tab): tab is GivenTab => tab !== undefined),
          ...held.filter((tab) => !strip.includes(num(tab.id))),
        ];
        const made = ordered.map((tab, at) => tabOf(tab, session, view, id, at));
        tabs.push(...made);
        return {
          id,
          session,
          view,
          index,
          tabs: made,
          focused: str(givenView.activePane) !== "" && num(str(givenView.activePane)) === id,
          zoomed: str(givenView.zoom) !== "" && num(str(givenView.zoom)) === id,
        };
      });
      const madeFloating = floating.map((tab, at) => tabOf(tab, session, view, null, at));
      tabs.push(...madeFloating);

      const made: View = {
        id: view,
        session,
        index: typeof givenView.index === "number" ? givenView.index : at,
        name: str(givenView.name),
        panes: madePanes,
        floating: madeFloating,
        focused: activeView === view,
      };
      panes.push(...madePanes);
      views.push(made);
      madeViews.push(made);
    });

    sessions.push({ id: session, label: str(each.name), focused: here === session, views: madeViews });
  }

  return { sessions, views, panes, tabs };
}
