// The workspace context's state: what the API says about the workspace, and the answer to a turn.
// Everything here takes what it needs as an argument (the source, `session.list` and `session.get`
// deep; the store of what each agent was told; the settings), so a test hands it a fake and no
// pumi needs to be running. `main.ts` wires it to the hook and to session tabs.
import { compose, frame, map, type Settings, type When } from "./context.ts";
import { num } from "./ids.ts";
import { read, type GivenSession, type Snapshot } from "./snapshot.ts";

/** Where the model comes from: the sessions, and each one's whole tree in one call. */
export interface Source {
  /** Every session's id, in creation order (`session.list`). */
  list(): Promise<string[]>;
  /** One session and its views, panes and tabs (`session.get` with `deep`), or `null`. */
  get(id: string): Promise<GivenSession | null>;
}

/** Where what an agent was told is kept. */
export interface Store {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
}

/** What every moment in an agent's life says of it: its tab, its id, its session and the event. */
export interface Moment {
  /** The agent's tab: `%3`. */
  tab: string;
  /** The agent's id: `claude`, `pi`, … */
  agent: string;
  /** Its own session id, or `null` while it has none. */
  session: string | null;
  /** `start` or `prompt` at a send; `stop` or `compact` at a turn's end. */
  event: string;
}

/** What a hook (or a session tab) asks at a start or a prompt: a moment, and what is asked of it. */
export interface Turn extends Moment {
  /** A `start` that continues a session. */
  resumed: boolean;
  /** `true` asks for everything again, not only what changed. */
  full: unknown;
  /** `true` asks what would be said without counting it as said. */
  peek: unknown;
}

/** Whether a flag says yes: `true`, or a string that is not empty. */
function yes(value: unknown): boolean {
  return value === true || (typeof value === "string" && value !== "");
}

/**
 * Where what an agent was told is kept: per agent and its own session (its tab when it has none).
 * The `2` is this map's shape: a map in the shape before it is not what an agent is now told.
 */
export function toldKey(turn: Moment): string {
  return `told:2:${turn.agent}:${turn.session ?? turn.tab}`;
}

/** The model, as the API has it now; `here` is the caller's session, which the map marks. */
export async function readState(source: Source, here: number | null): Promise<Snapshot> {
  const ids = await source.list();
  const sessions = await Promise.all(ids.map((id) => source.get(id)));
  return read(
    sessions.filter((session): session is GivenSession => session !== null),
    here,
  );
}

/** Everything `answer` reads: the API, the store, the options, and where the caller is. */
export interface Ask {
  source: Source;
  store: Store;
  settings: Settings;
  /** The caller's own session (`workspace.currentSession`). */
  here: number | null;
}

/** What the agent in `turn` is told now, or `null` when it is told nothing. */
export async function answer(turn: Turn, ask: Ask): Promise<string | null> {
  if (!ask.settings.context) return null;
  const snapshot = await readState(ask.source, ask.here);
  const mine = snapshot.tabs.find((tab) => tab.id === num(turn.tab));
  // Where the user is: the caller's session, else the session of the tab that has the focus (`%3`
  // is a tab a client is in, which a plugin's own worker never is).
  const current = ask.here ?? snapshot.tabs.find((tab) => tab.focused)?.session ?? null;
  const said = map(snapshot, {
    otherSessions: ask.settings.otherSessions,
    session: mine?.session ?? current,
    current,
  });
  const key = toldKey(turn);
  const told = await ask.store.get(key);
  const when: When = yes(turn.full) ? "full" : turn.event === "start" ? "start" : "prompt";
  const words = compose(when, turn.resumed, typeof told === "string" ? told : undefined, said, ask.settings.updates);
  // What an agent has seen is the map, whether or not it was said; a peek counts nothing.
  if (!yes(turn.peek)) await ask.store.set(key, said);
  return words === null ? null : frame(words);
}

/**
 * A turn's end: a compaction throws away what the agent was told, so the next turn hands it the
 * whole thing again.
 */
export async function turned(turn: Moment, store: Store): Promise<void> {
  if (turn.event === "compact") await store.set(toldKey(turn), null);
}
