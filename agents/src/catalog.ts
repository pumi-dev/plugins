// The agents the plugin can open, and how. Settings offers three choices per agent (`modes`): `off`
// leaves it out of the `+` menu and alone, `terminal` opens its own TUI, and `chat` opens it as a
// chat. A chat is the agent's terminal with the chat drawn over it where the plugin reads its
// session file (`chat`), else a tab of the plugin's own over ACP (`acp`), else over the agent's own
// protocol (`sdk`): `modeOf` picks, so no one has to know which. No `import … from "pumi"` here.
import type { Engine } from "./session/wire.ts";
import { AGENTS as BRIDGED } from "./agents.ts";
import { SESSION } from "./session/launch.ts";

/** How an agent tab opens: `chat` is its terminal with the chat over it, `acp` and `sdk` a session tab. */
export type Mode = "off" | "terminal" | "chat" | "acp" | "sdk";
/** What Settings offers for an agent, and the `modes` option holds. */
export type Choice = "off" | "terminal" | "chat";

/** What each choice is called in Settings. */
export const CHOICE_LABELS: Record<Choice, string> = { off: "Off", terminal: "Terminal", chat: "Chat" };

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
    default: "chat",
  },
  {
    id: "claude",
    title: "Claude Code",
    program: "claude",
    acp: { run: [["claude-agent-acp"], ["npx", "-y", PINS.claude]], login: ["claude", "/login"] },
    sdk: "claude",
    resume: ["claude", "--resume", SESSION],
    default: "chat",
  },
  {
    id: "codex",
    title: "Codex",
    program: "codex",
    acp: { run: [["codex-acp"], ["npx", "-y", PINS.codex]], login: ["codex", "login"] },
    sdk: "codex",
    resume: ["codex", "resume", SESSION],
    default: "chat",
  },
  { id: "omp", title: "omp", program: "omp", resume: ["omp", "--session", SESSION], default: "chat" },
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

/** The way `agent` opens as a chat: over its terminal where the chat reads it, else ACP, else its SDK. */
function chatMode(agent: CatalogAgent): Mode | undefined {
  if (BRIDGED[agent.id]) return "chat";
  if (agent.acp) return "acp";
  if (agent.sdk) return "sdk";
  return undefined;
}

/** The choices `agent` has, in the order Settings lists them. */
export function choicesOf(agent: CatalogAgent): Choice[] {
  return chatMode(agent) ? ["off", "terminal", "chat"] : ["off", "terminal"];
}

/**
 * `agent`'s choice as `modes` (the option) says, else its default. `acp` and `sdk`, which Settings
 * once offered, are `chat` now; a choice it does not have is its default.
 */
export function choiceOf(agent: CatalogAgent, modes: unknown): Choice {
  const given = modes && typeof modes === "object" ? (modes as Record<string, unknown>)[agent.id] : undefined;
  const choice = given === "acp" || given === "sdk" ? "chat" : given;
  return typeof choice === "string" && (choicesOf(agent) as string[]).includes(choice) ? (choice as Choice) : agent.default;
}

/** How `agent` opens, as its choice in `modes` says. */
export function modeOf(agent: CatalogAgent, modes: unknown): Mode {
  const choice = choiceOf(agent, modes);
  return choice === "chat" ? (chatMode(agent) ?? "terminal") : choice;
}
