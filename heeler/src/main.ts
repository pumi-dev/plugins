// heeler on pumi: Heeler's Host, on the machine's own SSH.
//
// Heeler's mobile app reaches a Host over SSH on port 22 as the account that runs it, and this
// package is that Host for pumi: it serves herdr's API and client sockets on pumi's panes, mints the
// QR Pairing Code that enrolls a phone into the account's `authorized_keys`, and sends Heeler's Agent
// Notifications and Live Activities. The SSH server is the machine's own OpenSSH (`Remote Login`) —
// the plugin starts nothing, needs no root, and adds no host key; its `herdr` shim only makes the
// commands Heeler runs answer on a machine with no herdr installed.
//
// A Herdr client reaches it as one of herdr's sessions: the sockets are in
// `~/.config/herdr/sessions/<session>/` (`pumi` by default), so Heeler's Host form takes this
// machine's address, port 22, this account, and the session name `pumi`.
//
// Nothing here keeps a screen: `pane.read` is the core's own text, keys are `{"keys": […]}` on the
// same call, and what an agent is doing is its tab's `@status`, with the Agents plugin's trait
// (`@pumi_dev.agents.agent`) naming it.
//
// The user-facing half is Settings: `heeler.pair.*` and `heeler.status` are provided functions
// (functions.ts), and the QR is answered as text rows so any monospaced view can show it. See
// README.md for the pieces and PARITY.md for what herdr's own server answers.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { on, option, paths, self, type PumiEvent } from "pumi";
import { status as activityStatus, start as startActivity } from "./activity.ts";
import { serve as serveClient } from "./client.ts";
import { provideFunctions } from "./functions.ts";
import {
  DEFAULT_SSH_PORT,
  ensureAuthorizedKeys,
  hostKeyFingerprint,
  hostPaths,
  installShim,
  installUserShim,
  probeSsh,
  user,
  writeRecord,
  type SshHost,
} from "./host.ts";
import { install as installKeys } from "./keys.ts";
import type { Listener } from "./listen.ts";
import { log } from "./log.ts";
import { closed as paneClosed, start as startNotifications, status as statusChanged } from "./notify.ts";
import { Pairing } from "./pair.ts";
import { HEELER_PLUGIN_VERSION } from "./protocol.ts";
import { dataDir, heelerConfigDir, sessionDir } from "./paths.ts";
import { numberOf } from "./api.ts";
import { onEvent, serve as serveApi } from "./server.ts";
import type { Json } from "./types.ts";

/** The events herdr's clients hear about: everything that changes the model, every program ending,
 * and what an agent is doing (`tab.changed`, which carries the tab's `@status`). */
const EVENTS = [
  "session.opened",
  "session.closed",
  "session.changed",
  "view.opened",
  "view.closed",
  "view.changed",
  "tab.opened",
  "tab.closed",
  "tab.changed",
];

/** The option naming the herdr session pumi also answers as. */
const SESSION = "session";
/** The option naming the port the machine's SSH listens on, which the Pairing Code advertises. */
const PORT = "ssh_port";

/** The listeners in pumi's data directory, and those in herdr's session directory, which move when
 * the `session` option does. */
let dataListeners: Listener[] = [];
let sessionListeners: Listener[] = [];

function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The package's own state directory, whose app's name the data directory is under. */
function stateDir(): string | undefined {
  try {
    return paths.state;
  } catch {
    return undefined;
  }
}

const state = stateDir();
if (state === undefined) {
  // Without a state directory there is nowhere for the shim or the pairing records.
  log("no plugin state directory: pairing cannot start");
}
const stateRoot = state ?? join(dataDir(process.env, undefined), "heeler-state");
mkdirSync(stateRoot, { recursive: true, mode: 0o700 });

// ---- herdr's sockets, on pumi's panes

/** Serves `herdr.sock` and `herdr-client.sock` in `dir`; the listeners made. */
async function serveIn(dir: string, grid: string): Promise<Listener[]> {
  const made: Listener[] = [];
  const api = join(dir, "herdr.sock");
  try {
    made.push(await serveApi(api));
    log(`serving ${api}`);
  } catch (err) {
    // Another herdr may hold it; Heeler then talks to that one.
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
  const dir = sessionDir(String(name));
  if (dir === undefined) return log(`${SESSION}: ${JSON.stringify(name)} is not a herdr session name`);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return log(`${dir}: ${why(err)}`);
  }
  sessionListeners = await serveIn(dir, grid);
}

const data = dataDir(process.env, stateDir());
const grid = join(data, "grid.sock");
mkdirSync(data, { recursive: true });
dataListeners = await serveIn(data, grid);

// ---- Heeler's Host: the machine's own SSH, on this account

const hostDirs = hostPaths(stateRoot);
ensureAuthorizedKeys(hostDirs.authorizedKeys);
const fingerprint = hostKeyFingerprint();
if (fingerprint === undefined) {
  log("no SSH host key under /etc/ssh: turn on Remote Login (System Settings > General > Sharing) to pair");
}

/** The port the Pairing Code advertises: the account's sshd. */
async function portSetting(): Promise<number> {
  const value = await option.get(PORT);
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : DEFAULT_SSH_PORT;
}

let advertised = await portSetting();
/** What the probe last found; nothing until it has run, which is after the functions are up. */
let sshAnswers: { running: boolean; error?: string } = { running: false, error: "not probed yet" };

/** The machine's SSH as the rest of the plugin reads it; `fingerprint` is the key every code pins. */
function hostStatus(): SshHost {
  return {
    port: advertised,
    user: user(),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    ...sshAnswers,
  };
}

const pairing = new Pairing({ stateDir: stateRoot, host: hostStatus });

// ---- the functions Settings calls

// First, before the sockets' grace periods and the SSH probe: a Settings page that opens while the
// plugin is still starting finds them, instead of the page reporting that the plugin is not there.
provideFunctions({
  version: HEELER_PLUGIN_VERSION,
  prefix: self.plugin.prefix,
  state: stateRoot,
  configDir: heelerConfigDir(),
  host: hostStatus,
  pairing,
  session: async () => String((await option.get(SESSION)) ?? "pumi"),
  restartHost: async () => {
    advertised = await portSetting();
    sshAnswers = await probeSsh(advertised);
    await writeHostRecord();
    return hostStatus();
  },
});

// ---- everything that takes its time

// The machine's sshd, and then herdr's session sockets: a live herdr answers on those, so taking
// them is given the grace a reload's overlap needs before it gives up.
sshAnswers = await probeSsh(advertised);
if (sshAnswers.running) log(`ssh: the machine's OpenSSH answers on ${advertised} as ${user()}`);
await serveSession(grid);

const userShim = installUserShim(hostDirs);
installShim(hostDirs);
if (userShim !== undefined) log(`herdr: ${userShim}`);

/** What the `herdr` shim reads, so it can answer without the API. */
async function writeHostRecord(): Promise<void> {
  const session = String((await option.get(SESSION)) ?? "pumi");
  const dir = session === "" ? undefined : sessionDir(session);
  writeRecord(hostDirs, {
    plugin: "heeler",
    version: HEELER_PLUGIN_VERSION,
    state: stateRoot,
    data,
    apiSocket: join(data, "herdr.sock"),
    clientSocket: join(data, "herdr-client.sock"),
    gridSocket: grid,
    session,
    ...(dir === undefined ? {} : { sessionDir: dir }),
    configDir: heelerConfigDir(),
    bin: hostDirs.shim,
    ssh: hostStatus(),
  });
}
await writeHostRecord();
mkdirSync(heelerConfigDir(), { recursive: true, mode: 0o700 });

// Heeler's Agent Notifications: the same push Heeler's herdr plugin sends, over pumi's `@status`
// (notify.ts), and its Live Activities (activity.ts).
const heeler = { session: async () => String((await option.get(SESSION)) ?? "pumi"), state };
startNotifications(heeler);
startActivity(heeler);
await installKeys();

// ---- following the options

on("option.changed", { match: self.plugin.prefixed(SESSION), desc: "heeler: the herdr session sockets follow the session option" }, async () => {
  try {
    await serveSession(grid);
    await writeHostRecord();
  } catch (err) {
    log(`${SESSION}: ${why(err)}`);
  }
});
on("option.changed", { match: self.plugin.prefixed(PORT), desc: "heeler: the advertised SSH port follows the option" }, async () => {
  try {
    advertised = await portSetting();
    sshAnswers = await probeSsh(advertised);
    await writeHostRecord();
  } catch (err) {
    log(`${PORT}: ${why(err)}`);
  }
});

// ---- Heeler's hooks

// A tab's own options are its changes (`tab.changed`), not the server's (`option.changed`): what an
// agent is doing arrives as the tab's `options.@status` in its patch, and a tab on the terminal
// engine is a pane of herdr's.
on("tab.changed", { desc: "Heeler's notifications: an agent's status changed" }, (event: PumiEvent) => {
  const at = numberOf(event.tab);
  const keys: string[] = event.data?.keys ?? [];
  const next = (event.data?.patch as { options?: Record<string, unknown> } | undefined)?.options?.["@status"];
  if (at === undefined || !keys.includes("options.@status") || typeof next !== "string") return;
  statusChanged(at, next);
  activityStatus(at, next);
});
on("tab.closed", { desc: "Heeler's notifications: a closed pane's marker goes" }, (event: PumiEvent) => {
  const at = numberOf(event.tab);
  if (at !== undefined) paneClosed(at);
});
on(EVENTS, { desc: "herdr's socket: the model changing" }, (event: PumiEvent) => {
  const changed = { event: event.event, session: event.session, view: event.view, tab: event.tab, data: event.data as Json };
  void onEvent(changed).catch((err) => log(`herdr's events: ${why(err)}`));
});

/** Closes every socket: what the host does when the package stops, and a test after. */
export function stop(): void {
  for (const listener of [...dataListeners, ...sessionListeners]) listener.stop(true);
  dataListeners = [];
  sessionListeners = [];
}
