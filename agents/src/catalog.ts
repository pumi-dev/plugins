// The agents the plugin can open, and how. Settings offers three choices per agent (`modes`): `off`
// leaves it out of the `+` menu and alone, `terminal` opens its own TUI (its tab's button flips it
// to the chat drawn over it), and `gui` opens a chat tab of the plugin's own that runs the agent:
// over its own protocol (`sdk`) or over ACP (`acp`), the one `prefer` puts first when it has both.
// No `import … from "pumi"` here.
import type { Engine } from "./session/wire.ts";
import { SESSION } from "./session/launch.ts";

/** How an agent tab opens: `chat` is its terminal with the chat over it, `acp` and `sdk` a session tab. */
export type Mode = "off" | "terminal" | "chat" | "acp" | "sdk";
/** What Settings offers for an agent, and the `modes` option holds. */
export type Choice = "off" | "terminal" | "gui";
/** The `prefer` option: what Settings sets every agent to at once, and which a GUI tries first. */
export type Prefer = "terminal" | "sdk" | "acp";

/** What each choice is called in Settings. */
export const CHOICE_LABELS: Record<Choice, string> = { off: "Off", terminal: "Terminal", gui: "GUI" };

export interface CatalogAgent {
  /** The id its hook sets as the trait (`names.ts` `AGENT`), and its key in `modes`. */
  id: string;
  /** What the menu and Settings call it. */
  title: string;
  /** Its TUI: the program on `PATH`, and the words it starts with. */
  program: string;
  /** How its ACP server starts, tried in order (the first whose program is found), and signs in. */
  acp?: { run: string[][]; env?: Record<string, string>; login?: string[] };
  /** Its own protocol, run by the session host (`session/engines.ts`). */
  sdk?: Engine;
  /** Its TUI resuming a session, `{session}` where the id goes. */
  resume?: string[];
  /** The choice it has until Settings says otherwise. */
  default: Choice;
  /** Said under its row while its GUI runs its SDK: why to think before picking it. */
  sdkNote?: string;
}

/** The ACP adapters' versions, pinned: `npx` fetches exactly these when the adapter is not installed. */
export const PINS = {
  claude: "@agentclientprotocol/claude-agent-acp@0.94.0",
  codex: "@agentclientprotocol/codex-acp@2.2.2",
  pi: "pi-acp@0.0.34",
} as const;

export const CATALOG: CatalogAgent[] = [
  {
    id: "pi",
    title: "Pi",
    program: "pi",
    acp: { run: [["pi-acp"], ["npx", "-y", PINS.pi]], login: ["pi"] },
    sdk: "pi",
    resume: ["pi", "--session", SESSION],
    default: "terminal",
  },
  {
    id: "claude",
    title: "Claude Code",
    program: "claude",
    acp: { run: [["claude-agent-acp"], ["npx", "-y", PINS.claude]], login: ["claude", "/login"] },
    sdk: "claude",
    resume: ["claude", "--resume", SESSION],
    default: "terminal",
    sdkNote: "GUI runs it through Anthropic's Agent SDK: on a Pro or Max plan that may be billed as extra usage.",
  },
  {
    id: "codex",
    title: "Codex",
    program: "codex",
    acp: { run: [["codex-acp"], ["npx", "-y", PINS.codex]], login: ["codex", "login"] },
    sdk: "codex",
    resume: ["codex", "resume", SESSION],
    default: "terminal",
  },
  { id: "omp", title: "omp", program: "omp", resume: ["omp", "--session", SESSION], default: "terminal" },
  { id: "gemini", title: "Gemini", program: "gemini", acp: { run: [["gemini", "--acp"]], login: ["gemini"] }, default: "terminal" },
  {
    id: "opencode",
    title: "OpenCode",
    program: "opencode",
    acp: { run: [["opencode", "acp"]], login: ["opencode", "auth", "login"] },
    resume: ["opencode", "--session", SESSION],
    default: "terminal",
  },
  { id: "cursor", title: "Cursor Agent", program: "cursor-agent", default: "terminal" },
  { id: "amp", title: "Amp", program: "amp", default: "terminal" },
  { id: "droid", title: "Droid", program: "droid", default: "terminal" },
  { id: "copilot", title: "Copilot", program: "copilot", acp: { run: [["copilot", "--acp"]], login: ["copilot"] }, default: "terminal" },
  { id: "kiro", title: "Kiro", program: "kiro-cli", acp: { run: [["kiro-cli", "acp"]], login: ["kiro-cli", "login"] }, default: "terminal" },
  { id: "qwen", title: "Qwen Code", program: "qwen", default: "terminal" },
  { id: "kilo", title: "Kilo", program: "kilo", default: "terminal" },
  { id: "hermes", title: "Hermes", program: "hermes", default: "terminal" },
];

/** One agent of the catalog, by id. */
export function catalogAgent(id: string): CatalogAgent | undefined {
  return CATALOG.find((a) => a.id === id);
}

/** `prefer` as the option holds it: `terminal` when it is not one of the three. */
export function preferOf(value: unknown): Prefer {
  return value === "sdk" || value === "acp" ? value : "terminal";
}

/** How `agent`'s GUI runs: the protocol `prefer` puts first when it has both, else the one it has. */
export function guiMode(agent: CatalogAgent, prefer: Prefer = "terminal"): "sdk" | "acp" | undefined {
  if (prefer === "acp") return agent.acp ? "acp" : agent.sdk ? "sdk" : undefined;
  return agent.sdk ? "sdk" : agent.acp ? "acp" : undefined;
}

/** The choices `agent` has, in the order Settings lists them: a GUI when it has an SDK or ACP. */
export function choicesOf(agent: CatalogAgent): Choice[] {
  return guiMode(agent) ? ["off", "terminal", "gui"] : ["off", "terminal"];
}

/**
 * `agent`'s choice as `modes` (the option) says, else its default. Of what Settings once offered,
 * `acp` and `sdk` are `gui`, and `chat` (the terminal with the chat over it) is `terminal`; a
 * choice it does not have is its default.
 */
export function choiceOf(agent: CatalogAgent, modes: unknown): Choice {
  const given = modes && typeof modes === "object" ? (modes as Record<string, unknown>)[agent.id] : undefined;
  const choice = given === "acp" || given === "sdk" ? "gui" : given === "chat" ? "terminal" : given;
  return typeof choice === "string" && (choicesOf(agent) as string[]).includes(choice) ? (choice as Choice) : agent.default;
}

/** How `agent` opens, as its choice in `modes` says, its GUI as `prefer` puts first. */
export function modeOf(agent: CatalogAgent, modes: unknown, prefer: Prefer = "terminal"): Mode {
  const choice = choiceOf(agent, modes);
  return choice === "gui" ? (guiMode(agent, prefer) ?? "terminal") : choice;
}

/** Every agent set as `prefer` says, those `off` left off: `terminal`, or a GUI where it has one. */
export function preferred(modes: unknown, prefer: Prefer): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const agent of CATALOG) {
    const was = choiceOf(agent, modes);
    out[agent.id] = was === "off" ? "off" : prefer !== "terminal" && guiMode(agent, prefer) ? "gui" : "terminal";
  }
  return out;
}

/**
 * Whether `prefer` is to set every agent (`preferred`): when it changes (`before` is what it was),
 * and at start when it asks for a GUI and no agent has a choice of its own yet. Set before the
 * plugin first ran (pumi's start screen sets it as it installs the plugin), it would else change
 * nothing: each agent kept its default, the terminal.
 */
export function followsPrefer(before: Prefer | undefined, prefer: Prefer, modes: unknown): boolean {
  if (before !== undefined) return before !== prefer;
  const none = !modes || typeof modes !== "object" || Object.keys(modes).length === 0;
  return prefer !== "terminal" && none;
}
