// agents: what an agent is told about the workspace it is in — a short guide to pumi and a map of
// the sessions, tabs and panes around it, at a start and the first prompt, then only what changed.
// The sidebar is the app theme's (`runtime/app/app/theme/default.tsx`); nothing here draws.
//
// What is here is the logic: the model, read from the API when an agent starts or is sent a prompt
// (`readState`), and the answer to `agent.sending`. The transport (the hook, the queue,
// `restore_command`) is the core's; this package only says what is said.
import { agent, option, pane, session, storage, tab } from "pumi";

import { compose, map, onFor, settings, type When } from "./context.ts";
import { read, type Given, type PaneGiven, type Snapshot, type TabGiven } from "./snapshot.ts";

/** The options a pane is read for: what it is, what it says of itself, and where it is. */
const OPTIONS = ["@agent", "@agent_status", "@program_status", "@label", "title", "pane_current_path"];

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The model as the API answers it: every session, its tabs, and every pane with the options that
 * say what it is. `pane.list` is every pane, in layout order within a tab.
 */
async function readState(): Promise<Snapshot> {
  const listed = await session.list();
  const sessions = await Promise.all(listed.map((each) => session.get(each.id)));
  const here = await session.get();

  /** Which session a tab is in. */
  const owner = new Map<number, number>();
  const tabs: TabGiven[] = [];
  for (const each of sessions) {
    for (const [index, id] of each.tabs) {
      owner.set(id, each.id);
      const info = await tab.get(id);
      tabs.push({ id, space: each.id, index, label: info.name ?? "" });
    }
  }

  const ids = (await pane.list()).filter((each): each is number => typeof each === "number");
  const panes: PaneGiven[] = await Promise.all(
    ids.map(async (id) => {
      const [info, said] = await Promise.all([pane.get(id), Promise.all(OPTIONS.map((name) => option.get(name, { pane: id })))]);
      const options = Object.fromEntries(OPTIONS.map((name, i) => [name, said[i]]));
      const at = info.place.kind === "tiled" ? info.place.tab : null;
      return {
        id,
        tab: at,
        space: at === null ? null : (owner.get(at) ?? null),
        title: text(options["title"]),
        cwd: text(options["pane_current_path"]),
        label: text(options["@label"]),
        options,
      };
    }),
  );

  const given: Given = {
    spaces: sessions.map((each) => ({ id: each.id, label: each.name, focused: each.id === here.id })),
    tabs,
    panes,
  };
  return read(given);
}

/** Where what an agent was told is kept: per agent and its own session (`%3` when it has none). */
const toldKey = (turn: { agent: string; session: string | null; pane: number }): string =>
  `told:${turn.agent}:${turn.session ?? `%${turn.pane}`}`;

agent.onSend(async (turn) => {
  const now = await settings();
  if (!onFor(turn.agent, now)) return null;
  const model = await readState();
  const space = model.panes.find((each) => each.id === turn.pane)?.space ?? null;
  const said = map(model, { otherSessions: now.otherSessions, space });
  const key = toldKey(turn);
  const told = await storage.get<string>(key);
  const when: When = turn.full ? "full" : turn.event === "start" ? "start" : "prompt";
  const text = compose(when, turn.resumed, told, said, now.updates);
  // What an agent has seen is the map, whether or not it was said; a peek counts nothing.
  if (!turn.peek) await storage.set(key, said);
  return text;
});

// A compaction throws away what the agent was told: the next turn hands it the whole thing again.
agent.onTurn(async (turn) => {
  if (turn.event === "compact") await storage.set(toldKey(turn), null);
});

/**
 * Once, for an installation of the version before this one: its options were the core's
 * (`agents.context*`, on against each agent's own), and are this package's now (`context`, `updates`,
 * `other_sessions`, `targets`, where a `false` turns an agent off). A target that was on stays on
 * (it is on unless it is off), and one that was off stays off.
 */
async function migrate(): Promise<void> {
  if (await storage.get("migrated")) return;
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
  await storage.set("migrated", true);
}

await migrate();
