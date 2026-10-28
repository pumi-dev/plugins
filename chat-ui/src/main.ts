// chat-ui: a chat button in the title bar of every Claude Code, Codex and pi tab, flipping the tab
// between the agent's own terminal and a rendered chat of the same live session.
//
//   the title bar's button, or the `key` option      the focused tab: the chat, or back to the TUI
//   pumi call pumi_dev.chat_ui.toggle                the same
//   pumi call pumi_dev.chat_ui.conversation.read %3  the conversation of tab %3
//
// The chat is how the plugin draws the tab's `terminal` block (the manifest's `renderers`, the
// `Chat` export in `ui.tsx`), picked for one tab by its `@tab_renderer` option naming this
// plugin: the terminal keeps running under it, untouched, and shows again as it was when the
// option goes. What the chat shows is the session file the agent writes (`bridge.ts`), and what
// it sends is typed into the terminal. Each agent tab says the chat serves its conversation
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

import type { Update } from "./conversation/change.ts";
import type { Ack, Command, Cursor } from "./conversation/model.ts";
import { agentSpec } from "./agents.ts";
import { Bridge, type TabOptions } from "./bridge.ts";
import { mentions as findMentions } from "./mentions.ts";
import { PICK_IN_TERMINAL } from "./models.ts";
import type { MentionHit } from "./conversation/view.ts";

/** The tab option naming the plugin drawing the tab's block (`@tab_renderer`): this one, or none. */
const TAB_RENDERER = "@tab_renderer";
/**
 * Set on an agent tab once the `auto` option has drawn it as the chat, for as long as its agent
 * runs: a tab the user then flips back to the terminal stays there, through a restart too (tab
 * options are kept with the tab). It goes when the agent does, so the next agent there is taken.
 */
const TAKEN = "@chat_ui.taken";
/** The options a bridge follows, set by the agents' hooks. */
const FOLLOWED = ["@agent.status", "@agent.session", "@agent.transcript", "@agent.model", "tab_current_path"];

/** A tab's id as the API has it (`%3`), from the number this package keeps of it. */
const tabRef = (tab: number): string => `%${tab}`;

/** The number a tab's id names (`%3` is `3`). */
const numberOf = (id: string): number => Number(id.slice(id.indexOf("/") + 1).replace(/^[%@$]/, ""));

/** The tab a command was called from, or nothing. */
async function here(): Promise<number | undefined> {
  await workspace.ready;
  const tab = workspace.currentTab;
  return tab ? numberOf(tab.id) : undefined;
}

/** One of tab `id`'s own options. */
const tabOption = (name: string, id: number): Promise<unknown> => option.get(name, { scope: "tab", id: tabRef(id) });

/** One of tab `id`'s own options, set. */
const setTabOption = (name: string, value: unknown, id: number): Promise<null> => option.set(name, value, { scope: "tab", id: tabRef(id) });

const bridges = new Map<number, Promise<Bridge>>();
/** The tabs this plugin draws as a chat now. */
const drawing = new Set<number>();
let history = 4 << 20;

/** A flag option as the server answers it: set to anything but nothing, `false` or "". */
const isSet = (value: unknown): boolean => value !== undefined && value !== null && value !== false && value !== "" && value !== "false";
/** Whether an agent tab is drawn as the chat as soon as its agent starts (the `auto` option). */
let auto = true;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function tabOptions(tab: number): Promise<TabOptions> {
  const get = async (name: string) => text(await tabOption(name, tab));
  const [session, transcript, model, status, cwd] = await Promise.all(["@agent.session", "@agent.transcript", "@agent.model", "@agent.status", "tab_current_path"].map(get));
  return { session, transcript, model, status, cwd };
}

/** The tab's bridge, started when first asked for. Throws for a tab with no agent the chat knows. */
function bridgeOf(tab: number): Promise<Bridge> {
  const running = bridges.get(tab);
  if (running) return running;
  const started = (async () => {
    const spec = agentSpec(await tabOption("@agent", tab));
    if (!spec) throw new Error(`tab %${tab} runs no agent the chat reads (Claude Code, Codex, pi)`);
    return new Bridge(tab, spec, await tabOptions(tab), () => history);
  })();
  bridges.set(tab, started);
  started.catch(() => bridges.get(tab) === started && bridges.delete(tab));
  return started;
}

function stop(tab: number): void {
  const running = bridges.get(tab);
  bridges.delete(tab);
  running?.then((bridge) => bridge.dispose()).catch(() => {});
}

// ── Drawing the tab ─────────────────────────────────────────────────────────────────────────

/**
 * Draws `tab` as the chat (`true`) or gives the terminal back (`false`), by naming this plugin in
 * the tab's `@tab_renderer`; answers whether the chat shows.
 */
export async function setChat(tab: number, on: boolean): Promise<boolean> {
  if (on) {
    await bridgeOf(tab);
    await setTabOption(TAB_RENDERER, self.plugin.id, tab);
  } else if ((await tabOption(TAB_RENDERER, tab)) === self.plugin.id) {
    await setTabOption(TAB_RENDERER, null, tab);
  }
  return on;
}

/** Flips `tab` (the focused one without) between its terminal and the chat. */
export async function toggle(tab?: number): Promise<boolean> {
  const at = typeof tab === "number" ? tab : await here();
  if (at === undefined) throw new Error("chat-ui: no tab in front to flip");
  if (!agentSpec(await tabOption("@agent", at))) throw new Error(`tab %${at} runs no agent the chat reads`);
  return setChat(at, (await tabOption(TAB_RENDERER, at)) !== self.plugin.id);
}

// ── The conversation, for the chat ──────────────────────────────────────────────────────────

/** What brings the chat of `tab` at `since` up to now: the batches after it, or a snapshot. */
export async function read(tab: number, since?: Cursor): Promise<Update> {
  return (await bridgeOf(tab)).read(since);
}

/**
 * The chat's command for `tab`'s agent: a prompt, a cancel, an answer, … A command that opens a
 * screen of the agent's own (`/model`, `/resume`) shows the terminal once it is typed there.
 */
export async function send(tab: number, cmd: Command): Promise<Ack> {
  const bridge = await bridgeOf(tab);
  const ack = await bridge.send(cmd);
  if (cmd.type === "prompt" && !ack.rejected && !cmd.images?.length && bridge.commandOf(cmd.text)?.terminal && !bridge.transcript.queue.some((each) => each.id === cmd.id)) {
    await setChat(tab, false);
  }
  // The agent's own model picker (Codex's, or "More in …") shows its terminal, to pick there.
  if (cmd.type === "setOption" && cmd.category === "model" && !ack.rejected && (cmd.value === PICK_IN_TERMINAL || bridge.spec.format === "codex")) await setChat(tab, false);
  // An agent that goes back in a screen of its own shows it, to pick the message there.
  if (cmd.type === "rewind" && !ack.rejected && bridge.rewinds === "terminal") await setChat(tab, false);
  return ack;
}

/** The files and directories an `@query` in `tab`'s chat finds, as paths from the agent's directory. */
export async function mentions(tab: number, query: string): Promise<MentionHit[]> {
  const bridge = await bridgeOf(tab);
  return findMentions(bridge.cwd, typeof query === "string" ? query : "");
}

// ── The convention, for everyone else ────────────────────────────────────────────────────────

const names = conversationNames(self.plugin.id);

fn.set(
  names.read,
  {
    desc: "An agent tab's conversation, as the chat reads it from its session file: `{snapshot, cursor}`, or `{changes, cursor}` after `since`.",
    parameters: [
      ["number", "tab"],
      ["table", "since"],
    ],
  },
  async (tab: string, since?: Cursor): Promise<ConversationRead> => {
    const update = await read(numberOf(tab), since ?? undefined);
    return update.type === "snapshot" ? { snapshot: update.transcript, cursor: { epoch: update.transcript.epoch, seq: update.transcript.seq } } : { changes: update.changes, cursor: update.to };
  },
);

fn.set(
  names.send,
  {
    desc: "Sends a command to an agent tab: `{type: \"prompt\", id, text}` (typed into its terminal, or queued while it works), `cancel`, `answer`, `unqueue`. Answers `{id, rejected?}`.",
    parameters: [
      ["number", "tab"],
      ["table", "command"],
    ],
  },
  (tab: string, cmd: Command) => send(numberOf(tab), cmd),
);

// ── Requests ─────────────────────────────────────────────────────────────────────────────────

// Heard only while a chat shows: with none, nothing of the chat's is there to answer a request, and
// an agent's hook that asks pumi hears `null` at once and asks in its own terminal.
let requests: Disposer | null = null;

function listen(): void {
  if (drawing.size > 0 && !requests) {
    requests = on("request.opened", { desc: "Chat UI shows an agent's requests in its chat" }, (e) => {
      const asked = e.data;
      if (typeof asked?.tab !== "string" || (asked.kind !== "permission" && asked.kind !== "question")) return;
      const tab = numberOf(asked.tab);
      if (bridges.has(tab) || drawing.has(tab)) void bridgeOf(tab).then((bridge) => bridge.requested(asked), () => {});
    });
  } else if (drawing.size === 0 && requests) {
    requests();
    requests = null;
  }
}

on("request.closed", { desc: "Chat UI takes an ended request out of its chat" }, (e) => {
  const asked = e.data;
  if (typeof asked?.request !== "string") return;
  if (typeof asked.tab !== "string") return;
  const tab = numberOf(asked.tab);
  bridges.get(tab)?.then((bridge) => bridge.resolved(asked.request), () => {});
});

// ── Following the tabs ──────────────────────────────────────────────────────────────────────

/** An agent tab the chat reads says so, unless another package serves its conversation. */
async function claim(tab: number): Promise<void> {
  if (!text(await tabOption(AGENT_CONVERSATION, tab))) await setTabOption(AGENT_CONVERSATION, self.plugin.id, tab);
}

/**
 * With `auto` on, an agent tab the chat has not taken yet is drawn as the chat, unless another
 * plugin draws it. Answers whether it was taken.
 */
async function takeOver(tab: number): Promise<boolean> {
  if (!auto || !agentSpec(await tabOption("@agent", tab))) return false;
  if (isSet(await tabOption(TAKEN, tab))) return false;
  const owner = text(await tabOption(TAB_RENDERER, tab));
  if (owner && owner !== self.plugin.id) return false;
  await setTabOption(TAKEN, true, tab);
  if (!owner) await setChat(tab, true);
  return true;
}

/** Every agent tab open now, taken (the option turned on, or the plugin started). */
async function takeOverAll(): Promise<void> {
  for (const each of await workspace.tabs()) await takeOver(numberOf(each.id)).catch((err) => console.error(`chat-ui: ${message(err)}`));
}

/** A tab's `@tab_renderer` now names `owner`: this plugin draws it as a chat, or stops. */
function rendererChanged(tab: number, owner: unknown): void {
  if (owner === self.plugin.id) {
    drawing.add(tab);
    listen();
    // The requests already waiting, asked while no chat showed (another client may hold them).
    void bridgeOf(tab)
      .then(async (bridge) => {
        for (const each of await workspace.requests({ tab: tabRef(tab) })) {
          const kind = (each as { kind?: unknown }).kind;
          if (kind !== undefined && kind !== "permission" && kind !== "question") continue;
          bridge.requested({ request: each.id, tab: tabRef(tab), kind: kind === "question" ? "question" : "permission", title: each.title, detail: each.detail, options: each.options as unknown[] });
        }
      })
      .catch((err) => console.error(`chat-ui: ${message(err)}`));
    return;
  }
  drawing.delete(tab);
  listen();
}

/** A tab's option changed: `tab.changed` names it `options.<name>` and carries its new value. */
function optionChanged(event: PumiEvent): void {
  if (typeof event.tab !== "string") return;
  const tab = numberOf(event.tab);
  const keys: string[] = event.data?.keys ?? [];
  const patch = (event.data?.patch as { options?: Record<string, unknown> } | undefined)?.options ?? {};
  for (const key of keys) {
    if (!key.startsWith("options.")) continue;
    const name = key.slice("options.".length);
    if (name === TAB_RENDERER) {
      rendererChanged(tab, patch[name]);
      continue;
    }
    if (name === "@agent") {
      const next = patch[name];
      if (agentSpec(next)) {
        stop(tab);
        void claim(tab)
          .then(() => takeOver(tab))
          .catch((err) => console.error(`chat-ui: ${message(err)}`));
      } else {
        stop(tab);
        if (drawing.has(tab)) void setChat(tab, false).catch(() => {});
        // The agent is gone: the next one started here is taken again.
        void tabOption(TAKEN, tab)
          .then((taken) => isSet(taken) && setTabOption(TAKEN, null, tab))
          .catch(() => {});
      }
      continue;
    }
    if (FOLLOWED.includes(name)) bridges.get(tab)?.then((bridge) => bridge.optionChanged(name, patch[name]), () => {});
  }
}

on("tab.changed", { desc: "Chat UI follows what agent tabs say" }, (event: PumiEvent) => optionChanged(event));

on("tab.closed", { desc: "Chat UI lets a closed tab's chat go" }, (e: PumiEvent) => {
  if (typeof e.tab !== "string") return;
  const tab = numberOf(e.tab);
  stop(tab);
  drawing.delete(tab);
  listen();
});

// ── Options, the command and the key ─────────────────────────────────────────────────────────

// From the palette or the key, the focused tab; from a slot's action, the `{ tab }` it was pressed on.
fn.set("toggle", { desc: "Flip the tab between its terminal and the chat.", parameters: [["table", "arg"]] }, (arg?: unknown) => {
  const asked = typeof arg === "object" && arg !== null ? (arg as { tab?: unknown }).tab : arg;
  const tab = typeof asked === "string" ? numberOf(asked) : typeof asked === "number" ? asked : Number.NaN;
  return toggle(Number.isFinite(tab) ? tab : undefined);
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
  const was = auto;
  auto = (await option.get("auto").catch(() => true)) !== false;
  // Turned on: the agent tabs open now are taken too.
  if (auto && !was) void takeOverAll().catch((err) => console.error(`chat-ui: ${message(err)}`));
  const chosen = await option.get("key").catch(() => "");
  const chord = typeof chosen === "string" ? chosen.trim() : "";
  if (bound === chord) return;
  const found = await option.get("keys", { scope: "global" });
  const root: Keys = found && typeof found === "object" && !Array.isArray(found) ? { ...(found as Keys) } : {};
  const table = { ...(root.root ?? {}) };
  if (bound !== null) delete table[bound];
  bound = null;
  if (chord !== "") {
    table[chord] = { call: self.plugin.prefixed("toggle"), args: [], desc: "Flip the tab between its terminal and the chat" };
    bound = chord;
  }
  await option.set("keys", { ...root, root: table }, { scope: "global" }).catch((err: unknown) => console.error(`chat-ui: ${message(err)}`));
}

on("option.changed", { match: `${self.plugin.prefix}*`, desc: "Chat UI follows its options" }, () => void configure());

/**
 * At start: every agent tab claimed, the chats that were showing (`@tab_renderer` is kept with the
 * tab) read again, and with `auto` on, the agent tabs not taken yet drawn as chats.
 */
async function startup(): Promise<void> {
  await configure();
  for (const each of await workspace.tabs()) {
    const tab = numberOf(each.id);
    if (!agentSpec(await tabOption("@agent", tab))) continue;
    await claim(tab);
    if ((await tabOption(TAB_RENDERER, tab)) === self.plugin.id) rendererChanged(tab, self.plugin.id);
    await takeOver(tab).catch((err) => console.error(`chat-ui: ${message(err)}`));
  }
}

void startup().catch((err) => console.error(`chat-ui: ${message(err)}`));
