// pumi's model as herdr's clients see it: sessions are workspaces, tabs are tabs, panes are panes,
// read from the core's state (`server.getState`) for each request.
//
// herdr's ids are derived from pumi's, so they never need a table: a session `$5` is the workspace
// `w5` (in herdr's alphabet), its tab `@7` is `w5:t7`, and a pane `%9` in it is `w5:p9`, terminal
// `term_9`. A pane's id names its workspace, but only its number is read.
import { pane as paneId, splitPane, splitTab, tab as tabId, terminal, workspace, workspaceNumber } from "./ids.ts";
import { HERDR_PROTOCOL, HERDR_VERSION } from "./protocol.ts";
import {
  parseAgentStatus,
  type AgentInfo,
  type AgentStatus,
  type Json,
  type PaneInfo,
  type SessionSnapshot,
  type TabInfo,
  type WorkspaceInfo,
} from "./types.ts";

export interface Session {
  id: number;
  name: string;
  /** `(index, tab)` in the order the session keeps them. */
  tabs: [number, number][];
  current?: number;
}

export interface Tab {
  name?: string;
  active: number;
  zoomed: boolean;
  panes: number[];
}

export interface Pane {
  id: number;
  tab?: number;
  options: Record<string, Json>;
}

function isObject(value: Json | undefined): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A title without the agent's marker at its head: herdr's `terminal_title_stripped`. Agents write
 * `π - <what I am doing>`, `claude - …` and the like, so the first word and its dash go.
 */
export function stripMark(title: string): string {
  const stripped = title.replace(/^\S+\s+-\s+/, "").trim();
  return stripped === "" ? title : stripped;
}

function string(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function leaves(layout: Json | undefined, out: number[]): void {
  if (!Array.isArray(layout)) return;
  if (layout[0] === "leaf") {
    const leaf = number(layout[1]);
    if (leaf !== undefined) out.push(leaf);
    return;
  }
  const children = layout[1];
  if (!Array.isArray(children)) return;
  for (const child of children) leaves(child, out);
}

export class View {
  constructor(
    readonly sessions: Session[],
    readonly tabs: Map<number, Tab>,
    readonly panes: Map<number, Pane>,
    readonly current?: [number, number, number],
  ) {}

  /** The model as `server.getState` answers it. */
  static fromState(state: Json | undefined): View {
    const at = (key: string): Json | undefined => (isObject(state) ? state[key] : undefined);
    const list = (key: string): Json[] => {
      const value = at(key);
      return Array.isArray(value) ? value : [];
    };
    const sessions: Session[] = [];
    for (const session of list("sessions")) {
      if (!isObject(session)) continue;
      const id = number(session.id);
      if (id === undefined) continue;
      const tabs: [number, number][] = [];
      if (Array.isArray(session.tabs)) {
        for (const pair of session.tabs) {
          if (!Array.isArray(pair)) continue;
          const index = number(pair[0]);
          const tab = number(pair[1]);
          if (index !== undefined && tab !== undefined) tabs.push([index, tab]);
        }
      }
      sessions.push({ id, name: string(session.name) ?? "", tabs, current: number(session.current) });
    }
    const tabs = new Map<number, Tab>();
    for (const tab of list("tabs")) {
      if (!isObject(tab)) continue;
      const id = number(tab.id);
      const active = number(tab.active);
      if (id === undefined || active === undefined) continue;
      const panes: number[] = [];
      leaves(tab.layout, panes);
      tabs.set(id, { name: string(tab.name), active, zoomed: tab.zoomed === true, panes });
    }
    const panes = new Map<number, Pane>();
    for (const pane of list("panes")) {
      if (!isObject(pane)) continue;
      const id = number(pane.id);
      if (id === undefined) continue;
      const place = isObject(pane.place) ? pane.place : {};
      const inTab = place.kind === "tiled" ? number(place.tab) : undefined;
      panes.set(id, { id, tab: inTab, options: isObject(pane.options) ? pane.options : {} });
    }
    const now = isObject(at("current")) ? (at("current") as Record<string, Json>) : undefined;
    const session = now === undefined ? undefined : number(now.session);
    const tab = now === undefined ? undefined : number(now.tab);
    const pane = now === undefined ? undefined : number(now.pane);
    const current = session !== undefined && tab !== undefined && pane !== undefined ? ([session, tab, pane] as [number, number, number]) : undefined;
    return new View(sessions, tabs, panes, current);
  }

  sessionOfTab(tab: number): Session | undefined {
    return this.sessions.find((session) => session.tabs.some(([, t]) => t === tab));
  }

  private static wsId(session: number): string {
    return workspace(session);
  }

  tabId(tab: number): string {
    return tabId(View.wsId(this.sessionOfTab(tab)?.id ?? 0), tab);
  }

  paneId(pane: number): string {
    const tab = this.panes.get(pane)?.tab;
    const session = tab === undefined ? undefined : this.sessionOfTab(tab);
    return paneId(View.wsId(session?.id ?? 0), pane);
  }

  /** A session from a workspace id (`w5`, or pumi's `$5`). */
  session(id: string): number | undefined {
    const named = id.startsWith("$") ? parseCount(id.slice(1)) : workspaceNumber(id);
    if (named === undefined) return undefined;
    return this.sessions.some((session) => session.id === named) ? named : undefined;
  }

  tab(id: string): number | undefined {
    const split = splitTab(id);
    const named = split === undefined ? (id.startsWith("@") ? parseCount(id.slice(1)) : undefined) : split[1];
    if (named === undefined) return undefined;
    return this.tabs.has(named) ? named : undefined;
  }

  /** A pane from a pane id (`w5:p9`), a terminal id (`term_9`) or pumi's `%9`. */
  pane(id: string): number | undefined {
    const split = splitPane(id);
    const named =
      split !== undefined
        ? split[1]
        : id.startsWith("term_")
          ? parseCount(id.slice("term_".length))
          : id.startsWith("%")
            ? parseCount(id.slice(1))
            : undefined;
    if (named === undefined) return undefined;
    return this.panes.has(named) ? named : undefined;
  }

  private text(pane: number, key: string): string | undefined {
    const value = this.panes.get(pane)?.options[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  }

  /** The pane's `@agent_status`, which pumi's host decides. herdr has no `error`: a failed
   * program is `done` to its clients, and its record (`program_status`) says so. */
  status(pane: number): AgentStatus {
    const status = this.text(pane, "@agent_status");
    if (status === undefined) return "unknown";
    return parseAgentStatus(status === "error" ? "done" : status) ?? "unknown";
  }

  /** A terminal's own reports (OSC 7501), which the pane carries as `@program_status`. */
  private programStatus(pane: number): Json[] {
    const value = this.panes.get(pane)?.options["@program_status"];
    return Array.isArray(value) ? value : [];
  }

  /** The most demanding of some panes' statuses, herdr's order. */
  private rollup(panes: number[]): AgentStatus {
    const rank: Record<AgentStatus, number> = { blocked: 4, working: 3, done: 2, idle: 1, unknown: 0 };
    let best: AgentStatus = "unknown";
    for (const pane of panes) {
      const status = this.status(pane);
      if (rank[status] > rank[best]) best = status;
    }
    return best;
  }

  private tabPanes(tab: number): number[] {
    return this.tabs.get(tab)?.panes ?? [];
  }

  workspaceInfo(session: number): WorkspaceInfo | undefined {
    const index = this.sessions.findIndex((candidate) => candidate.id === session);
    if (index < 0) return undefined;
    const s = this.sessions[index];
    const panes = s.tabs.flatMap(([, tab]) => this.tabPanes(tab));
    return {
      workspace_id: View.wsId(session),
      number: index + 1,
      label: s.name,
      focused: this.current?.[0] === session,
      pane_count: panes.length,
      tab_count: s.tabs.length,
      active_tab_id: s.current === undefined ? "" : this.tabId(s.current),
      agent_status: this.rollup(panes),
    };
  }

  tabInfo(tab: number): TabInfo | undefined {
    const session = this.sessionOfTab(tab);
    const t = this.tabs.get(tab);
    if (!session || !t) return undefined;
    const index = session.tabs.findIndex(([, candidate]) => candidate === tab);
    const num = (index < 0 ? 0 : index) + 1;
    return {
      tab_id: this.tabId(tab),
      workspace_id: View.wsId(session.id),
      number: num,
      label: t.name ?? this.text(t.active, "title") ?? String(num),
      focused: this.current?.[1] === tab,
      pane_count: t.panes.length,
      agent_status: this.rollup(t.panes),
    };
  }

  paneInfo(pane: number, revision: number): PaneInfo | undefined {
    const p = this.panes.get(pane);
    if (!p || p.tab === undefined) return undefined;
    const session = this.sessionOfTab(p.tab);
    if (!session) return undefined;
    const title = this.text(pane, "title");
    const label = this.text(pane, "@label");
    const agent = this.text(pane, "@agent");
    const cwd = this.text(pane, "pane_current_path");
    const programStatus = this.programStatus(pane);
    return {
      pane_id: this.paneId(pane),
      terminal_id: terminal(pane),
      workspace_id: View.wsId(session.id),
      tab_id: this.tabId(p.tab),
      focused: this.current?.[2] === pane,
      ...(cwd === undefined ? {} : { cwd }),
      ...(label === undefined ? {} : { label }),
      ...(agent === undefined ? {} : { agent, display_agent: agent }),
      ...(title === undefined ? {} : { title, terminal_title: title, terminal_title_stripped: title }),
      agent_status: this.status(pane),
      revision,
      ...(programStatus.length === 0 ? {} : { program_status: programStatus }),
    };
  }

  agentInfo(pane: number): AgentInfo | undefined {
    const agent = this.text(pane, "@agent");
    const info = this.paneInfo(pane, 0);
    if (agent === undefined || info === undefined) return undefined;
    // herdr's `name` is what an Agent row and `$name` show, and `terminal_title_stripped` is what a
    // Heeler row draws: the program's title with the agent's own marker taken off (`π - Debug …`
    // is `Debug …`). `tokens` is what those rows read by name — the workspace and tab are their
    // labels, not pumi's ids.
    const label = this.text(pane, "@label");
    const stripped = info.title === undefined ? undefined : stripMark(info.title);
    const name = label ?? stripped ?? info.title ?? agent;
    const tab = this.panes.get(pane)?.tab;
    const session = tab === undefined ? undefined : this.sessionOfTab(tab);
    const tabLabel = tab === undefined ? undefined : this.text(this.tabs.get(tab)?.active ?? -1, "title");
    const tokens: Record<string, string> = {
      name,
      agent,
      workspace: session?.name ?? info.workspace_id,
      tab: (tab === undefined ? undefined : this.tabs.get(tab)?.name) ?? tabLabel ?? info.tab_id,
      pane: label ?? stripped ?? info.pane_id,
      ...(info.title === undefined
        ? {}
        : { terminal_title: info.title, terminal_title_stripped: stripped ?? info.title }),
    };
    return {
      terminal_id: terminal(pane),
      name,
      tokens,
      agent,
      ...(info.title === undefined
        ? {}
        : { title: info.title, terminal_title: info.title, terminal_title_stripped: info.title }),
      display_agent: agent,
      agent_status: info.agent_status,
      workspace_id: info.workspace_id,
      tab_id: info.tab_id,
      pane_id: info.pane_id,
      focused: info.focused,
      interactive_ready: true,
      state_change_seq: 0,
      ...(info.cwd === undefined ? {} : { cwd: info.cwd }),
      revision: 0,
    };
  }

  /** Panes in tabs, in order: what herdr lists. */
  tiled(): number[] {
    return this.sessions.flatMap((session) => session.tabs.flatMap(([, tab]) => this.tabPanes(tab)));
  }

  snapshot(revision: (pane: number) => number): SessionSnapshot {
    const panes = this.tiled();
    return {
      version: HERDR_VERSION,
      protocol: HERDR_PROTOCOL,
      ...(this.current === undefined
        ? {}
        : {
            focused_workspace_id: View.wsId(this.current[0]),
            focused_tab_id: this.tabId(this.current[1]),
            focused_pane_id: this.paneId(this.current[2]),
          }),
      workspaces: this.sessions.flatMap((session) => this.workspaceInfo(session.id) ?? []),
      tabs: this.sessions.flatMap((session) => session.tabs.flatMap(([, tab]) => this.tabInfo(tab) ?? [])),
      panes: panes.flatMap((pane) => this.paneInfo(pane, revision(pane)) ?? []),
      layouts: [],
      agents: panes.flatMap((pane) => this.agentInfo(pane) ?? []),
    };
  }
}

function parseCount(text: string): number | undefined {
  return /^\d+$/.test(text) ? Number(text) : undefined;
}
