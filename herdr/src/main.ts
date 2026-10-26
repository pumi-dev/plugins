// herdr on pumi: herdr's API and its client socket, as a package. It serves `herdr.sock` so herdr's
// clients (its CLI, its mobile apps) reach pumi's panes: sessions are workspaces, tabs are tabs,
// panes are panes. Beside it is `herdr-client.sock`, where herdr's own client attaches to a pane's
// terminal (`herdr agent attach`, which is how herdr's mobile apps show a pane live): each attach is
// a client of pumi's grid socket for that pane (client.ts).
//
// No screen is kept here and nothing detects agents. A pane's text is `pane.call`'s `read`; its keys
// are `{"keys": […]}` on the same call, which the host encodes; and what an agent is doing is the
// pane's `@agent`/`@agent.status`, which the host keeps from the program's own reports (OSC 7501).
//
// Both are served in pumi's data directory and, under the name the `session` option gives, where
// herdr keeps a named session (`~/.config/herdr/sessions/<name>/`), so herdr's CLI and its apps find
// pumi as one of herdr's sessions.
//
// It also binds herdr's default keys in the prefix table (keys.ts), as herdr has them.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { on, option, paths, self, type PumiEvent } from "pumi";
import { serve as serveClient } from "./client.ts";
import { install as installKeys } from "./keys.ts";
import type { Listener } from "./listen.ts";
import { log } from "./log.ts";
import { dataDir, sessionDir } from "./paths.ts";
import { onEvent, serve as serveApi } from "./server.ts";
import type { Json } from "./types.ts";

/** The events herdr's clients hear about: everything that changes the model, every program ending,
 * and what an agent is doing (`pane.changed`, which carries the pane's `@agent.status`). */
const EVENTS = [
  "session.opened",
  "session.closed",
  "session.changed",
  "tab.opened",
  "tab.closed",
  "tab.changed",
  "pane.opened",
  "pane.closed",
  "pane.changed",
];

/** The option naming the herdr session pumi also answers as. */
const SESSION = "session";

/** The listeners in pumi's data directory, and those in herdr's session directory, which move when
 * the `session` option does. */
let dataListeners: Listener[] = [];
let sessionListeners: Listener[] = [];

function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Serves `herdr.sock` and `herdr-client.sock` in `dir`; the listeners made. */
async function serveIn(dir: string, grid: string): Promise<Listener[]> {
  const made: Listener[] = [];
  const api = join(dir, "herdr.sock");
  try {
    made.push(await serveApi(api));
    log(`serving ${api}`);
  } catch (err) {
    // Another herdr may hold it; herdr's clients then talk to that one.
    log(`${api}: ${why(err)}`);
  }
  // herdr's client finds its socket beside the API's (`herdr.sock` → `herdr-client.sock`).
  const client = join(dir, "herdr-client.sock");
  try {
    made.push(await serveClient(client, grid));
    log(`serving ${client}`);
  } catch (err) {
    log(`${client}: ${why(err)}`);
  }
  return made;
}

/** (Re)serves the sockets in herdr's session directory for the current `session` option. */
async function serveSession(grid: string): Promise<void> {
  for (const listener of sessionListeners) listener.stop(true);
  sessionListeners = [];
  const name = (await option.get(SESSION)) ?? "pumi";
  if (name === "") return;
  const dir = sessionDir(name);
  if (dir === undefined) return log(`${SESSION}: ${JSON.stringify(name)} is not a herdr session name`);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return log(`${dir}: ${why(err)}`);
  }
  sessionListeners = await serveIn(dir, grid);
}

/** The package's own state directory, whose app's name the data directory is under when the
 * environment does not say. */
function stateDir(): string | undefined {
  try {
    return paths.state;
  } catch {
    return undefined;
  }
}

/** Closes every socket: what the host does when the package stops, and what a test does after it. */
export function stop(): void {
  for (const listener of [...dataListeners, ...sessionListeners]) listener.stop(true);
  dataListeners = [];
  sessionListeners = [];
}

const data = dataDir(process.env, stateDir());
const grid = join(data, "grid.sock");
mkdirSync(data, { recursive: true });
dataListeners = await serveIn(data, grid);
await serveSession(grid);
await installKeys();
on("option.changed", { match: self.plugin.prefixed(SESSION), desc: "herdr's session sockets follow herdr.session" }, () => {
  void serveSession(grid).catch((err) => log(`${SESSION}: ${why(err)}`));
});
on(EVENTS, { desc: "herdr's socket: the model changing" }, (event: PumiEvent) => {
  const changed = { event: event.event, pane: event.pane, tab: event.tab, session: event.session, data: event.data as Json };
  void onEvent(changed).catch((err) => log(`herdr's events: ${why(err)}`));
});
