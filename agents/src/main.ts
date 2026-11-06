// agents: what an agent is told about the workspace it is in — a short guide to pumi and a map of
// the sessions, views, panes and tabs around it, at a start and the first prompt, then only what
// changed. The sidebar is the app theme's (`runtime/app/app/theme/default.tsx`); nothing here draws.
//
// What this file is: the wiring — the source (`session.list`, then each session's tree),
// `agent.sending` and `agent.turned` answered by `wire.ts`, and `migrate`, for an installation of
// the version before this one. The transport (the hook, the queue, `restore_command`) is the core's.
import { agent, call, option, workspace } from "pumi";

import { settings } from "./context.ts";
import { num } from "./ids.ts";
import type { GivenSession } from "./snapshot.ts";
import { answer, turned, type Source, type Store } from "./wire.ts";

/** Where the model comes from: `session.list`, and `session.get` deep for each of them. */
const source: Source = {
  list: () => call("session.list"),
  get: async (id) => {
    // `session.get --deep`: one session, with every view and its tabs, in one call.
    const session = await call("session.get", id, { deep: true });
    return session;
  },
};

/** Where what an agent was told is kept: the plugin's own options. */
const store: Store = {
  get: (key) => option.get(key),
  set: (key, value) => option.set(key, value),
};

agent.onSend(async (turn) => {
  await workspace.ready;
  const own = workspace.currentSession;
  return answer(turn, {
    source,
    store,
    settings: await settings(),
    here: own === null ? null : num(own.id),
  });
});

// A compaction throws away what the agent was told: the next turn hands it the whole thing again.
agent.onTurn((turn) => turned(turn, store));

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
