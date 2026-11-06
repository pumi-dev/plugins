// herdr's methods over pumi: each reads the core's state, calls the core's functions, and answers
// in herdr's shapes (`{"type": …, …}`). Methods for herdr's TUI, plugins and remotes answer
// `unsupported` at once, from `methods.ts`; the ones herdr has and pumi has not answers
// `unsupported` too, saying so.
//
// Nothing here keeps a screen: a pane's text is `tab.call`'s `read`, its keys are `{"keys": […]}` on
// the same call (the host encodes them for the modes the program set), and what an agent is doing
// is the tab's `@status`, with its name in the Agents plugin's trait (`@pumi_dev.agents.agent`).
import { join } from "node:path";
import { call, option, workspace, type Session, type Tab, type View as ViewModel } from "pumi";
import { terminal, workspace as workspaceId } from "./ids.ts";
import { find } from "./methods.ts";
import { heelerConfigDir } from "./paths.ts";
import { HEELER_PLUGIN_VERSION, HERDR_PROTOCOL, HERDR_VERSION, codes, result, type Code } from "./protocol.ts";
import { revision, type Envelope } from "./state.ts";
import {
  READ_FORMATS,
  READ_SOURCES,
  parseAgentStatus,
  type AgentInfo,
  type Json,
  type PaneInfo,
  type PaneProcessInfo,
  type ReadFormat,
  type ReadSource,
  type SplitDirection,
} from "./types.ts";
import { View } from "./view.ts";

/** A pane's id, as the API has it: herdr reads numbers, the wire takes `%3`.
 *
 * herdr's panes are pumi's tabs (`%`), and its tabs are pumi's views (`@`). */
export function paneRef(number: number): string {
  return `%${number}`;
}

/** A tab's id, as the API has it: herdr reads numbers, the wire takes `@3`. */
function tabRef(number: number): string {
  return `@${number}`;
}

/** The pane `number` names, as the SDK's model of it: a tab on the terminal engine, whose methods are
 * the API's calls (`read`, `input`, `focus`). */
function paneModel(number: number): Tab {
  const tab = workspace.getTab(paneRef(number));
  if (tab === null) throw new Fail(codes.PANE_NOT_FOUND, `pane not found: ${number}`);
  return tab;
}

/** The tab `number` names, as the SDK's model of it: a view, which is herdr's tab. */
function tabModel(number: number): ViewModel {
  const view = workspace.getView(tabRef(number));
  if (view === null) throw new Fail(codes.TAB_NOT_FOUND, `tab not found: ${number}`);
  return view;
}

/** The session `number` names, as the SDK's model of it. */
function sessionModel(number: number): Session {
  const session = workspace.getSession(`$${number}`);
  if (session === null) throw new Fail(codes.WORKSPACE_NOT_FOUND, `workspace not found: ${number}`);
  return session;
}

/** herdr's error: a code and a message. */
export class Fail extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message);
    this.name = "Fail";
  }
}

/** A call the core refused, as herdr's error. */
export function fromApi(err: unknown): Fail {
  const kind = (err as { kind?: unknown } | null)?.kind;
  const code: Code =
    kind === "not_found" ? codes.NOT_FOUND : kind === "invalid_params" ? codes.INVALID_PARAMS : kind === "timeout" ? codes.TIMEOUT : codes.INTERNAL;
  return new Fail(code, err instanceof Error ? err.message : String(err));
}

/**
 * A call of the core's, its refusal as herdr's. Some of the calls here are the wire's own
 * (`server.getState`, `server.kill`, `server.restart`): they are out of the SDK, and `call` reaches
 * them by name.
 */
async function ask(name: string, ...args: Json[]): Promise<Json> {
  try {
    return (await call(name, ...args)) as Json;
  } catch (err) {
    throw fromApi(err);
  }
}

function isObject(value: Json | undefined): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A request's params. */
class Params {
  private readonly at: Record<string, Json>;

  constructor(value: Json | undefined) {
    this.at = isObject(value) ? value : {};
  }

  get(key: string): Json | undefined {
    return this.at[key] ?? undefined;
  }

  optStr(key: string): string | undefined {
    const value = this.at[key];
    return typeof value === "string" ? value : undefined;
  }

  str(key: string): string {
    const value = this.optStr(key);
    if (value === undefined) throw new Fail(codes.INVALID_PARAMS, `missing \`${key}\``);
    return value;
  }

  bool(key: string, fallback: boolean): boolean {
    const value = this.at[key];
    return typeof value === "boolean" ? value : fallback;
  }

  strings(key: string): string[] {
    const value = this.at[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }
}

/** A param that is one of `values`, or nothing at all. */
function enumParam<T extends string>(p: Params, key: string, values: readonly T[]): T | undefined {
  const value = p.get(key);
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
  throw new Fail(codes.INVALID_PARAMS, `\`${key}\`: expected ${values.map((one) => `\`${one}\``).join(", ")}`);
}

/** The model as the core has it now. */
export async function view(): Promise<View> {
  const state = await ask("server.getState");
  return View.fromState(isObject(state) ? state.state : undefined);
}

/** The pane a new one opens with: herdr's `cwd`, `env` and `command`, and nothing else. */
function launch(p: Params): Record<string, Json> {
  const args: Record<string, Json> = {};
  const cwd = p.optStr("cwd");
  if (cwd !== undefined) args.cwd = cwd;
  const env = p.get("env");
  if (isObject(env)) args.env = env;
  const command = p.get("command");
  if (command !== undefined && command !== null) args.command = command;
  return args;
}

function workspaceOf(v: View, p: Params): number {
  const id = p.str("workspace_id");
  const workspace = v.session(id);
  if (workspace === undefined) throw new Fail(codes.WORKSPACE_NOT_FOUND, `workspace not found: ${id}`);
  return workspace;
}

function tabOf(v: View, p: Params): number {
  const id = p.str("tab_id");
  const tab = v.tab(id);
  if (tab === undefined) throw new Fail(codes.TAB_NOT_FOUND, `tab not found: ${id}`);
  return tab;
}

function paneOf(v: View, id: string): number {
  const pane = v.pane(id);
  if (pane === undefined) throw new Fail(codes.PANE_NOT_FOUND, `pane not found: ${id}`);
  return pane;
}

/** A pane's object, as it is now. */
async function paneInfo(pane: number): Promise<PaneInfo> {
  const v = await view();
  const info = v.paneInfo(pane, revision(pane));
  if (info === undefined) throw new Fail(codes.PANE_NOT_FOUND, "the pane is not in a tab");
  return info;
}

/** The text of a pane, from the core's own terminal (`tab.call`'s `read`): the last `lines` rows
 * it keeps. The core keeps text, not a screen, so nothing is truncated and there is no unwrapped
 * or visible variant. */
async function read(pane: number, lines: number | undefined): Promise<string> {
  try {
    await workspace.ready;
    const answered = await paneModel(pane).read({ source: "recent", lines: lines ?? 80 });
    return typeof answered?.text === "string" ? answered.text : "";
  } catch {
    return "";
  }
}

/** Keys by name, encoded for the modes the pane's program set (the host does that). */
async function keys(pane: number, names: string[]): Promise<void> {
  if (names.length === 0) return;
  await paneModel(pane).input({ keys: names });
}

async function write(pane: number, text: string): Promise<void> {
  await paneModel(pane).input({ text });
}

/** Opens a tab with `block` (`null`: what a new tab holds), `args` and `place`, and answers the
 * number herdr reads it by: a terminal is a tab, so herdr's panes are tabs. */
async function openPane(block: string | null, args: Json, place: Record<string, Json>): Promise<number> {
  await workspace.ready;
  const made = await ask("tab.open", block, args, place);
  const v = await view();
  return typeof made === "string" ? (v.pane(made) ?? 0) : 0;
}

/** The block a pane opens: the Terminal plugin's shell when herdr asks for a program to run, and
 * what a new tab holds (`null`) otherwise. */
function blockOf(args: Record<string, Json>): string | null {
  return args.command === undefined ? null : "pumi_dev.terminal.shell";
}

/** Runs one request. */
export async function dispatch(method: string, params: Json | undefined): Promise<Record<string, Json>> {
  const spec = find(method);
  if (spec === undefined) throw new Fail(codes.UNKNOWN_METHOD, `unknown method: ${method}`);
  if (spec.support.kind === "unsupported") throw new Fail(codes.UNSUPPORTED, `${method} is not supported by pumi: ${spec.support.why}`);
  const p = new Params(params);
  switch (method) {
    case "ping":
      return result("pong", {
        version: HERDR_VERSION,
        protocol: HERDR_PROTOCOL,
        capabilities: {
          live_handoff: true,
          detached_server_daemon: true,
          surface_interest: false,
          health_check: true,
          ssh_agent_registration: false,
        },
      });
    case "server.stop":
      await ask("server.kill");
      return result("ok");
    case "pumi.server.restart":
      await ask("server.restart");
      return result("restarting");
    case "notification.show": {
      const title = p.str("title");
      const body = p.optStr("body");
      const text = body === undefined ? title : `${title}: ${body}`;
      let shown = true;
      try {
        await workspace.openRequest({ kind: "notification", title: text, level: "info" });
      } catch {
        shown = false;
      }
      return result("notification_show", { shown, reason: shown ? "shown" : "no_foreground_client" });
    }
    case "session.snapshot": {
      const v = await view();
      return result("session_snapshot", { snapshot: v.snapshot(revision) });
    }
    case "workspace.list": {
      const v = await view();
      return result("workspace_list", { workspaces: v.sessions.flatMap((session) => v.workspaceInfo(session.id) ?? []) });
    }
    case "workspace.get":
    case "workspace.focus":
    case "workspace.rename": {
      let v = await view();
      const workspace = workspaceOf(v, p);
      if (method === "workspace.focus") await sessionModel(workspace).focus();
      if (method === "workspace.rename") await sessionModel(workspace).update({ name: p.str("label").trim() });
      v = await view();
      return result("workspace_info", { workspace: v.workspaceInfo(workspace) ?? null });
    }
    case "workspace.create": {
      const place: Record<string, Json> = { kind: "session", focus: p.bool("focus", true) };
      const label = p.optStr("label");
      if (label !== undefined) place.name = label;
      const args = launch(p);
      const pane = await openPane(blockOf(args), args, place);
      const v = await view();
      const tab = v.panes.get(pane)?.tab ?? 0;
      const workspace = v.sessionOfTab(tab)?.id ?? 0;
      return result("workspace_created", {
        workspace: v.workspaceInfo(workspace) ?? null,
        tab: v.tabInfo(tab) ?? null,
        root_pane: v.paneInfo(pane, 0) ?? null,
      });
    }
    case "workspace.close": {
      const v = await view();
      const workspace = workspaceOf(v, p);
      await sessionModel(workspace).close();
      return result("ok");
    }
    case "tab.list": {
      const v = await view();
      const only = p.optStr("workspace_id") === undefined ? undefined : workspaceOf(v, p);
      const tabs = v.sessions.flatMap((session) =>
        only === undefined || only === session.id ? session.tabs.flatMap(([, tab]) => v.tabInfo(tab) ?? []) : [],
      );
      return result("tab_list", { tabs });
    }
    case "tab.get":
    case "tab.focus":
    case "tab.rename": {
      let v = await view();
      const tab = tabOf(v, p);
      if (method === "tab.focus") await tabModel(tab).focus();
      if (method === "tab.rename") {
        const label = p.str("label").trim();
        await tabModel(tab).update({ name: label === "" ? null : label });
      }
      v = await view();
      return result("tab_info", { tab: v.tabInfo(tab) ?? null });
    }
    case "tab.create": {
      let v = await view();
      // A tab opens as a view of the current session, or of the one it names.
      const place: Record<string, Json> = { kind: "view", focus: p.bool("focus", true) };
      const session = p.optStr("workspace_id") === undefined ? v.current?.[0] : workspaceOf(v, p);
      if (session !== undefined) place.session = `$${session}`;
      const label = p.optStr("label");
      if (label !== undefined) place.name = label;
      const args = launch(p);
      const pane = await openPane(blockOf(args), args, place);
      v = await view();
      const tab = v.panes.get(pane)?.tab ?? 0;
      return result("tab_created", { tab: v.tabInfo(tab) ?? null, root_pane: v.paneInfo(pane, 0) ?? null });
    }
    case "tab.close": {
      const v = await view();
      const tab = tabOf(v, p);
      await tabModel(tab).close();
      return result("ok");
    }
    case "pane.list": {
      const v = await view();
      const only = p.optStr("workspace_id") === undefined ? undefined : workspaceOf(v, p);
      const panes = v
        .tiled()
        .flatMap((pane) => v.paneInfo(pane, revision(pane)) ?? [])
        .filter((info) => only === undefined || v.session(info.workspace_id) === only);
      return result("pane_list", { panes });
    }
    case "pane.current": {
      const v = await view();
      const caller = p.optStr("caller_pane_id");
      const pane = (caller === undefined ? undefined : v.pane(caller)) ?? v.current?.[2];
      if (pane === undefined) throw new Fail(codes.PANE_NOT_FOUND, "no current pane");
      return result("pane_current", { pane: await paneInfo(pane) });
    }
    case "pane.get":
    case "pane.focus":
    case "pane.rename":
    case "pane.zoom":
    case "pane.clear": {
      const v = await view();
      const pane = paneOf(v, p.str("pane_id"));
      if (method === "pane.focus") await paneModel(pane).focus();
      if (method === "pane.rename") {
        const label = p.optStr("label")?.trim();
        await option.set("@label", label === undefined || label === "" ? null : label, { scope: "tab", id: paneRef(pane) });
      }
      if (method === "pane.zoom") {
        const tab = v.panes.get(pane)?.tab;
        const zoomed = tab === undefined ? false : (v.tabs.get(tab)?.zoomed ?? false);
        const asked = p.get("zoomed");
        const want = typeof asked === "boolean" ? asked : !zoomed;
        await paneModel(pane).update({ zoom: want });
        return result("pane_zoom", { pane_id: v.paneId(pane), zoomed: want });
      }
      if (method === "pane.clear") {
        await call("tab.call", paneRef(pane), "clear_history", {});
        return result("ok");
      }
      return result("pane_info", { pane: await paneInfo(pane) });
    }
    case "pane.split": {
      const v = await view();
      let target: number;
      const named = p.optStr("target_pane_id");
      if (named !== undefined) {
        target = paneOf(v, named);
      } else if (p.optStr("workspace_id") !== undefined) {
        const workspace = workspaceOf(v, p);
        const current = v.sessions.find((session) => session.id === workspace)?.current;
        const active = current === undefined ? undefined : v.tabs.get(current)?.active;
        if (active === undefined) throw new Fail(codes.PANE_NOT_FOUND, "no pane");
        target = active;
      } else {
        const current = v.current?.[2];
        if (current === undefined) throw new Fail(codes.PANE_NOT_FOUND, "no current pane");
        target = current;
      }
      const direction: SplitDirection = enumParam(p, "direction", ["right", "down"] as const) ?? "right";
      // The pane's tab is split, and the new terminal is a tab of the pane that makes.
      const place: Record<string, Json> = { kind: "tiled", beside: paneRef(target), split: direction, focus: p.bool("focus", false) };
      const ratio = p.get("ratio");
      if (typeof ratio === "number") place.size = `${Math.round((1 - ratio) * 100)}%`;
      const args = launch(p);
      if (args.cwd === undefined) {
        const cwd = v.panes.get(target)?.options.tab_current_path;
        if (cwd !== undefined) args.cwd = cwd;
      }
      const pane = await openPane(blockOf(args), args, place);
      return result("pane_info", { pane: await paneInfo(pane) });
    }
    case "pane.process_info": {
      const v = await view();
      const named = p.optStr("pane_id");
      const pane = named === undefined ? v.current?.[2] : v.pane(named);
      if (pane === undefined) throw new Fail(codes.PANE_NOT_FOUND, "no current pane");
      const options = v.panes.get(pane)?.options ?? {};
      const pid = options.tab_pid;
      const tty = options.tab_tty;
      const info: PaneProcessInfo = {
        pane_id: v.paneId(pane),
        ...(typeof pid === "number" ? { shell_pid: pid } : {}),
        ...(typeof tty === "string" && tty !== "" ? { tty } : {}),
      };
      return result("pane_process_info", { process_info: info });
    }
    case "pane.close": {
      const v = await view();
      const pane = paneOf(v, p.str("pane_id"));
      await paneModel(pane).close();
      return result("ok");
    }
    case "plugin.list": {
      // Heeler looks for its own plugin here before it writes the Notification Registration
      // (`herdr plugin list --json`), and `heeler` is the id it has looked for since 0.4.0. pumi runs
      // no herdr plugin; this package *is* the Host, so it answers as that plugin, with the version
      // Heeler's app expects (its feature gates trust the version alone).
      const only = p.optStr("plugin_id");
      const dir = heelerConfigDir();
      const plugins =
        only === undefined || only === "heeler"
          ? [
              {
                plugin_id: "heeler",
                name: "heeler",
                version: HEELER_PLUGIN_VERSION,
                min_herdr_version: "0.7.5",
                description: "Heeler's Host, from pumi: Pairing, Agent Notifications and Live Activities",
                manifest_path: join(dir, "herdr-plugin.toml"),
                plugin_root: dir,
                enabled: true,
                source: { kind: "local" },
                warnings: [],
              },
            ]
          : [];
      return result("plugin_list", { plugins });
    }
    case "pane.read":
    case "agent.read": {
      const v = await view();
      const pane = paneOf(v, method === "pane.read" ? p.str("pane_id") : p.str("target"));
      const source: ReadSource = enumParam(p, "source", READ_SOURCES) ?? "recent";
      const format: ReadFormat = enumParam(p, "format", READ_FORMATS) ?? "text";
      const asked = p.get("lines");
      let text = await read(pane, typeof asked === "number" ? asked : undefined);
      if (format === "ansi" && p.bool("strip_ansi", true)) text = keepSgr(text);
      const info = v.paneInfo(pane, revision(pane));
      return result("pane_read", {
        read: {
          pane_id: v.paneId(pane),
          workspace_id: info?.workspace_id ?? null,
          tab_id: info?.tab_id ?? null,
          source,
          format,
          text,
          revision: revision(pane),
          truncated: false,
        },
      });
    }
    case "pane.send_text":
    case "pane.send_keys":
    case "pane.send_input":
    case "agent.send_keys": {
      const v = await view();
      const pane = paneOf(v, method === "agent.send_keys" ? p.str("target") : p.str("pane_id"));
      const keysOnly = method === "pane.send_keys" || method === "agent.send_keys";
      const text = keysOnly ? undefined : p.optStr("text");
      if (text !== undefined) await write(pane, text);
      if (method !== "pane.send_text") await keys(pane, p.strings("keys"));
      return result("ok");
    }
    case "agent.list": {
      const v = await view();
      return result("agent_list", { agents: v.tiled().flatMap((pane) => v.agentInfo(pane) ?? []) });
    }
    case "agent.get":
    case "agent.focus": {
      let v = await view();
      const pane = paneOf(v, p.str("target"));
      if (method === "agent.focus") {
        await paneModel(pane).focus();
        v = await view();
      }
      const agent: AgentInfo | undefined = v.agentInfo(pane);
      if (agent === undefined) throw new Fail(codes.AGENT_NOT_FOUND, "no agent in that pane");
      return result("agent_info", { agent });
    }
    case "pane.report_agent": {
      const v = await view();
      const pane = paneOf(v, p.str("pane_id"));
      const at = { scope: "tab", id: paneRef(pane) } as const;
      // The agent a tab runs is the Agents plugin's trait, and what it is doing the tab's `@status`:
      // both are the tab's own options, so they live and go as its options do.
      const agent = p.optStr("agent");
      if (agent !== undefined) await option.set("@pumi_dev.agents.agent", agent === "" ? null : agent, at);
      const state = p.optStr("state");
      if (state !== undefined) {
        const known = parseAgentStatus(state);
        if (known === undefined) throw new Fail(codes.INVALID_PARAMS, `no agent state \`${state}\``);
        await option.set("@status", known === "unknown" ? null : known, at);
      }
      return result("ok");
    }
  }
  throw new Fail(codes.UNSUPPORTED, `${method} is not implemented by pumi yet`);
}

/** The length of the escape sequence at the start of `seq`, which begins with ESC. */
function escapeLength(seq: string): number {
  if (seq.length < 2) return seq.length;
  const kind = seq[1];
  if (kind === "[") {
    for (let at = 2; at < seq.length; at++) {
      const code = seq.charCodeAt(at);
      if (code >= 0x40 && code <= 0x7e) return at + 1;
    }
    return seq.length;
  }
  if (kind === "]" || kind === "P" || kind === "_" || kind === "^") {
    let previousEscape = false;
    for (let at = 2; at < seq.length; at++) {
      const char = seq[at];
      if (char === "\x07" || (previousEscape && char === "\\")) return at + 1;
      previousEscape = char === "\x1b";
    }
    return seq.length;
  }
  return 2;
}

/** Keeps colours (SGR), drops every other escape. */
export function keepSgr(text: string): string {
  let out = "";
  let rest = text;
  for (;;) {
    const start = rest.indexOf("\x1b");
    if (start < 0) break;
    out += rest.slice(0, start);
    const seq = rest.slice(start);
    const length = escapeLength(seq);
    const piece = seq.slice(0, length);
    if (piece.startsWith("\x1b[") && piece.endsWith("m")) out += piece;
    rest = seq.slice(length);
  }
  return out + rest;
}

/** A core event, as the host hands it over: the objects it is about by their prefixed ids (`%3`). */
export interface CoreEvent {
  event: string;
  session?: string | null;
  view?: string | null;
  tab?: string | null;
  data?: Json;
}

/** The number a prefixed id names (`%3`, `@2`, `$1`); nothing for anything else. */
export function numberOf(id: Json | undefined): number | undefined {
  if (typeof id !== "string") return undefined;
  const found = /^(?:[A-Za-z0-9._-]+\/)?[$@%]([1-9][0-9]*)$/.exec(id);
  if (found === null) return undefined;
  const number = Number(found[1]);
  return Number.isInteger(number) ? number : undefined;
}

/** The pane, tab or session an event's data names, by its prefixed id. */
function idIn(value: Json | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (!isObject(value)) return undefined;
  return numberOf(value.id);
}

/**
 * The core's events as herdr's: `{"event": snake, "data": {"type": snake, …}}`. `before` is the view
 * before the event, for what it no longer has.
 */
export function translate(now: View, before: View, event: CoreEvent): Envelope[] {
  const envelope = (snake: string, data: Record<string, Json>): Envelope => ({ event: snake, data: { ...data, type: snake } });
  const data = isObject(event.data) ? event.data : {};
  // pumi puts the objects an event is about beside it (`session`, `view`, `tab`) and in its data.
  // Its tab is herdr's pane, and its view herdr's tab.
  const pane = numberOf(event.tab) ?? idIn(data.tab);
  const tab = numberOf(event.view) ?? idIn(data.view);
  const session = numberOf(event.session) ?? idIn(data.session);
  // What changed, as the `<noun>.changed` events name it: `title`, `options.@label`, …
  const keys: string[] = Array.isArray(data.keys) ? data.keys.filter((k): k is string => typeof k === "string") : [];
  const changed = (...want: string[]): boolean => keys.some((key) => want.some((one) => key === one || (one.endsWith("*") && key.startsWith(one.slice(0, -1)))));
  switch (event.event) {
    case "session.opened": {
      const workspace = session === undefined ? undefined : now.workspaceInfo(session);
      return workspace === undefined ? [] : [envelope("workspace_created", { workspace })];
    }
    case "session.closed":
      return session === undefined ? [] : [envelope("workspace_closed", { workspace_id: workspaceId(session) })];
    case "session.changed": {
      if (changed("name")) {
        const workspace = session === undefined ? undefined : now.workspaceInfo(session);
        return workspace === undefined ? [] : [envelope("workspace_renamed", { workspace_id: workspace.workspace_id, label: workspace.label })];
      }
      // The tab in front of it, which is herdr's `workspace_focused`.
      if (changed("activeView")) return session === undefined ? [] : [envelope("workspace_focused", { workspace_id: workspaceId(session) })];
      return [];
    }
    // A view is herdr's tab, and a tab its pane.
    case "view.opened": {
      const info = tab === undefined ? undefined : now.tabInfo(tab);
      return info === undefined ? [] : [envelope("tab_created", { tab: info })];
    }
    case "view.closed":
      return tab === undefined ? [] : [envelope("tab_closed", { tab_id: before.tabId(tab) })];
    case "view.changed": {
      const info = tab === undefined ? undefined : now.tabInfo(tab);
      if (info === undefined) return [];
      const out: Envelope[] = [];
      if (changed("name")) out.push(envelope("tab_renamed", { tab_id: info.tab_id, workspace_id: info.workspace_id, label: info.label }));
      if (changed("activeTab")) out.push(envelope("tab_focused", { tab_id: info.tab_id, workspace_id: info.workspace_id }));
      if (changed("layout", "zoom", "index")) out.push(envelope("layout_updated", { tab_id: info.tab_id, workspace_id: info.workspace_id }));
      // The tab brought forward is herdr's `pane_focused`.
      const active = idIn(isObject(data.patch) ? data.patch.activeTab : undefined);
      if (changed("activeTab") && active !== undefined) {
        const at = now.paneInfo(active, revision(active));
        if (at !== undefined) out.push(envelope("pane_focused", { pane_id: at.pane_id, tab_id: at.tab_id, workspace_id: at.workspace_id }));
      }
      return out;
    }
    case "tab.opened": {
      const info = pane === undefined ? undefined : now.paneInfo(pane, 0);
      return info === undefined ? [] : [envelope("pane_created", { pane: info })];
    }
    case "tab.closed":
      return pane === undefined ? [] : [envelope("pane_closed", { pane_id: before.paneId(pane), terminal_id: terminal(pane) })];
    case "tab.changed": {
      if (pane === undefined) return [];
      const info = now.paneInfo(pane, revision(pane));
      if (info === undefined) return [];
      const out: Envelope[] = [];
      // What an agent is doing is the tab's `@status`, and which agent it is the Agents plugin's
      // trait: either changing is herdr's `pane.agent_status_changed`.
      if (changed("options.@status", "options.@pumi_dev.agents.agent")) {
        out.push({
          event: "pane.agent_status_changed",
          data: {
            pane_id: info.pane_id,
            workspace_id: info.workspace_id,
            agent_status: info.agent_status,
            agent: info.agent ?? null,
          },
        });
      }
      if (changed("title", "options.@label", "options.tab_current_path", "cwd")) out.push(envelope("pane_updated", { pane: info }));
      if (changed("exitCode")) out.push(envelope("pane_exited", { pane_id: now.paneId(pane) }));
      return out;
    }
    default:
      return [];
  }
}
