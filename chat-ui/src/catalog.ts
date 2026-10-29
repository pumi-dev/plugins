// The agents the plugin can open, and how: in their own terminal (`terminal`), in their terminal with
// the chat drawn over it (`chat`, the session file read back), in a tab of the plugin's own over ACP
// (`acp`), or over the agent's own protocol (`sdk`). Settings picks one mode per agent (`modes`);
// `off` leaves the agent out of the `+` menu and alone. No `import … from "pumi"` here.
import type { Engine } from "./session/wire.ts";
import { AGENTS as BRIDGED } from "./agents.ts";
import { SESSION } from "./session/launch.ts";

export type Mode = "off" | "terminal" | "chat" | "acp" | "sdk";

/** What each mode is called in Settings. */
export const MODE_LABELS: Record<Mode, string> = {
  off: "Off",
  terminal: "Terminal",
  chat: "Terminal + chat",
  acp: "ACP",
  sdk: "SDK",
};

export interface CatalogAgent {
  /** The id its hook sets as `@agent`, and its key in `modes`. */
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
  /** The mode it has until Settings says otherwise. */
  default: Mode;
  /** Said beside the SDK mode in Settings: why to think before picking it. */
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
    sdkNote: "Runs through Anthropic's Agent SDK. Anthropic asks apps built on it to use an API key; with a Pro or Max sign-in it may be billed as extra usage.",
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
];

/** One agent of the catalog, by id. */
export function catalogAgent(id: string): CatalogAgent | undefined {
  return CATALOG.find((a) => a.id === id);
}

/** The modes `agent` has, in the order Settings lists them. */
export function modesOf(agent: CatalogAgent): Mode[] {
  const out: Mode[] = ["off", "terminal"];
  if (BRIDGED[agent.id]) out.push("chat");
  if (agent.acp) out.push("acp");
  if (agent.sdk) out.push("sdk");
  return out;
}

/** `agent`'s mode as `modes` (the option) says, else its default; a mode it does not have is its default. */
export function modeOf(agent: CatalogAgent, modes: unknown): Mode {
  const given = modes && typeof modes === "object" ? (modes as Record<string, unknown>)[agent.id] : undefined;
  return typeof given === "string" && (modesOf(agent) as string[]).includes(given) ? (given as Mode) : agent.default;
}
