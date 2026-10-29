// A small ACP agent for the host's test: it speaks just enough of the protocol over stdin/stdout.
// `session/prompt` streams a reply, runs a tool that needs permission, and ends the turn; a prompt
// of "wait" runs until `session/cancel`. `session/load` replays two messages and never answers, as
// some agents do, so the host's quiet-replay rule ends it. Everything here is made up.
const sessions = [{ sessionId: "fake-1", cwd: process.cwd(), title: "An earlier session", updatedAt: "2025-01-01T00:00:00Z" }];
let next = 100;
const waiting = new Map<number, (result: any) => void>();
let cancel: (() => void) | undefined;

const send = (message: unknown): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};
const update = (sessionId: string, update: unknown) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
const ask = (method: string, params: unknown) =>
  new Promise<any>((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });

const modes = { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code" }] };

async function handle(message: any): Promise<void> {
  if (message.method === undefined) {
    waiting.get(message.id)?.(message.result);
    waiting.delete(message.id);
    return;
  }
  const { id, method, params } = message;
  const answer = (result: unknown): void => send({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return answer({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } }, authMethods: [] });
    case "session/new":
      return answer({ sessionId: "fake-2", modes });
    case "session/list":
      return answer({ sessions });
    case "session/load":
      update(params.sessionId, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "an old question" } });
      update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "an old answer" } });
      return; // never answered
    case "session/set_mode":
      update(params.sessionId, { sessionUpdate: "current_mode_update", currentModeId: params.modeId });
      return answer({});
    case "session/prompt": {
      const sessionId = params.sessionId;
      const text = params.prompt.map((block: any) => block.text ?? "").join("");
      if (text === "wait") {
        await new Promise<void>((resolve) => (cancel = resolve));
        return answer({ stopReason: "cancelled" });
      }
      update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello, " } });
      update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "there." } });
      const toolCall = { toolCallId: "call-1", title: "Run ls", kind: "execute", status: "pending", rawInput: { command: "ls" } };
      update(sessionId, { sessionUpdate: "tool_call", ...toolCall });
      const outcome = await ask("session/request_permission", {
        sessionId,
        toolCall,
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Deny", kind: "reject_once" },
        ],
      });
      const allowed = outcome?.outcome?.outcome === "selected" && outcome.outcome.optionId === "yes";
      update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "call-1", status: allowed ? "completed" : "failed", rawOutput: { output: "a.txt\n", exitCode: 0 } });
      return answer({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
    }
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `no ${method}` } });
}

process.stdin.on("data", (() => {
  let rest = "";
  return (chunk: Buffer) => {
    rest += chunk.toString();
    let at = rest.indexOf("\n");
    while (at >= 0) {
      const line = rest.slice(0, at);
      rest = rest.slice(at + 1);
      at = rest.indexOf("\n");
      if (line.trim() === "") continue;
      const message = JSON.parse(line);
      if (message.method === "session/cancel") cancel?.();
      else void handle(message);
    }
  };
})());
