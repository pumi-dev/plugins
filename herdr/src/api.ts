// herdr's methods over pumi: each reads the core's state, calls the core's functions, and answers
// in herdr's shapes (`{"type": …, …}`). Methods for herdr's TUI, plugins and remotes answer
// `unsupported` at once, from `methods.ts`; the ones herdr has and pumi has not answers
// `unsupported` too, saying so.
//
// Nothing here keeps a screen: a pane's text is `pane.call`'s `read`, its keys are `{"keys": […]}` on
// the same call (the host encodes them for the modes the program set), and what an agent is doing
// is the pane's `@agent`/`@agent_status` (OSC 7501), which the host decides.
import { call } from "pumi";
import { terminal, workspace as workspaceId } from "./ids.ts";
import { find } from "./methods.ts";
import { HERDR_PROTOCOL, HERDR_VERSION, codes, result, type Code } from "./protocol.ts";
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

/** A call of the core's, its refusal as herdr's. */
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

/** The pane `pane.open` answered with. */
function opened(answer: Json): number {
  if (typeof answer === "number") return answer;
  const id = isObject(answer) ? answer.id : undefined;
  return typeof id === "number" ? id : 0;
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

/** The text of a pane, from the core's own terminal (`pane.call`'s `read`): the last `lines` rows
 * it keeps. The core keeps text, not a screen, so nothing is truncated and there is no unwrapped
 * or visible variant. */
async function read(pane: number, lines: number | undefined): Promise<string> {
  try {
    const text = await ask("pane.call", pane, "read", { lines: lines ?? 80 });
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

/** Keys by name, encoded for the modes the pane's program set (the host does that). */
async function keys(pane: number, names: string[]): Promise<void> {
  if (names.length === 0) return;
  await ask("pane.call", pane, "input", { keys: names });
}

async function write(pane: number, text: string): Promise<void> {
  await ask("pane.call", pane, "input", { text });
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
        await ask("message.notify", text, "info", {});
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
      if (method === "workspace.focus") await ask("session.select", { session: workspace });
      if (method === "workspace.rename") await ask("session.rename", workspace, p.str("label").trim());
      v = await view();
      return result("workspace_info", { workspace: v.workspaceInfo(workspace) ?? null });
    }
    case "workspace.create": {
      const place: Record<string, Json> = { kind: "session", focus: p.bool("focus", true) };
      const label = p.optStr("label");
      if (label !== undefined) place.name = label;
      const pane = opened(await ask("pane.open", "terminal", launch(p), place));
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
      await ask("session.close", workspace, true);
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
      if (method === "tab.focus") await ask("tab.select", { tab });
      if (method === "tab.rename") {
        const label = p.str("label").trim();
        await ask("tab.rename", tab, label === "" ? null : label);
      }
      v = await view();
      return result("tab_info", { tab: v.tabInfo(tab) ?? null });
    }
    case "tab.create": {
      let v = await view();
      const place: Record<string, Json> = { kind: "tab", focus: p.bool("focus", true) };
      if (p.optStr("workspace_id") !== undefined) place.session = workspaceOf(v, p);
      const label = p.optStr("label");
      if (label !== undefined) place.name = label;
      const pane = opened(await ask("pane.open", "terminal", launch(p), place));
      v = await view();
      const tab = v.panes.get(pane)?.tab ?? 0;
      return result("tab_created", { tab: v.tabInfo(tab) ?? null, root_pane: v.paneInfo(pane, 0) ?? null });
    }
    case "tab.close": {
      const v = await view();
      const tab = tabOf(v, p);
      await ask("tab.close", tab, true);
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
      if (method === "pane.focus") {
        await ask("pane.select", { to: pane });
      }
      if (method === "pane.rename") {
        const label = p.optStr("label")?.trim();
        await ask("option.set", "@label", label === undefined || label === "" ? null : label, { pane });
      }
      if (method === "pane.zoom") {
        const tab = v.panes.get(pane)?.tab;
        const zoomed = tab === undefined ? false : (v.tabs.get(tab)?.zoomed ?? false);
        const asked = p.get("zoomed");
        const want = typeof asked === "boolean" ? asked : !zoomed;
        await ask("pane.setZoom", pane, want);
        return result("pane_zoom", { pane_id: v.paneId(pane), zoomed: want });
      }
      if (method === "pane.clear") {
        await ask("pane.call", pane, "clear_history");
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
      const place: Record<string, Json> = { beside: target, split: direction, focus: p.bool("focus", false) };
      const ratio = p.get("ratio");
      if (typeof ratio === "number") place.size = `${Math.round((1 - ratio) * 100)}%`;
      const args = launch(p);
      if (args.cwd === undefined) {
        const cwd = v.panes.get(target)?.options.pane_current_path;
        if (cwd !== undefined) args.cwd = cwd;
      }
      const pane = opened(await ask("pane.open", "terminal", args, place));
      return result("pane_info", { pane: await paneInfo(pane) });
    }
    case "pane.process_info": {
      const v = await view();
      const named = p.optStr("pane_id");
      const pane = named === undefined ? v.current?.[2] : v.pane(named);
      if (pane === undefined) throw new Fail(codes.PANE_NOT_FOUND, "no current pane");
      const options = v.panes.get(pane)?.options ?? {};
      const pid = options.pane_pid;
      const tty = options.pane_tty;
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
      await ask("pane.close", pane, true);
      return result("ok");
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
        await ask("pane.select", { to: pane });
        v = await view();
      }
      const agent: AgentInfo | undefined = v.agentInfo(pane);
      if (agent === undefined) throw new Fail(codes.AGENT_NOT_FOUND, "no agent in that pane");
      return result("agent_info", { agent });
    }
    case "pane.report_agent": {
      const v = await view();
      const pane = paneOf(v, p.str("pane_id"));
      const agent = p.optStr("agent");
      if (agent !== undefined) await ask("option.set", "@agent", agent, { pane });
      const state = p.optStr("state");
      if (state !== undefined) {
        // The state is the pane's program status, which the host keeps (OSC 7501): said as the
        // program would, so it lives and goes as the program's own reports do.
        const known = parseAgentStatus(state);
        if (known === undefined) throw new Fail(codes.INVALID_PARAMS, `no agent state \`${state}\``);
        const named = agent !== undefined && isApp(agent) ? agent : undefined;
        const report =
          known === "unknown" ? "state=clear" : named === undefined ? `state=${known}` : `state=${known}:app=${named}`;
        await ask("pane.report", pane, report);
      }
      return result("ok");
    }
  }
  throw new Fail(codes.UNSUPPORTED, `${method} is not implemented by pumi yet`);
}

/** An OSC 7501 `app`: what a report may name its program. */
function isApp(name: string): boolean {
  return name.length >= 1 && name.length <= 32 && /^[A-Za-z0-9_.+-]+$/.test(name);
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

/** A core event, as the host hands it over. */
export interface CoreEvent {
  event: string;
  pane?: number;
  tab?: number;
  session?: number;
  data?: Json;
}

function idIn(value: Json | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (!isObject(value)) return undefined;
  const id = value.id;
  return typeof id === "number" ? id : undefined;
}

/**
 * The core's events as herdr's: `{"event": snake, "data": {"type": snake, …}}`. `before` is the view
 * before the event, for what it no longer has.
 */
export function translate(now: View, before: View, event: CoreEvent): Envelope[] {
  const envelope = (snake: string, data: Record<string, Json>): Envelope => ({ event: snake, data: { ...data, type: snake } });
  const data = isObject(event.data) ? event.data : {};
  // pumi puts the object an event is about beside it (`pane`, `tab`, `session`) and in its data.
  const pane = event.pane ?? idIn(data.pane);
  const tab = event.tab ?? idIn(data.tab);
  const session = event.session ?? idIn(data.session);
  switch (event.event) {
    case "session.created": {
      const workspace = session === undefined ? undefined : now.workspaceInfo(session);
      return workspace === undefined ? [] : [envelope("workspace_created", { workspace })];
    }
    case "session.closed":
      return session === undefined ? [] : [envelope("workspace_closed", { workspace_id: workspaceId(session) })];
    case "session.renamed": {
      const workspace = session === undefined ? undefined : now.workspaceInfo(session);
      return workspace === undefined ? [] : [envelope("workspace_renamed", { workspace_id: workspace.workspace_id, label: workspace.label })];
    }
    case "session.focused":
      return session === undefined ? [] : [envelope("workspace_focused", { workspace_id: workspaceId(session) })];
    case "tab.opened": {
      const info = tab === undefined ? undefined : now.tabInfo(tab);
      return info === undefined ? [] : [envelope("tab_created", { tab: info })];
    }
    case "tab.closed":
      return tab === undefined ? [] : [envelope("tab_closed", { tab_id: before.tabId(tab) })];
    case "tab.focused": {
      const info = tab === undefined ? undefined : now.tabInfo(tab);
      return info === undefined ? [] : [envelope("tab_focused", { tab_id: info.tab_id, workspace_id: info.workspace_id })];
    }
    case "tab.renamed": {
      const info = tab === undefined ? undefined : now.tabInfo(tab);
      return info === undefined ? [] : [envelope("tab_renamed", { tab_id: info.tab_id, workspace_id: info.workspace_id, label: info.label })];
    }
    case "pane.opened": {
      const info = pane === undefined ? undefined : now.paneInfo(pane, 0);
      return info === undefined ? [] : [envelope("pane_created", { pane: info })];
    }
    case "pane.closed":
      return pane === undefined ? [] : [envelope("pane_closed", { pane_id: before.paneId(pane), terminal_id: terminal(pane) })];
    case "pane.focused": {
      const info = pane === undefined ? undefined : now.paneInfo(pane, revision(pane));
      return info === undefined
        ? []
        : [envelope("pane_focused", { pane_id: info.pane_id, tab_id: info.tab_id, workspace_id: info.workspace_id })];
    }
    case "terminal.closed":
      return pane === undefined ? [] : [envelope("pane_exited", { pane_id: now.paneId(pane) })];
    case "layout.changed": {
      const info = tab === undefined ? undefined : now.tabInfo(tab);
      return info === undefined ? [] : [envelope("layout_updated", { tab_id: info.tab_id, workspace_id: info.workspace_id })];
    }
    case "option.changed": {
      const name = data.name;
      const at = idIn(data.id);
      if (at === undefined) return [];
      if (name === "@agent_status") {
        const info = now.paneInfo(at, revision(at));
        if (info === undefined) return [];
        return [
          {
            event: "pane.agent_status_changed",
            data: {
              pane_id: info.pane_id,
              workspace_id: info.workspace_id,
              agent_status: info.agent_status,
              agent: info.agent ?? null,
            },
          },
        ];
      }
      if (name === "title" || name === "@label" || name === "pane_current_path") {
        const info = now.paneInfo(at, revision(at));
        return info === undefined ? [] : [envelope("pane_updated", { pane: info })];
      }
      return [];
    }
    default:
      return [];
  }
}
