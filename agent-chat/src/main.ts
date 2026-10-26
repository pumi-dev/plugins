// agent-chat: a chat button in the title bar of every Claude Code, Codex and pi pane, flipping the pane
// between the agent's own terminal and a rendered chat of the same live session.
//
//   the title bar's button, or the `key` option  the focused pane: the chat, or back to the TUI
//   pumi call amresyd.agent_chat.toggle          the same
//   pumi call amresyd.agent_chat.conversation.read 3     the conversation of pane %3
//
// The chat is how the plugin draws the pane's `terminal` block (the manifest's `renderers`, the
// `Chat` export in `ui.tsx`), picked for one pane by its `@pane_renderer` option naming this
// plugin: the terminal keeps running under it, untouched, and shows again as it was when the
// option goes. What the chat shows is the session file the agent writes (`bridge.ts`), and what
// it sends is typed into the terminal. Each agent pane says the chat serves its conversation
// (`@agent_conversation`), so anything can read it and send to it by the convention
// (`conversation.read` / `send` / `changed`).
import {
  agent,
  AGENT_CONVERSATION,
  call,
  command,
  conversationNames,
  on,
  option,
  pane as panes,
  plugin,
  provide,
  type AgentRequest,
  type ConversationRead,
  type Disposer,
} from "pumi";

import type { Update } from "../../lib/conversation/src/change.ts";
import type { Ack, Command, Cursor } from "../../lib/conversation/src/model.ts";
import { agentSpec } from "./agents.ts";
import { Bridge, type PaneOptions } from "./bridge.ts";
import { mentions as findMentions } from "./mentions.ts";
import type { MentionHit } from "../../lib/conversation/src/view.ts";

/** The pane option naming the plugin drawing the pane's block (`@pane_renderer`): this one, or none. */
const PANE_RENDERER = "@pane_renderer";
/** The options a bridge follows, set by the agents' hooks. */
const FOLLOWED = ["@agent_status", "@agent_session", "@agent_transcript", "@agent_model", "pane_current_path"];

const bridges = new Map<number, Promise<Bridge>>();
/** The panes this plugin draws as a chat now. */
const drawing = new Set<number>();
let history = 4 << 20;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function paneOptions(pane: number): Promise<PaneOptions> {
  const get = async (name: string) => text(await option.get(name, { pane }));
  const [session, transcript, model, status, cwd] = await Promise.all(["@agent_session", "@agent_transcript", "@agent_model", "@agent_status", "pane_current_path"].map(get));
  return { session, transcript, model, status, cwd };
}

/** The pane's bridge, started when first asked for. Throws for a pane with no agent the chat knows. */
function bridgeOf(pane: number): Promise<Bridge> {
  const running = bridges.get(pane);
  if (running) return running;
  const started = (async () => {
    const spec = agentSpec(await option.get("@agent", { pane }));
    if (!spec) throw new Error(`pane %${pane} runs no agent the chat reads (Claude Code, Codex, pi)`);
    return new Bridge(pane, spec, await paneOptions(pane), () => history);
  })();
  bridges.set(pane, started);
  started.catch(() => bridges.get(pane) === started && bridges.delete(pane));
  return started;
}

function stop(pane: number): void {
  const running = bridges.get(pane);
  bridges.delete(pane);
  running?.then((bridge) => bridge.dispose()).catch(() => {});
}

// ── Drawing the pane ─────────────────────────────────────────────────────────────────────────

/**
 * Draws `pane` as the chat (`true`) or gives the terminal back (`false`), by naming this plugin in
 * the pane's `@pane_renderer`; answers whether the chat shows.
 */
export async function setChat(pane: number, on: boolean): Promise<boolean> {
  if (on) {
    await bridgeOf(pane);
    await option.set(PANE_RENDERER, plugin.id, { pane });
  } else if ((await option.get(PANE_RENDERER, { pane })) === plugin.id) {
    await option.set(PANE_RENDERER, null, { pane });
  }
  return on;
}

/** Flips `pane` (the focused one without) between its terminal and the chat. */
export async function toggle(pane?: number): Promise<boolean> {
  const at = typeof pane === "number" ? pane : (await panes.get()).id;
  if (!agentSpec(await option.get("@agent", { pane: at }))) throw new Error(`pane %${at} runs no agent the chat reads`);
  return setChat(at, (await option.get(PANE_RENDERER, { pane: at })) !== plugin.id);
}

// ── The conversation, for the views ──────────────────────────────────────────────────────────

/** What brings a view of `pane`'s chat at `since` up to now: the batches after it, or a snapshot. */
export async function read(pane: number, since?: Cursor): Promise<Update> {
  return (await bridgeOf(pane)).read(since);
}

/**
 * A view's command for `pane`'s agent: a prompt, a cancel, an answer, … A command that opens a
 * screen of the agent's own (`/model`, `/resume`) shows the terminal once it is typed there.
 */
export async function send(pane: number, cmd: Command): Promise<Ack> {
  const bridge = await bridgeOf(pane);
  const ack = await bridge.send(cmd);
  if (cmd.type === "prompt" && !ack.rejected && !cmd.images?.length && bridge.commandOf(cmd.text)?.terminal && !bridge.transcript.queue.some((each) => each.id === cmd.id)) {
    await setChat(pane, false);
  }
  return ack;
}

/** The files and directories an `@query` in `pane`'s chat finds, as paths from the agent's directory. */
export async function mentions(pane: number, query: string): Promise<MentionHit[]> {
  const bridge = await bridgeOf(pane);
  return findMentions(bridge.cwd, typeof query === "string" ? query : "");
}

// ── The convention, for everyone else ────────────────────────────────────────────────────────

const names = conversationNames(plugin.id);

provide(
  names.read,
  {
    desc: "An agent pane's conversation, as the chat reads it from its session file: `{snapshot, cursor}`, or `{changes, cursor}` after `since`.",
    parameters: [
      ["number", "pane"],
      ["table", "since"],
    ],
  },
  async (pane: number, since?: Cursor): Promise<ConversationRead> => {
    const update = await read(Number(pane), since ?? undefined);
    return update.type === "snapshot" ? { snapshot: update.transcript, cursor: { epoch: update.transcript.epoch, seq: update.transcript.seq } } : { changes: update.changes, cursor: update.to };
  },
);

provide(
  names.send,
  {
    desc: "Sends a command to an agent pane: `{type: \"prompt\", id, text}` (typed into its terminal, or queued while it works), `cancel`, `answer`, `unqueue`. Answers `{id, rejected?}`.",
    parameters: [
      ["number", "pane"],
      ["table", "command"],
    ],
  },
  (pane: number, cmd: Command) => send(Number(pane), cmd),
);

// ── Requests ─────────────────────────────────────────────────────────────────────────────────

// Heard only while a chat shows: with none, nothing of the chat's is there to answer a request, and
// an agent's hook that asks pumi hears `null` at once and asks in its own terminal.
let requests: Disposer | null = null;

function listen(): void {
  if (drawing.size > 0 && !requests) {
    requests = on("agent.requested", { desc: "agent-chat shows an agent's requests in its chat" }, (e) => {
      const request = e.data as AgentRequest;
      if (bridges.has(request.pane) || drawing.has(request.pane)) void bridgeOf(request.pane).then((bridge) => bridge.requested(request), () => {});
    });
  } else if (drawing.size === 0 && requests) {
    requests();
    requests = null;
  }
}

on("agent.resolved", { desc: "agent-chat takes an ended request out of its chat" }, (e) => {
  const pane = Number(e.data.pane);
  bridges.get(pane)?.then((bridge) => bridge.resolved(Number(e.data.id)), () => {});
});

// ── Following the panes ──────────────────────────────────────────────────────────────────────

/** An agent pane the chat reads says so, unless another package serves its conversation. */
async function claim(pane: number): Promise<void> {
  if (!text(await option.get(AGENT_CONVERSATION, { pane }))) await option.set(AGENT_CONVERSATION, plugin.id, { pane });
}

/** A pane's `@pane_renderer` now names `owner`: this plugin draws it as a chat, or stops. */
function rendererChanged(pane: number, owner: unknown): void {
  if (owner === plugin.id) {
    drawing.add(pane);
    listen();
    // The requests already waiting, asked while no chat showed (another client may hold them).
    void bridgeOf(pane)
      .then(async (bridge) => {
        for (const request of await agent.requests(pane)) bridge.requested(request);
      })
      .catch((err) => console.error(`agent-chat: ${message(err)}`));
    return;
  }
  drawing.delete(pane);
  listen();
}

on("option.changed", { match: ["@agent", PANE_RENDERER, ...FOLLOWED], desc: "agent-chat follows what agent panes say" }, (e) => {
  const { name, scope, id } = e.data;
  if (scope !== "pane" || typeof id !== "number") return;
  if (name === PANE_RENDERER) return rendererChanged(id, e.data.new);
  if (name === "@agent") {
    if (agentSpec(e.data.new)) {
      if (e.data.old !== e.data.new) stop(id);
      void claim(id).catch((err) => console.error(`agent-chat: ${message(err)}`));
    } else {
      stop(id);
      if (drawing.has(id)) void setChat(id, false).catch(() => {});
    }
    return;
  }
  bridges.get(id)?.then((bridge) => bridge.optionChanged(name, e.data.new), () => {});
});

on("pane.closed", { desc: "agent-chat lets a closed pane's chat go" }, (e) => {
  const pane = Number(e.data.pane);
  stop(pane);
  drawing.delete(pane);
  listen();
});

// ── Options, the command and the key ─────────────────────────────────────────────────────────

// From the palette or the key, the focused pane; from a slot's action, the `{ pane }` it was pressed on.
command("toggle", (arg?: unknown) => {
  const pane = typeof arg === "number" ? arg : typeof arg === "object" && arg !== null ? Number((arg as { pane?: unknown }).pane) : Number.NaN;
  return toggle(Number.isFinite(pane) ? pane : undefined);
});

/** The chord bound to `toggle` in the root key table now. */
let bound: string | null = null;

/**
 * Reads the options: the history size, and the chord bound to `toggle` (unbinding the one before).
 * A key has no disposer: it goes by `key.del`, and the server takes the plugin's own away when it
 * stops.
 */
async function configure(): Promise<void> {
  const mb = Number(await option.get("history_mb").catch(() => 4));
  history = Math.max(1, Number.isFinite(mb) ? mb : 4) << 20;
  const chosen = await option.get("key").catch(() => "");
  const chord = typeof chosen === "string" ? chosen.trim() : "";
  if (bound === chord) return;
  if (bound !== null) await call("key.del", "root", bound, {}).catch(() => {});
  bound = null;
  if (chord !== "") {
    await call("key.set", "root", chord, { call: plugin.prefixed("toggle") }, { desc: "Flip the pane between its terminal and the chat" }).catch((err) => console.error(`agent-chat: ${message(err)}`));
    bound = chord;
  }
}

on("option.changed", { match: `${plugin.prefix}*`, desc: "agent-chat follows its options" }, () => void configure());

/** At start: every agent pane claimed, and the chats that were showing (`@pane_renderer` is kept with the pane) read again. */
async function startup(): Promise<void> {
  await configure();
  for (const each of await panes.list()) {
    const pane = Number(each);
    if (!agentSpec(await option.get("@agent", { pane }))) continue;
    await claim(pane);
    if ((await option.get(PANE_RENDERER, { pane })) === plugin.id) rendererChanged(pane, plugin.id);
  }
}

void startup().catch((err) => console.error(`agent-chat: ${message(err)}`));
