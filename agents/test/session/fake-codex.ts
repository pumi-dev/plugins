// A small `codex app-server` for the host's test: JSON-RPC on stdin and stdout. A turn streams a
// reasoning summary and a reply around a command that asks approval first; "wait" runs until
// `turn/interrupt`. Everything here is made up.
export {};

type Rec = Record<string, any>;
const send = (message: Rec) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method: string, params: Rec) => send({ method, params: { threadId: "th1", ...params } });
let next = 100;
const waiting = new Map<number, (result: any) => void>();
const ask = (method: string, params: Rec) =>
  new Promise<any>((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });
let interrupted: (() => void) | undefined;

const asked: Rec[] = [];

async function turn(id: string, text: string): Promise<void> {
  notify("turn/started", { turn: { id, status: "inProgress", items: [] } });
  if (text.endsWith("quick")) {
    notify("item/completed", { turnId: id, item: { type: "agentMessage", id: `m-${id}`, text: `Said ${text}.` } });
    notify("turn/completed", { turn: { id, status: "completed", items: [], error: null } });
    return;
  }
  if (text === "wait") {
    await new Promise<void>((resolve) => (interrupted = resolve));
    notify("turn/completed", { turn: { id, status: "interrupted", items: [], error: null } });
    return;
  }
  notify("item/reasoning/summaryTextDelta", { turnId: id, itemId: "r1", delta: "Planning", summaryIndex: 0 });
  notify("item/started", { turnId: id, item: { type: "commandExecution", id: "c1", command: "ls", cwd: "/tmp", status: "inProgress" } });
  const answer = await ask("item/commandExecution/requestApproval", { threadId: "th1", turnId: id, itemId: "c1", command: "ls", cwd: "/tmp" });
  const ok = answer.decision === "accept" || answer.decision === "acceptForSession";
  if (ok) notify("item/commandExecution/outputDelta", { turnId: id, itemId: "c1", delta: "a.txt\n" });
  notify("item/completed", { turnId: id, item: { type: "commandExecution", id: "c1", command: "ls", status: ok ? "completed" : "declined", aggregatedOutput: ok ? "a.txt\n" : "", exitCode: ok ? 0 : null } });
  notify("item/agentMessage/delta", { turnId: id, itemId: "m1", delta: ok ? "Ran it" : "Did not run it" });
  notify("item/agentMessage/delta", { turnId: id, itemId: "m1", delta: "." });
  notify("item/completed", { turnId: id, item: { type: "agentMessage", id: "m1", text: ok ? "Ran it." : "Did not run it." } });
  notify("thread/tokenUsage/updated", { turnId: id, tokenUsage: { total: { totalTokens: 300 }, last: { inputTokens: 100 }, modelContextWindow: 1000 } });
  notify("turn/completed", { turn: { id, status: "completed", items: [], error: null } });
}

let turns = 0;
let rest = "";
process.stdin.on("data", (chunk) => {
  rest += String(chunk);
  let at = rest.indexOf("\n");
  while (at >= 0) {
    const line = rest.slice(0, at);
    rest = rest.slice(at + 1);
    at = rest.indexOf("\n");
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === undefined) {
      waiting.get(m.id)?.(m.result);
      waiting.delete(m.id);
      continue;
    }
    switch (m.method) {
      case "initialize":
        send({ id: m.id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } });
        break;
      case "initialized":
        break;
      case "thread/start":
        send({ id: m.id, result: { thread: { id: "th1", turns: [] }, model: "gpt-fake", reasoningEffort: "medium", approvalPolicy: "on-request", sandbox: { type: "workspaceWrite" } } });
        break;
      case "thread/resume":
        send({
          id: m.id,
          result: {
            thread: { id: m.params.threadId, turns: [{ id: "t0", status: "completed", items: [{ type: "userMessage", id: "u0", content: [{ type: "text", text: "Earlier" }] }, { type: "agentMessage", id: "a0", text: "Answered" }] }] },
            model: "gpt-fake",
          },
        });
        break;
      case "model/list":
        send({ id: m.id, result: { data: [{ id: "gpt-fake", model: "gpt-fake", displayName: "Fake", description: "", hidden: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "medium", description: "" }, { reasoningEffort: "high", description: "" }] }], nextCursor: null } });
        break;
      case "fake/asked":
        send({ id: m.id, result: asked });
        break;
      case "thread/revert":
      case "thread/fork":
        asked.push({ method: m.method, ...m.params });
        send({ id: m.id, result: m.method === "thread/fork" ? { thread: { id: "th-forked", turns: [] } } : { thread: { id: m.params.threadId, turns: [] } } });
        break;
      case "turn/start": {
        asked.push({ method: "turn/start", effort: m.params.effort, approvalPolicy: m.params.approvalPolicy, sandbox: m.params.sandboxPolicy?.type });
        const id = `turn${++turns}`;
        send({ id: m.id, result: { turn: { id, status: "inProgress", items: [] } } });
        void turn(id, m.params.input.map((i: Rec) => i.text ?? "").join(""));
        break;
      }
      case "turn/interrupt":
        interrupted?.();
        send({ id: m.id, result: {} });
        break;
      default:
        send({ id: m.id, error: { code: -32601, message: `no ${m.method}` } });
    }
  }
});
