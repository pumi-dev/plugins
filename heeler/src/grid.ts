// pumi's grid socket (`grid.sock` in the server's data directory), where a client attaches to one
// terminal pane: a snapshot (the output tail and the modes), then every byte the program writes,
// with the client's input sent back in-band. It is what the app's own panes draw from.
//
// A payload is postcard: integers are LEB128 varints, a string or a byte vector is its length and
// then its bytes, `Option` is one byte and then the value, and both a struct and an enum's fields
// follow in order, an enum led by its variant's index. So the orders below are pumi's.
//
// PROVENANCE: pumi `crates/pumi-proto/src/native.rs` and `frame.rs`, protocol 2.

/** The native protocol's major version. */
export const PROTOCOL = 2;

/** The largest frame pumi sends (a snapshot of a long scrollback is a few MiB). */
export const MAX_FRAME = 64 << 20;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

class Writer {
  private out: number[] = [];

  u8(value: number): this {
    this.out.push(value & 0xff);
    return this;
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  varint(value: number): this {
    let left = value;
    while (left >= 0x80) {
      this.u8((left & 0x7f) | 0x80);
      left = Math.floor(left / 128);
    }
    return this.u8(left);
  }

  bytes(bytes: Uint8Array): this {
    this.varint(bytes.length);
    for (const byte of bytes) this.u8(byte);
    return this;
  }

  text(text: string): this {
    return this.bytes(ENCODER.encode(text));
  }

  option<T>(value: T | null | undefined, write: (value: T) => void): this {
    if (value === null || value === undefined) return this.u8(0);
    this.u8(1);
    write(value);
    return this;
  }

  done(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

class Reader {
  private at = 0;

  constructor(private readonly data: Uint8Array) {}

  get left(): number {
    return this.data.length - this.at;
  }

  u8(): number {
    if (this.at >= this.data.length) throw new Error("a frame ended early");
    return this.data[this.at++];
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  varint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = this.u8();
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 128;
    }
  }

  /** A signed 32-bit number: postcard writes it zigzagged. */
  int32(): number {
    const value = this.varint();
    return (value >>> 1) ^ -(value & 1);
  }

  bytes(): Uint8Array {
    const length = this.varint();
    if (length > this.left) throw new Error(`a field of ${length} bytes past the frame's end`);
    const out = this.data.slice(this.at, this.at + length);
    this.at += length;
    return out;
  }

  text(): string {
    return DECODER.decode(this.bytes());
  }

  option<T>(read: () => T): T | undefined {
    return this.u8() === 0 ? undefined : read();
  }
}

function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, true);
  out.set(payload, 4);
  return out;
}

/** What a client says when it connects. */
export interface Hello {
  protocol: number;
  client: string;
  clientVersion: string;
}

/** The server's answer to a hello. */
export type Welcome =
  | { type: "ok"; protocol: number; serverVersion: string; bootId: string; pid: number }
  | { type: "refused"; protocol: number; serverVersion: string; reason: string };

/** Input, resize and query replies come from a `control` client, whose size wins; an `observe`
 * one gets the output only, at the controller's size. */
export type Mode = "control" | "observe";

export interface Size {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

/** An attach, which is `ClientMsg`'s third variant. */
export interface Attach {
  /** `%N`. */
  pane: string;
  mode: Mode;
  size: Size;
  budget?: number;
  resume?: number;
}

/** What an attached client sends; the first three are the ones this package uses. */
export type AttachClient =
  | { type: "input"; bytes: Uint8Array }
  | { type: "paste"; text: string }
  | { type: "resize"; size: Size }
  | { type: "claim" }
  | { type: "release" };

/** What the server sends an attached client. */
export type AttachServer =
  /** The tail and the modes, for a fresh terminal; `seq` is the output it is current to. */
  | { type: "snapshot"; cols: number; rows: number; bytes: Uint8Array; seq: number; mode: Mode }
  /** Raw output, in order. */
  | { type: "output"; seq: number; bytes: Uint8Array }
  | { type: "resized"; cols: number; rows: number }
  | { type: "control_lost" }
  | { type: "control_gained" }
  | { type: "exited"; status?: number }
  | { type: "error"; message: string };

export function encodeHello(hello: Hello): Uint8Array {
  return frame(new Writer().varint(hello.protocol).text(hello.client).text(hello.clientVersion).done());
}

/** `ClientMsg::Attach`: the third variant of the control messages. */
export function encodeAttach(attach: Attach): Uint8Array {
  const w = new Writer().varint(2).text(attach.pane).varint(attach.mode === "observe" ? 1 : 0);
  writeSize(w, attach.size);
  w.option(attach.budget, (budget) => w.varint(budget));
  w.option(attach.resume, (resume) => w.varint(resume));
  return frame(w.done());
}

function writeSize(w: Writer, size: Size): void {
  w.varint(size.cols).varint(size.rows).varint(size.cellWidth).varint(size.cellHeight);
}

/** One of [`AttachClient`], as a frame. */
export function encodeClient(message: AttachClient): Uint8Array {
  const w = new Writer();
  switch (message.type) {
    case "input":
      w.varint(0).bytes(message.bytes);
      break;
    case "paste":
      w.varint(1).text(message.text);
      break;
    case "resize":
      w.varint(2);
      writeSize(w, message.size);
      break;
    case "claim":
      w.varint(3);
      break;
    case "release":
      w.varint(4);
      break;
  }
  return frame(w.done());
}

/** The server's answer to a hello. */
export function decodeWelcome(payload: Uint8Array): Welcome {
  const r = new Reader(payload);
  const welcome: Welcome =
    r.varint() === 1
      ? { type: "refused", protocol: r.varint(), serverVersion: r.text(), reason: r.text() }
      : { type: "ok", protocol: r.varint(), serverVersion: r.text(), bootId: r.text(), pid: r.varint() };
  return exact(r, welcome);
}

/** One message of the server's, as a payload from [`Frames`]. */
export function decodeServer(payload: Uint8Array): AttachServer {
  const r = new Reader(payload);
  let message: AttachServer;
  switch (r.varint()) {
    case 0: {
      const cols = r.varint();
      const rows = r.varint();
      const bytes = r.bytes();
      const seq = r.varint();
      message = { type: "snapshot", cols, rows, bytes, seq, mode: r.varint() === 1 ? "observe" : "control" };
      break;
    }
    case 1: {
      const seq = r.varint();
      message = { type: "output", seq, bytes: r.bytes() };
      break;
    }
    case 2:
      message = { type: "resized", cols: r.varint(), rows: r.varint() };
      break;
    case 3:
      message = { type: "control_lost" };
      break;
    case 4:
      message = { type: "control_gained" };
      break;
    case 5:
      message = { type: "exited", status: r.option(() => r.int32()) };
      break;
    case 6:
      message = { type: "error", message: r.text() };
      break;
    default:
      throw new Error("not a message of the grid's");
  }
  return exact(r, message);
}

function exact<T>(r: Reader, value: T): T {
  if (r.left !== 0) throw new Error(`${r.left} bytes after a message`);
  return value;
}
