/**
 * One DeepSeek Harness agent per pane: it spawns `dsh --profile sdk`, initializes the JSON-RPC
 * session, sends prompts, folds the session's events into a transcript, and asks the pane about
 * approvals.
 *
 * The wire is the harness's SDK protocol (`@deepseek-ai/dsh-sdk-protocol`). The session event
 * vocabulary it folds is the harness's own (`@deepseek-ai/dsh-session`): `user/message`,
 * `assistant/message`, `tool/call`, `tool/result`, `assistant/attempt`, `turn/end`,
 * `session/title`, and the permission/sandbox/policy snapshots.
 */
import { LineRpc, type Proc } from "./rpc.ts"

/** A line of the pane's transcript. */
export interface Row {
  id: number
  kind: "user" | "assistant" | "tool" | "error" | "note"
  text: string
  /** A tool's name. */
  name?: string
  /** A tool call's state, while its result is still to come. */
  state?: "running" | "done" | "error"
}

/** An approval the pane is being asked to decide. */
export interface Approval {
  id: number
  toolName: string
  reason?: string
}

/** Everything the pane draws, posted whole on each change. */
export interface Snapshot {
  tab: string
  sessionId: string
  status: "starting" | "running" | "idle" | "failed" | "stopped"
  title: string | null
  provider: string
  model: string
  cwd: string
  permission: string | null
  sandbox: string | null
  rows: Row[]
  approval: Approval | null
  error: string | null
  /** The harness executable this pane spawned. */
  binary: string
}

/** What one pane's agent is started with. */
export interface AgentConfig {
  tab: string
  binary: string
  profile: string
  home: string
  cwd: string
  provider: string
  model: string
  effort?: string
  maxTokens?: number
  /** `--patch` files, after the profile's own layers: how a route like OpenRouter is added. */
  patches?: string[]
  /** Environment entries laid over the runtime's: a gateway's key, by the name it expects. */
  env?: Record<string, string>
}

/** How much of a tool's output the transcript keeps. */
const TOOL_TEXT_LIMIT = 4000
/** How many rows a transcript keeps. */
const ROW_LIMIT = 400
/** A question the pane never answers is refused after this long. */
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000

/** The text of a message's content blocks, skipping reasoning and images. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== "object") continue
    const each = block as { type?: string; text?: string }
    if (each.type === "text" && typeof each.text === "string") parts.push(each.text)
  }
  return parts.join("\n")
}

/** A tool call's arguments as one line: the raw JSON the model produced, trimmed. */
function argumentsOf(raw: unknown): string {
  if (typeof raw !== "string") return ""
  try {
    return JSON.stringify(JSON.parse(raw))
  } catch {
    return raw
  }
}

/** One pane's agent. */
export class Agent {
  private readonly rpc: LineRpc
  private readonly proc: Proc
  private readonly rows: Row[] = []
  private readonly calls = new Map<string, Row>()
  private nextRow = 1
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>()
  private snapshot: Snapshot
  private ready: Promise<void> | null = null

  constructor(
    private readonly config: AgentConfig,
    private readonly sessionId: string,
    private readonly onChange: (snapshot: Snapshot) => void,
  ) {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
    env.DSH_HOME = config.home
    for (const [key, value] of Object.entries(config.env ?? {})) env[key] = value

    const argv = [config.binary, "--profile", config.profile]
    for (const patch of config.patches ?? []) argv.push("--patch", patch)

    // SAFETY: with all three stdio slots piped, Bun's `Subprocess` carries exactly the members
    // `Proc` declares (a `FileSink` stdin, `ReadableStream` stdout and stderr, `exited`, `pid`,
    // `kill`), which Bun's own generic parameters only spell differently.
    this.proc = Bun.spawn(argv, {
      cwd: config.cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }) as unknown as Proc

    this.rpc = new LineRpc(
      this.proc,
      (method, params) => this.notification(method, params),
      (id, method, params) => this.request(id, method, params),
      (reason) => this.stopped(reason),
    )

    this.snapshot = {
      tab: config.tab,
      sessionId,
      status: "starting",
      title: null,
      provider: config.provider,
      model: config.model,
      cwd: config.cwd,
      permission: null,
      sandbox: null,
      rows: this.rows,
      approval: null,
      error: null,
      binary: config.binary,
    }
  }

  /** What the pane draws now. */
  get state(): Snapshot {
    return this.snapshot
  }

  /** Starts the runtime, once: reads its stderr, its stdout, then initializes the session. */
  async start(): Promise<void> {
    if (this.ready) return this.ready
    this.rpc.start()
    this.ready = (async () => {
      // Why a pane's runtime stopped is the first thing to know when it does: keep it in the log.
      void this.proc.exited.then((status) => {
        console.error(`dsh[${this.config.tab}]: the runtime exited with status ${status}`)
      })
      void this.drainStderr()
      await this.rpc.request("initialize", {
        cwd: this.config.cwd,
        provider: this.config.provider,
        model: this.config.model,
        ...(this.config.effort ? { reasoningEffort: this.config.effort } : {}),
        ...(this.config.maxTokens ? { maxTokens: this.config.maxTokens } : {}),
        // The pane answers `approval/request`; without this the runtime's own answerers decide.
        approvalRequests: true,
        // This pane has no question UI yet: it dismisses what is asked rather than failing it.
        capabilities: { userQuestions: true },
      })
      this.patch({ status: "idle" })
    })().catch((error: unknown) => {
      this.patch({ status: "failed", error: message(error) })
      throw error
    })
    return this.ready
  }

  /** Sends one prompt into this pane's session. */
  async prompt(text: string): Promise<void> {
    await this.start()
    const trimmed = text.trim()
    if (trimmed === "") return
    this.patch({ status: "running", error: null })
    try {
      await this.rpc.request("session/prompt", {
        sessionId: this.sessionId,
        contentBlocks: [{ type: "text", text: trimmed }],
      })
    } catch (error) {
      this.patch({ status: "idle", error: message(error) })
      throw error
    }
  }

  /** Answers the approval the pane is showing. */
  answer(id: number, outcome: "allowed-once" | "rejected" | "cancelled"): void {
    const timer = this.timers.get(id)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(id)
    this.rpc.respond(id, { outcome })
    this.patch({ approval: null })
  }

  /** Says in the pane that the agent could not do what was asked, without ending it. */
  report(error: unknown): void {
    this.patch({ status: "failed", error: message(error) })
  }

  /** Ends the process. The pane keeps its transcript. */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    try {
      this.proc.kill()
    } catch {
      // Already gone.
    }
    this.patch({ status: "stopped", approval: null })
  }

  /** Asks the runtime to shut down, then ends it. */
  async shutdown(): Promise<void> {
    await this.rpc.request("shutdown").catch(() => {})
    this.stop()
  }

  private async drainStderr(): Promise<void> {
    const decoder = new TextDecoder()
    try {
      for await (const chunk of this.proc.stderr) {
        const text = decoder.decode(chunk, { stream: true }).trim()
        if (text !== "") console.error(`dsh[${this.config.tab}]: ${text}`)
      }
    } catch {
      // The process ended.
    }
  }

  private notification(method: string, params: any): void {
    if (method === "session.status" && params?.sessionId === this.sessionId) {
      const running = params.status === "running"
      this.patch({ status: running ? "running" : "idle" })
      return
    }
    if (method !== "session.event" || params?.sessionId !== this.sessionId) return
    const event = params.event
    if (!event || typeof event !== "object") return
    this.apply(String(event.type), event.data ?? {})
  }

  /** A server→client request: an approval, or a question this pane dismisses. */
  private request(id: number, method: string, params: any): void {
    if (method === "approval/request") {
      const approval: Approval = {
        id,
        toolName: String(params?.toolName ?? "a tool"),
        ...(typeof params?.reason === "string" ? { reason: params.reason } : {}),
      }
      const timer = setTimeout(() => {
        this.timers.delete(id)
        this.rpc.respond(id, { outcome: "rejected" })
        this.patch({ approval: null, error: "the approval timed out" })
      }, APPROVAL_TIMEOUT_MS)
      this.timers.set(id, timer)
      this.patch({ approval })
      return
    }
    if (method === "user-question/ask") {
      // No question UI yet: dismiss, which the runtime maps to its own cancellation rather than
      // failing the turn. The pane says so, so the transcript is not silently wrong.
      this.rpc.respond(id, { cancelled: true })
      this.push({
        kind: "note",
        text: `The agent asked ${Array.isArray(params?.questions) ? params.questions.length : "a"} question(s); dismissed (this pane has no question UI yet).`,
      })
      return
    }
    this.rpc.respondError(id, -32601, `pumi-dsh does not handle ${method}`)
  }

  private stopped(reason: string): void {
    if (this.snapshot.status === "stopped") return
    this.patch({ status: "stopped", error: this.snapshot.error ?? reason, approval: null })
  }

  /** Folds one session event into the transcript. */
  private apply(type: string, data: any): void {
    switch (type) {
      case "session/title":
        if (typeof data.title === "string") this.patch({ title: data.title })
        return
      case "permission/preset":
        if (typeof data.preset === "string") this.patch({ permission: data.preset })
        return
      case "sandbox/mode":
        if (typeof data.mode === "string") this.patch({ sandbox: data.mode })
        return
      case "user/message": {
        // Runtime context and reminders arrive as user messages too; only the person's show.
        if (data?.source?.kind !== "user") return
        const text = textOf(data.content)
        if (text.trim() === "") return
        this.push({ kind: "user", text })
        return
      }
      case "assistant/message": {
        const text = textOf(data?.message?.content)
        if (text.trim() !== "") this.push({ kind: "assistant", text })
        if (data.interrupted === true) this.push({ kind: "note", text: "Interrupted." })
        return
      }
      case "tool/call": {
        const row = this.push({
          kind: "tool",
          name: String(data.name ?? "tool"),
          text: argumentsOf(data.arguments),
          state: "running",
        })
        if (typeof data.callId === "string") this.calls.set(data.callId, row)
        return
      }
      case "tool/result": {
        const id = typeof data?.message?.toolCallId === "string" ? data.message.toolCallId : undefined
        const row = id === undefined ? undefined : this.calls.get(id)
        const text = textOf(data?.message?.content)
        const failed = data?.message?.isError === true
        if (row !== undefined) {
          row.text = clip(text, TOOL_TEXT_LIMIT)
          row.state = failed ? "error" : "done"
          if (typeof data?.error?.reason === "string") row.text = `${row.text}\n\n${data.error.reason}`
        } else {
          this.push({
            kind: "tool",
            name: String(data?.message?.toolCallId ?? "tool"),
            text: clip(text, TOOL_TEXT_LIMIT),
            state: failed ? "error" : "done",
          })
        }
        this.patch({})
        return
      }
      case "assistant/attempt": {
        // A completed model attempt with no message: a failure, retry, or cancellation.
        const reason = finishReason(data?.stream)
        if (reason !== undefined) this.push({ kind: "error", text: reason })
        return
      }
      case "turn/end": {
        const kind = data?.reason?.kind
        if (kind === "error") {
          const detail = data?.reason?.error?.message
          this.push({ kind: "error", text: typeof detail === "string" ? detail : "The turn failed." })
          this.patch({ status: "idle" })
          return
        }
        if (kind === "max-tokens") this.push({ kind: "note", text: "Stopped at the output-token limit." })
        if (kind === "cancelled" || kind === "aborted") this.push({ kind: "note", text: "Turn cancelled." })
        this.patch({ status: "idle" })
        return
      }
      case "plan/mode":
        if (data?.active === true) this.push({ kind: "note", text: "Plan mode." })
        return
      default:
        return
    }
  }

  private push(row: Omit<Row, "id">): Row {
    const full: Row = { id: this.nextRow++, ...row }
    this.rows.push(full)
    if (this.rows.length > ROW_LIMIT) this.rows.splice(0, this.rows.length - ROW_LIMIT)
    this.patch({})
    return full
  }

  /** Applies a change and posts the whole snapshot: a pane that mounts late reads it as one. */
  private patch(change: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...change }
    this.onChange(this.snapshot)
  }
}

/** A failure as one line for the pane. */
function message(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message)
  return String(error)
}

/** Cuts text to `limit`, saying so. */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… ${text.length - limit} more characters`
}

/** The kind of finish a failed attempt's stream ended with, when it was an error. */
function finishReason(stream: unknown): string | undefined {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index] as { chunk?: { type?: string; reason?: { kind?: string; error?: { message?: string } } } }
    if (record?.chunk?.type !== "finish") continue
    const reason = record.chunk.reason
    if (reason?.kind !== "error") return undefined
    return typeof reason.error?.message === "string" ? reason.error.message : "The model request failed."
  }
  return undefined
}
