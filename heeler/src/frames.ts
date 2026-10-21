// The framing both sockets use: a u32 little-endian length, then that many bytes of payload.
// `Frames` keeps what a connection has read so far and hands out the frames that are complete,
// leaving a partial one for the next read.

export class Frames {
  private buffer: Uint8Array = new Uint8Array(0);
  private start = 0;

  /** `max` is the largest payload a frame may hold; a bigger one is not a client of ours. */
  constructor(private readonly max: number) {}

  /** What the connection read, after the frames taken before it. */
  push(bytes: Uint8Array): void {
    const left = this.buffer.subarray(this.start);
    const next = new Uint8Array(left.length + bytes.length);
    next.set(left);
    next.set(bytes, left.length);
    this.buffer = next;
    this.start = 0;
  }

  /** The complete frames at the front, in order; a partial frame stays for the next `push`. */
  take(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (;;) {
      const left = this.buffer.length - this.start;
      if (left < 4) break;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.start);
      const length = view.getUint32(0, true);
      if (length > this.max) throw new Error(`a frame of ${length} bytes`);
      if (left - 4 < length) break;
      out.push(this.buffer.slice(this.start + 4, this.start + 4 + length));
      this.start += 4 + length;
    }
    if (this.start === this.buffer.length) {
      this.buffer = new Uint8Array(0);
      this.start = 0;
    }
    return out;
  }
}

/** A payload as a frame: its length, then it. */
export function framed(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + payload.length);
  new DataView(frame.buffer).setUint32(0, payload.length, true);
  frame.set(payload, 4);
  return frame;
}
