// A stand-in for the Claude Agent SDK, for the host's test: `query` takes the prompts as they come
// and answers each as Claude Code would, in streaming-input mode. A prompt streams a reply with
// thinking and runs a `Bash` call that asks permission (`canUseTool`) before its result; "wait"
// runs until `interrupt()`; "quick" answers at once. Each query's options (and each fork, rewind
// and setting) are written to `calls.jsonl` in its directory, for the test to read. Everything here
// is made up.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

type Rec = Record<string, any>;

let uuids = 0;
const log = (dir: string, call: Rec) => appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify(call)}\n`);

export async function forkSession(session: string, options: Rec = {}) {
  log(options.dir, { call: "forkSession", session, ...options });
  return { sessionId: "forked-session" };
}

export function query({ prompt, options }: { prompt: AsyncIterable<Rec>; options: Rec }) {
  log(options.cwd, { call: "query", ...Object.fromEntries(Object.entries(options).filter(([, v]) => typeof v !== "function")) });
  const out: Rec[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let interrupted: (() => void) | undefined;
  const say = (m: Rec) => {
    out.push({ parent_tool_use_id: null, session_id: "fake-session", ...(m.type === "assistant" || m.type === "user" ? { uuid: `rec-${++uuids}` } : {}), ...m });
    wake?.();
  };
  const delta = (d: Rec) => say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: d } });

  void (async () => {
    let first = true;
    for await (const user of prompt) {
      const text = user.message.content.map((b: Rec) => b.text ?? "").join(" ");
      if (first) say({ type: "system", subtype: "init", session_id: "fake-session", model: "claude-fake", permissionMode: options.permissionMode ?? "default" });
      first = false;
      if (text.endsWith("quick")) {
        say({ type: "assistant", message: { model: "claude-fake", content: [{ type: "text", text: `Said ${text}.` }] } });
        say({ type: "result", subtype: "success", is_error: false, stop_reason: "end_turn", duration_ms: 3 });
        continue;
      }
      if (text.endsWith("wait")) {
        await new Promise<void>((resolve) => (interrupted = resolve));
        say({ type: "result", subtype: "error_during_execution", is_error: true, duration_ms: 5, total_cost_usd: 0.02 });
        continue;
      }
      say({ type: "stream_event", event: { type: "message_start" } });
      delta({ type: "thinking_delta", thinking: "Looking" });
      say({ type: "assistant", message: { model: "claude-fake", content: [{ type: "thinking", thinking: "Looking" }, { type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }] } });
      const answer = await options.canUseTool("Bash", { command: "ls" }, { signal: new AbortController().signal, toolUseID: "tu1", suggestions: [{ type: "addRules" }] });
      const allowed = answer.behavior === "allow";
      say({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: allowed ? "a.txt" : answer.message, is_error: !allowed }] } });
      say({ type: "stream_event", event: { type: "message_start" } });
      delta({ type: "text_delta", text: allowed ? "Listed" : "Not listed" });
      delta({ type: "text_delta", text: "." });
      say({ type: "assistant", message: { model: "claude-fake", content: [{ type: "text", text: allowed ? "Listed." : "Not listed." }], usage: { input_tokens: 10, output_tokens: 5 } } });
      say({ type: "result", subtype: "success", is_error: false, stop_reason: "end_turn", duration_ms: 7, total_cost_usd: 0.01 });
    }
    done = true;
    wake?.();
  })();

  async function* messages() {
    while (true) {
      const next = out.shift();
      if (next) {
        yield next;
        continue;
      }
      if (done) return;
      await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
    }
  }
  const generator = messages() as AsyncGenerator<Rec, void> & Rec;
  generator.interrupt = async () => interrupted?.();
  generator.setModel = async () => {};
  generator.supportedModels = async () => [
    { value: "default", displayName: "Default", description: "The default", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] },
    { value: "opus", displayName: "Opus", description: "The big one" },
  ];
  generator.setMaxThinkingTokens = async (tokens: number | null) => log(options.cwd, { call: "setMaxThinkingTokens", tokens });
  generator.applyFlagSettings = async (settings: Rec) => log(options.cwd, { call: "applyFlagSettings", settings });
  generator.setPermissionMode = async (mode: string) => log(options.cwd, { call: "setPermissionMode", mode });
  generator.rewindFiles = async (uuid: string) => {
    log(options.cwd, { call: "rewindFiles", uuid });
    return { canRewind: true, filesChanged: ["a.txt"], insertions: 1, deletions: 2 };
  };
  generator.getContextUsage = async () => ({ totalTokens: 500, maxTokens: 1000, percentage: 50 });
  generator.supportedCommands = async () => [{ name: "review", description: "Review", argumentHint: "" }];
  generator.close = () => {
    done = true;
    wake?.();
  };
  return generator;
}
