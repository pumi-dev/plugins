// The files the hooks install whole, as text: pi's (and omp's) extension and OpenCode's (and
// Kilo's) plugin. `{fn}` is the hook function, `{agent}` the agent's id, `{stop}` what pi does at a
// turn's end, `{live}` pi's live file. No `import … from "pumi"` here.

/**
 * pi's extension: at each point of a session's life it calls the hook function (`pumi call`), with
 * the session's id, its file and the model as an agent's hook names them (`session_id`,
 * `transcript_path`, `model`). What the hook answers at a start and a prompt (the workspace) goes
 * to pi as a message it reads and the user does not see.
 */
export const PI_EXTENSION = `import { execFile } from "node:child_process";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";

const bin = process.env.PUMI_BIN || "pumi";

// One call of the hook function: what pi is told (the workspace, or a queued prompt), or "".
function hook(event: string, input: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    const args = ["call", "{fn}", String(process.env.PUMI_TAB ?? ""), "{agent}", event, JSON.stringify(input)];
    const child = execFile(bin, args, { timeout: 4000, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? "" : String(stdout)));
    child.stdin?.end();
  });
}

export default function (pi: any) {
  if (!process.env.PUMI_AGENT) return;
  // The session's id, its file and the model.
  const about = (ctx: any) => {
    const input: Record<string, unknown> = {};
    try {
      input.session_id = String(ctx?.sessionManager?.getSessionId?.() ?? "");
      const file = ctx?.sessionManager?.getSessionFile?.();
      if (typeof file === "string" && file.startsWith("/")) input.transcript_path = file;
      const model = ctx?.model;
      if (model?.provider && model?.id) input.model = model.provider + "/" + model.id;
    } catch {}
    return input;
  };
  // What the plugin tells pi about the workspace, handed to it unseen.
  const hidden = (content: string) => ({ customType: "pumi-context", content, display: false });
  pi.on("session_start", async (event: any, ctx: any) => {
    // What a session that ended mid-turn left of its live file no longer holds.
    live.at(ctx);
    live.clear();
    if (ctx?.mode !== "tui") return;
    const resumed = ["resume", "reload", "fork"].includes(event?.reason);
    const text = (await hook("start", { ...about(ctx), resumed })).trim();
    if (text) {
      try {
        pi.sendMessage(hidden(text), { deliverAs: "nextTurn" });
      } catch {}
    }
  });
  pi.on("session_compact", async (_event: any, ctx: any) => {
    await hook("compact", about(ctx));
  });
  pi.on("before_agent_start", async (event: any, ctx: any) => {
    if (ctx?.mode !== "tui" || event?.messageType !== "user") return;
    const text = (await hook("prompt", about(ctx))).trim();
    if (text) return { message: hidden(text) };
  });
  pi.on("agent_end", async (_event: any, ctx: any) => {
    if (ctx?.mode !== "tui") return;
{stop}
  });
  pi.on("session_shutdown", async () => live.clear());
{live}
}
`;

/** The turn is over: what the chat queued is pi's next message, sent as the user's. */
export const PI_STOP_QUEUE = `    const next = (await hook("stop", about(ctx))).trim();
    if (next) {
      try {
        pi.sendUserMessage(next, { deliverAs: "followUp" });
      } catch {}
    }`;

/** The turn is over, for an agent not checked to take a queued message. */
export const PI_STOP = `    await hook("stop", about(ctx));`;

/**
 * What pi says and runs before its session file has it, for the chat to show as it comes: the
 * assistant message being streamed (its text and thinking) and each running tool's output so far.
 * It is the whole of it each time, at most every 100 ms, in `<session file>.live` (JSON, `v: 1`),
 * which goes when the turn ends. pi lists only `.jsonl` files, so it never takes it for a session.
 * `live.ts` reads it.
 */
export const PI_LIVE = `  const live = (() => {
    const most = 64 * 1024;
    let file = "";
    let message: any = null;
    let tools: Record<string, { name: string; output: string }> = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (!file) return;
      try {
        writeFileSync(file + ".tmp", JSON.stringify({ v: 1, message, tools }));
        renameSync(file + ".tmp", file);
      } catch {}
    };
    const later = () => {
      timer ??= setTimeout(flush, 100);
    };
    const textOf = (content: any) =>
      Array.isArray(content) ? content.map((block: any) => (block?.type === "text" && typeof block.text === "string" ? block.text : "")).join("") : "";
    return {
      at(ctx: any) {
        let next = "";
        try {
          const path = ctx?.sessionManager?.getSessionFile?.();
          if (typeof path === "string" && path.startsWith("/")) next = path + ".live";
        } catch {}
        if (next !== file) this.clear();
        file = next;
      },
      message(value: any) {
        if (value?.role !== "assistant") return;
        const content = (Array.isArray(value.content) ? value.content : []).flatMap((block: any) =>
          block?.type === "text" ? [{ type: "text", text: String(block.text ?? "") }]
          : block?.type === "thinking" ? [{ type: "thinking", text: String(block.thinking ?? "") }]
          : [],
        );
        message = { timestamp: value.timestamp, content };
        later();
      },
      ended() {
        message = null;
        later();
      },
      tool(id: string, name: string, output: string | undefined) {
        if (output === undefined) delete tools[id];
        else tools[id] = { name, output: output.length > most ? output.slice(-most) : output };
        later();
      },
      textOf,
      clear() {
        if (timer) clearTimeout(timer);
        timer = undefined;
        message = null;
        tools = {};
        if (file) {
          try {
            unlinkSync(file);
          } catch {}
        }
      },
    };
  })();
  pi.on("message_update", async (event: any, ctx: any) => {
    live.at(ctx);
    live.message(event?.message);
  });
  pi.on("message_end", async (event: any) => {
    if (event?.message?.role === "assistant") live.ended();
  });
  pi.on("tool_execution_start", async (event: any, ctx: any) => {
    if (event?.parentToolCallId || !event?.toolCallId) return;
    live.at(ctx);
    live.tool(event.toolCallId, String(event.toolName ?? ""), "");
  });
  pi.on("tool_execution_update", async (event: any) => {
    if (event?.parentToolCallId || !event?.toolCallId) return;
    live.tool(event.toolCallId, String(event.toolName ?? ""), live.textOf(event.partialResult?.content));
  });
  pi.on("tool_execution_end", async (event: any) => {
    if (event?.parentToolCallId || !event?.toolCallId) return;
    live.tool(event.toolCallId, "", undefined);
  });
  pi.on("agent_end", async () => live.clear());`;

/**
 * OpenCode's plugin: a prompt says the agent works, an idle session that its turn is over. The
 * workspace goes in the system prompt, the whole of it each time (`full`), since the system prompt
 * is built again for each turn.
 */
export const OPENCODE_PLUGIN = `import { execFile } from "node:child_process";

function hook(event, input) {
  return new Promise((resolve) => {
    const args = ["call", "{fn}", String(process.env.PUMI_TAB ?? ""), "{agent}", event, JSON.stringify(input)];
    const child = execFile(process.env.PUMI_BIN || "pumi", args, { timeout: 4000, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? "" : String(stdout)));
    child.stdin?.end();
  });
}

// What the plugin tells each session about the workspace: in its system prompt from each prompt on.
const known = new Map();

export const PumiAgentsPlugin = async () => {
  if (!process.env.PUMI_AGENT) return {};
  return {
    "chat.message": async ({ sessionID }) => {
      if (!sessionID) return;
      const text = (await hook("prompt", { session_id: sessionID, full: true })).trim();
      if (text) known.set(sessionID, text);
      else known.delete(sessionID);
    },
    "experimental.chat.system.transform": async ({ sessionID }, output) => {
      const text = sessionID && known.get(sessionID);
      if (text && Array.isArray(output?.system)) output.system.push(text);
    },
    // The turn is over: the agent is done (OSC 7501, which opencode does not say itself).
    event: async ({ event }) => {
      const session_id = event?.properties?.sessionID ?? "";
      if (event?.type === "session.idle") await hook("stop", { session_id });
      else if (event?.type === "session.compacted") await hook("compact", { session_id });
    },
  };
};

export default { id: "pumi.agents", server: PumiAgentsPlugin, setup() {} };
`;
