// A socket's writes, queued.
//
// Bun writes only what the kernel takes right now and returns how much that was — as little as
// eight kilobytes when the far side has not read yet — and the rest is not sent. A frame is
// often far larger: a pane's snapshot is hundreds of kilobytes, a `pane.read` answer may be
// megabytes. Written in one call, everything past the first chunk would be dropped, the client
// would read a length prefix it never receives the body of, and the stream would stop there.
//
// So every write is appended here and sent in order until the socket takes no more; the rest
// waits for the socket's `drain`, which is when there is room again.
import type { Socket } from "bun";

const ENCODER = new TextEncoder();

export class Writer {
  /** The bytes not yet written, oldest first; the first may be partly written. */
  private queue: Uint8Array[] = [];
  /** Nothing more is written, and the socket is closed once the queue is empty. */
  private closing = false;
  /** The connection is gone (or refused a write): nothing more is written at all. */
  private dead = false;

  constructor(
    private readonly socket: Socket<undefined>,
    /** What to do when the socket refuses a write; it is closed and the queue dropped first. */
    private readonly onFail?: (err?: Error) => void,
  ) {}

  /** The bytes waiting to go: a test's window into the queue. */
  get pending(): number {
    return this.queue.reduce((total, part) => total + part.length, 0);
  }

  write(bytes: Uint8Array | string): void {
    if (this.closing || this.dead) return;
    const part = typeof bytes === "string" ? ENCODER.encode(bytes) : bytes;
    if (part.length === 0) return;
    this.queue.push(part);
    this.flush();
  }

  /** Writes what the socket takes now; the rest waits for `drain`. */
  flush(): void {
    if (this.dead) return;
    while (this.queue.length > 0) {
      const head = this.queue[0];
      const wrote = this.socket.write(head);
      if (wrote < 0) return this.fail();
      if (wrote < head.length) {
        // What the kernel did not take is still ours to send.
        this.queue[0] = head.subarray(wrote);
        return;
      }
      this.queue.shift();
    }
    if (this.closing) {
      this.closing = false;
      try {
        this.socket.end();
      } catch {
        // It is gone already.
      }
    }
  }

  /** Sends what is queued, then closes the socket. */
  end(): void {
    if (this.closing || this.dead) return;
    this.closing = true;
    this.flush();
  }

  /** The connection is gone: nothing more is sent, queued or not. */
  stop(): void {
    this.dead = true;
    this.closing = false;
    this.queue = [];
  }

  private fail(): void {
    const pending = this.pending;
    this.stop();
    this.onFail?.(pending === 0 ? undefined : new Error(`${pending} bytes could not be written`));
  }
}
