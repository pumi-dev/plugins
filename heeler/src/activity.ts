// Heeler's Live Activity, updated from pumi.
//
// Heeler runs one Live Activity per Host while the app is in the background: the app starts it and
// writes the per-activity APNs token (with the Device's pins and Agent List Fields layout) into its
// Notification Registration entry; herdr's activity hook then pushes `update` and `end` to Heeler's
// relay from `pane.agent_status_changed`, one envelope per Device, sealed under the same Notification
// Key as alerts but with AAD `HERDR-ACTIVITY:1`. pumi runs no herdr plugin, so that hook lives here,
// over pumi's own `@agent_status`: the same latest-wins debounce, the same unchanged-snapshot
// suppression, the same canonical content-state, the same size degradation and the same relay.
//
// PROVENANCE: Heeler `plugin/src/activity-hook.js`, `activity-state.js`, `activity-envelope.js`,
// `activity-rows.js` and `docs/agents/live-activity-contract.md` @ plugin 0.6.2 (Apache-2.0).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { view } from "./api.ts";
import { log } from "./log.ts";
import { heelerConfigDir } from "./paths.ts";
import { deliversToSession, hookSession, readConfig, sessionStateDir, type Settings } from "./notify.ts";
import { ENVELOPE_VERSION, KEY_BYTES, seal } from "./seal.ts";
import type { AgentInfo, Json, PaneInfo, TabInfo } from "./types.ts";

export const ACTIVITY_AAD = Buffer.from(`HERDR-ACTIVITY:${ENVELOPE_VERSION}`, "utf8");

/** The statuses the Live Activity shows; idle and unknown panes stay hidden. */
export const ELIGIBLE = new Set(["working", "blocked", "done"]);

/** The sort order of the visible agents: what needs you first. */
const RANK: Record<string, number> = { blocked: 0, done: 1, working: 2 };

/** The visible agents at most; `counts` always cover the whole inventory. */
const CAP = 5;
const APNS_ENVIRONMENTS = new Set(["production", "sandbox"]);
const ACTIVITY_TOKEN = /^[0-9a-f]{16,200}$/;
const STALE_AFTER_SECONDS = 900;
const CT_BUDGET = 2800;
const APNS_PAYLOAD_BUDGET = 4096;
const RELAY_REQUEST_BUDGET = 8192;
const DISPLAY_LIMIT = 80;
const SEND_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const BUILTINS = new Set([
  "state_icon",
  "state_text",
  "workspace",
  "tab",
  "pane",
  "agent",
  "terminal_title",
  "terminal_title_stripped",
  "host",
  "status",
  "directory",
]);

export type Environment = "production" | "sandbox";

/** One styled piece of a rendered Agent row. */
export interface Span {
  text: string;
  bold?: boolean;
  dim?: boolean;
  fg?: string;
}

export type Row = Span[];

export interface Field {
  token: string;
  fg?: string;
  bold?: boolean;
  dim?: boolean;
}

/** The app's resolved Agent List Fields layout, as it registered it. */
export interface Layout {
  rows: Field[][];
}

/** The decrypted content-state's details: counts stay in the clear, these do not. */
export interface PlaintextAgent {
  kind: string;
  name?: string;
  pane: string;
  rows?: Row[];
  status: string;
  title?: string;
  workspace?: string;
}

export interface Plaintext {
  agents: PlaintextAgent[];
  host: string;
  v: 1;
}

export interface Counts {
  working: number;
  blocked: number;
  done: number;
}

export interface ActivityState {
  counts: Counts;
  plaintext: Plaintext;
}

/** What is known about a workspace's tab, for a `tab` field. */
export interface TabContext {
  label: string;
  workspace_id: string;
  position: number;
  count: number;
}

/** What is known about a pane, for a `pane` field. */
export interface PaneContext {
  label?: string;
  workspace_id: string;
  tab_id: string;
}

/** A Device that asked for Live Activity updates. */
export interface ActivityDevice {
  /** The Live Activity's own APNs push token. */
  token: string;
  env: Environment;
  key: Buffer;
  /** Pane pins, most recently pinned first; reorders the visible agents only. */
  pinned: string[];
  layout: Layout | null;
  /** The app's configured Host name, when it has one. */
  host?: string;
}

export interface ActivityInput {
  agents: AgentInfo[];
  host: string;
  pins?: unknown;
  labels?: Map<string, string>;
  layout?: Layout | null;
  rowHost?: string;
  tabs?: Map<string, TabContext>;
  panes?: Map<string, PaneContext>;
}

/** A non-empty string, as Heeler reads its display fields. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Heeler's `forDisplay`: 80 graphemes at most, ellipsis included. */
export function display(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const graphemes = [...value];
  if (graphemes.length <= DISPLAY_LIMIT) return value;
  return `${graphemes.slice(0, DISPLAY_LIMIT - 1).join("").trimEnd()}…`;
}

/** The Host machine's short name: the first DNS label, at most 80 graphemes. */
export function shortHostName(name: string = hostname()): string {
  return display(String(name).split(".")[0] ?? "") ?? "";
}

/** Pane pins are lenient: a missing or malformed list is empty, never an error. */
export function parsePins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.every((entry) => typeof entry === "string") ? (value as string[]) : [];
}

/** A layout is only used whole: one bad field and the legacy identity is drawn instead. */
export function parseLayout(value: unknown): Layout | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const rows = (value as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length > 3) return null;
  const parsed: Field[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length > 16) return null;
    const fields: Field[] = [];
    for (const field of row) {
      if (typeof field !== "object" || field === null || Array.isArray(field)) return null;
      const { token, fg, bold, dim } = field as Record<string, unknown>;
      if (typeof token !== "string") return null;
      if (!BUILTINS.has(token) && !/^\$[A-Za-z0-9_-]{1,32}$/.test(token)) return null;
      const entry: Field = { token };
      if (fg !== undefined && fg !== null) {
        if (typeof fg !== "string" || !COLOR.test(fg)) return null;
        entry.fg = fg;
      }
      for (const key of ["bold", "dim"] as const) {
        const flag = key === "bold" ? bold : dim;
        if (flag !== undefined && flag !== null) {
          if (typeof flag !== "boolean") return null;
          entry[key] = flag;
        }
      }
      fields.push(entry);
    }
    parsed.push(fields);
  }
  return { rows: parsed };
}

/** Heeler's one-glyph fallback for a stripped title: a leading activity glyph is dropped. */
function strippedTitle(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const [first] = [...trimmed];
  if (!first) return trimmed;
  const scalar = first.codePointAt(0) ?? 0;
  if (!(scalar >= 0x2800 && scalar <= 0x28ff) && !"·✢✳✶✻✽◐◓◑◒".includes(first)) return trimmed;
  const rest = trimmed.slice(first.length);
  return rest.length === 0 || /^\s/u.test(rest) ? rest.trim() : trimmed;
}

/** The first 80 graphemes of a row's text, without an ellipsis. */
function rowText(value: string): string {
  return [...GRAPHEMES.segment(value)].slice(0, DISPLAY_LIMIT).map(({ segment }) => segment).join("");
}

/** One agent's fields rendered through a Device's layout; null when the Device has none. */
export function renderRows(
  layout: Layout | null | undefined,
  agent: AgentInfo,
  context: { hostName: string; labels?: Map<string, string>; tabs?: Map<string, TabContext>; panes?: Map<string, PaneContext> },
): Row[] | null {
  if (layout === null || layout === undefined) return null;
  const tab = context.tabs?.get(agent.tab_id);
  const pane = context.panes?.get(agent.pane_id);
  const matchingTab = tab?.workspace_id === agent.workspace_id ? tab : undefined;
  const matchingPane =
    pane?.workspace_id === agent.workspace_id && pane.tab_id === agent.tab_id ? pane : undefined;
  const value = (token: string): string | undefined => {
    switch (token) {
      case "workspace":
        return context.labels?.get(agent.workspace_id);
      case "tab":
        // The sole tab of a workspace is not repeated when its label is just its number.
        return matchingTab && (matchingTab.count > 1 || matchingTab.label !== String(matchingTab.position))
          ? matchingTab.label
          : undefined;
      case "pane":
        return agent.title ?? matchingPane?.label;
      case "agent":
        return text(agent.display_agent) ?? text(agent.name) ?? agent.agent ?? "unknown";
      case "terminal_title":
        return agent.terminal_title;
      case "terminal_title_stripped":
        return agent.terminal_title_stripped ?? strippedTitle(agent.terminal_title);
      case "host":
        return context.hostName.trim();
      case "status": {
        const status = agent.agent_status.toLowerCase();
        return status.charAt(0).toUpperCase() + status.slice(1);
      }
      case "directory":
        return typeof agent.cwd === "string" ? agent.cwd.trim() : undefined;
      default:
        return token.startsWith("$") ? agent.tokens?.[token.slice(1)] : undefined;
    }
  };
  return layout.rows
    .map((row) => {
      const spans: Row = [];
      for (const field of row) {
        const raw = value(field.token);
        if (typeof raw !== "string" || raw.trim() === "") continue;
        if (spans.length > 0) spans.push({ text: " · " });
        const span: Span = { text: rowText(raw) };
        if (field.fg !== undefined) span.fg = field.fg;
        if (field.bold !== undefined) span.bold = field.bold;
        if (field.dim !== undefined) span.dim = field.dim;
        spans.push(span);
      }
      return spans;
    })
    .filter((row) => row.length > 0);
}

/** What Heeler draws: the eligible counts, and the capped, sorted agents that go encrypted. */
export function buildActivityState({ agents, host, pins, labels, layout, rowHost, tabs, panes }: ActivityInput): ActivityState {
  const counts: Counts = { working: 0, blocked: 0, done: 0 };
  const eligible: { agent: AgentInfo; pane: string; status: string }[] = [];
  for (const agent of agents) {
    const pane = text(agent.pane_id);
    const status = agent.agent_status.toLowerCase();
    if (pane === undefined || !ELIGIBLE.has(status)) continue;
    counts[status as keyof Counts] += 1;
    eligible.push({ agent, pane, status });
  }
  const pinIndex = new Map<string, number>();
  for (const pane of parsePins(pins)) if (!pinIndex.has(pane)) pinIndex.set(pane, pinIndex.size);
  eligible.sort((left, right) => {
    const leftPinned = pinIndex.get(left.pane);
    const rightPinned = pinIndex.get(right.pane);
    if (leftPinned !== undefined && rightPinned !== undefined) return leftPinned - rightPinned;
    if (leftPinned !== undefined) return -1;
    if (rightPinned !== undefined) return 1;
    const rank = RANK[left.status] - RANK[right.status];
    if (rank !== 0) return rank;
    return left.pane < right.pane ? -1 : left.pane > right.pane ? 1 : 0;
  });
  const hostName = display(host) ?? "";
  const visible = eligible.slice(0, CAP).map(({ agent, pane, status }) => {
    const name = display(text(agent.display_agent) ?? text(agent.name));
    const title = display(text(agent.terminal_title_stripped) ?? text(agent.terminal_title));
    const workspace = display(text(labels?.get(agent.workspace_id)));
    const rows = renderRows(layout, agent, { hostName: rowHost ?? hostName, labels, tabs, panes });
    return {
      kind: text(agent.agent) ?? "unknown",
      ...(name === undefined ? {} : { name }),
      pane,
      ...(rows === null ? {} : { rows }),
      status,
      ...(title === undefined ? {} : { title }),
      ...(workspace === undefined ? {} : { workspace }),
    };
  });
  return { counts, plaintext: { agents: visible, host: hostName, v: 1 } };
}

/**
 * The canonical plaintext: compact JSON, keys in ascending alphabetical order at every level, so
 * the bytes Heeler's app opens are the bytes it expects.
 */
export function canonicalActivity(plaintext: Plaintext): string {
  return JSON.stringify({
    agents: plaintext.agents.map((agent) => {
      const entry: Record<string, Json> = {};
      entry.kind = agent.kind;
      if (agent.name !== undefined) entry.name = agent.name;
      entry.pane = agent.pane;
      if (agent.rows !== undefined) {
        entry.rows = agent.rows.map((row) =>
          row.map((span) => {
            const field: Record<string, Json> = {};
            if (span.bold !== undefined) field.bold = span.bold;
            if (span.dim !== undefined) field.dim = span.dim;
            if (span.fg !== undefined) field.fg = span.fg;
            field.text = span.text;
            return field;
          }),
        );
      }
      entry.status = agent.status;
      if (agent.title !== undefined) entry.title = agent.title;
      if (agent.workspace !== undefined) entry.workspace = agent.workspace;
      return entry;
    }),
    host: plaintext.host,
    v: plaintext.v,
  });
}

/** An activity envelope: the plaintext sealed for the Live Activity domain. */
export function sealActivity(plaintext: Plaintext, key: Buffer, nonce?: Buffer): string {
  return seal(canonicalActivity(plaintext), key, ACTIVITY_AAD, nonce);
}

/** The plaintext at a size-degradation step: 0 full, 1 no title/name, 2 no rows, 3 no agents. */
export function plaintextAtStep(plaintext: Plaintext, step: number): Plaintext {
  const noTitles: Plaintext = {
    agents: plaintext.agents.map((agent) => {
      const entry: PlaintextAgent = { kind: agent.kind, pane: agent.pane, status: agent.status };
      if (agent.rows !== undefined) entry.rows = agent.rows;
      if (agent.workspace !== undefined) entry.workspace = agent.workspace;
      return entry;
    }),
    host: plaintext.host,
    v: plaintext.v,
  };
  if (step <= 0) return plaintext;
  if (step === 1) return noTitles;
  if (step === 2) {
    return { agents: noTitles.agents.map(({ rows: _rows, ...agent }) => agent), host: plaintext.host, v: plaintext.v };
  }
  return { agents: [], host: plaintext.host, v: plaintext.v };
}

export interface ActivityRequest {
  event: "update" | "end";
  priority: 5 | 10;
  timestamp: number;
  counts: Counts;
}

/** What one Device's registration says about Live Activities. */
export function readActivityDevices(dir: string, session: string): ActivityDevice[] {
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(join(dir, "notifications.json"), "utf8"));
  } catch {
    return [];
  }
  if (typeof file !== "object" || file === null) return [];
  const registration = file as { v?: unknown; devices?: unknown };
  if (registration.v !== 1 || !Array.isArray(registration.devices)) return [];
  const devices: ActivityDevice[] = [];
  for (const value of registration.devices) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (!deliversToSession(entry, session)) continue;
    const live = entry.live_activity;
    if (typeof live !== "object" || live === null || Array.isArray(live)) continue;
    const activity = live as Record<string, unknown>;
    if (typeof activity.token !== "string" || !ACTIVITY_TOKEN.test(activity.token)) continue;
    const env = APNS_ENVIRONMENTS.has(String(activity.env)) ? (activity.env as Environment) : (entry.env as Environment);
    if (!APNS_ENVIRONMENTS.has(String(env))) continue;
    const key = typeof entry.key === "string" ? Buffer.from(entry.key, "base64url") : undefined;
    if (key === undefined || key.length !== KEY_BYTES) continue;
    devices.push({
      token: activity.token,
      env,
      key,
      pinned: parsePins(activity.pinned_pane_ids),
      layout: parseLayout(activity.row_layout),
      host: text(activity.host_name),
    });
  }
  return devices;
}

/** APNs said a Live Activity is gone: drop only that field, keeping the alert registration. */
function pruneActivity(dir: string, tokens: Set<string>): void {
  const path = join(dir, "notifications.json");
  let file: { v?: unknown; devices?: unknown };
  try {
    file = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  if (file === null || typeof file !== "object" || file.v !== 1 || !Array.isArray(file.devices)) return;
  for (const entry of file.devices) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const live = record.live_activity;
    if (typeof live === "object" && live !== null && tokens.has(String((live as Record<string, unknown>).token))) {
      delete record.live_activity;
    }
  }
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(file));
  renameSync(temp, path);
}

function activityDir(state: string): string {
  return join(state, "activity");
}

function lastStatePath(state: string): string {
  return join(activityDir(state), "last-state.json");
}

function claimPath(state: string): string {
  return join(activityDir(state), "claim.json");
}

interface LastState {
  statuses?: Record<string, string>;
  preferences?: string;
  ended?: boolean;
}

function readLastState(state: string): LastState | null {
  try {
    const value = JSON.parse(readFileSync(lastStatePath(state), "utf8"));
    return typeof value === "object" && value !== null ? (value as LastState) : null;
  } catch {
    return null;
  }
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, path);
}

function writeLastState(state: string, last: LastState & { sent_at_ms: number }): void {
  writeAtomic(lastStatePath(state), last);
}

interface Claim {
  seq: number;
  at: number;
}

let claims = 0;

function writeClaim(state: string, claim: Claim): void {
  writeAtomic(claimPath(state), claim);
}

function readClaim(state: string): Claim | null {
  try {
    const value = JSON.parse(readFileSync(claimPath(state), "utf8"));
    return typeof value === "object" && value !== null ? (value as Claim) : null;
  } catch {
    return null;
  }
}

/** What decides whether a Live Activity push is worth sending: the eligible panes and the
 * Devices' preferences (pins, layout, Host name). */
function eligibleStatuses(agents: AgentInfo[]): Record<string, string> {
  const statuses: Record<string, string> = {};
  for (const agent of agents) {
    const pane = text(agent.pane_id);
    const status = agent.agent_status.toLowerCase();
    if (pane !== undefined && ELIGIBLE.has(status)) statuses[pane] = status;
  }
  return statuses;
}

function sameStatuses(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left).sort();
  const others = Object.keys(right).sort();
  if (keys.length !== others.length) return false;
  return keys.every((key, index) => key === others[index] && left[key] === right[key]);
}

/** Priority 10 only when a pane is blocked now and was not blocked before. */
function newlyBlocked(current: Record<string, string>, previous: Record<string, string> | undefined): boolean {
  return Object.entries(current).some(([pane, status]) => status === "blocked" && previous?.[pane] !== "blocked");
}

function preferenceHash(devices: ActivityDevice[]): string {
  const preferences = devices
    .map((device) => ({
      token: device.token,
      env: device.env,
      pins: device.pinned,
      layout: device.layout,
      host: device.host,
    }))
    .sort((left, right) => left.token.localeCompare(right.token));
  return createHash("sha256").update(JSON.stringify(preferences)).digest("hex");
}

function projectedBytes(envelope: string, request: ActivityRequest): number {
  const aps = {
    aps: {
      timestamp: request.timestamp,
      event: request.event,
      "content-state": { counts: request.counts, envelope: JSON.parse(envelope) },
      [request.event === "update" ? "stale-date" : "dismissal-date"]:
        request.event === "update" ? request.timestamp + STALE_AFTER_SECONDS : request.timestamp,
    },
  };
  return Buffer.byteLength(JSON.stringify(aps));
}

export function relayBody(device: ActivityDevice, envelope: string, request: ActivityRequest): Record<string, Json> {
  return {
    kind: "liveactivity",
    token: device.token,
    env: device.env,
    event: request.event,
    priority: request.priority,
    timestamp: request.timestamp,
    counts: request.counts as unknown as Json,
    envelope,
    ...(request.event === "update"
      ? { stale_date: request.timestamp + STALE_AFTER_SECONDS }
      : { dismissal_date: request.timestamp }),
  };
}

/** Whether an envelope fits the Live Activity budgets the app enforces. */
function fits(envelope: string, device: ActivityDevice, request: ActivityRequest): boolean {
  let parsed: { ct?: unknown };
  try {
    parsed = JSON.parse(envelope) as { ct?: unknown };
  } catch {
    return false;
  }
  if (typeof parsed.ct !== "string" || parsed.ct.length > CT_BUDGET) return false;
  if (projectedBytes(envelope, request) > APNS_PAYLOAD_BUDGET) return false;
  return Buffer.byteLength(JSON.stringify(relayBody(device, envelope, request))) <= RELAY_REQUEST_BUDGET;
}

/** Posts one Live Activity push; `pruned` is APNs saying the activity is gone, `too_large` is the
 * relay refusing the payload. */
async function post(relay: string, retry: number, body: Record<string, Json>, token: string): Promise<"ok" | "pruned" | "too_large"> {
  const payload = JSON.stringify(body);
  let failure = "";
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await Bun.sleep(retry);
    let response: Response;
    try {
      response = await fetch(`${relay}/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      failure = `the relay could not be reached: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    if (response.ok) return "ok";
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    if (response.status === 410) return "pruned";
    if (response.status === 413 && relayOrigin(detail)) return "too_large";
    failure = `the relay answered ${response.status}: ${detail}`;
    if (response.status !== 429 && response.status < 500) break;
  }
  throw new Error(`a Live Activity push to ${token.slice(0, 8)}… failed: ${failure}`);
}

/** The relay's own 413 says `{"error": …}`; APNs' payload-too-large does not. */
function relayOrigin(detail: string): boolean {
  try {
    const parsed = JSON.parse(detail) as { error?: unknown };
    return typeof parsed.error === "string";
  } catch {
    return false;
  }
}

/** One Device's update, degraded step by step until it fits. */
export async function deliverActivity(
  relay: string,
  retry: number,
  device: ActivityDevice,
  plaintext: Plaintext,
  request: ActivityRequest,
): Promise<"ok" | "pruned"> {
  let step = 0;
  let envelope = sealActivity(plaintextAtStep(plaintext, step), device.key);
  while (step < 3 && !fits(envelope, device, request)) {
    step += 1;
    envelope = sealActivity(plaintextAtStep(plaintext, step), device.key);
  }
  for (;;) {
    const outcome = await post(relay, retry, relayBody(device, envelope, request), device.token);
    if (outcome === "ok" || outcome === "pruned") return outcome;
    if (step < 3) {
      step += 1;
      envelope = sealActivity(plaintextAtStep(plaintext, step), device.key);
      continue;
    }
    throw new Error(`the Live Activity payload did not fit APNs' budget`);
  }
}

let settings: Settings | undefined;

/** Start following agents for Heeler's Live Activity; from here on, `status` is what fires. */
export function start(setup: Settings): void {
  settings = setup;
}

/** An agent's `@agent_status` changed: the activity hook looks once the change settles. */
export function status(_pane: number, status: string): void {
  const hook = settings;
  if (hook === undefined) return;
  void update(hook, status.toLowerCase()).catch((err) => log(`activity: ${err instanceof Error ? err.message : String(err)}`));
}

/**
 * What herdr's activity hook does, in order: cheap exits, the latest-wins debounce, the unchanged
 * snapshot, then one update (or an end) per Device.
 */
async function update(hook: Settings, incoming: string): Promise<void> {
  if (hook.state === undefined) return;
  const dir = heelerConfigDir();
  const session = hookSession(await hook.session());
  const state = sessionStateDir(hook.state, session);
  const config = readConfig(dir);
  // Cheap exits before burning a debounce on a no-op.
  if (readActivityDevices(dir, session).length === 0) return;
  const last = readLastState(state);
  if (last?.ended === true && !ELIGIBLE.has(incoming)) return;
  // Latest wins: an overlapping hook that started later supersedes this one.
  const claim: Claim = { seq: ++claims, at: Date.now() };
  writeClaim(state, claim);
  await Bun.sleep(config.activityDebounce);
  if ((readClaim(state)?.seq ?? 0) > claim.seq) return;
  const devices = readActivityDevices(dir, session);
  if (devices.length === 0) return;
  const v = await view();
  const snapshot = v.snapshot(() => 0);
  const statuses = eligibleStatuses(snapshot.agents);
  const preferences = preferenceHash(devices);
  if (last?.statuses !== undefined && sameStatuses(statuses, last.statuses) && last.preferences === preferences) return;
  const empty = Object.keys(statuses).length === 0;
  if (empty && last?.ended === true) return;
  const labels = new Map(snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace.label]));
  const context = empty ? undefined : rowContext(snapshot.tabs, snapshot.panes, devices);
  const request: ActivityRequest = {
    event: empty ? "end" : "update",
    priority: newlyBlocked(statuses, last?.statuses) ? 10 : 5,
    timestamp: Math.floor(Date.now() / 1000),
    counts: { working: 0, blocked: 0, done: 0 },
  };
  const host = shortHostName();
  const pruned = new Set<string>();
  const failures: string[] = [];
  let delivered = false;
  let counts = request.counts;
  for (const device of devices) {
    const content = empty
      ? { counts: { working: 0, blocked: 0, done: 0 }, plaintext: { agents: [], host, v: 1 as const } }
      : buildActivityState({
          agents: snapshot.agents,
          host,
          pins: device.pinned,
          labels,
          layout: device.layout,
          rowHost: device.host,
          tabs: context?.tabs,
          panes: context?.panes,
        });
    counts = content.counts;
    try {
      const outcome = await deliverActivity(config.relay, config.retry, device, content.plaintext, { ...request, counts: content.counts });
      if (outcome === "ok") delivered = true;
      else pruned.add(device.token);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (pruned.size > 0) pruneActivity(dir, pruned);
  if (failures.length > 0) log(`activity: ${failures.join("; ")}`);
  if (delivered) {
    const sent = devices.length - pruned.size;
    log(`activity: ${request.event} (${counts.working}w ${counts.blocked}b ${counts.done}d) → ${sent} device${sent === 1 ? "" : "s"}`);
    writeLastState(state, {
      sent_at_ms: Date.now(),
      statuses,
      preferences,
      ended: request.event === "end",
    });
  }
}

/** Tab and pane context, read once and only when a Device's layout asks for it. */
function rowContext(
  tabs: TabInfo[],
  panes: PaneInfo[],
  devices: ActivityDevice[],
): { tabs: Map<string, TabContext>; panes: Map<string, PaneContext> } {
  const tokens = new Set<string>();
  for (const device of devices) {
    for (const row of device.layout?.rows ?? []) for (const field of row) tokens.add(field.token);
  }
  const tabContext = new Map<string, TabContext>();
  const paneContext = new Map<string, PaneContext>();
  if (!tokens.has("tab") && !tokens.has("pane")) return { tabs: tabContext, panes: paneContext };
  if (tokens.has("tab")) {
    const counts = new Map<string, number>();
    for (const tab of tabs) counts.set(tab.workspace_id, (counts.get(tab.workspace_id) ?? 0) + 1);
    for (const tab of tabs) {
      tabContext.set(tab.tab_id, {
        label: tab.label,
        workspace_id: tab.workspace_id,
        position: tab.number,
        count: counts.get(tab.workspace_id) ?? 0,
      });
    }
  }
  if (tokens.has("pane")) {
    for (const pane of panes) {
      paneContext.set(pane.pane_id, { label: pane.label, workspace_id: pane.workspace_id, tab_id: pane.tab_id });
    }
  }
  return { tabs: tabContext, panes: paneContext };
}
