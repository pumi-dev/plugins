/**
 * Newline-delimited JSON-RPC 2.0 over a child process's stdio, as `dsh --profile sdk` speaks it:
 * one message per line, request/response by `id`, notifications by `method` alone, and
 * server→client requests for approvals and user questions.
 *
 * The framing rules are the harness's (`@deepseek-ai/dsh-sdk-protocol`): a frame with both `id`
 * and `method` is a request, `id` alone is a response, `method` alone is a notification, and a
 * malformed line is ignored.
 */

/** A writable side of the child: Bun's `FileSink`, narrowed to what this file uses. */
export interface Sink {
  write(chunk: string | Uint8Array): number
  flush(): Promise<number>
}

/** The parts of `Bun.spawn`'s result that this file uses. */
export interface Proc {
  readonly stdin: Sink
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  readonly pid: number
  kill(): void
}

/** A JSON-RPC error the harness answered with. */
export class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message)
    this.name = "RpcError"
  }
}

export type NotificationHandler = (method: string, params: any) => void
export type RequestHandler = (id: number, method: string, params: any) => void

export class LineRpc {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>()
  private readonly decoder = new TextDecoder()
  private buffer = ""
  private closed = false

  constructor(
    private readonly proc: Proc,
    private readonly onNotification: NotificationHandler,
    private readonly onRequest: RequestHandler,
    private readonly onClose: (reason: string) => void,
  ) {}

  /** Starts reading. Frames are handled as they arrive; a closed stream fails what is pending. */
  start(): void {
    void this.read()
  }

  /** A request's answer, or the harness's error. */
  request(method: string, params?: unknown): Promise<any> {
    if (this.closed) return Promise.reject(new Error("the harness is not running"))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  /** Answers a server→client request. */
  respond(id: number, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result })
  }

  /** Refuses a server→client request. */
  respondError(id: number, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } })
  }

  /** Stops reading and fails every pending request: the process is gone. */
  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    const error = new Error(reason)
    for (const waiting of this.pending.values()) waiting.reject(error)
    this.pending.clear()
    this.onClose(reason)
  }

  private write(message: unknown): void {
    try {
      this.proc.stdin.write(`${JSON.stringify(message)}\n`)
      void this.proc.stdin.flush().catch(() => {})
    } catch {
      this.close("the harness stopped accepting input")
    }
  }

  private async read(): Promise<void> {
    try {
      for await (const chunk of this.proc.stdout) {
        this.buffer += this.decoder.decode(chunk, { stream: true })
        let end = this.buffer.indexOf("\n")
        while (end >= 0) {
          const line = this.buffer.slice(0, end)
          this.buffer = this.buffer.slice(end + 1)
          if (line.trim() !== "") this.handle(line)
          end = this.buffer.indexOf("\n")
        }
      }
    } catch {
      // The stream ended; the exit below says why.
    }
    const code = await this.proc.exited.catch(() => undefined)
    this.close(code === undefined ? "the harness exited" : `the harness exited with status ${code}`)
  }

  private handle(line: string): void {
    let message: any
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (typeof message !== "object" || message === null) return
    if (message.id !== undefined && message.method === undefined) {
      const waiting = this.pending.get(message.id)
      if (!waiting) return
      this.pending.delete(message.id)
      if (message.error) waiting.reject(new RpcError(message.error.code ?? -32603, String(message.error.message ?? "error"), message.error.data))
      else waiting.resolve(message.result)
      return
    }
    if (message.id !== undefined) {
      this.onRequest(message.id, String(message.method), message.params)
      return
    }
    if (message.method !== undefined) this.onNotification(String(message.method), message.params)
  }
}
