// herdr's private protocol, as far as a direct terminal attach uses it: what herdr's client
// (`herdr agent attach`, `herdr terminal attach`) sends, and what the server sends back.
//
// A payload is bincode 2 in its standard configuration (`bincode::config::standard()`:
// little-endian, varint integers, serde): an enum is its variant's index as a varint, then its
// fields in order; a struct is its fields; `Option` is one byte (0 or 1) and then the value; a
// string or a byte vector is a varint length and then the bytes. So the orders below are herdr's
// exactly, and a variant a direct attach never sends is skipped whole: its tag is not one we
// read, and the frame's length says where it ends.
//
// PROVENANCE: herdr `src/protocol/wire.rs` (`ClientMessage`, `ServerMessage`, `TerminalFrame`,
// `write_message`, `read_message`) and `src/client/attach.rs` @ v0.9.4 (Apache-2.0). herdr
// freezes `ClientMessage`'s variant order ("endpoint generation 1").

/** The private protocol a direct attach checks. */
export const PROTOCOL_VERSION = 22;

/** The largest frame either side sends; terminal bytes are split below it. */
export const MAX_FRAME = 2 * 1024 * 1024;

/** The most terminal bytes put in one frame. */
export const CHUNK = 256 * 1024;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** bincode 2's varint: one byte under 251, else a marker and the value little-endian. */
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
    if (value <= 250) return this.u8(value);
    if (value <= 0xffff) return this.u8(251).u8(value).u8(value >>> 8);
    if (value <= 0xffffffff) return this.u8(252).u8(value).u8(value >>> 8).u8(value >>> 16).u8(value >>> 24);
    const big = BigInt(Math.trunc(value));
    this.u8(253);
    for (let i = 0n; i < 8n; i++) this.u8(Number((big >> (i * 8n)) & 0xffn));
    return this;
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

/** A payload's reader; running past its end is a frame that is not herdr's. */
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
    const first = this.u8();
    if (first <= 250) return first;
    if (first === 254) throw new Error("a 128-bit number is not in this protocol");
    const width = first === 251 ? 2 : first === 252 ? 4 : 8;
    let value = 0;
    let scale = 1;
    for (let i = 0; i < width; i++) {
      value += this.u8() * scale;
      scale *= 256;
    }
    return value;
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

export type RenderEncoding = "semantic_frame" | "terminal_ansi";
const ENCODINGS: RenderEncoding[] = ["semantic_frame", "terminal_ansi"];

export interface TerminalFrame {
  seq: number;
  width: number;
  height: number;
  /** A full redraw rather than a diff. */
  full: boolean;
  /** Bytes the client writes to its terminal as they are. */
  bytes: Uint8Array;
}

/** What the server sends; only the first and the last are sent here. */
export type ServerMessage =
  | { type: "welcome"; version: number; encoding: RenderEncoding; error?: string }
  | { type: "terminal"; frame: TerminalFrame }
  /** The attach is over; the client exits, quietly when the reason is `detached`. */
  | { type: "server_shutdown"; reason?: string };

/** herdr's variant order: `2` is `Graphics`, which pumi never sends. */
const SERVER_TAG = { welcome: 0, terminal: 1, server_shutdown: 3 } as const;

/** A message as a frame: the length, then the payload. */
export function encode(message: ServerMessage): Uint8Array {
  const w = new Writer();
  w.varint(SERVER_TAG[message.type]);
  switch (message.type) {
    case "welcome":
      w.varint(message.version).varint(ENCODINGS.indexOf(message.encoding)).option(message.error, (e) => w.text(e));
      break;
    case "terminal": {
      const frame = message.frame;
      w.varint(frame.seq).varint(frame.width).varint(frame.height).bool(frame.full).bytes(frame.bytes);
      break;
    }
    case "server_shutdown":
      w.option(message.reason, (reason) => w.text(reason));
      break;
  }
  return payload(w);
}

function payload(w: Writer): Uint8Array {
  const body = w.done();
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, true);
  frame.set(body, 4);
  return frame;
}

/** Terminal bytes as frames, each under [`MAX_FRAME`]. `seq.value` counts the frames. */
export function terminal(seq: { value: number }, cols: number, rows: number, full: boolean, bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += CHUNK) {
    seq.value += 1;
    const slice = bytes.slice(at, at + CHUNK);
    parts.push(
      encode({ type: "terminal", frame: { seq: seq.value, width: cols, height: rows, full: full && at === 0, bytes: slice } }),
    );
  }
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export type MouseButton = "left" | "right" | "middle";

/** A mouse event, as herdr's client sends one. */
export type MouseKind =
  | { type: "down"; button: MouseButton }
  | { type: "up"; button: MouseButton }
  | { type: "drag"; button: MouseButton }
  | { type: "moved" }
  | { type: "scroll_up" }
  | { type: "scroll_down" }
  | { type: "scroll_left" }
  | { type: "scroll_right" };

export type MousePosition =
  | { type: "cell"; column: number; row: number }
  | { type: "pixels"; x: number; y: number; column: number; row: number };

export interface MouseGeometry {
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
}

export type ScrollSource = { type: "wheel" } | { type: "page_key"; input: Uint8Array };
export type ScrollDirection = "up" | "down";
export type ClipboardImageTarget = { type: "direct_terminal" } | { type: "pane"; id: string } | { type: "popup"; id: string };

/** What herdr's client sends. Variants this does not name are herdr's shell's, and skipped. */
export type ClientMessage =
  | { type: "terminal_hello"; version: number; cols: number; rows: number; cellWidthPx: number; cellHeightPx: number; pixelMouse: boolean }
  | { type: "input"; data: Uint8Array }
  | { type: "clipboard_image"; target: ClipboardImageTarget; extension: string; data: Uint8Array }
  | { type: "resize"; cols: number; rows: number; cellWidthPx: number; cellHeightPx: number; pixelMouse: boolean }
  | { type: "detach" }
  | { type: "attach_terminal"; terminalId: string; takeover: boolean }
  | { type: "attach_scroll"; source: ScrollSource; direction: ScrollDirection; lines: number; column?: number; row?: number; modifiers: number }
  | { type: "observe_terminal"; target: string }
  | { type: "control_terminal"; target: string; takeover: boolean }
  | { type: "attach_mouse"; kind: MouseKind; position: MousePosition; geometry?: MouseGeometry; modifiers: number; lines: number }
  | { type: "endpoint_control"; kind: string; data: string };

/** The variants that carry what a direct attach uses; the rest are skipped by their tag. */
const DECODED = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 20]);

export type Decoded = { message: ClientMessage } | { skipped: number };

/** One frame's payload: herdr's message, or the tag of a variant a direct attach does not use. */
export function decode(bytes: Uint8Array): Decoded {
  const r = new Reader(bytes);
  const tag = r.varint();
  if (!DECODED.has(tag)) return { skipped: tag };
  const message = readMessage(tag, r);
  if (r.left !== 0) throw new Error(`${r.left} bytes after a message`);
  return { message };
}

function readMessage(tag: number, r: Reader): ClientMessage {
  switch (tag) {
    case 0: {
      const version = r.varint();
      const cols = r.varint();
      const rows = r.varint();
      const cellWidthPx = r.varint();
      const cellHeightPx = r.varint();
      return { type: "terminal_hello", version, cols, rows, cellWidthPx, cellHeightPx, pixelMouse: r.bool() };
    }
    case 1:
      return { type: "input", data: r.bytes() };
    case 2: {
      const kind = r.varint();
      const target: ClipboardImageTarget =
        kind === 1 ? { type: "pane", id: r.text() } : kind === 2 ? { type: "popup", id: r.text() } : { type: "direct_terminal" };
      return { type: "clipboard_image", target, extension: r.text(), data: r.bytes() };
    }
    case 3: {
      const cols = r.varint();
      const rows = r.varint();
      const cellWidthPx = r.varint();
      const cellHeightPx = r.varint();
      return { type: "resize", cols, rows, cellWidthPx, cellHeightPx, pixelMouse: r.bool() };
    }
    case 4:
      return { type: "detach" };
    case 5:
      return { type: "attach_terminal", terminalId: r.text(), takeover: r.bool() };
    case 6: {
      const source: ScrollSource = r.varint() === 1 ? { type: "page_key", input: r.bytes() } : { type: "wheel" };
      const direction: ScrollDirection = r.varint() === 1 ? "down" : "up";
      const lines = r.varint();
      const column = r.option(() => r.varint());
      const row = r.option(() => r.varint());
      return { type: "attach_scroll", source, direction, lines, column, row, modifiers: r.u8() };
    }
    case 7:
      return { type: "observe_terminal", target: r.text() };
    case 8:
      return { type: "control_terminal", target: r.text(), takeover: r.bool() };
    case 16: {
      const kind = readMouseKind(r);
      const position = readMousePosition(r);
      const geometry = r.option(() => ({
        cols: r.varint(),
        rows: r.varint(),
        widthPx: r.varint(),
        heightPx: r.varint(),
      }));
      return { type: "attach_mouse", kind, position, geometry, modifiers: r.u8(), lines: r.varint() };
    }
    default:
      return { type: "endpoint_control", kind: r.text(), data: r.text() };
  }
}

const BUTTONS: MouseButton[] = ["left", "right", "middle"];

function readMouseKind(r: Reader): MouseKind {
  const tag = r.varint();
  if (tag === 3) return { type: "moved" };
  if (tag >= 4) return { type: (["scroll_up", "scroll_down", "scroll_left", "scroll_right"] as const)[tag - 4] };
  const button = BUTTONS[r.varint()] ?? "left";
  return { type: (["down", "up", "drag"] as const)[tag], button };
}

function readMousePosition(r: Reader): MousePosition {
  if (r.varint() === 1) {
    const x = r.varint();
    const y = r.varint();
    return { type: "pixels", x, y, column: r.varint(), row: r.varint() };
  }
  const column = r.varint();
  return { type: "cell", column, row: r.varint() };
}

const BUTTON_CODE: Record<MouseButton, number> = { left: 0, middle: 1, right: 2 };

/** A mouse event as the program asked to hear it: SGR (1006) when it set that, else the legacy
 * encoding (which cannot say a cell past 222). `modifiers` are crossterm's bits (shift 1,
 * control 2, alt 4), as herdr's client sends them. */
export function mouseReport(kind: MouseKind, column: number, row: number, modifiers: number, sgr: boolean): Uint8Array | undefined {
  let code: number;
  let release = false;
  switch (kind.type) {
    case "down":
      code = BUTTON_CODE[kind.button];
      break;
    case "up":
      code = sgr ? BUTTON_CODE[kind.button] : 3;
      release = true;
      break;
    case "drag":
      code = BUTTON_CODE[kind.button] + 32;
      break;
    case "moved":
      code = 35;
      break;
    case "scroll_up":
      code = 64;
      break;
    case "scroll_down":
      code = 65;
      break;
    case "scroll_left":
      code = 66;
      break;
    case "scroll_right":
      code = 67;
      break;
  }
  if (modifiers & 0b001) code += 4;
  if (modifiers & 0b100) code += 8;
  if (modifiers & 0b010) code += 16;
  const x = column + 1;
  const y = row + 1;
  if (sgr) return ENCODER.encode(`\x1b[<${code};${x};${y}${release ? "m" : "M"}`);
  const byte = (value: number) => (value + 32 <= 255 ? value + 32 : undefined);
  const cx = byte(code);
  const cy = byte(x);
  const cz = byte(y);
  if (cx === undefined || cy === undefined || cz === undefined) return undefined;
  return Uint8Array.from([0x1b, 0x5b, 0x4d, cx, cy, cz]);
}
