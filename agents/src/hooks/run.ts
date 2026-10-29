// The hook function: what an agent's hook calls from its terminal (`pumi call
// pumi_dev.agents.hook %3 claude stop '<its input>'`). It puts what the hook says on the tab (the
// plugin's trait, its `restore_command`), reports the agent's state as the agent would (OSC 7501,
// `tab.call`'s `report`, which pumi-host makes the tab's `@status`), asks a permission in pumi and
// waits for its answer, and at a turn's end hands the agent the prompt the chat queued. What it
// answers is what the hook prints, in the agent's format; `null` prints nothing. What it calls of
// pumi is `main.ts`'s to give (`HookApi`), so a test gives its own. No `import … from "pumi"` here.
import { AGENT, AGENT_ACCEPTS, AGENT_MODEL, AGENT_SESSION, AGENT_TRANSCRIPT, STATUS } from "../names.ts";
import { agentIcon, ICON } from "../icons.ts";
import type { Moment, Turn } from "../context/wire.ts";
import { contextOutput, continuation, formatOf, hookEvent, permissionAsk, permissionDecision, reportBody, reportState, startOf, told } from "./hook.ts";
import { findAgent, PERMISSION_WAIT, resumeLine } from "./integrations.ts";

/** What the hook function calls: pumi's functions, and the chat's queue. */
export interface HookApi {
  /** `tab.call(tab, "report", {body})`: an OSC 7501 report, as the agent would send it. */
  report(tab: string, body: string): Promise<unknown>;
  /** One of the plugin's own options (`permissions`), or with `tab` one of that tab's. */
  get(name: string, tab?: string): Promise<unknown>;
  /** One of tab `tab`'s options, set. */
  set(name: string, value: unknown, tab: string): Promise<unknown>;
  /** `request.open`: the request's id. */
  open(ask: Record<string, unknown>, opts: { tab: string; expires: string }): Promise<string>;
  /** `request.close`, unanswered. */
  close(request: string): Promise<unknown>;
  /** The next prompt the chat queued for tab `tab`, taken to hand its agent at its turn's end. */
  takeQueued(tab: number): Promise<string | undefined>;
  /** What the agent is told about the workspace now (`context/wire.ts` `answer`), or `null`. */
  context(turn: Turn): Promise<string | null>;
  /** Its context was compacted: what it was told is gone from it. */
  compacted(turn: Moment): Promise<void>;
}

/** An agent's id as a hook names it: one short word. */
const isAgentId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value);

/** The number a tab's id names (`%3` is `3`), when it is one. */
function tabNumber(value: unknown): number | undefined {
  const match = typeof value === "string" ? /^%(\d+)$/.exec(value.trim()) : null;
  return match ? Number(match[1]) : undefined;
}

function warn(what: string, err: unknown): void {
  console.warn(`agents: the hook: ${what}: ${err instanceof Error ? err.message : String(err)}`);
}

// ── Permissions ──────────────────────────────────────────────────────────────────────────────

/** The answer each permission the hook asked waits for, by request id. */
const waiting = new Map<string, (answer: unknown) => void>();
/** Requests that closed before their asker heard back from `request.open`, with their answer. */
const closedEarly = new Map<string, unknown>();
/** The permissions each tab's hook is asking now, so a later point of its agent's life ends them. */
const asking = new Map<number, Set<string>>();

/** A request closed (`request.closed`): the hook asking it hears its answer, or `null`. */
export function requestClosed(id: string, answer: unknown): void {
  const resolve = waiting.get(id);
  if (resolve) return resolve(answer ?? null);
  closedEarly.set(id, answer ?? null);
  while (closedEarly.size > 32) closedEarly.delete(closedEarly.keys().next().value!);
}

/** The answer to request `id`: when it closes, or `null` once it would have expired. */
function answerOf(id: string): Promise<unknown> {
  if (closedEarly.has(id)) {
    const answer = closedEarly.get(id);
    closedEarly.delete(id);
    return Promise.resolve(answer);
  }
  return new Promise((resolve) => {
    // The server closes it at `expires`; this is for a close not heard.
    const timer = setTimeout(() => done(null), (PERMISSION_WAIT + 5) * 1000);
    const done = (answer: unknown) => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve(answer);
    };
    waiting.set(id, done);
  });
}

/**
 * Asks the user in pumi (the `permissions` option): the agent's decision, or none (the agent asks
 * in its own prompt) when it is off, nothing answered in time, or the answer is not one it knows.
 */
async function askPermission(api: HookApi, tab: number, label: string, input: unknown): Promise<string | undefined> {
  if ((await api.get("permissions").catch(() => false)) !== true) return undefined;
  const ask = permissionAsk(label, input);
  if (!ask) return undefined;
  let id: string;
  try {
    const expires = new Date(Date.now() + PERMISSION_WAIT * 1000).toISOString();
    id = await api.open(ask, { tab: `%${tab}`, expires });
  } catch (err) {
    // Nothing shows requests (no listener for `request.opened`): the agent asks itself.
    warn("request.open", err);
    return undefined;
  }
  const mine = asking.get(tab) ?? new Set<string>();
  asking.set(tab, mine.add(id));
  try {
    return permissionDecision(await answerOf(id), input);
  } finally {
    mine.delete(id);
    if (mine.size === 0) asking.delete(tab);
  }
}

/** The permissions tab `tab`'s hook still asks, closed unanswered: its agent moved on (it was stopped, or asked itself). */
function dismiss(api: HookApi, tab: number): void {
  for (const id of asking.get(tab) ?? []) void api.close(id).catch(() => {});
}

// ── The hook ─────────────────────────────────────────────────────────────────────────────────

/** What the agent's hook in tab `tabId` (`%3`) answers at `event`, for agent `agentId`, told `input` (its JSON). */
export async function runHook(api: HookApi, tabId: unknown, agentId: unknown, word: unknown, input: unknown): Promise<string | null> {
  const tab = tabNumber(tabId);
  const event = hookEvent(word);
  if (tab === undefined || !isAgentId(agentId) || !event) return null;
  const agent = findAgent(agentId);
  const id = `%${tab}`;
  // An agent that does not report its own state (OSC 7501) has it reported for it.
  const report = async (state: string, kind?: "permission" | "question") => {
    if (agent?.reports) return;
    await api.report(id, reportBody(agentId, state, kind)).catch((err: unknown) => warn("report", err));
  };
  switch (event) {
    case "permission": {
      // The agent is about to ask: the user is waited on, whether pumi asks it or the agent does.
      // Answered here, the tool runs.
      await report("blocked", "permission");
      const decision = await askPermission(api, tab, agent?.label ?? "The agent", input);
      if (decision) await report("working");
      return decision ?? null;
    }
    case "question":
      await report("blocked", "question");
      return null;
    case "resume":
      // Run after every tool: only a `blocked` tab is told, so a tool call costs one read.
      if ((await api.get(STATUS, id).catch(() => null)) === "blocked") await report("working");
      return null;
  }
  const said = told(input);
  // A tab new to this agent shows its mark, which the user may change after.
  const icon = (await api.get(AGENT, id).catch(() => null)) === agentId ? undefined : agentIcon(agentId);
  // The fields first: a chat that starts when the trait comes reads them at once.
  const fields: [string, unknown][] = [
    [AGENT_SESSION, said.session],
    [AGENT_MODEL, said.model],
    [AGENT_TRANSCRIPT, said.transcript],
    [AGENT_ACCEPTS, agent?.accepts],
    [ICON, icon],
    [AGENT, agentId],
  ];
  for (const [name, value] of fields) if (value !== undefined) await api.set(name, value, id).catch((err: unknown) => warn(name, err));
  if (said.session) {
    const line = resumeLine(agentId, said.session, null);
    if (line) await api.set("restore_command", line, id).catch((err: unknown) => warn("restore_command", err));
  }
  if (event !== "compact") dismiss(api, tab);
  let state = reportState(event);
  let out: string | null = null;
  const moment: Moment = { tab: id, agent: agentId, session: said.session ?? null, event };
  const start = startOf(input);
  if (event === "compact" || (event === "start" && start.compacted)) await api.compacted(moment).catch((err: unknown) => warn("context", err));
  if (event === "start" || event === "prompt") {
    const turn: Turn = { ...moment, resumed: event === "start" && start.resumed, full: start.full, peek: false };
    const text = await api.context(turn).catch((err: unknown) => (warn("context", err), null));
    if (text) out = contextOutput(formatOf(agent), agent, event, text, said.hookEvent);
  }
  if (event === "stop" && agent?.accepts.includes("queue")) {
    const next = await api.takeQueued(tab);
    if (next) {
      out = continuation(formatOf(agent), next);
      state = "working";
    }
  }
  if (state) await report(state);
  return out;
}
