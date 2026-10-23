// `agent-overview`: every agent in this pumi in one pane — who is working, who is blocked, and
// where. The rail narrows the list by state and by name; a row picks an agent, a second press goes
// to its pane.
//
// It reads nothing on its own: an agent says what it is doing itself, over OSC 7501, and the host
// keeps that as a pane's `@agent_status` and `@program_status` (docs/v2/23 §6). The dashboard is the
// window's own state (`ui.tsx` reads the app's panes); what is here is what the rest of pumi asks
// for: `amresyd.agent_overview.open` opens it (its command `open` in the palette, its menu item
// under View), `amresyd.agent_overview.list` answers with the agents as JSON, and the `key` option
// binds a chord to it.
import { call, command, menu, on, option, pane, plugin, provide, session, tab } from "pumi";

import { Overview, type State } from "./overview.ts";
import { message, open } from "./open.ts";

/** The options the model reads on a pane: what it is, what it says of itself, and where it is. */
const OPTIONS = ["@agent", "@agent_status", "@agent_session", "@program_status", "pane_current_path", "pane_current_command", "title"];

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The server's panes, tabs and sessions, as the model reads them: `pane.list` is every pane in
 * layout order, and each one's options are read under it.
 */
async function readState(): Promise<State> {
  const listed = await session.list();
  const spaces = await Promise.all(listed.map((each) => session.get(each.id)));
  const now = await session.get();
  /** Which session a tab is in. */
  const owned = new Map<number, number>();
  const tabs: State["tabs"] = [];
  for (const space of spaces) {
    for (const [, id] of space.tabs) {
      owned.set(id, space.id);
      const info = await tab.get(id);
      tabs.push({ id, session: space.id, name: info.name ?? "" });
    }
  }
  /** The pane in front: the current session's current tab's active one. */
  const front = await tab.get(now.current ?? 0);
  const ids = (await pane.list()).filter((each): each is number => typeof each === "number");
  const panes: State["panes"] = await Promise.all(
    ids.map(async (id) => {
      const info = await pane.get(id);
      const values = await Promise.all(OPTIONS.map((name) => option.get(name, { pane: id })));
      const options = Object.fromEntries(OPTIONS.map((name, i) => [name, values[i]]));
      const at = info.place.kind === "tiled" ? info.place.tab : null;
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
    here: front.active,
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
  if (bound !== null) await call("key.del", "root", bound, {}).catch(() => {});
  bound = null;
  if (chord === "") return;
  // The chord comes from an option, so it is not the manifest's: it stays on the wire (`key.set`),
  // and the app takes it out when the plugin stops.
  await call("key.set", "root", chord, { call: plugin.prefixed("open") }, { desc: "Open the agent overview" }).catch((err) =>
    console.error("agent-overview:", message(err)),
  );
  bound = chord;
}

command("open", () => open());

provide(
  plugin.prefixed("list"),
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

menu.add("View.Agent Overview", { call: plugin.prefixed("open") }, {
  desc: "Every agent in this pumi: who is working, who is blocked, and where.",
});

// The chord follows its option, as the dashboard follows its others.
on("option.changed", { match: `${plugin.prefix}*`, desc: "agent-overview follows its options" }, () => void bind());

void bind();
