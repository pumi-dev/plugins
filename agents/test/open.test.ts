// Opening an agent on a model with a first prompt (`open.ts`): the model is the session's before
// any prompt goes, a model it does not have is refused with those it has, and without a model the
// open is what it was.
import { expect, test } from "bun:test";

import type { Ack, Command, ConfigOption } from "../src/conversation/model.ts";
import { OpenError, openWith, pickModel, titled, type OpenSteps } from "../src/open.ts";

const MODELS: ConfigOption = {
  id: "pi.model",
  category: "model",
  name: "Model",
  current: "kiro/claude-sonnet-5",
  choices: [
    { id: "kiro/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "kiro/claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "openai/gpt-6", name: "GPT-6" },
  ],
};

/** A session tab whose agent says its models after `lists` asks, and takes a model `takes` asks after it is set. */
function fakeTab(opts: { lists?: number; takes?: number; refuses?: string } = {}) {
  const log: string[] = [];
  let model = { ...MODELS };
  let asked = 0;
  let setAt: number | undefined;
  const steps: OpenSteps = {
    open: async () => {
      log.push("open");
      return 7;
    },
    options: async () => {
      asked++;
      if (setAt !== undefined && asked - setAt >= (opts.takes ?? 1)) model = { ...model, current: pending ?? model.current };
      return asked > (opts.lists ?? 0) ? [{ id: "pi.thinking", category: "thought_level", name: "Thinking", current: "high", choices: [] }, model] : undefined;
    },
    send: async (_tab, command: Command): Promise<Ack> => {
      if (command.type === "setOption") {
        log.push(`setOption ${command.value} on ${model.current}`);
        if (opts.refuses) return { id: command.id, rejected: opts.refuses };
        pending = String(command.value);
        setAt = asked;
      }
      if (command.type === "prompt") log.push(`prompt "${command.text}" on ${model.current}`);
      return { id: command.id };
    },
    close: async (tab) => void log.push(`close %${tab}`),
    chosen: async (_tab, choice) => void log.push(`chosen ${choice.name}`),
    newId: () => "id",
    sleep: async () => {},
  };
  let pending: string | undefined;
  return { steps, log };
}

test("the model is the session's before the first prompt goes", async () => {
  const { steps, log } = fakeTab({ lists: 3, takes: 2 });
  expect(await openWith(steps, { model: "kiro/claude-opus-5.5", prompt: "hi", label: "Pi" })).toBe(7);
  expect(log).toEqual(["open", "setOption kiro/claude-opus-5.5 on kiro/claude-sonnet-5", "chosen Claude Opus 5.5", 'prompt "hi" on kiro/claude-opus-5.5']);
});

test("a model by its name or by its id after the provider is the same model", async () => {
  for (const model of ["Claude Opus 5.5", "claude-opus-5.5"]) {
    const { steps, log } = fakeTab();
    await openWith(steps, { model, label: "Pi" });
    expect(log).toEqual(["open", "setOption kiro/claude-opus-5.5 on kiro/claude-sonnet-5", "chosen Claude Opus 5.5"]);
  }
});

test("a model the agent does not have closes the tab, names the model and those it has, and sends no prompt", async () => {
  const { steps, log } = fakeTab();
  const err = await openWith(steps, { model: "kiro/claude-opus-9", prompt: "hi", label: "Pi" }).catch((e) => e);
  expect(err).toBeInstanceOf(OpenError);
  expect(err.kind).toBe("invalid_params");
  expect(err.message).toBe("agents: Pi has no model `kiro/claude-opus-9`; it has kiro/claude-sonnet-5 (Claude Sonnet 5), kiro/claude-opus-5.5 (Claude Opus 5.5), openai/gpt-6 (GPT-6)");
  expect(log).toEqual(["open", "close %7"]);
});

test("a model the agent refuses, or never takes, closes the tab before any prompt", async () => {
  const refused = fakeTab({ refuses: "pi is busy" });
  const err = await openWith(refused.steps, { model: "openai/gpt-6", prompt: "hi", label: "Pi" }).catch((e) => e);
  expect([err.kind, err.message]).toEqual(["exception", "agents: Pi did not take model `openai/gpt-6`: pi is busy"]);
  expect(refused.log).toEqual(["open", "setOption openai/gpt-6 on kiro/claude-sonnet-5", "close %7"]);
  const slow = fakeTab({ takes: 1_000_000 });
  const late = await openWith(slow.steps, { model: "openai/gpt-6", prompt: "hi", label: "Pi", waitMs: 1000 }).catch((e) => e);
  expect([late.kind, late.message]).toEqual(["timeout", "agents: Pi did not switch to `openai/gpt-6` in 1s"]);
  expect(slow.log.at(-1)).toBe("close %7");
  const silent = fakeTab({ lists: 1_000_000 });
  const none = await openWith(silent.steps, { model: "openai/gpt-6", label: "Pi", waitMs: 1000 }).catch((e) => e);
  expect([none.kind, none.message]).toEqual(["timeout", "agents: Pi did not say its models in 1s, so `openai/gpt-6` was not set"]);
});

test("the model it is on already is not set again, and is still named", async () => {
  const { steps, log } = fakeTab();
  await openWith(steps, { model: "kiro/claude-sonnet-5", prompt: "go", label: "Pi" });
  expect(log).toEqual(["open", "chosen Claude Sonnet 5", 'prompt "go" on kiro/claude-sonnet-5']);
});

test("without a model the open is what it was: no options asked, no title, the prompt straight after", async () => {
  const bare = fakeTab({ lists: 1_000_000 });
  expect(await openWith(bare.steps, { label: "Pi" })).toBe(7);
  expect(bare.log).toEqual(["open"]);
  const prompted = fakeTab({ lists: 1_000_000 });
  await openWith(prompted.steps, { prompt: "hi", label: "Pi" });
  expect(prompted.log).toEqual(["open", 'prompt "hi" on kiro/claude-sonnet-5']);
});

test("an id after the provider that more than one model has is ambiguous", () => {
  const two: ConfigOption = { ...MODELS, choices: [{ id: "a/x", name: "X at a" }, { id: "b/x", name: "X at b" }] };
  expect(() => pickModel(two, "x", "Pi")).toThrow("agents: `x` is more than one of Pi's models: a/x (X at a), b/x (X at b)");
});

test("the title names the model once", () => {
  expect(titled("Pi", "Claude Opus 5.5")).toBe("Pi · Claude Opus 5.5");
  expect(titled("Pi · Claude Opus 5.5", "Claude Opus 5.5")).toBe("Pi · Claude Opus 5.5");
  expect(titled("Fix the docs", undefined)).toBe("Fix the docs");
});
