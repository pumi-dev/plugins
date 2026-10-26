// The model behind the dashboard: every agent pane in this pumi, built from the panes, tabs and
// sessions both halves have — the window's own state, or what `pane.list` and `option.get` find on
// the server.
//
// An agent says what it is doing itself (OSC 7501, docs/v2/23 §6): the host keeps a pane's records
// as `@program_status` and the most demanding state among them as `@agent_status`. Who the agent is
// (`@agent`: `pi`, `claude`, …) and which conversation it is in (`@agent_session`) the agent's hook
// writes. Nothing here reads a screen or a process.

import {
  filterMatches,
  needsYou,
  parseStatus,
  rank,
  type Filter,
  type Status,
} from "./status.ts";

/** One agent pane: who, where, and what it is doing. */
export interface Agent {
  pane: string;
  session: string;
  sessionName: string;
  tab: string;
  tabName: string;
  /** `@agent`: the program's own name for itself (`pi`, `claude`, …), or the app that last
   * reported if it has none. */
  kind: string;
  status: Status;
  /** Why it wants the user: "needs permission", "has a question", … */
  why: string;
  /** What it last said, when it said more than its state. */
  message: string;
  /** `@agent_session`: the conversation it is in, when the agent's hook knows. */
  conversation: string;
  cwd: string;
  command: string;
  title: string;
  /** The pane the user is in: the model's current pane. */
  here: boolean;
}

/** A pane, a tab and a session, as both halves have them before the model is built: the window's
 * own, or what the server's `pane.list` finds. */
export interface PaneState {
  id: string;
  /** The tab it is tiled in; none for a float, a slot or a detached pane. */
  tab: string | null;
  /** The session its tab is in. */
  session: string | null;
  /** Its `title` option, as the program wrote it. */
  title: string;
  /** Its `pane_current_path`. */
  cwd: string;
  /** Its options: `@agent`, `@agent.status`, `@program_status`, `@agent.session`, … */
  options: Record<string, unknown>;
}

/** A tab: its session and its name. */
export interface TabState {
  id: string;
  session: string;
  name: string;
}

/** A session. */
export interface SpaceState {
  id: string;
  name: string;
}

/** Every pane, tab and session, and the pane in front. */
export interface State {
  spaces: SpaceState[];
  tabs: TabState[];
  panes: PaneState[];
  here: string | null;
}

/** The last segment of its directory: what a row can afford to show. */
export function folder(agent: Agent): string {
  return agent.cwd.split("/").findLast((leaf) => leaf !== "") ?? agent.cwd;
}

/** `~/Kitchen/pumi`, for a detail line. */
export function path(agent: Agent): string {
  return tilde(agent.cwd);
}

/** `main › tests`, the place it is in. */
export function place(agent: Agent): string {
  if (agent.sessionName === "") return agent.tabName;
  if (agent.tabName === "") return agent.sessionName;
  return `${agent.sessionName} › ${agent.tabName}`;
}

/** What a search looks through. */
export function haystack(agent: Agent): string {
  return [agent.kind, agent.sessionName, agent.tabName, agent.cwd, agent.title, agent.command, agent.conversation]
    .join(" ")
    .toLowerCase();
}

/** Whether `agent` passes a filter and a search query (case-insensitive, every word has to be in
 * its text). */
export function matches(agent: Agent, filter: Filter, query: string): boolean {
  if (!filterMatches(filter, agent.status)) return false;
  const text = haystack(agent);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "")
    .every((word) => text.includes(word));
}

/** Every agent, and which pane the user is in. */
export class Overview {
  constructor(
    /** In the order the table shows them: what wants the user first, then by session and tab. */
    readonly agents: Agent[] = [],
    readonly currentPane: string | null = null,
  ) {}

  /**
   * The panes, tabs and sessions, as the dashboard reads them: what each pane says of itself is in
   * its options, so nothing else is read here.
   */
  static fromState(state: State | undefined): Overview {
    if (!state) return new Overview([], null);
    /** A tab's place: its session, the session's name, and its own. */
    const places = new Map<string, { session: string; sessionName: string; tabName: string }>();
    const nameOf = new Map(state.spaces.map((each) => [each.id, each.name]));
    for (const tab of state.tabs) {
      places.set(tab.id, { session: tab.session, sessionName: nameOf.get(tab.session) ?? "", tabName: tab.name });
    }
    const agents: Agent[] = [];
    for (const pane of state.panes) {
      // Agents live in panes placed in a tab; floats, slots and detached panes are the chrome's and
      // other blocks' business.
      if (pane.tab === null) continue;
      const site = places.get(pane.tab);
      if (!site) continue;
      const options = pane.options;
      const option = (key: string) => str(options[key]).trim();
      const records = Array.isArray(options["@program_status"]) ? (options["@program_status"] as unknown[]) : undefined;
      const { status, why } = statusOf(option("@agent.status"), records);
      const agent = option("@agent");
      // A shell nobody has reported on is not an agent; a program that said what it is doing is one
      // even when it never named itself.
      if (agent === "" && (status === "idle" || status === "unknown")) continue;
      const record = worst(records);
      const message = record ? str(obj(record).msg) : "";
      const kind = agent !== "" ? agent : str(record ? obj(record).app : "") || option("pane_current_command");
      agents.push({
        pane: pane.id,
        session: site.session,
        sessionName: site.sessionName,
        tab: pane.tab,
        tabName: site.tabName,
        kind,
        status,
        why,
        message,
        conversation: option("@agent.session"),
        cwd: pane.cwd.trim() !== "" ? pane.cwd : option("pane_current_path"),
        command: option("pane_current_command"),
        title: stripTitle(pane.title),
        here: pane.id === state.here,
      });
    }
    agents.sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        compare(a.sessionName, b.sessionName) ||
        compare(a.session, b.session) ||
        compare(a.tabName, b.tabName) ||
        compare(a.pane, b.pane),
    );
    return new Overview(agents, state.here);
  }


  total(): number {
    return this.agents.length;
  }

  count(status: Status): number {
    return this.agents.filter((agent) => agent.status === status).length;
  }

  /** Blocked and failed: the agents that will not go on without the user. */
  needsYou(): number {
    return this.agents.filter((agent) => needsYou(agent.status)).length;
  }

  /** How many sessions the agents are spread over. */
  sessions(): number {
    return new Set(this.agents.map((agent) => agent.session)).size;
  }

  /** The agents a filter and a query let through, in table order. */
  visible(filter: Filter, query: string): Agent[] {
    return this.agents.filter((agent) => matches(agent, filter, query));
  }

  /** The sessions the agents are in, in table order, each with its agents. */
  groups(filter: Filter, query: string): { session: string; name: string; agents: Agent[] }[] {
    const groups: { session: string; name: string; agents: Agent[] }[] = [];
    for (const agent of this.visible(filter, query)) {
      const group = groups.find((each) => each.session === agent.session);
      if (group) group.agents.push(agent);
      else groups.push({ session: agent.session, name: agent.sessionName, agents: [agent] });
    }
    return groups;
  }
}

/** `@agent.status`, corrected by the records behind it: a host that predates `error` said `done`
 * for one, and the record still tells. `why` is what the protocol's `kind` says it waits for. */
export function statusOf(word: string, records: unknown[] | undefined): { status: Status; why: string } {
  const record = worst(records);
  const said = record ? str(obj(record).state) : undefined;
  let status: Status = parseStatus(word) ?? parseStatus(said) ?? "unknown";
  if (status === "done" && said === "error") status = "error";
  const kind = record !== null && str(obj(record).state) === status ? str(obj(record).kind) : "";
  const why =
    status === "blocked"
      ? kind === "permission"
        ? "needs permission"
        : kind === "question"
          ? "has a question"
          : kind === "auth"
            ? "needs a login"
            : "waiting on you"
      : status === "error"
        ? "failed"
        : "";
  return { status, why };
}

/** The record that wants the user most, the protocol's set: its root first, then the most urgent
 * state. */
function worst(records: unknown[] | undefined): Record<string, unknown> | null {
  if (!records || records.length === 0) return null;
  const key = (record: unknown): [number, boolean] => {
    const status = parseStatus(str(obj(record).state));
    return [status === null ? 0 : 9 - rank(status), str(obj(record).id) === ""];
  };
  let best: unknown = records[0]!;
  let bestKey = key(best);
  for (const each of records.slice(1)) {
    const at = key(each);
    // As `max_by_key` decides: the greater state, a root record over one with an id, the later.
    if (at[0] > bestKey[0] || (at[0] === bestKey[0] && at[1] >= bestKey[1])) {
      best = each;
      bestKey = at;
    }
  }
  return obj(best);
}

/** A terminal title without the spinner a shell puts in front of it (`⠋ π - pumi` → `π - pumi`). */
export function stripTitle(title: string): string {
  return title.trim().replace(/^[^\p{L}\p{N}/~.]+/u, "").trimStart();
}


/** A JSON object's fields, an object when it is not one. */
function obj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A string field, empty when it is not one. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Two names in the order the table shows them, the unnamed last. */
function compare(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return a < b ? -1 : 1;
}

/** `/Users/me/x` as `~/x`. */
export function tilde(path: string): string {
  const home = process.env.HOME ?? "";
  return home !== "" && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
