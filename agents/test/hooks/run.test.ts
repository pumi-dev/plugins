// The hook function (`src/hooks/run.ts`) with a fake of what it calls of pumi: what goes on the
// tab, what is reported, a permission asked and answered, and a queued prompt at a turn's end.
import { describe, expect, test } from "bun:test";

import { AGENT, AGENT_ACCEPTS, AGENT_MODEL, AGENT_SESSION, AGENT_TRANSCRIPT, STATUS } from "../../src/names.ts";
import { agentIcon, ICON } from "../../src/icons.ts";
import { requestClosed, runHook, type HookApi } from "../../src/hooks/run.ts";

/** A fake pumi: what was set and reported, in order, and the answers it is given. */
function fake(given: { options?: Record<string, unknown>; queued?: string[]; refuse?: boolean; context?: string } = {}) {
  const sets: [string, unknown, string][] = [];
  const reports: string[] = [];
  const opened: Record<string, unknown>[] = [];
  const closed: string[] = [];
  const queued = [...(given.queued ?? [])];
  const asked: { event: string; resumed: boolean; full: unknown }[] = [];
  const forgot: string[] = [];
  let next = 0;
  const api: HookApi = {
    report: async (tab, body) => reports.push(`${tab} ${body}`),
    get: async (name) => given.options?.[name] ?? null,
    set: async (name, value, tab) => sets.push([name, value, tab]),
    open: async (ask) => {
      if (given.refuse) throw new Error("nothing listens to `request.opened`");
      opened.push(ask);
      return `+${++next}`;
    },
    close: async (id) => {
      closed.push(id);
      requestClosed(id, null);
    },
    takeQueued: async () => queued.shift(),
    context: async (turn) => {
      asked.push({ event: turn.event, resumed: turn.resumed, full: turn.full });
      return given.context ?? null;
    },
    compacted: async (turn) => void forgot.push(`${turn.tab} ${turn.agent} ${turn.session}`),
  };
  return { api, sets, reports, opened, closed, asked, forgot };
}

describe("the hook function", () => {
  test("puts the session, the model and the file on the tab, the trait last, and the resume line", async () => {
    const { api, sets, reports } = fake();
    const input = { session_id: "s-1", transcript_path: "/p/s-1.jsonl", model: "opus" };
    expect(await runHook(api, "%3", "claude", "start", input)).toBeNull();
    expect(sets).toEqual([
      [AGENT_SESSION, "s-1", "%3"],
      [AGENT_MODEL, "opus", "%3"],
      [AGENT_TRANSCRIPT, "/p/s-1.jsonl", "%3"],
      [AGENT_ACCEPTS, ["queue"], "%3"],
      [ICON, agentIcon("claude"), "%3"],
      [AGENT, "claude", "%3"],
      ["restore_command", "claude --resume s-1", "%3"],
    ]);
    expect(reports).toEqual(["%3 state=idle:app=claude"]);
  });

  test("shows an agent's mark on a tab new to it only", async () => {
    const again = fake({ options: { [AGENT]: "claude" } });
    await runHook(again.api, "%3", "claude", "prompt", {});
    expect(again.sets.map(([name]) => name)).toEqual([AGENT_ACCEPTS, AGENT]);
    const unknown = fake();
    await runHook(unknown.api, "%3", "aider", "start", {});
    expect(unknown.sets).toEqual([[AGENT, "aider", "%3"]]);
  });

  test("writes the agent's own resume line, whatever the options say", async () => {
    const { api, sets } = fake({ options: { restore: { codex: [] } } });
    await runHook(api, "%3", "codex", "prompt", { session_id: "s" });
    expect(sets.find(([name]) => name === "restore_command")?.[1]).toBe("codex resume s");
  });

  test("leaves the state of an agent that reports its own", async () => {
    const { api, reports, sets } = fake();
    await runHook(api, "%4", "pi", "prompt", { session_id: "p" });
    expect(reports).toEqual([]);
    expect(sets.at(-2)).toEqual([AGENT, "pi", "%4"]);
  });

  test("answers nothing to what is not a hook's call", async () => {
    const { api, sets, reports } = fake();
    expect(await runHook(api, "3", "claude", "start", {})).toBeNull();
    expect(await runHook(api, "%3", "claude; rm", "start", {})).toBeNull();
    expect(await runHook(api, "%3", "claude", "full", {})).toBeNull();
    expect(sets).toEqual([]);
    expect(reports).toEqual([]);
  });

  test("hands a queued prompt on at a turn's end, and the agent works on", async () => {
    const { api, reports } = fake({ queued: ["run the tests"] });
    expect(await runHook(api, "%3", "claude", "stop", { session_id: "s" })).toBe(`{"decision":"block","reason":"run the tests"}`);
    expect(reports).toEqual(["%3 state=working:app=claude"]);
    expect(await runHook(api, "%3", "claude", "stop", { session_id: "s" })).toBeNull();
    expect(reports.at(-1)).toBe("%3 state=done:app=claude");
  });

  test("tells the agent the workspace at its start and its prompts, in its format", async () => {
    const claude = fake({ context: "the map" });
    const start = await runHook(claude.api, "%3", "claude", "start", { session_id: "s", source: "resume", hook_event_name: "SessionStart" });
    expect(JSON.parse(start!)).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "the map" } });
    expect(JSON.parse((await runHook(claude.api, "%3", "claude", "prompt", { session_id: "s" }))!).hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(claude.asked).toEqual([
      { event: "start", resumed: true, full: false },
      { event: "prompt", resumed: false, full: false },
    ]);
    const pi = fake({ context: "the map" });
    expect(await runHook(pi.api, "%4", "pi", "prompt", { session_id: "p" })).toBe("the map");
    // Nothing to tell: the hook prints nothing.
    expect(await runHook(fake().api, "%3", "claude", "prompt", { session_id: "s" })).toBeNull();
  });

  test("forgets what the agent was told when its context is compacted", async () => {
    const { api, forgot, asked } = fake();
    await runHook(api, "%3", "claude", "compact", { session_id: "s" });
    await runHook(api, "%3", "claude", "start", { session_id: "s", source: "compact" });
    expect(forgot).toEqual(["%3 claude s", "%3 claude s"]);
    expect(asked).toEqual([{ event: "start", resumed: false, full: false }]);
  });

  test("hands nothing to an agent that takes no queued prompt", async () => {
    const { api } = fake({ queued: ["x"] });
    expect(await runHook(api, "%3", "codex", "stop", { session_id: "s" })).toBeNull();
  });

  test("says blocked before a question, and working after a tool only when it was blocked", async () => {
    const blocked = fake({ options: { [STATUS]: "blocked" } });
    await runHook(blocked.api, "%3", "claude", "question", {});
    await runHook(blocked.api, "%3", "claude", "resume", {});
    expect(blocked.reports).toEqual(["%3 state=blocked:kind=question:app=claude", "%3 state=working:app=claude"]);
    const working = fake({ options: { [STATUS]: "working" } });
    await runHook(working.api, "%3", "claude", "resume", {});
    expect(working.reports).toEqual([]);
  });
});

describe("a permission", () => {
  const input = { tool_name: "Bash", tool_input: { command: "make deploy" } };

  test("is the agent's to ask while the option is off", async () => {
    const { api, opened, reports } = fake();
    expect(await runHook(api, "%3", "claude", "permission", input)).toBeNull();
    expect(opened).toEqual([]);
    expect(reports).toEqual(["%3 state=blocked:kind=permission:app=claude"]);
  });

  test("is asked in pumi and waits for its answer", async () => {
    const { api, opened, reports } = fake({ options: { permissions: true } });
    const answer = runHook(api, "%3", "claude", "permission", input);
    await Bun.sleep(5);
    expect(opened[0]!.title).toBe("Claude Code wants to use Bash: make deploy");
    requestClosed("+1", { option: "allow" });
    expect(JSON.parse((await answer)!).hookSpecificOutput.decision).toEqual({ behavior: "allow" });
    expect(reports).toEqual(["%3 state=blocked:kind=permission:app=claude", "%3 state=working:app=claude"]);
  });

  test("answered before its asker heard its id, is still heard", async () => {
    const { api } = fake({ options: { permissions: true } });
    requestClosed("+1", { option: "deny" });
    const decision = JSON.parse((await runHook(api, "%3", "claude", "permission", input))!);
    expect(decision.hookSpecificOutput.decision.behavior).toBe("deny");
  });

  test("ends unanswered when the agent moves on, and the agent asks itself", async () => {
    const { api, closed } = fake({ options: { permissions: true } });
    const answer = runHook(api, "%3", "claude", "permission", input);
    await Bun.sleep(5);
    await runHook(api, "%3", "claude", "prompt", { session_id: "s" });
    expect(closed).toEqual(["+1"]);
    expect(await answer).toBeNull();
  });

  test("that nothing shows is the agent's to ask", async () => {
    const { api } = fake({ options: { permissions: true }, refuse: true });
    expect(await runHook(api, "%3", "claude", "permission", input)).toBeNull();
  });
});
