// JSON-RPC 2.0 over newline-delimited JSON, both ways: what the host speaks to its agent on the
// agent's stdin/stdout (ACP's transport). The agent asks the client things too
// (`session/request_permission`), so a peer answers requests as well as making them; an answer may
// take as long as the user does. No `import … from "pumi"` here.

/** A JSON-RPC error, as an answer carries it. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** ACP's "the agent needs you to sign in first". */
export const AUTH_REQUIRED = -32000;
export const METHOD_NOT_FOUND = -32601;

/** What a peer does with the other side's messages. */
export interface Handlers {
  /** A request: its answer, or a throw (an `RpcError` keeps its code). */
  request(method: string, params: any): unknown | Promise<unknown>;
  /** A notification. */
  notify(method: string, params: any): void;
}

interface Waiting {
  resolve(value: any): void;
  reject(err: Error): void;
}

/** One side of a JSON-RPC connection: `write` sends a line, `feed` takes each line received. */
export class Peer {
  #next = 1;
  #waiting = new Map<number | string, Waiting>();
  #closed: Error | undefined;

  constructor(
    private readonly write: (line: string) => void,
    private readonly handlers: Handlers,
  ) {}

  /** Calls `method`; answers its result, or rejects with its `RpcError`. */
  request<T = any>(method: string, params: unknown): Promise<T> {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = this.#next++;
    return new Promise<T>((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.#closed) this.#send({ jsonrpc: "2.0", method, params });
  }

  /** One line from the other side. A line that is not JSON-RPC is dropped (an agent's stray log). */
  feed(line: string): void {
    const text = line.trim();
    if (text === "") return;
    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    if (typeof message.method === "string") {
      if (message.id === undefined || message.id === null) {
        try {
          this.handlers.notify(message.method, message.params);
        } catch (err) {
          console.error(`acp: ${message.method}: ${String(err)}`);
        }
        return;
      }
      void this.#answer(message.id, message.method, message.params);
      return;
    }
    const waiting = this.#waiting.get(message.id);
    if (!waiting) return;
    this.#waiting.delete(message.id);
    if (message.error) waiting.reject(new RpcError(Number(message.error.code ?? -32603), String(message.error.message ?? "error"), message.error.data));
    else waiting.resolve(message.result ?? null);
  }

  /** The connection is gone: every call still waiting fails with `reason`. */
  close(reason: Error): void {
    if (this.#closed) return;
    this.#closed = reason;
    for (const waiting of this.#waiting.values()) waiting.reject(reason);
    this.#waiting.clear();
  }

  async #answer(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.request(method, params);
      if (!this.#closed) this.#send({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (err) {
      const code = err instanceof RpcError ? err.code : -32603;
      if (!this.#closed) this.#send({ jsonrpc: "2.0", id, error: { code, message: err instanceof Error ? err.message : String(err) } });
    }
  }

  #send(message: unknown): void {
    this.write(`${JSON.stringify(message)}\n`);
  }
}

/** Cuts a byte stream into lines: `push` each chunk, `fn` hears each whole line. */
export function lineReader(fn: (line: string) => void): (chunk: Uint8Array | string) => void {
  const decoder = new TextDecoder();
  let rest = "";
  return (chunk) => {
    rest += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let at = rest.indexOf("\n");
    while (at >= 0) {
      const line = rest.slice(0, at);
      rest = rest.slice(at + 1);
      fn(line);
      at = rest.indexOf("\n");
    }
  };
}
