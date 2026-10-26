// agent-chat: a chat button in the title bar of every Claude Code, Codex and pi pane, flipping the pane
// between the agent's own terminal and a rendered chat of the same live session.
//
//   the title bar's button, or the `key` option  the focused pane: the chat, or back to the TUI
//   pumi call amresyd.agent_chat.toggle          the same
//   pumi call amresyd.agent_chat.conversation.read %3    the conversation of pane %3
//
// The chat is how the plugin draws the pane's `terminal` block (the manifest's `renderers`, the
// `Chat` export in `ui.tsx`), picked for one pane by its `@pane_renderer` option naming this
// plugin: the terminal keeps running under it, untouched, and shows again as it was when the
// option goes. What the chat shows is the session file the agent writes (`bridge.ts`), and what
// it sends is typed into the terminal. Each agent pane says the chat serves its conversation
// (`@agent.conversation`), so anything can read it and send to it by the convention
// (`conversation.read` / `send` / `changed`).
import {
  AGENT_CONVERSATION,
  call,
  conversationNames,
  fn,
  on,
  option,
  request,
  self,
  workspace,
  type ConversationRead,
  type Disposer,
  type PumiEvent,
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
const FOLLOWED = ["@agent.status", "@agent.session", "@agent.transcript", "@agent.model", "pane_current_path"];

/** A pane's id as the API has it (`%3`), from the number this package keeps of it. */
const paneRef = (pane: number): string => `%${pane}`;

/** The number a pane's id names (`%3` is `3`). */
const numberOf = (id: string): number => Number(id.slice(id.indexOf("/") + 1).replace(/^[%@$]/, ""));

/** The pane a command was called from, or nothing. */
async function here(): Promise<number | undefined> {
  await workspace.ready;
  const pane = workspace.currentPane;
  return pane ? numberOf(pane.id) : undefined;
}

/** One of pane `id`'s own options. */
const paneOption = (name: string, id: number): Promise<unknown> => option.get(name, { scope: "pane", id: paneRef(id) });

/** One of pane `id`'s own options, set. */
const setPaneOption = (name: string, value: unknown, id: number): Promise<null> => option.set(name, value, { scope: "pane", id: paneRef(id) });

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
  const get = async (name: string) => text(await paneOption(name, pane));
  const [session, transcript, model, status, cwd] = await Promise.all(["@agent.session", "@agent.transcript", "@agent.model", "@agent.status", "pane_current_path"].map(get));
  return { session, transcript, model, status, cwd };
}

/** The pane's bridge, started when first asked for. Throws for a pane with no agent the chat knows. */
function bridgeOf(pane: number): Promise<Bridge> {
  const running = bridges.get(pane);
  if (running) return running;
  const started = (async () => {
    const spec = agentSpec(await paneOption("@agent", pane));
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
    await setPaneOption(PANE_RENDERER, self.plugin.id, pane);
  } else if ((await paneOption(PANE_RENDERER, pane)) === self.plugin.id) {
    await setPaneOption(PANE_RENDERER, null, pane);
  }
  return on;
}

/** Flips `pane` (the focused one without) between its terminal and the chat. */
export async function toggle(pane?: number): Promise<boolean> {
  const at = typeof pane === "number" ? pane : await here();
  if (at === undefined) throw new Error("agent-chat: no pane in front to flip");
  if (!agentSpec(await paneOption("@agent", at))) throw new Error(`pane %${at} runs no agent the chat reads`);
  return setChat(at, (await paneOption(PANE_RENDERER, at)) !== self.plugin.id);
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

const names = conversationNames(self.plugin.id);

fn.set(
  names.read,
  {
    desc: "An agent pane's conversation, as the chat reads it from its session file: `{snapshot, cursor}`, or `{changes, cursor}` after `since`.",
    parameters: [
      ["number", "pane"],
      ["table", "since"],
    ],
  },
  async (pane: string, since?: Cursor): Promise<ConversationRead> => {
    const update = await read(numberOf(pane), since ?? undefined);
    return update.type === "snapshot" ? { snapshot: update.transcript, cursor: { epoch: update.transcript.epoch, seq: update.transcript.seq } } : { changes: update.changes, cursor: update.to };
  },
);

fn.set(
  names.send,
  {
    desc: "Sends a command to an agent pane: `{type: \"prompt\", id, text}` (typed into its terminal, or queued while it works), `cancel`, `answer`, `unqueue`. Answers `{id, rejected?}`.",
    parameters: [
      ["number", "pane"],
      ["table", "command"],
    ],
  },
  (pane: string, cmd: Command) => send(numberOf(pane), cmd),
);

// ── Requests ─────────────────────────────────────────────────────────────────────────────────

// Heard only while a chat shows: with none, nothing of the chat's is there to answer a request, and
// an agent's hook that asks pumi hears `null` at once and asks in its own terminal.
let requests: Disposer | null = null;

function listen(): void {
  if (drawing.size > 0 && !requests) {
    requests = on("request.opened", { desc: "agent-chat shows an agent's requests in its chat" }, (e) => {
      const asked = e.data;
      if (typeof asked?.pane !== "string" || asked.kind !== "permission") return;
      const pane = numberOf(asked.pane);
      if (bridges.has(pane) || drawing.has(pane)) void bridgeOf(pane).then((bridge) => bridge.requested(asked), () => {});
    });
  } else if (drawing.size === 0 && requests) {
    requests();
    requests = null;
  }
}

on("request.closed", { desc: "agent-chat takes an ended request out of its chat" }, (e) => {
  const asked = e.data;
  if (typeof asked?.request !== "string") return;
  if (typeof asked.pane !== "string") return;
  const pane = numberOf(asked.pane);
  bridges.get(pane)?.then((bridge) => bridge.resolved(asked.request), () => {});
});

// ── Following the panes ──────────────────────────────────────────────────────────────────────

/** An agent pane the chat reads says so, unless another package serves its conversation. */
async function claim(pane: number): Promise<void> {
  if (!text(await paneOption(AGENT_CONVERSATION, pane))) await setPaneOption(AGENT_CONVERSATION, self.plugin.id, pane);
}

/** A pane's `@pane_renderer` now names `owner`: this plugin draws it as a chat, or stops. */
function rendererChanged(pane: number, owner: unknown): void {
  if (owner === self.plugin.id) {
    drawing.add(pane);
    listen();
    // The requests already waiting, asked while no chat showed (another client may hold them).
    void bridgeOf(pane)
      .then(async (bridge) => {
        for (const each of await workspace.requests({ pane: paneRef(pane) })) {
          bridge.requested({ request: each.id, pane: paneRef(pane), kind: "permission", title: each.title, detail: each.detail, options: each.options as unknown[] });
        }
      })
      .catch((err) => console.error(`agent-chat: ${message(err)}`));
    return;
  }
  drawing.delete(pane);
  listen();
}

/** A pane's option changed: `pane.changed` names it `options.<name>` and carries its new value. */
function optionChanged(event: PumiEvent): void {
  if (typeof event.pane !== "string") return;
  const pane = numberOf(event.pane);
  const keys: string[] = event.data?.keys ?? [];
  const patch = (event.data?.patch as { options?: Record<string, unknown> } | undefined)?.options ?? {};
  for (const key of keys) {
    if (!key.startsWith("options.")) continue;
    const name = key.slice("options.".length);
    if (name === PANE_RENDERER) {
      rendererChanged(pane, patch[name]);
      continue;
    }
    if (name === "@agent") {
      const next = patch[name];
      if (agentSpec(next)) {
        stop(pane);
        void claim(pane).catch((err) => console.error(`agent-chat: ${message(err)}`));
      } else {
        stop(pane);
        if (drawing.has(pane)) void setChat(pane, false).catch(() => {});
      }
      continue;
    }
    if (FOLLOWED.includes(name)) bridges.get(pane)?.then((bridge) => bridge.optionChanged(name, patch[name]), () => {});
  }
}

on("pane.changed", { desc: "agent-chat follows what agent panes say" }, (event: PumiEvent) => optionChanged(event));

on("pane.closed", { desc: "agent-chat lets a closed pane's chat go" }, (e: PumiEvent) => {
  if (typeof e.pane !== "string") return;
  const pane = numberOf(e.pane);
  stop(pane);
  drawing.delete(pane);
  listen();
});

// ── Options, the command and the key ─────────────────────────────────────────────────────────

// From the palette or the key, the focused pane; from a slot's action, the `{ pane }` it was pressed on.
fn.set("toggle", { desc: "Flip the pane between its terminal and the chat.", parameters: [["table", "arg"]] }, (arg?: unknown) => {
  const asked = typeof arg === "object" && arg !== null ? (arg as { pane?: unknown }).pane : arg;
  const pane = typeof asked === "string" ? numberOf(asked) : typeof asked === "number" ? asked : Number.NaN;
  return toggle(Number.isFinite(pane) ? pane : undefined);
});

/** The chord bound to `toggle` in the root key table now. */
let bound: string | null = null;

/** The server's key tables, as the `keys` option holds them. */
type Keys = Record<string, Record<string, unknown>>;

/**
 * Reads the options: the history size, and the chord bound to `toggle` (unbinding the one before).
 * The keys are the server's `keys` option, which has no disposer: the app takes a plugin's own
 * away when it stops.
 */
async function configure(): Promise<void> {
  const mb = Number(await option.get("history_mb").catch(() => 4));
  history = Math.max(1, Number.isFinite(mb) ? mb : 4) << 20;
  const chosen = await option.get("key").catch(() => "");
  const chord = typeof chosen === "string" ? chosen.trim() : "";
  if (bound === chord) return;
  const found = await option.get("keys", { scope: "global" });
  const root: Keys = found && typeof found === "object" && !Array.isArray(found) ? { ...(found as Keys) } : {};
  const table = { ...(root.root ?? {}) };
  if (bound !== null) delete table[bound];
  bound = null;
  if (chord !== "") {
    table[chord] = { call: self.plugin.prefixed("toggle"), args: [], desc: "Flip the pane between its terminal and the chat" };
    bound = chord;
  }
  await option.set("keys", { ...root, root: table }, { scope: "global" }).catch((err: unknown) => console.error(`agent-chat: ${message(err)}`));
}

on("option.changed", { match: `${self.plugin.prefix}*`, desc: "agent-chat follows its options" }, () => void configure());

/** At start: every agent pane claimed, and the chats that were showing (`@pane_renderer` is kept with the pane) read again. */
async function startup(): Promise<void> {
  await configure();
  for (const each of await workspace.panes()) {
    const pane = numberOf(each.id);
    if (!agentSpec(await paneOption("@agent", pane))) continue;
    await claim(pane);
    if ((await paneOption(PANE_RENDERER, pane)) === self.plugin.id) rendererChanged(pane, self.plugin.id);
  }
}

void startup().catch((err) => console.error(`agent-chat: ${message(err)}`));
