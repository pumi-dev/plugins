// agents: what an agent is told about the workspace it is in — a short guide to pumi and a map of
// the sessions, tabs and panes around it, at a start and the first prompt, then only what changed.
// The sidebar is the app theme's (`runtime/app/app/theme/default.tsx`); nothing here draws.
//
// What is here is the logic: the model, read from the API when an agent starts or is sent a prompt
// (`readState`), and the answer to `agent.sending`. The transport (the hook, the queue,
// `restore_command`) is the core's; this package only says what is said.
import { agent, call, option, workspace } from "pumi";

import { compose, map, onFor, settings, type When } from "./context.ts";
import { num } from "./ids.ts";
import { read, type Given, type PaneGiven, type Snapshot, type TabGiven } from "./snapshot.ts";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The model as the workspace has it: every session, its tabs, and every pane with the options that
 * say what it is. `workspace.panes` is every pane, in layout order within a tab.
 */
async function readState(): Promise<Snapshot> {
  await workspace.ready;
  const sessions = workspace.sessions;
  const here = workspace.currentSession?.id ?? null;

  /** Which session a tab is in. */
  const owner = new Map<number, number>();
  const tabs: TabGiven[] = [];
  for (const each of sessions) {
    for (const [index, tab] of each.tabs.entries()) {
      owner.set(num(tab.id), num(each.id));
      // Its name is the one field the models of a session's tabs are not listed with.
      const info = await call("tab.get", tab.id);
      tabs.push({ id: num(tab.id), space: num(each.id), index, label: info.name ?? "" });
    }
  }

  const panes: PaneGiven[] = (await workspace.panes()).map((pane) => {
    const options = (pane.options ?? {}) as Record<string, unknown>;
    const at = pane.tab?.id ?? null;
    return {
      id: num(pane.id),
      tab: at === null ? null : num(at),
      space: at === null ? null : (owner.get(num(at)) ?? null),
      title: text(options["title"]),
      cwd: text(options["pane_current_path"]),
      label: text(options["@label"]),
      options,
    };
  });

  const given: Given = {
    spaces: sessions.map((each) => ({ id: num(each.id), label: each.name ?? "", focused: each.id === here })),
    tabs,
    panes,
  };
  return read(given);
}

/** Where what an agent was told is kept: per agent and its own session (its pane when it has none). */
const toldKey = (turn: { agent: string; session: string | null; pane: string }): string =>
  `told:${turn.agent}:${turn.session ?? turn.pane}`;

agent.onSend(async (turn) => {
  const now = await settings();
  if (!onFor(turn.agent, now)) return null;
  const model = await readState();
  const here = num(turn.pane);
  const space = model.panes.find((each) => each.id === here)?.space ?? null;
  const said = map(model, { otherSessions: now.otherSessions, space });
  const key = toldKey(turn);
  const told = await option.get(key);
  const when: When = turn.full ? "full" : turn.event === "start" ? "start" : "prompt";
  const words = compose(when, turn.resumed, told ?? undefined, said, now.updates);
  // What an agent has seen is the map, whether or not it was said; a peek counts nothing.
  if (!turn.peek) await option.set(key, said);
  return words;
});

// A compaction throws away what the agent was told: the next turn hands it the whole thing again.
agent.onTurn(async (turn) => {
  if (turn.event === "compact") await option.set(toldKey(turn), null);
});

/**
 * Once, for an installation of the version before this one: its options were the core's
 * (`agents.context*`, on against each agent's own), and are this package's now (`context`, `updates`,
 * `other_sessions`, `targets`, where a `false` turns an agent off). A target that was on stays on
 * (it is on unless it is off), and one that was off stays off.
 */
async function migrate(): Promise<void> {
  if (await option.get("migrated")) return;
  const old = async (name: string): Promise<unknown> => {
    try {
      return await option.get(name);
    } catch {
      return null;
    }
  };
  const [updates, otherSessions, targets] = await Promise.all([
    old("agents.context_updates"),
    old("agents.context_other_sessions"),
    old("agents.context_targets"),
  ]);
  const off: Record<string, boolean> = {};
  for (const [agent, on] of Object.entries(typeof targets === "object" && targets !== null ? targets : {})) {
    if (on === false) off[agent] = false;
  }
  if (updates === "start") await option.set("updates", "start");
  if (typeof otherSessions === "boolean") await option.set("other_sessions", otherSessions);
  if (Object.keys(off).length > 0) await option.set("targets", off);
  await option.set("migrated", true);
}

await migrate();
