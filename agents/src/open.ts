// Opening an agent on a model, with a first prompt: the model is the session's before any prompt
// goes, or the open fails and says which models there are. No `import … from "pumi"` here, so a
// test drives it with a fake tab.
import type { Ack, Command, ConfigOption, Choice } from "./conversation/model.ts";

/** Why an open failed, in the API's kinds (`invalid_params`, `timeout`, …): `main.ts` throws it as an `ApiError`. */
export class OpenError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
  }
}

/** What opening a session tab does, as `openWith` asks it. */
export interface OpenSteps {
  /** Opens the tab and starts its agent; answers its id. */
  open(): Promise<number>;
  /** Its session's options now; none until the agent has said them. */
  options(tab: number): Promise<ConfigOption[] | undefined>;
  send(tab: number, command: Command): Promise<Ack>;
  /** Closes a tab whose model could not be set: no turn ran on another. */
  close(tab: number): Promise<void>;
  /** Marks the tab as opened on `model`, so its title names it. */
  chosen(tab: number, model: Choice): Promise<void>;
  newId(): string;
  sleep(ms: number): Promise<void>;
}

export interface OpenWith {
  /** A model's id (`kiro/claude-opus-5.5`), its name (`Claude Opus 5.5`), or its id after the provider (`claude-opus-5.5`). */
  model?: string;
  /** The first prompt: it goes once the model is the session's. */
  prompt?: string;
  /** What the errors call the agent (`Pi`). */
  label: string;
  /** How long the agent has to say its models, and to take one. */
  waitMs?: number;
}

/**
 * Opens a session tab as `steps` do; with `model`, sets it and waits until the session says it is
 * on it, and with `prompt`, sends it after. A model the agent does not have, or one it does not
 * take, closes the tab and throws, naming the models it has. Answers the tab's id.
 */
export async function openWith(steps: OpenSteps, given: OpenWith): Promise<number> {
  const model = given.model?.trim() || undefined;
  const prompt = given.prompt?.trim() || undefined;
  const waitMs = given.waitMs ?? 60_000;
  const tab = await steps.open();
  if (model) {
    try {
      await onModel(steps, tab, model, given.label, waitMs);
    } catch (err) {
      await steps.close(tab).catch(() => {});
      throw err;
    }
  }
  if (prompt) {
    const ack = await steps.send(tab, { type: "prompt", id: steps.newId(), text: prompt });
    if (ack.rejected) throw new OpenError("exception", `agents: ${given.label} did not take the prompt: ${ack.rejected}`);
  }
  return tab;
}

async function onModel(steps: OpenSteps, tab: number, model: string, label: string, waitMs: number): Promise<void> {
  const step = 100;
  let listed: ConfigOption | undefined;
  for (let waited = 0; !(listed = modelOption(await steps.options(tab))); waited += step) {
    if (waited >= waitMs) throw new OpenError("timeout", `agents: ${label} did not say its models in ${waitMs / 1000}s, so \`${model}\` was not set`);
    await steps.sleep(step);
  }
  const choice = pickModel(listed, model, label);
  if (listed.current !== choice.id) {
    const ack = await steps.send(tab, { type: "setOption", id: steps.newId(), category: "model", value: choice.id, ...(listed.id ? { option: listed.id } : {}) });
    if (ack.rejected) throw new OpenError("exception", `agents: ${label} did not take model \`${choice.id}\`: ${ack.rejected}`);
    for (let waited = 0; modelOption(await steps.options(tab))?.current !== choice.id; waited += step) {
      if (waited >= waitMs) throw new OpenError("timeout", `agents: ${label} did not switch to \`${choice.id}\` in ${waitMs / 1000}s`);
      await steps.sleep(step);
    }
  }
  await steps.chosen(tab, choice);
}

/** The session's model option, once it lists its models. */
function modelOption(options: ConfigOption[] | undefined): ConfigOption | undefined {
  return options?.find((each) => each.category === "model" && (each.choices?.length ?? 0) > 0);
}

/** The choice `model` names: by id, by name, or by the id after its provider (when one choice has it). */
export function pickModel(option: ConfigOption, model: string, label: string): Choice {
  const choices = option.choices ?? [];
  const lower = model.toLowerCase();
  const exact = choices.find((each) => each.id === model) ?? choices.find((each) => each.name.toLowerCase() === lower);
  if (exact) return exact;
  const tail = choices.filter((each) => each.id.slice(each.id.indexOf("/") + 1).toLowerCase() === lower);
  if (tail.length === 1) return tail[0]!;
  const list = (tail.length > 1 ? tail : choices).map((each) => (each.name && each.name !== each.id ? `${each.id} (${each.name})` : each.id));
  const shown = list.length > 30 ? [...list.slice(0, 30), `and ${list.length - 30} more`] : list;
  if (tail.length > 1) throw new OpenError("ambiguous", `agents: \`${model}\` is more than one of ${label}'s models: ${shown.join(", ")}`);
  throw new OpenError("invalid_params", `agents: ${label} has no model \`${model}\`; it has ${shown.join(", ")}`);
}

/** A tab's title with the model it was opened on: `Pi · Claude Opus 5.5`. */
export function titled(title: string, model: string | undefined): string {
  return model && !title.endsWith(` · ${model}`) ? `${title} · ${model}` : title;
}
