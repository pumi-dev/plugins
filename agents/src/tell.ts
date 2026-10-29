// What an agent is told about the workspace, for the agents' hooks (`hooks/run.ts`) and session tabs
// (`sessions.ts`): the context's options, the API it reads the workspace from, and what each agent
// was told last. That is kept in memory: after the plugin starts again, an agent's next prompt
// hears the whole map again, which costs it a few lines. `context/` decides what is said.
import { call, option, workspace } from "pumi";

import { settingsOf } from "./context/context.ts";
import { num } from "./context/ids.ts";
import type { GivenSession } from "./context/snapshot.ts";
import { answer, turned, type Moment, type Source, type Store, type Turn } from "./context/wire.ts";

/** Where the model comes from: `session.list`, and `session.get` deep for each one. */
const source: Source = {
  list: () => call("session.list") as Promise<string[]>,
  get: (id) => call("session.get", id, { deep: true }) as Promise<GivenSession | null>,
};

/** How many agents' last maps are kept: the oldest goes first. */
const KEPT = 256;
const told = new Map<string, unknown>();

const store: Store = {
  get: async (key) => told.get(key),
  set: async (key, value) => {
    told.delete(key);
    if (value !== null && value !== undefined) told.set(key, value);
    while (told.size > KEPT) told.delete(told.keys().next().value!);
    return null;
  },
};

/** What the agent in `turn` is told now, framed, or `null` when it is told nothing. */
export async function tell(turn: Turn): Promise<string | null> {
  // Every change, and the other sessions too: only whether to tell at all is the user's.
  const context = await option.get("context", { scope: "global" }).catch(() => null);
  await workspace.ready;
  const own = workspace.currentSession;
  return answer(turn, { source, store, settings: settingsOf(context, "changes", true), here: own === null ? null : num(own.id) });
}

/** The agent's context was compacted: what it was told is gone, so its next turn hears it all. */
export function forget(turn: Moment): Promise<void> {
  return turned({ ...turn, event: "compact" }, store);
}
