// agents: coding agents in pumi's tabs. Each agent opens from the `+` menu as Settings says (its
// mode): its own TUI in a terminal, the TUI with a chat drawn over it, or a chat tab the plugin
// runs the agent in itself (ACP or the agent's own protocol, `sessions.ts`). Its hook tells the
// plugin its session and state, and the agent is told about the workspace around it (`tell.ts`).
//
//   the `+` menu, or pumi call pumi_dev.agents.open claude   a new agent tab, as its mode says
//   the title bar's button, or the `key` option              the focused tab: the chat, or the TUI
//   pumi call pumi_dev.agents.toggle                         the same
//   pumi call pumi_dev.agents.conversation.read %3           the conversation of tab %3
//   pumi call pumi_dev.agents.queue %3 "next"                a prompt for tab %3's agent, after its turn
//   pumi call pumi_dev.agents.hook %3 claude stop …          what an agent's hook runs (`hooks/`)
//
// An agent's terminal is the plugin's own block, `term`, on pumi's terminal engine (`openTerminal`). The
// chat is how `ui.tsx`'s `Term` draws it while the tab's `@tab_renderer` option names this
// plugin: the terminal keeps running under it, untouched, and shows again as it was when the
// option goes. What the chat shows is the session file the agent writes (`bridge.ts`), and what
// it sends is typed into the terminal. A tab is an agent's by the plugin's own trait (`names.ts`
// `AGENT`), which the agent's hook sets; each one the chat reads says the chat serves its
// conversation (`AGENT_CONVERSATION`), so anything can read it and send to it
// (`conversation.read` / `send` / `changed`).
import {
  call,
  fn,
  on,
  option,
  plugin,
  request,
  self,
  workspace,
  type Disposer,
  type PumiEvent,
} from "pumi";

import type { Update } from "./conversation/change.ts";
import type { Ack, Command, Cursor } from "./conversation/model.ts";
import { agentSpec } from "./agents.ts";
import { Bridge, type TabOptions } from "./bridge.ts";
import { mentions as findMentions } from "./mentions.ts";
import { PICK_IN_TERMINAL } from "./models.ts";
import { runHook, requestClosed, type HookApi } from "./hooks/run.ts";
import { agentLaunch, findAgent, hookRows, install, uninstall } from "./hooks/integrations.ts";
import { agentIcon, ICON } from "./icons.ts";
import { AGENT, AGENT_CONVERSATION, AGENT_MODEL, AGENT_SESSION, AGENT_TRANSCRIPT, STATUS } from "./names.ts";
import type { MentionHit } from "./conversation/view.ts";
import type { ConversationRead } from "./topics.ts";
import { CATALOG, catalogAgent, CHOICE_LABELS, choiceOf, choicesOf, guiMode, modeOf, preferOf, preferred, type CatalogAgent, type Choice, type Mode, type Prefer } from "./catalog.ts";
import { findProgram, searchPath } from "./session/launch.ts";
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
  setOpenTerminal,
  startSession,
} from "./sessions.ts";
import { forget, tell } from "./tell.ts";

export { attach, authenticate, followFile, login, restart, retry, sessionSend, startSession };

/** The tab option naming the plugin drawing the tab's block (`@tab_renderer`): this one, or none. */
const TAB_RENDERER = "@tab_renderer";
/**
 * Set on an agent tab once its `chat` mode has drawn it as the chat, for as long as its agent
 * runs: a tab the user then flips back to the terminal stays there, through a restart too (tab
 * options are kept with the tab). It goes when the agent does, so the next agent there is taken.
 */
const TAKEN = "@agents.taken";
/** The options a bridge follows: the agent's hook sets the trait's, pumi-host `@status`. */
const FOLLOWED = [STATUS, AGENT_SESSION, AGENT_TRANSCRIPT, AGENT_MODEL, "tab_current_path"];

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
/** How much of the end of a session file the chat reads when it opens. */
const history = 4 << 20;

/**
 * One of the options Settings shows, where Settings keeps it: the global scope (the SDK's
 * `option.get` without a scope reads the plugin's own store, which Settings does not write).
 */
const setting = (name: string): Promise<unknown> => option.get(name, { scope: "global" });
const setSetting = (name: string, value: unknown): Promise<null> => option.set(name, value, { scope: "global" });

/** A flag option as the server answers it: set to anything but nothing, `false` or "". */
const isSet = (value: unknown): boolean => value !== undefined && value !== null && value !== false && value !== "" && value !== "false";
/** Each agent's mode, as the `modes` option says (`catalog.ts`). */
let modes: unknown = {};
/** What a GUI tries first, and what Settings last set every agent to (`prefer`); unread before `configure`. */
let prefer: Prefer | undefined;

/** The mode of the agent a tab's trait names: `terminal` for one the catalog does not know. */
function modeFor(agent: unknown): Mode {
  const def = typeof agent === "string" ? catalogAgent(agent) : undefined;
  return def ? modeOf(def, modes, prefer) : "terminal";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function tabOptions(tab: number): Promise<TabOptions> {
  const get = async (name: string) => text(await tabOption(name, tab));
  const [session, transcript, model, status, cwd] = await Promise.all([AGENT_SESSION, AGENT_TRANSCRIPT, AGENT_MODEL, STATUS, "tab_current_path"].map(get));
  return { session, transcript, model, status, cwd };
}

/** The tab's bridge, started when first asked for. Throws for a tab with no agent the chat knows. */
function bridgeOf(tab: number): Promise<Bridge> {
  const running = bridges.get(tab);
  if (running) return running;
  const started = (async () => {
    const spec = agentSpec(await tabOption(AGENT, tab));
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
  if (at === undefined) throw new Error("agents: no tab in front to flip");
  if (!agentSpec(await tabOption(AGENT, at))) throw new Error(`tab %${at} runs no agent the chat reads`);
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

// ── The conversation, for everyone else ──────────────────────────────────────────────────────

fn.set(
  "conversation.read",
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
  "conversation.send",
  {
    desc: "Sends a command to an agent tab: `{type: \"prompt\", id, text}` (typed into its terminal, or queued while it works), `cancel`, `answer`, `unqueue`. Answers `{id, rejected?}`.",
    parameters: [
      ["number", "tab"],
      ["table", "command"],
    ],
  },
  (tab: string, cmd: Command) => sendTo(numberOf(tab), cmd),
);

/** A command for any agent tab of the plugin's: a terminal's, or a session tab's. */
async function sendTo(tab: number, cmd: Command): Promise<Ack> {
  return (await isSessionTab(tab)) ? sessionSend(tab, cmd) : send(tab, cmd);
}

fn.set(
  "queue",
  {
    desc: "A prompt for an agent tab's agent: it goes now when the agent is ready, else at its turn's end. What one agent sends another (`pumi call pumi_dev.agents.queue %5 \"…\"`). Answers `{id, rejected?}`.",
    parameters: [
      ["string", "tab"],
      ["string", "text"],
    ],
  },
  async (tab: string, text: string) => {
    if (typeof text !== "string" || text.trim() === "") throw new Error("agents: nothing to queue");
    return sendTo(numberOf(String(tab)), { type: "prompt", id: crypto.randomUUID(), text });
  },
);

// ── Requests ─────────────────────────────────────────────────────────────────────────────────

// Heard only while a chat shows: with none, nothing of the chat's is there to answer a request, and
// an agent's hook that asks pumi hears `null` at once and asks in its own terminal.
let requests: Disposer | null = null;

function listen(): void {
  if (drawing.size > 0 && !requests) {
    requests = on("request.opened", { desc: "Agents shows an agent's requests in its chat" }, (e) => {
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

on("request.closed", { desc: "Agents takes an ended request out of its chat" }, (e) => {
  const asked = e.data;
  if (typeof asked?.request !== "string") return;
  requestClosed(asked.request, asked.answer);
  if (typeof asked.tab !== "string") return;
  const tab = numberOf(asked.tab);
  bridges.get(tab)?.then((bridge) => bridge.resolved(asked.request), () => {});
});

// ── The agents' hooks ───────────────────────────────────────────────────────────────────────

/** The next prompt queued in `tab`'s chat, for its agent's stop hook; none without a chat. */
async function takeQueued(tab: number): Promise<string | undefined> {
  const running = bridges.get(tab);
  return running ? running.then((bridge) => bridge.handOff(), () => undefined) : undefined;
}

/** What the hook function calls of pumi, and the chat's queue. */
const hookApi: HookApi = {
  report: (tab, body) => call("tab.call", tab, "report", { body }),
  get: (name, tab) => (tab === undefined ? setting(name) : option.get(name, { scope: "tab", id: tab })),
  set: (name, value, tab) => option.set(name, value, { scope: "tab", id: tab }),
  open: (ask, opts) => request.open(ask as Parameters<typeof request.open>[0], opts),
  close: (id) => request.close(id),
  takeQueued,
  context: tell,
  compacted: forget,
};

fn.set(
  "hook",
  {
    desc: "What an agent's hook calls from its terminal (`hooks/integrations.ts` installs it): its tab, the agent's id, the point of its life (`start`, `prompt`, `stop`, `compact`, `permission`, `question`, `resume`) and its input. Answers what the hook prints: a permission's decision, or a queued prompt at its turn's end.",
    parameters: [
      ["string", "tab"],
      ["string", "agent"],
      ["string", "event"],
      ["table", "input"],
    ],
  },
  (tab: unknown, agent: unknown, event: unknown, input: unknown) => runHook(hookApi, tab, agent, event, input),
);

/** The block an agent's terminal is (`pumi_dev.agents.term`): on pumi's terminal engine, drawn by `Term`. */
const TERM = self.plugin.prefixed("term");

/**
 * Opens a terminal for agent `id` (`claude`) and starts it there, with `PUMI_AGENT` so its hook
 * runs; `run` is what is typed instead of the agent's own command (a resume). Answers the tab's id.
 */
async function openTerminal(id: string, opts: { cwd?: string; place?: unknown; run?: string } = {}): Promise<string> {
  const hooked = findAgent(id);
  const program = hooked?.command ?? catalogAgent(id)?.program;
  if (!program) throw new Error(`agents: no agent \`${id}\``);
  const launch = hooked ? agentLaunch(hooked) : { env: {}, command: program };
  const args = { env: launch.env, ...(opts.cwd ? { cwd: opts.cwd } : {}) };
  const tab = (await workspace.openTab(TERM, args, opts.place ?? undefined)).id;
  const icon = agentIcon(id);
  if (icon) await option.set(ICON, icon, { scope: "tab", id: tab }).catch((err: unknown) => console.error(`agents: ${message(err)}`));
  await call("tab.call", tab, "run", { command: opts.run ?? launch.command });
  return tab;
}

setOpenTerminal(openTerminal);

/** Where a `tab.new` action was pressed and where the tab goes, or where an agent starts. */
interface NewArgs {
  /** The tab or pane it was pressed on (`%3`, `:4`). */
  tab?: unknown;
  /** Where it goes, as `tab.open` takes it. */
  place?: unknown;
  cwd?: unknown;
}

/** A new tab of agent `id`, as its mode says: its TUI in a terminal (the chat over it, for `chat`), or a session tab. */
export async function openAgent(id: string, args: NewArgs = {}): Promise<string> {
  const agent = catalogAgent(id);
  if (!agent && !findAgent(id)) throw new Error(`agents: no agent \`${id}\``);
  const beside = typeof args.tab === "string" && /^%\d+$/.test(args.tab) ? numberOf(args.tab) : undefined;
  const place = args.place && typeof args.place === "object" ? args.place : beside !== undefined ? { kind: "tiled", beside: tabRef(beside) } : undefined;
  const given = typeof args.cwd === "string" && args.cwd !== "" ? args.cwd : undefined;
  const mode = agent ? modeOf(agent, modes, prefer) : "terminal";
  if (agent && (mode === "acp" || mode === "sdk")) {
    const engine = mode === "acp" ? "acp" : agent.sdk!;
    return tabRef(await openSession({ agent: agent.id, engine, cwd: given, beside, ...(place ? { place } : {}) }));
  }
  // `chat`: the hook names the agent as it starts, and the tab is taken then (`takeOver`).
  const cwd = given !== undefined || beside !== undefined ? await cwdFrom(given, beside) : undefined;
  return openTerminal(id, { cwd, place });
}

fn.set(
  "open",
  {
    desc: "Opens an agent (`claude`, `codex`, `pi`, …) in a new tab, as its mode in Settings says: its terminal, where its hook runs, or a chat tab. Answers the tab's id.",
    parameters: [
      ["string", "agent"],
      ["string", "cwd"],
    ],
  },
  (agent: string, cwd?: string) => openAgent(agent, { cwd: cwd ?? undefined }),
);

// ── Opening agents: the `+` menu ─────────────────────────────────────────────────────────────

/** The command that opens a new `agent` tab (`tab.new`'s action runs it). */
const newCommand = (agent: CatalogAgent) => `new_${agent.id}`;

for (const agent of CATALOG) {
  fn.set(newCommand(agent), { desc: `Open ${agent.title} in a new tab, as Settings → Agents says.`, parameters: [["table", "args"]] }, (args?: NewArgs) => openAgent(agent.id, args ?? {}));
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
  const shown = CATALOG.filter((agent) => available(agent, modeOf(agent, modes, prefer), path));
  const own = (self.plugin.manifest.contributes?.commands ?? []) as { id: string; title: string }[];
  const commands = [...own, ...shown.map((agent) => ({ id: newCommand(agent), title: `New ${agent.title}` }))];
  const actions = shown.map((agent) => ({ id: agent.id, title: agent.title, icon: "sparkle", command: newCommand(agent) }));
  await plugin.contribute(self.plugin.id, { commands, slots: { "tab.new": actions.length ? { actions } : null } });
}

// ── Settings ────────────────────────────────────────────────────────────────────────────────

/** One agent as Settings lists it: how it opens, whether it is here, and whether its hook is in. */
export interface AgentRow {
  id: string;
  title: string;
  choices: { value: Choice; label: string }[];
  choice: Choice;
  /** Its program is on the PATH. */
  installed: boolean;
  /** Said under its name: why to think before its GUI (the SDK's billing). */
  note?: string;
  /** Its mark, as an image's `src`. */
  icon?: string;
  /** Its hook, when it has one: in (and up to date), and what went wrong putting it in. */
  hook?: { connected: boolean; error?: string };
}

/** Every agent the plugin opens, those installed here first, each with its choice and its hook. */
export async function agentRows(): Promise<AgentRow[]> {
  await syncHooks();
  const path = searchPath(process.env.PATH);
  const hooks = new Map(hookRows().map((row) => [row.id, row]));
  const rows: AgentRow[] = CATALOG.map((agent) => {
    const hook = hooks.get(agent.id);
    const error = hookErrors.get(agent.id);
    return {
      id: agent.id,
      title: agent.title,
      choices: choicesOf(agent).map((value) => ({ value, label: CHOICE_LABELS[value] })),
      choice: choiceOf(agent, modes),
      installed: findProgram(agent.program, path) !== undefined,
      ...(agent.sdkNote && modeOf(agent, modes, prefer) === "sdk" ? { note: agent.sdkNote } : {}),
      ...(agentIcon(agent.id) ? { icon: agentIcon(agent.id) } : {}),
      ...(hook && hook.hook !== "unsupported" ? { hook: { connected: hook.hook === "installed", ...(error ? { error } : {}) } } : {}),
    };
  });
  return rows.sort((a, b) => Number(b.installed) - Number(a.installed));
}

/** Sets how `agent` opens (Settings' switch). */
export async function setMode(agent: string, choice: Choice): Promise<void> {
  const def = catalogAgent(agent);
  if (!def || !choicesOf(def).includes(choice)) throw new Error(`agents: ${agent} has no choice ${choice}`);
  const now = { ...((modes && typeof modes === "object" ? modes : {}) as Record<string, unknown>), [agent]: choice };
  await setSetting("modes", now);
}

/** What went wrong putting each agent's hook in or taking it out, by id, for Settings. */
const hookErrors = new Map<string, string>();
let syncing: Promise<void> = Promise.resolve();

/**
 * Each agent's hook as the options say, with nothing to click: in, and up to date, for an agent
 * installed here that is not `off`; out for one that is `off`, and for all while `hooks` is off.
 * An agent reads its hook when it starts, so one running now picks a change up when it restarts.
 * One at a time: the options and Settings both ask.
 */
function syncHooks(): Promise<void> {
  syncing = syncing.then(async () => {
    const on = (await setting("hooks").catch(() => true)) !== false;
    for (const row of hookRows()) {
      const agent = findAgent(row.id);
      if (!agent || row.hook === "unsupported") continue;
      const off = !on || modeFor(row.id) === "off";
      try {
        if (!off && row.available && row.hook !== "installed") install(agent);
        else if (off && row.hook !== "not_installed") uninstall(agent);
        hookErrors.delete(row.id);
      } catch (err) {
        hookErrors.set(row.id, message(err));
        console.error(`agents: ${row.label}'s hook: ${message(err)}`);
      }
    }
  });
  return syncing;
}

// ── Following the tabs ──────────────────────────────────────────────────────────────────────

/** An agent tab the chat reads says so, unless another package serves its conversation or its mode is `off`. */
async function claim(tab: number): Promise<void> {
  if (modeFor(await tabOption(AGENT, tab)) === "off") return;
  if (!text(await tabOption(AGENT_CONVERSATION, tab))) await setTabOption(AGENT_CONVERSATION, self.plugin.id, tab);
}

/**
 * An agent tab whose mode is `chat`, not taken yet, is drawn as the chat, unless another plugin
 * draws it. Answers whether it was taken.
 */
async function takeOver(tab: number): Promise<boolean> {
  const agent = await tabOption(AGENT, tab);
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
  for (const each of await workspace.tabs()) await takeOver(numberOf(each.id)).catch((err) => console.error(`agents: ${message(err)}`));
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
      .catch((err) => console.error(`agents: ${message(err)}`));
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
    if (name === AGENT) {
      const next = patch[name];
      if (agentSpec(next)) {
        stop(tab);
        void claim(tab)
          .then(() => takeOver(tab))
          .catch((err) => console.error(`agents: ${message(err)}`));
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

on("tab.changed", { desc: "Agents follows what agent tabs say" }, (event: PumiEvent) => optionChanged(event));

on("tab.closed", { desc: "Agents lets a closed tab's chat go" }, (e: PumiEvent) => {
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

/** Reads the options: `prefer` (every agent set as it says when it changes), the modes (the `+` menu follows them), and the hooks'. */
async function configure(): Promise<void> {
  const before = prefer;
  prefer = preferOf(await setting("prefer").catch(() => null));
  if (before !== undefined && before !== prefer) {
    // Settings' "Open agents in" changed: every agent is set so (the `modes` change comes back here).
    await setSetting("modes", preferred(await setting("modes").catch(() => ({})), prefer)).catch((err) => console.error(`agents: ${message(err)}`));
  }
  const was = JSON.stringify(modes);
  modes = (await setting("modes").catch(() => ({}))) ?? {};
  if (JSON.stringify(modes) !== was) {
    // A mode changed: the `+` menu says so, and agent tabs now of the `chat` mode are taken.
    void contribute().catch((err) => console.error(`agents: ${message(err)}`));
    void takeOverAll().catch((err) => console.error(`agents: ${message(err)}`));
  }
  await syncHooks();
}

on("option.changed", { match: `${self.plugin.prefix}*`, desc: "Agents follows its options" }, () => void configure());

/**
 * At start: the options of the plugins this one took over, every agent tab claimed, the chats that
 * were showing (`@tab_renderer` is kept with the tab) read again, the agent tabs of the `chat`
 * mode not taken yet drawn as chats, and each session tab's host found again.
 */
async function startup(): Promise<void> {
  await migrate();
  await configure();
  await contribute().catch((err) => console.error(`agents: ${message(err)}`));
  void reconcile().catch((err) => console.error(`agents: ${message(err)}`));
  for (const each of await workspace.tabs()) {
    const tab = numberOf(each.id);
    if (!agentSpec(await tabOption(AGENT, tab))) continue;
    await claim(tab);
    if ((await tabOption(TAB_RENDERER, tab)) === self.plugin.id) rendererChanged(tab, self.plugin.id);
    await takeOver(tab).catch((err) => console.error(`agents: ${message(err)}`));
  }
}

void startup().catch((err) => console.error(`agents: ${message(err)}`));

// ── Session tabs: handing off and back ──────────────────────────────────────────────────────

// From the palette, the focused tab; from the toolbar, the `{ tab }` it was pressed on.
const tabArg = async (arg?: unknown): Promise<number> => {
  const asked = typeof arg === "object" && arg !== null ? (arg as { tab?: unknown }).tab : arg;
  if (typeof asked === "string") return numberOf(asked);
  if (typeof asked === "number") return asked;
  const at = await here();
  if (at === undefined) throw new Error("agents: no tab in front");
  return at;
};

fn.set("handoff", { desc: "Continue this terminal agent's session in its GUI: a chat tab of the plugin's own, over its SDK or ACP.", parameters: [["table", "arg"]] }, async (arg?: unknown) => {
  const tab = await tabArg(arg);
  const agent = catalogAgent(String((await tabOption(AGENT, tab)) ?? ""));
  if (!agent) throw new Error("agents: this tab runs no agent the plugin knows");
  const gui = guiMode(agent, prefer);
  const engine = gui === "sdk" ? agent.sdk : gui;
  if (!engine) throw new Error(`agents: ${agent.title} has no GUI`);
  return tabRef(await handoff(tab, engine));
});

fn.set("back", { desc: "Continue this chat tab's session in its agent's own terminal.", parameters: [["table", "arg"]] }, async (arg?: unknown) => tabRef(await back(await tabArg(arg))));

/** The toolbar's button: a session tab goes back to a terminal, a terminal agent tab flips its chat. */
export async function toolbarPress(tab: number): Promise<void> {
  if (await isSessionTab(tab)) await back(tab);
  else await toggle(tab);
}

// ── Taking over from the plugins this one replaces ─────────────────────────────────────────

/** The plugins this one took over from: Chat UI (the chat, ACP and SDK tabs), and before it agent-chat and acp. */
const FORMER = { chatUi: "pumi_dev/chat-ui", chat: "amresyd/agent-chat", acp: "amresyd/acp" } as const;

/** Another plugin's option by its full name: in that plugin's own store (`owner/name`), else global. */
async function optionNamed(name: string, plugin?: string): Promise<unknown> {
  const own = plugin ? await option.get(name, { scope: "plugin", plugin }).catch(() => null) : null;
  return own ?? (await setting(name).catch(() => null));
}

/**
 * Once: the options the plugins this one replaces had, as this one's: Chat UI's modes (`choiceOf`
 * reads its `acp`, `sdk` and `chat`), and the workspace context's (`amresyd/agents`). Before modes,
 * agents opened in their terminals, as every one does by default now.
 */
async function migrate(): Promise<void> {
  await adopt().catch((err) => console.error(`agents: ${message(err)}`));
  // Modes an earlier version kept in the plugin's own store go where Settings keeps them.
  const stored = await option.get("modes").catch(() => null);
  const shown = await setting("modes").catch(() => null);
  if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
    if (!shown || typeof shown !== "object" || Object.keys(shown).length === 0) await setSetting("modes", stored).catch(() => null);
    await option.set("modes", null).catch(() => null);
  }
  if (await option.get("migrated").catch(() => null)) return;
  const given = await setting("modes").catch(() => null);
  if (!given || typeof given !== "object" || Object.keys(given).length === 0) {
    const former = await optionNamed("pumi_dev.chat_ui.modes", FORMER.chatUi);
    if (former && typeof former === "object" && Object.keys(former).length > 0) await setSetting("modes", former).catch(() => null);
  }
  for (const [from, to] of [
    ["amresyd.agents.context", "context"],
  ] as const) {
    const value = await optionNamed(from);
    if (value !== null && value !== undefined && value !== "") await setSetting(to, value).catch(() => null);
  }
  await option.set("migrated", true).catch(() => null);
}

/**
 * Tabs the former plugins drew, while they are not on: a terminal's chat is drawn by this plugin
 * now, and a chat tab of theirs opens again as a session tab of this one's on its session.
 */
async function adopt(): Promise<void> {
  const on = new Set(((await call("registry.list", "plugin", {}).catch(() => [])) as { id?: string; active?: boolean }[]).filter((p) => p.active).map((p) => p.id));
  const former: string[] = Object.values(FORMER).filter((id) => !on.has(id));
  if (former.length === 0) return;
  const sessionBlocks: Record<string, string> = { "pumi_dev.chat_ui.session": FORMER.chatUi, "amresyd.acp.chat": FORMER.acp };
  for (const each of await workspace.tabs()) {
    const tab = numberOf(each.id);
    const renderer = text(await tabOption(TAB_RENDERER, tab));
    const serves = text(await tabOption(AGENT_CONVERSATION, tab)) ?? text(await tabOption("@agent.conversation", tab));
    if (renderer && former.includes(renderer)) await setTabOption(TAB_RENDERER, self.plugin.id, tab);
    if (serves && former.includes(serves)) await setTabOption(AGENT_CONVERSATION, self.plugin.id, tab);
    const owner = sessionBlocks[each.block ?? ""];
    if (!owner || !former.includes(owner)) continue;
    const agent = text(await tabOption("@agent", tab));
    const def = agent ? catalogAgent(agent) : undefined;
    if (!agent || !def) continue;
    const engine = owner === FORMER.acp ? "acp" : ((text(await tabOption("@chat_ui.engine", tab)) ?? "acp") as "acp" | "pi" | "claude" | "codex");
    if (engine === "acp" ? !def.acp : def.sdk !== engine) continue;
    const session = text(await tabOption("@agent.session", tab));
    const cwd = text(await tabOption("@chat_ui.cwd", tab)) ?? text(await tabOption("@acp.cwd", tab));
    await openSession({ agent, engine, ...(cwd ? { cwd } : {}), ...(session ? { session } : {}), place: { kind: "tiled", replace: tabRef(tab) } });
  }
}
