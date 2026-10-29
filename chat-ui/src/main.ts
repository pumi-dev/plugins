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
  plugin,
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
import { CATALOG, catalogAgent, MODE_LABELS, modeOf, modesOf, type CatalogAgent, type Mode } from "./catalog.ts";
import { searchPath, findProgram } from "./session/launch.ts";
import {
  attach,
  authenticate,
  back,
  cwdFrom,
  engineInstalled,
  followFile,
  handoff,
  isSessionTab,
  login,
  openSession,
  reconcile,
  restart,
  retry,
  sessionRead,
  sessionSend,
  startSession,
} from "./sessions.ts";

export { attach, authenticate, followFile, login, restart, retry, sessionSend, startSession };

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
/** Each agent's mode, as the `modes` option says (`catalog.ts`). */
let modes: unknown = {};

/** The mode of the agent a tab's `@agent` names: `off` for one the catalog does not know. */
function modeFor(agent: unknown): Mode {
  const def = typeof agent === "string" ? catalogAgent(agent) : undefined;
  return def ? modeOf(def, modes) : "off";
}

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

/** The same, for a session tab: from its agent's directory. */
export async function sessionMentions(tab: number, query: string): Promise<MentionHit[]> {
  return findMentions(await cwdFrom(undefined, tab), typeof query === "string" ? query : "");
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
    const id = numberOf(tab);
    const update = (await isSessionTab(id)) ? await sessionRead(id, since ?? undefined) : await read(id, since ?? undefined);
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
  async (tab: string, cmd: Command) => ((await isSessionTab(numberOf(tab))) ? sessionSend(numberOf(tab), cmd) : send(numberOf(tab), cmd)),
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
  // An agent whose mode is `off` is left alone.
  if (modeFor(await tabOption("@agent", tab)) === "off") return;
  if (!text(await tabOption(AGENT_CONVERSATION, tab))) await setTabOption(AGENT_CONVERSATION, self.plugin.id, tab);
}

/**
 * An agent tab whose mode is `chat`, not taken yet, is drawn as the chat, unless another plugin
 * draws it. Answers whether it was taken.
 */
async function takeOver(tab: number): Promise<boolean> {
  const agent = await tabOption("@agent", tab);
  if (!agentSpec(agent) || modeFor(agent) !== "chat") return false;
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
  const was = JSON.stringify(modes);
  modes = (await option.get("modes").catch(() => ({}))) ?? {};
  if (JSON.stringify(modes) !== was) {
    // A mode changed: the `+` menu says so, and agent tabs now of the `chat` mode are taken.
    void contribute().catch((err) => console.error(`chat-ui: ${message(err)}`));
    void takeOverAll().catch((err) => console.error(`chat-ui: ${message(err)}`));
  }
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
  await migrate();
  await configure();
  await contribute().catch((err) => console.error(`chat-ui: ${message(err)}`));
  void reconcile().catch((err) => console.error(`chat-ui: ${message(err)}`));
  for (const each of await workspace.tabs()) {
    const tab = numberOf(each.id);
    if (!agentSpec(await tabOption("@agent", tab))) continue;
    await claim(tab);
    if ((await tabOption(TAB_RENDERER, tab)) === self.plugin.id) rendererChanged(tab, self.plugin.id);
    await takeOver(tab).catch((err) => console.error(`chat-ui: ${message(err)}`));
  }
}

void startup().catch((err) => console.error(`chat-ui: ${message(err)}`));

// ── Opening agents: the `+` menu, by each agent's mode ───────────────────────────────────────

/** The command that opens a new `agent` tab (`tab.new`'s action runs it). */
const newCommand = (agent: CatalogAgent) => `new_${agent.id}`;

/** Where a `tab.new` action was pressed, and where the tab goes. */
interface NewArgs {
  tab?: unknown;
  place?: unknown;
  cwd?: unknown;
}

/** A new tab of `agent`, as its mode says: its TUI in a terminal (the chat over it, for `chat`), or a session tab. */
export async function openAgent(id: string, args?: NewArgs): Promise<string> {
  const agent = catalogAgent(id);
  if (!agent) throw new Error(`chat-ui: no agent \`${id}\``);
  const beside = typeof args?.tab === "string" && !args.tab.includes("/") ? numberOf(args.tab) : undefined;
  const place = args?.place && typeof args.place === "object" ? args.place : beside !== undefined ? { kind: "tiled", beside: tabRef(beside) } : { kind: "tiled" };
  const mode = modeOf(agent, modes);
  if (mode === "acp" || mode === "sdk") {
    const engine = mode === "acp" ? "acp" : agent.sdk!;
    return tabRef(await openSession({ agent: agent.id, engine, cwd: typeof args?.cwd === "string" ? args.cwd : undefined, beside, place }));
  }
  const cwd = await cwdFrom(args?.cwd, beside);
  // `chat`: the hook names the agent as it starts, and the tab is taken then (`takeOver`).
  const opened = await workspace.openTab("terminal", { command: [agent.program], cwd }, place);
  return opened.id;
}

for (const agent of CATALOG) {
  fn.set(newCommand(agent), { desc: `Open ${agent.title} in a new tab, as Settings says (Chat UI).`, parameters: [["table", "args"]] }, (args?: NewArgs) => openAgent(agent.id, args));
}

/** Whether `agent` can open here now, in the mode it has. */
function available(agent: CatalogAgent, mode: Mode, path: string): boolean {
  if (mode === "off") return false;
  if (mode === "acp") return engineInstalled(agent, "acp", path) || (findProgram("npx", path) !== undefined && agent.acp!.run.some((c) => c[0] === "npx"));
  return findProgram(agent.program, path) !== undefined;
}

/**
 * What the plugin contributes now, beside its manifest: a `tab.new` action and a command for each
 * agent installed here whose mode is not `off`, in the catalog's order (`plugin.contribute`).
 */
async function contribute(): Promise<void> {
  const path = searchPath(process.env.PATH);
  const shown = CATALOG.filter((agent) => available(agent, modeOf(agent, modes), path));
  const own = (self.plugin.manifest.contributes?.commands ?? []) as { id: string; title: string }[];
  const commands = [...own, ...shown.map((agent) => ({ id: newCommand(agent), title: `New ${agent.title}` }))];
  const actions = shown.map((agent) => ({ id: agent.id, title: agent.title, icon: "sparkle", command: newCommand(agent) }));
  await plugin.contribute(self.plugin.id, { commands, slots: { "tab.new": actions.length ? { actions } : null } });
}

/** For Settings: each agent, the modes it has, the one it is in, and whether it is installed here. */
export async function agentModes(): Promise<{ id: string; title: string; modes: { value: Mode; label: string }[]; mode: Mode; installed: boolean; note?: string }[]> {
  const path = searchPath(process.env.PATH);
  return CATALOG.map((agent) => ({
    id: agent.id,
    title: agent.title,
    modes: modesOf(agent).map((value) => ({ value, label: MODE_LABELS[value] })),
    mode: modeOf(agent, modes),
    installed: findProgram(agent.program, path) !== undefined,
    ...(agent.sdkNote ? { note: agent.sdkNote } : {}),
  }));
}

/** Sets `agent`'s mode (Settings' dropdown). */
export async function setMode(agent: string, mode: Mode): Promise<void> {
  const def = catalogAgent(agent);
  if (!def || !modesOf(def).includes(mode)) throw new Error(`chat-ui: ${agent} has no mode ${mode}`);
  const now = { ...((modes && typeof modes === "object" ? modes : {}) as Record<string, unknown>), [agent]: mode };
  await option.set("modes", now);
}

/**
 * The plugin's options before it had modes: `auto` off meant agents stayed in their terminals,
 * which is the `terminal` mode now. Read once, while `modes` has never been set.
 */
async function migrate(): Promise<void> {
  await adopt().catch((err) => console.error(`chat-ui: ${message(err)}`));
  const given = await option.get("modes").catch(() => null);
  if (given && typeof given === "object" && Object.keys(given).length > 0) return;
  // No longer declared: read by its full name.
  const auto = await option.get(self.plugin.prefixed("auto")).catch(() => null);
  if (auto !== false && auto !== "false") return;
  const now: Record<string, Mode> = {};
  for (const agent of CATALOG) if (agent.default === "chat") now[agent.id] = "terminal";
  await option.set("modes", now).catch(() => null);
}

// From the palette, the focused tab; from the toolbar, the `{ tab }` it was pressed on.
const tabArg = async (arg?: unknown): Promise<number> => {
  const asked = typeof arg === "object" && arg !== null ? (arg as { tab?: unknown }).tab : arg;
  if (typeof asked === "string") return numberOf(asked);
  if (typeof asked === "number") return asked;
  const at = await here();
  if (at === undefined) throw new Error("chat-ui: no tab in front");
  return at;
};

fn.set("handoff", { desc: "Continue this terminal agent's session in a tab of Chat UI's own (its ACP or SDK mode).", parameters: [["table", "arg"]] }, async (arg?: unknown) => {
  const tab = await tabArg(arg);
  const agent = catalogAgent(String((await tabOption("@agent", tab)) ?? ""));
  if (!agent) throw new Error("chat-ui: this tab runs no agent Chat UI knows");
  const mode = modeOf(agent, modes);
  const engine = mode === "sdk" && agent.sdk ? agent.sdk : agent.acp ? "acp" : agent.sdk;
  if (!engine) throw new Error(`chat-ui: ${agent.title} has no ACP or SDK mode`);
  return tabRef(await handoff(tab, engine));
});

fn.set("back", { desc: "Continue this Chat UI session tab's session in its agent's own terminal.", parameters: [["table", "arg"]] }, async (arg?: unknown) => tabRef(await back(await tabArg(arg))));

/** Flips the toolbar's tab: a session tab goes back to a terminal, a terminal agent tab flips its chat. */
export async function toolbarPress(tab: number): Promise<void> {
  if (await isSessionTab(tab)) await back(tab);
  else await toggle(tab);
}

/** The plugins this one took over from: `agent-chat` (the chat over a terminal) and `acp` (ACP tabs). */
const FORMER = { chat: "amresyd/agent-chat", acp: "amresyd/acp" } as const;

/**
 * Tabs the former plugins drew, while they are not on: a terminal's chat is drawn by this plugin
 * now, and an ACP tab of `acp`'s opens again as a session tab of this one's on its session.
 */
async function adopt(): Promise<void> {
  const on = new Set(((await call("registry.list", "plugin", {}).catch(() => [])) as { id?: string; active?: boolean }[]).filter((p) => p.active).map((p) => p.id));
  const former = Object.values(FORMER).filter((id) => !on.has(id));
  if (former.length === 0) return;
  for (const each of await workspace.tabs()) {
    const tab = numberOf(each.id);
    const renderer = text(await tabOption(TAB_RENDERER, tab));
    const serves = text(await tabOption(AGENT_CONVERSATION, tab));
    if (renderer && former.includes(renderer as never)) await setTabOption(TAB_RENDERER, self.plugin.id, tab);
    if (serves && former.includes(serves as never)) await setTabOption(AGENT_CONVERSATION, self.plugin.id, tab);
    if (each.block !== "amresyd.acp.chat" || !former.includes(FORMER.acp)) continue;
    const agent = text(await tabOption("@agent", tab));
    if (!agent || !catalogAgent(agent)?.acp) continue;
    const session = text(await tabOption("@agent.session", tab));
    const cwd = text(await tabOption("@acp.cwd", tab));
    await openSession({ agent, engine: "acp", ...(cwd ? { cwd } : {}), ...(session ? { session } : {}), place: { kind: "tiled", replace: tabRef(tab) } });
  }
}
