// The model picker's list: pi's `--list-models` table read, and the option built from it.
import { describe, expect, test } from "bun:test";

import { modelCommand, modelOption, parsePiModels, PICK_IN_TERMINAL } from "../src/models.ts";

const TABLE = `provider    model                              context  max-out  thinking  images
anthropic   claude-sonnet-9                    1M       128K     yes       yes
openrouter  ~vendor/model-latest               1.0M     393.2K   yes       yes
openrouter  vendor/model-v2                    1.0M     393.2K   yes       yes
`;

describe("parsePiModels", () => {
  test("each row is provider/model, listed under its provider", () => {
    expect(parsePiModels(TABLE)).toEqual([
      { id: "anthropic/claude-sonnet-9", name: "claude-sonnet-9", group: "anthropic" },
      { id: "openrouter/~vendor/model-latest", name: "~vendor/model-latest", group: "openrouter" },
      { id: "openrouter/vendor/model-v2", name: "vendor/model-v2", group: "openrouter" },
    ]);
  });

  test("with enabled models, only those, by id or provider/id", () => {
    expect(parsePiModels(TABLE, ["claude-sonnet-9", "openrouter/vendor/model-v2"]).map((each) => each.id)).toEqual(["anthropic/claude-sonnet-9", "openrouter/vendor/model-v2"]);
  });
});

describe("modelOption", () => {
  const choices = parsePiModels(TABLE);

  test("the current model is the choice it names, by id or by the model alone", () => {
    expect(modelOption("~vendor/model-latest", choices, "pi").current).toBe("openrouter/~vendor/model-latest");
    expect(modelOption("anthropic/claude-sonnet-9", choices, "pi").current).toBe("anthropic/claude-sonnet-9");
  });

  test("a choice without its provider names a current model with one", () => {
    expect(modelOption("kiro/claude-x", [{ id: "claude-x", name: "claude-x" }], "pi").current).toBe("claude-x");
  });

  test("a current model not listed is listed first", () => {
    const option = modelOption("something-else", choices, "pi");
    expect(option.current).toBe("something-else");
    expect(option.choices?.[0]).toEqual({ id: "something-else", name: "something-else", group: "Now" });
  });

  test("the agent's own picker is always the last choice", () => {
    expect(modelOption(undefined, [], "Codex").choices?.at(-1)?.id).toBe(PICK_IN_TERMINAL);
    expect(modelOption(undefined, [], "Codex").current).toBe(PICK_IN_TERMINAL);
  });

  test("a pick is typed as /model", () => {
    expect(modelCommand("opus")).toBe("/model opus");
  });
});
