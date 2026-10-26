// `agent-overview`: every agent in this pumi in one pane — who is working, who is blocked, and
// where. The rail narrows the list by state and by name; a row picks an agent, a second press goes
// to its pane.
//
// It reads nothing on its own: an agent says what it is doing itself, over OSC 7501, and the host
// keeps that as a pane's `@agent.status` and `@program_status` (docs/v2/23 §6). The dashboard is the
// window's own state (`ui.tsx` reads the app's panes); what is here is what the rest of pumi asks
// for: `amresyd.agent_overview.open` opens it (its command `open` in the palette, its menu item
// under View), `amresyd.agent_overview.list` answers with the agents as JSON, and the `key` option
// binds a chord to it.
import { call, fn, menu, on, option, self } from "pumi";

import { Overview, type State } from "./overview.ts";
import { message, open } from "./open.ts";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The server's panes, tabs and sessions, as the model reads them: `pane.list` is every pane in
 * layout order, and `pane.get` answers each one's options with it.
 */
async function readState(): Promise<State> {
  const listed: string[] = await call("session.list");
  const spaces = await Promise.all(listed.map((id) => call("session.get", id)));
  /** Which session a tab is in. */
  const owned = new Map<string, string>();
  const tabs: State["tabs"] = [];
  for (const space of spaces) {
    for (const id of space.tabs) {
      owned.set(id, space.id);
      const info = await call("tab.get", id);
      tabs.push({ id, session: space.id, name: info.name ?? "" });
    }
  }
  /** The pane in front: the current session's current tab's active one. */
  const front = await call("session.get", null);
  const current = front.activeTab === null ? null : await call("tab.get", front.activeTab);
  const ids: string[] = await call("pane.list", {});
  const panes: State["panes"] = await Promise.all(
    ids.map(async (id) => {
      const info = await call("pane.get", id);
      const options = (info.options ?? {}) as Record<string, unknown>;
      const at = info.tab === null ? null : info.tab;
      return {
        id,
        tab: at,
        session: at === null ? null : (owned.get(at) ?? null),
        title: text(options["title"]),
        cwd: text(options["pane_current_path"]),
        options,
      };
    }),
  );
  return {
    spaces: spaces.map((each) => ({ id: each.id, name: each.name })),
    tabs,
    panes,
    here: current?.activePane ?? null,
  };
}

/** The agents and their counts, as `amresyd.agent_overview.list` answers. */
async function listed(): Promise<{ agents: Record<string, unknown>[]; counts: Record<string, number>; sessions: number }> {
  const model = Overview.fromState(await readState());
  const counts: Record<string, number> = {};
  for (const agent of model.agents) counts[agent.status] = (counts[agent.status] ?? 0) + 1;
  return {
    agents: model.agents.map((agent) => ({ pane: agent.pane, agent: agent.kind, status: agent.status, why: agent.why })),
    counts,
    sessions: model.sessions(),
  };
}

/** The chord the `key` option is bound at, so a change unbinds the one before. */
let bound: string | null = null;

/** The root keys table: the `keys` option's `root`, with this plugin's chord in it or out. */
type KeyTable = Record<string, unknown>;

/** Bind the `key` option (and unbind the chord it was bound at before). */
async function bind(): Promise<void> {
  let chosen: unknown = "";
  try {
    chosen = await option.get("key");
  } catch (err) {
    console.error("agent-overview:", message(err));
  }
  const chord = typeof chosen === "string" ? chosen.trim() : "";
  if (bound === chord) return;
  try {
    // The chord comes from an option, so it is not the manifest's: it goes in the `keys` option's
    // root table, and the app takes it out when the plugin stops.
    const keys = ((await option.get("keys", { scope: "global" })) ?? {}) as KeyTable;
    const root = { ...((keys["root"] ?? {}) as KeyTable) };
    if (bound !== null) delete root[bound];
    if (chord !== "") root[chord] = { call: self.plugin.prefixed("open") };
    await option.set("keys", { ...keys, root }, { scope: "global" });
    bound = chord === "" ? null : chord;
  } catch (err) {
    console.error("agent-overview:", message(err));
  }
}

fn.set("open", { desc: "Open the agent overview, in a tab of its own." }, () => open());

fn.set(
  "list",
  {
    desc: "Every agent and what it is doing: `{agents, counts, sessions}`.",
    parameters: [],
    examples: [
      {
        args: [],
        result: { agents: [{ pane: "%1", agent: "pi", status: "working" }], counts: { working: 1 }, sessions: 1 },
      },
    ],
  },
  () => listed(),
);

menu.set("View.Agent Overview", {
  fn: self.plugin.prefixed("open"),
  title: "Agent overview",
});

// The chord follows its option, as the dashboard follows its others.
on("option.changed", { match: `${self.plugin.prefix}*`, desc: "agent-overview follows its options" }, () => void bind());

void bind();
