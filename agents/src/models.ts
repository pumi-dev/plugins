// The models the chat's model picker offers, per agent, and how a pick goes in: what the format
// its sub-plugin reads lists (`registry.ts` `FormatDef.models`). Claude Code and pi take `/model
// <name>` typed into their prompt and switch at once; Codex's `/model` is a picker of its own, so the
// chat opens it in its terminal. No `import … from "pumi"` here.
import type { Choice, ConfigOption } from "./conversation/model.ts";
import type { AgentSpec } from "./agents.ts";
import { formatOf } from "./registry.ts";

/** The choice that opens the agent's own picker in its terminal. */
export const PICK_IN_TERMINAL = "pumi:terminal";

/** The models `spec`'s agent can be switched to from the chat; none for one that picks in its terminal. */
export async function modelsFor(spec: AgentSpec, cwd: string | undefined, env: Record<string, string | undefined> = process.env): Promise<Choice[]> {
  const format = formatOf(spec.format);
  if (!format?.models || format.modelsInTerminal) return [];
  return Promise.resolve(format.models(spec, cwd, env)).catch(() => []);
}

/**
 * The model picker, as the conversation's option: the models it offers, the current one first
 * among them when it is not one of them, and for an agent that picks in its own terminal (or with
 * none found), the choice that opens that.
 */
export function modelOption(current: string | undefined, choices: Choice[], label: string): ConfigOption {
  // A model is named with its provider or without (`kiro/claude-x`, `claude-x`): either names it.
  const names = (id: string) => current !== undefined && (id === current || id.endsWith(`/${current}`) || current.endsWith(`/${id}`));
  const found = choices.find((each) => each.id === current) ?? choices.find((each) => names(each.id));
  const listed = current === undefined || found ? choices : [{ id: current, name: current, group: "Now" }, ...choices];
  const now = found?.id;
  return {
    id: "model",
    category: "model",
    name: "Model",
    current: now ?? current ?? PICK_IN_TERMINAL,
    choices: [...listed, { id: PICK_IN_TERMINAL, name: `More in ${label}…`, description: "Its own model picker, in its terminal", group: " " }],
  };
}

/** What is typed to switch to `model`. */
export function modelCommand(model: string): string {
  return `/model ${model}`;
}
