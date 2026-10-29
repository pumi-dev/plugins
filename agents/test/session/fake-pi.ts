// A small `pi --mode rpc` for the host's test: it answers the commands the pi engine sends, and a
// prompt streams a reply with thinking, runs a `bash` call and settles; a prompt of "ask" opens an
// extension's `confirm` dialog first and says what was answered; "wait" runs until `abort`.
// Everything here is made up.
export {};

const send = (record: unknown): void => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};
const respond = (id: unknown, command: string, data: unknown = null) => send({ id, type: "response", command, success: true, data });

let model = { provider: "fake", id: "small", name: "Small" };
// The session as entries (`get_entries`): each prompt and reply, the leaf the last. A fork or a
// clone moves to a new session; `switch_session` back.
let level = "high";
let session = { id: process.argv.includes("--session") ? "earlier" : "fresh", file: "/tmp/fake-pi/one.jsonl" };
let entries: Record<string, any>[] = [];
const files = new Map<string, { id: string; entries: Record<string, any>[] }>();
let ids = 0;
const add = (message: Record<string, any>) => {
  const id = `e${++ids}`;
  entries.push({ type: "message", id, parentId: entries.at(-1)?.id ?? null, message });
};
if (session.id === "earlier") {
  add({ role: "user", content: "Earlier question", timestamp: 1 });
  add({ role: "assistant", content: [{ type: "text", text: "Earlier answer" }], stopReason: "stop", timestamp: 2 });
}
const dialogs = new Map<string, (answer: any) => void>();
let aborted: (() => void) | undefined;

async function run(id: unknown, text: string): Promise<void> {
  respond(id, "prompt", { disposition: "started" });
  send({ type: "agent_start" });
  send({ type: "message_start", message: { role: "user", content: text } });
  add({ role: "user", content: text });
  if (text.endsWith("quick")) {
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `Said ${text}.` } });
    send({ type: "message_end", message: { role: "assistant", provider: "fake", model: "small", content: [{ type: "text", text: `Said ${text}.` }], stopReason: "stop" } });
    add({ role: "assistant", content: [{ type: "text", text: `Said ${text}.` }], stopReason: "stop" });
    send({ type: "agent_settled", aborted: false });
    return;
  }
  let said = "Done";
  if (text === "ask") {
    const answer = await new Promise<any>((resolve) => {
      dialogs.set("d1", resolve);
      send({ type: "extension_ui_request", id: "d1", method: "confirm", title: "Go on?", message: "It is safe." });
    });
    said = answer.confirmed ? "Went on" : "Stopped";
  }
  if (text === "wait") {
    await new Promise<void>((resolve) => (aborted = resolve));
    send({ type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } });
    send({ type: "agent_settled", aborted: true });
    return;
  }
  send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Thinking it over" } });
  send({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { id: "call1", name: "bash", arguments: { command: "ls" } } } });
  send({ type: "message_end", message: { role: "assistant", provider: "fake", model: "small", content: [], stopReason: "toolUse" } });
  send({ type: "tool_execution_start", toolCallId: "call1", toolName: "bash", args: { command: "ls" } });
  send({ type: "tool_execution_end", toolCallId: "call1", toolName: "bash", result: { content: [{ type: "text", text: "a.txt\n" }] }, isError: false });
  send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: said } });
  send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "." } });
  send({ type: "message_end", message: { role: "assistant", provider: "fake", model: "small", content: [{ type: "text", text: `${said}.` }], stopReason: "stop", usage: { totalTokens: 120, cost: { total: 0.01 } } } });
  send({ type: "agent_settled", aborted: false });
}

let rest = "";
process.stdin.on("data", (chunk) => {
  rest += String(chunk);
  let at = rest.indexOf("\n");
  while (at >= 0) {
    const line = rest.slice(0, at);
    rest = rest.slice(at + 1);
    at = rest.indexOf("\n");
    if (!line.trim()) continue;
    const command = JSON.parse(line);
    switch (command.type) {
      case "get_state":
        respond(command.id, "get_state", { model, sessionId: session.id, sessionFile: session.file, thinkingLevel: level, isStreaming: false });
        break;
      case "get_entries":
        respond(command.id, "get_entries", { entries, leafId: entries.at(-1)?.id });
        break;
      case "get_available_thinking_levels":
        respond(command.id, "get_available_thinking_levels", { levels: ["off", "low", "high"] });
        break;
      case "set_thinking_level":
        // pi takes the nearest level the model has.
        level = command.level === "medium" ? "high" : command.level;
        respond(command.id, "set_thinking_level", null);
        send({ type: "thinking_level_changed", level });
        break;
      case "fork": {
        const at = entries.findIndex((e) => e.id === command.entryId);
        if (at < 0) {
          send({ id: command.id, type: "response", command: "fork", success: false, error: "no such entry" });
          break;
        }
        const text = entries[at]!.message.content;
        files.set(session.file, { id: session.id, entries });
        // The new file's entries have ids of their own.
        const copy: Record<string, any>[] = entries.slice(0, at).map((e) => ({ ...e, id: `f${e.id}` }));
        copy.forEach((e, i) => (e.parentId = i === 0 ? null : copy[i - 1]!.id));
        entries = copy;
        session = { id: `forked-${command.entryId}`, file: `/tmp/fake-pi/${command.entryId}.jsonl` };
        respond(command.id, "fork", { text, cancelled: false });
        break;
      }
      case "clone":
        files.set(session.file, { id: session.id, entries });
        entries = entries.map((e) => ({ ...e }));
        session = { id: "cloned", file: "/tmp/fake-pi/cloned.jsonl" };
        respond(command.id, "clone", { cancelled: false });
        break;
      case "switch_session": {
        const had = files.get(command.sessionPath);
        files.set(session.file, { id: session.id, entries });
        if (had) entries = had.entries;
        session = { id: had?.id ?? "back", file: command.sessionPath };
        respond(command.id, "switch_session", { cancelled: false });
        break;
      }
      case "get_messages_unused":
        respond(command.id, "get_messages", {
          messages: [
            { role: "user", content: "Earlier question", timestamp: 1 },
            { role: "assistant", content: [{ type: "text", text: "Earlier answer" }], stopReason: "stop", timestamp: 2 },
          ],
        });
        break;
      case "get_available_models":
        respond(command.id, "get_available_models", { models: [model, { provider: "fake", id: "big", name: "Big" }] });
        break;
      case "get_commands":
        respond(command.id, "get_commands", { commands: [{ name: "review", description: "Review the diff", source: "prompt" }] });
        break;
      case "set_model":
        model = { provider: command.provider, id: command.modelId, name: command.modelId };
        respond(command.id, "set_model", model);
        break;
      case "prompt":
        void run(command.id, command.message);
        break;
      case "abort":
        aborted?.();
        respond(command.id, "abort");
        break;
      case "extension_ui_response":
        dialogs.get(command.id)?.(command);
        dialogs.delete(command.id);
        break;
      default:
        send({ id: command.id, type: "response", command: command.type, success: false, error: `unknown command ${command.type}` });
    }
  }
});
