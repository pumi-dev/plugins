// The agents the plugin can open, and how. Settings offers three choices per agent (`modes`): `off`
// leaves it out of the `+` menu and alone, `terminal` opens its own TUI (its tab's button flips it
// to the chat drawn over it), and `gui` opens a chat tab of the plugin's own that runs the agent:
// over its own protocol (`sdk`) or over ACP (`acp`), the one `prefer` puts first when it has both.
// The agents are the sub-plugins' (`registry.ts`). No `import … from "pumi"` here.
import { agentDef, agentList, engineOf, type AgentDef, type Choice } from "./registry.ts";

export type { Choice } from "./registry.ts";

/** How an agent tab opens: `chat` is its terminal with the chat over it, `acp` and `sdk` a session tab. */
export type Mode = "off" | "terminal" | "chat" | "acp" | "sdk";
/** The `prefer` option: what Settings sets every agent to at once, and which a GUI tries first. */
export type Prefer = "terminal" | "sdk" | "acp";

/** What each choice is called in Settings. */
export const CHOICE_LABELS: Record<Choice, string> = { off: "Off", terminal: "Terminal", gui: "GUI" };

/** An agent the plugin can open: a sub-plugin's (`registry.ts`). */
export type CatalogAgent = AgentDef;

/** Every agent the sub-plugins that are on give, in order. */
export function catalog(): CatalogAgent[] {
  return agentList();
}

/** One agent of the catalog, by id. */
export function catalogAgent(id: string): CatalogAgent | undefined {
  return agentDef(id);
}

/** The choice `agent` has until Settings says otherwise. */
export function defaultOf(agent: CatalogAgent): Choice {
  const choice = agent.default ?? "terminal";
  return (choicesOf(agent) as string[]).includes(choice) ? choice : "terminal";
}

/** The engine `agent`'s SDK is, while a sub-plugin that is on gives it. */
function sdkOf(agent: CatalogAgent): string | undefined {
  return engineOf(agent.sdk) ? agent.sdk : undefined;
}

/** `prefer` as the option holds it: `terminal` when it is not one of the three. */
export function preferOf(value: unknown): Prefer {
  return value === "sdk" || value === "acp" ? value : "terminal";
}

/** How `agent`'s GUI runs: the protocol `prefer` puts first when it has both, else the one it has. */
export function guiMode(agent: CatalogAgent, prefer: Prefer = "terminal"): "sdk" | "acp" | undefined {
  const sdk = sdkOf(agent);
  if (prefer === "acp") return agent.acp ? "acp" : sdk ? "sdk" : undefined;
  return sdk ? "sdk" : agent.acp ? "acp" : undefined;
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
  return typeof choice === "string" && (choicesOf(agent) as string[]).includes(choice) ? (choice as Choice) : defaultOf(agent);
}

/** How `agent` opens, as its choice in `modes` says, its GUI as `prefer` puts first. */
export function modeOf(agent: CatalogAgent, modes: unknown, prefer: Prefer = "terminal"): Mode {
  const choice = choiceOf(agent, modes);
  return choice === "gui" ? (guiMode(agent, prefer) ?? "terminal") : choice;
}

/** Every agent set as `prefer` says, those `off` left off: `terminal`, or a GUI where it has one. */
export function preferred(modes: unknown, prefer: Prefer): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const agent of catalog()) {
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
