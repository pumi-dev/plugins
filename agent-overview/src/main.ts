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
import { command, key, menu, on, option, pkg, provide, view, type Disposer } from "pumi";

import { Dashboard } from "./dashboard.ts";
import { message, open } from "./open.ts";
import { listed } from "./overview.ts";

view("overview", Dashboard);

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
