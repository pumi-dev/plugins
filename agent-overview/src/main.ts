// `agent-overview`: every agent in this pumi in one pane — who is working, who is blocked, and
// where. The rail narrows the list by state and by name; a row picks an agent, a second press goes
// to its pane.
//
// It reads nothing on its own: an agent says what it is doing itself, over OSC 7501, and the host
// keeps that as a pane's `@agent_status` and `@program_status` (docs/v2/23 §6). The dashboard is
// one `server.getState` every few seconds, and a read of every open dashboard whenever an event
// says something moved.
//
// `pumi call amresyd.agent_overview.open` opens it (its command `open` in the palette, its menu
// item under View), `amresyd.agent_overview.list` answers with the agents as JSON, and the `key`
// option binds a chord to it.
import { command, key, menu, on, option, pkg, provide, server, type Disposer, type Snapshot as Window } from "pumi";

import { Overview } from "./overview.ts";
import { message, open } from "./open.ts";

/** The server's model, as the app's own snapshot: the worker has no window, so this is how it reads
 * the same panes the dashboard does. */
function fromServer(reply: unknown): Window | undefined {
  const outer = reply as { state?: unknown } | null;
  const state = (outer && typeof outer === "object" && "state" in outer ? outer.state : reply) as
    | {
        sessions?: { id: number; name: string; tabs?: [number, number][]; current?: number }[];
        tabs?: { id: number; name: string }[];
        panes?: { id: number; type: string; place?: { kind?: string; tab?: number }; options?: Record<string, unknown> }[];
        current?: { session?: number; tab?: number; pane?: number };
      }
    | undefined;
  if (!state || typeof state !== "object") return undefined;
  /** Which session a tab is in, and where. */
  const where = new Map<number, string>();
  for (const session of state.sessions ?? []) {
    for (const [, tab] of session.tabs ?? []) where.set(tab, String(session.id));
  }
  const label = new Map((state.tabs ?? []).map((tab) => [tab.id, tab.name]));
  return {
    focused_workspace_id: state.current?.session === undefined ? null : `$${state.current.session}`,
    focused_tab_id: state.current?.tab === undefined ? null : `@${state.current.tab}`,
    focused_pane_id: state.current?.pane === undefined ? null : `%${state.current.pane}`,
    workspaces: (state.sessions ?? []).map((session) => ({
      workspace_id: `$${session.id}`,
      label: session.name,
      active_tab_id: session.current === undefined ? null : `@${session.current}`,
      agent_status: "",
    })),
    tabs: (state.tabs ?? []).map((tab, index) => ({
      tab_id: `@${tab.id}`,
      workspace_id: where.get(tab.id) ?? "",
      number: index,
      label: tab.name,
      agent_status: "",
    })),
    panes: (state.panes ?? []).map((pane) => ({
      pane_id: `%${pane.id}`,
      kind: pane.type,
      tab_id: pane.place?.kind === "tiled" && pane.place.tab !== undefined ? `@${pane.place.tab}` : "",
      workspace_id: pane.place?.kind === "tiled" && pane.place.tab !== undefined ? (where.get(pane.place.tab) ?? "") : "",
      agent_status: String((pane.options ?? {})["@agent_status"] ?? ""),
      cwd: String((pane.options ?? {}).pane_current_path ?? ""),
      terminal_title: String((pane.options ?? {}).title ?? ""),
      agent: String((pane.options ?? {})["@agent"] ?? ""),
      options: pane.options ?? {},
    })),
    layouts: [],
  };
}

/** The agents and their counts, as `amresyd.agent_overview.list` answers. */
async function listed(): Promise<{ agents: Record<string, unknown>[]; counts: Record<string, number>; sessions: number }> {
  const model = Overview.fromWindow(fromServer(await server.getState()));
  const counts: Record<string, number> = {};
  for (const agent of model.agents) counts[agent.status] = (counts[agent.status] ?? 0) + 1;
  return {
    agents: model.agents.map((agent) => ({ pane: agent.pane, agent: agent.kind, status: agent.status, why: agent.why })),
    counts,
    sessions: model.sessions(),
  };
}

/** The chord the `key` option is bound at, so a change unbinds the one before. */
let bound: { chord: string; dispose: Disposer } | null = null;

/** Bind the `key` option (and unbind the chord it was bound at before). */
async function bind(): Promise<void> {
  let chosen: unknown = "";
  try {
    chosen = await option.get("key");
  } catch (err) {
    console.error("agent-overview:", message(err));
  }
  const chord = typeof chosen === "string" ? chosen.trim() : "";
  if (bound?.chord === chord) return;
  bound?.dispose();
  bound = null;
  if (chord === "") return;
  bound = {
    chord,
    dispose: key.set("root", chord, { call: pkg.prefixed("open") }, { desc: "Open the agent overview" }),
  };
}

command("open", () => open());

provide(
  pkg.prefixed("list"),
  {
    desc: "Every agent and what it is doing: `{agents, counts, sessions}`.",
    parameters: [],
    examples: [
      {
        args: [],
        result: { agents: [{ pane: 1, agent: "pi", status: "working" }], counts: { working: 1 }, sessions: 1 },
      },
    ],
  },
  () => listed(),
);

menu.add(
  "View.Agent Overview",
  { call: pkg.prefixed("open") },
  { desc: "Every agent in this pumi: who is working, who is blocked, and where." },
);

// The chord follows its option, as the dashboard follows its others.
on(
  "option.changed",
  { match: `${pkg.prefix}*`, desc: "agent-overview follows its options" },
  () => void bind(),
);

void bind();
