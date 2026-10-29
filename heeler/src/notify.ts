// Heeler's Agent Notifications, sent from pumi.
//
// Heeler's herdr plugin (`heeler`, https://github.com/ZingerLittleBee/Heeler) delivers a push when an
// Agent goes Blocked or Done: herdr runs its `notify-hook.js` on every `pane.agent_status_changed`,
// which waits out a debounce, re-checks the pane, and encrypts the details with the Device's
// Notification Key before posting them to Heeler's relay. pumi runs no herdr plugin and no hooks, so
// that hook lives here instead, over a tab's `@status` (OSC 7501): the same wait, the same
// re-check, the same envelope, the same relay.
//
// What Heeler itself writes is unchanged: its Notification Registration, `notifications.json` in the
// `heeler` plugin's config directory (`herdr plugin config-dir heeler` — a local command, so it
// answers on pumi too), one entry per Device with the push token, the APNs environment, the
// Notification Key and which statuses to announce. The file is read before every push, so a Device
// enabled or revoked in the app is followed at once.
//
// PROVENANCE: Heeler `plugin/src/notify-hook.js`, `notification-envelope.js`, `seal-envelope.js`,
// `notification-config.js` and `session.js` @ plugin 0.6.2 (Apache-2.0).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { view } from "./api.ts";
import { log } from "./log.ts";
import { heelerConfigDir } from "./paths.ts";
import { ENVELOPE_VERSION, KEY_BYTES, NONCE_BYTES, seal } from "./seal.ts";

/** Statuses that notify, keyed by the registration's per-Device flag they gate on. */
const NOTIFY_FLAG = { blocked: "blocked", done: "done" } as const;
type NotifyStatus = keyof typeof NOTIFY_FLAG;

const AAD = Buffer.from(`HERDR-NOTIFY:${ENVELOPE_VERSION}`, "utf8");
const APNS_ENVIRONMENTS = new Set(["production", "sandbox"]);
/** Heeler trims display strings to 80 graphemes, the app's own limit. */
const DISPLAY_LIMIT = 80;
const SEND_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RELAY = "https://heeler-apns.bybee.dev";
const DEFAULT_DEBOUNCE_MS = 5_000;
const DEFAULT_ACTIVITY_DEBOUNCE_MS = 1_500;
const DEFAULT_RETRY_DELAY_MS = 1_000;

/** The APNs environments a Device registered with. */
type Environment = "production" | "sandbox";

export interface Device {
  token: string;
  env: Environment;
  key: Buffer;
}

/** What this hook needs: which herdr session it is, and where its own state goes. */
export interface Settings {
  /** The herdr session name (`pumi`, `default`, …), read when an event arrives. */
  session: () => Promise<string>;
  /** pumi's state directory for the package, where dedupe markers go. */
  state?: string;
}

let settings: Settings | undefined;

/** herdr's session name for the `session` option: `default` and `-` are herdr's default session. */
export function hookSession(name: string): string {
  return name === "default" || name === "-" ? "" : name;
}

/** One session's state: the default session keeps the state directory itself, as herdr's hook has. */
export function sessionStateDir(state: string, session: string): string {
  return session === "" ? state : join(state, "sessions", session);
}

/** What `notify.json` says, and what it leaves at Heeler's defaults. */
export function readConfig(dir: string): { relay: string; debounce: number; retry: number; activityDebounce: number } {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(readFileSync(join(dir, "notify.json"), "utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) parsed = value;
  } catch {
    // No file, or not JSON: Heeler's defaults, as its hook has them.
  }
  const text = typeof parsed.relay_url === "string" ? parsed.relay_url.trim().replace(/\/+$/, "") : "";
  const positive = (value: unknown, fallback: number): number => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : fallback);
  return {
    relay: text === "" ? DEFAULT_RELAY : text,
    debounce: positive(parsed.debounce_ms, DEFAULT_DEBOUNCE_MS),
    retry: positive(parsed.retry_delay_ms, DEFAULT_RETRY_DELAY_MS),
    activityDebounce: positive(parsed.activity_debounce_ms, DEFAULT_ACTIVITY_DEBOUNCE_MS),
  };
}

/** A registration entry's `session`: absent ones predate scoping and hear every session. */
export function deliversToSession(entry: Record<string, unknown>, session: string): boolean {
  return typeof entry.session !== "string" ? true : entry.session === session;
}

/** The Devices that asked for this status, from the registration file as it is now. */
export function readDevices(dir: string, session: string, status: NotifyStatus): Device[] {
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(join(dir, "notifications.json"), "utf8"));
  } catch {
    return [];
  }
  if (typeof file !== "object" || file === null) return [];
  const registration = file as { v?: unknown; devices?: unknown };
  if (registration.v !== 1 || !Array.isArray(registration.devices)) return [];
  const devices: Device[] = [];
  for (const value of registration.devices) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.token !== "string" || entry.token === "") continue;
    if (!APNS_ENVIRONMENTS.has(String(entry.env))) continue;
    if (typeof entry.session === "string" && !deliversToSession(entry, session)) continue;
    // The v1 contract fails closed: no flag means do not send.
    const notify = typeof entry.notify === "object" && entry.notify !== null ? (entry.notify as Record<string, unknown>) : {};
    if (notify[NOTIFY_FLAG[status]] !== true) continue;
    const key = typeof entry.key === "string" ? Buffer.from(entry.key, "base64url") : undefined;
    if (key === undefined || key.length !== KEY_BYTES) continue;
    devices.push({ token: entry.token, env: entry.env as Environment, key });
  }
  return devices;
}

/** A registration entry as the file holds it, for the fields a prune keeps. */
function dropDevices(dir: string, tokens: Set<string>): void {
  const path = join(dir, "notifications.json");
  let file: { v?: unknown; devices?: unknown };
  try {
    file = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  if (file === null || typeof file !== "object" || file.v !== 1 || !Array.isArray(file.devices)) return;
  file.devices = file.devices.filter((entry) => {
    const token = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).token : undefined;
    return typeof token !== "string" || !tokens.has(token);
  });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(file));
  renameSync(temp, path);
}

/** One pane's state marker: the status a push was last sent for, so a flapping report does not
 * send one twice and a confirmed departure re-arms it. */
function markerPath(state: string, pane: string): string {
  return join(state, "notify", `${Buffer.from(pane, "utf8").toString("base64url")}.json`);
}

function lastNotified(state: string, pane: string): string | null {
  try {
    const marker = JSON.parse(readFileSync(markerPath(state, pane), "utf8"));
    return typeof marker?.last_notified_status === "string" ? marker.last_notified_status : null;
  } catch {
    return null;
  }
}

function remember(state: string, pane: string, status: string): void {
  const path = markerPath(state, pane);
  mkdirSync(join(state, "notify"), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify({ pane, last_notified_status: status }));
  renameSync(temp, path);
}

function forget(state: string, pane: string): void {
  rmSync(markerPath(state, pane), { force: true });
}

/** What a Device is told: the notification envelope v1's cleartext, sealed under its key. */
export interface Notification {
  paneId: string;
  agentKind: string;
  status: string;
  timestamp: number;
  project?: string;
  title?: string;
}

/** A display string as Heeler's `forDisplay`: 80 graphemes at most, ellipsis included. */
function clamp(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (line === "") return undefined;
  const graphemes = [...line];
  if (graphemes.length <= DISPLAY_LIMIT) return line;
  return `${graphemes.slice(0, DISPLAY_LIMIT - 1).join("").trimEnd()}…`;
}

/** The envelope Heeler's app decrypts: `{v,kid,n,ct}` with the payload as its ciphertext's JSON. */
export function envelope(notification: Notification, key: Buffer, nonce?: Buffer): string {
  const plaintext = JSON.stringify({
    pane: notification.paneId,
    kind: notification.agentKind,
    status: notification.status,
    ts: notification.timestamp,
    ...(notification.project ? { project: notification.project } : {}),
    ...(notification.title ? { title: notification.title } : {}),
  });
  return seal(plaintext, key, AAD, nonce);
}

/** What APNs replaces when a second status of the same pane arrives: opaque to the relay. */
function collapseKey(key: Buffer, pane: string): string {
  return createHash("sha256")
    .update(key)
    .update("HERDR-NOTIFY-COLLAPSE:")
    .update(pane, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

/** Posts one push to Heeler's relay; `pruned` is APNs saying the Device's token is gone. */
async function push(relay: string, retry: number, device: Device, sealed: string, collapse: string): Promise<"ok" | "pruned"> {
  const body = JSON.stringify({ token: device.token, env: device.env, envelope: sealed, collapse });
  let failure = "";
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await Bun.sleep(retry);
    let response: Response;
    try {
      response = await fetch(`${relay}/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      failure = `the relay could not be reached: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    if (response.ok) return "ok";
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    if (response.status === 410) return "pruned";
    failure = `the relay answered ${response.status}: ${detail}`;
    if (response.status !== 429 && response.status < 500) break;
  }
  throw new Error(failure);
}

/** The pane's agent status and the details a push carries, as pumi has them now; undefined when
 * the pane is gone. */
async function look(pane: number): Promise<{ status: string; paneId: string; agentKind: string; project?: string; title?: string } | undefined> {
  const v = await view();
  const paneId = v.paneId(pane);
  const info = v.paneInfo(pane, 0);
  if (info === undefined) return undefined;
  const session = v.session(info.workspace_id);
  const project = session === undefined ? undefined : v.sessions.find((one) => one.id === session)?.name;
  return {
    status: info.agent_status,
    paneId,
    agentKind: info.agent ?? "unknown",
    project: clamp(project),
    title: clamp(info.terminal_title_stripped ?? info.title),
  };
}

/** One pane's hook at a time: a burst of `@status` reports (a program re-reporting, a tab with
 * several) must not race its own debounce and send the same push twice. Later reports queue behind
 * the one running; each then sees the marker the one before it wrote. */
const chains = new Map<string, Promise<void>>();

/** The `@status` hook: a pane's status changed to `status`. */
export function status(pane: number, status: string): void {
  const hook = settings;
  if (hook === undefined) return;
  const key = paneId(pane);
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous
    .then(() => announce(hook, pane, status))
    .catch((err) => log(`notify: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
}

/** The pane is gone: its marker is stale. */
export function closed(pane: number): void {
  const hook = settings;
  if (hook === undefined || hook.state === undefined) return;
  void hook
    .session()
    .then((name) => forget(sessionStateDir(hook.state as string, hookSession(name)), paneId(pane)))
    .catch(() => {});
}

function paneId(pane: number): string {
  return `%${pane}`;
}

/**
 * What herdr's event hook does, in order: cheap exits, the debounce, the re-check, and the push.
 * `status` is the new `@status`; the re-check is what is sent.
 */
async function announce(hook: Settings, pane: number, status: string): Promise<void> {
  if (hook.state === undefined) return;
  const normalized = status === "error" ? "done" : status;
  const worth = normalized === "blocked" || normalized === "done" ? (normalized as NotifyStatus) : undefined;
  const dir = heelerConfigDir();
  const session = hookSession(await hook.session());
  const state = sessionStateDir(hook.state, session);
  const marker = paneId(pane);
  const last = lastNotified(state, marker);
  const devices = worth === undefined ? [] : readDevices(dir, session, worth);
  if (worth !== undefined && (last === worth || devices.length === 0)) return;
  if (worth === undefined && last === null) return;
  const config = readConfig(dir);
  await Bun.sleep(config.debounce);
  const after = await look(pane);
  if (after === undefined) {
    forget(state, marker);
    return;
  }
  if (after.status !== normalized) return;
  if (worth === undefined) {
    // A confirmed departure (working, idle, …) re-arms the pane.
    forget(state, marker);
    return;
  }
  if (lastNotified(state, marker) === worth) return;
  const now = readDevices(dir, session, worth);
  if (now.length === 0) return;
  const notification: Notification = {
    paneId: after.paneId,
    agentKind: after.agentKind,
    status: worth,
    timestamp: Math.floor(Date.now() / 1000),
    project: after.project,
    title: after.title,
  };
  const pruned = new Set<string>();
  const failures: string[] = [];
  let delivered = false;
  for (const device of now) {
    try {
      const sealed = envelope(notification, device.key);
      const outcome = await push(config.relay, config.retry, device, sealed, collapseKey(device.key, notification.paneId));
      if (outcome === "pruned") pruned.add(device.token);
      else delivered = true;
    } catch (err) {
      failures.push(`a push to ${device.token.slice(0, 8)}… failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (pruned.size > 0) dropDevices(dir, pruned);
  if (failures.length > 0) log(`notify: ${failures.join("; ")}`);
  if (delivered) {
    const sent = now.length - pruned.size;
    log(`notify: ${notification.paneId} ${worth} → ${sent} device${sent === 1 ? "" : "s"}`);
    remember(state, marker, worth);
  }
}

/** Start sending Heeler's notifications: from here on, `status` and `closed` are what fire. */
export function start(setup: Settings): void {
  settings = setup;
}
