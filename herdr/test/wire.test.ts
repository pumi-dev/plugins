// herdr's private protocol against vectors worked out by hand from the Rust
// (`herdr/ui/src/proto/wire.rs`, its own tests included): nothing here runs Rust. Each payload
// below is read off the Rust's variant order and bincode 2's standard configuration — the
// variant's index as a varint, then its fields, `Option` as 0 or 1, a string or a byte vector as
// a varint length and then the bytes — and the Rust's `#[cfg(test)]` module gives the first two
// server frames and the mouse reports as bytes.
import { expect, test } from "bun:test";
import { Frames } from "../src/frames.ts";
import {
  CHUNK,
  MAX_FRAME,
  PROTOCOL_VERSION,
  decode,
  encode,
  mouseReport,
  terminal,
  type ClientMessage,
  type MouseKind,
} from "../src/wire.ts";

const frame = (payload: number[]) => Uint8Array.from([payload.length, 0, 0, 0, ...payload]);

test("a welcome is the bytes herdr reads", () => {
  // `Welcome { version: 22, encoding: TerminalAnsi, error: None }`: tag 0, 22, 1, None (the
  // Rust's own test).
  expect(encode({ type: "welcome", version: PROTOCOL_VERSION, encoding: "terminal_ansi" })).toEqual(
    Uint8Array.from([4, 0, 0, 0, 0, 22, 1, 0]),
  );
});

test("a terminal frame is the bytes herdr reads", () => {
  // `Terminal { seq: 1, width: 80, height: 24, full: true, bytes: "hi" }` (the Rust's own test).
  const seq = { value: 0 };
  expect(terminal(seq, 80, 24, true, new TextEncoder().encode("hi"))).toEqual(
    Uint8Array.from([8, 0, 0, 0, 1, 1, 80, 24, 1, 2, 0x68, 0x69]),
  );
  expect(seq.value).toBe(1);
  // Nothing is said in an empty frame; a long one is split, `full` on the first part only.
  expect(terminal(seq, 80, 24, true, new Uint8Array(0))).toEqual(new Uint8Array(0));
  const long = new Uint8Array(CHUNK + 1).fill(0x61);
  const wire = terminal(seq, 80, 24, true, long);
  const frames = new Frames(MAX_FRAME);
  frames.push(wire);
  const parts = frames.take();
  expect(parts).toHaveLength(2);
  // The tag of each, then its seq: 2 and 3, and only the first says `full`.
  expect([parts[0][0], parts[0][1], parts[0][parts[0].length - 2], parts[0][parts[0].length - 1]]).toEqual([1, 2, 0x61, 0x61]);
  // The tag, the seq, the size, `full` off, then one byte of terminal: seven.
  expect([parts[1][0], parts[1][1], parts[1].length]).toEqual([1, 3, 7]);
});

test("a shutdown says why", () => {
  expect(encode({ type: "server_shutdown", reason: "detached" })).toEqual(frame([3, 1, 8, ...new TextEncoder().encode("detached")]));
  expect(encode({ type: "server_shutdown" })).toEqual(frame([3, 0]));
});

test("the client's variant indices are herdr's", () => {
  // From the Rust's `variant_indices_are_herdrs`.
  const tag = (payload: number[]) => (decode(Uint8Array.from(payload)) as { message: ClientMessage }).message.type;
  expect(tag([4])).toBe("detach");
  expect(tag([5, 6, 0x74, 0x65, 0x72, 0x6d, 0x5f, 0x31, 0])).toBe("attach_terminal");
  expect(tag([8, 1, 0x78, 1])).toBe("control_terminal");
  expect(
    tag([16, 4, 0, 0, 0, 0, 0, 1]),
  ).toBe("attach_mouse");
  expect(tag([20, 1, 0x6b, 1, 0x64])).toBe("endpoint_control");
});

test("a hello says the client's size", () => {
  // `TerminalHello { version: 22, cols: 300, rows: 50, cell_width_px: 0, cell_height_px: 0,
  // pixel_mouse: false }`: 300 is over 250, so bincode writes 251, 300's low byte, its high one.
  const hello = decode(Uint8Array.from([0, 22, 251, 44, 1, 50, 0, 0, 0]));
  expect(hello).toEqual({
    message: { type: "terminal_hello", version: 22, cols: 300, rows: 50, cellWidthPx: 0, cellHeightPx: 0, pixelMouse: false },
  });
});

test("frames split across reads, and what is not an attach is skipped", () => {
  // The Rust's `frames_split_across_reads_and_skip_what_is_not_attach`, byte for byte.
  const hello = frame([0, 22, 251, 44, 1, 50, 0, 0, 0]);
  const started = frame([10]);
  const input = frame([1, 3, 0x6c, 0x73, 13]);
  const wire = new Uint8Array([...hello, ...started, ...input]);
  const frames = new Frames(MAX_FRAME);
  frames.push(wire.slice(0, 7));
  expect(frames.take()).toEqual([]);
  frames.push(wire.slice(7));
  const got = frames.take().map((payload) => decode(payload));
  expect(got).toEqual([
    {
      message: { type: "terminal_hello", version: 22, cols: 300, rows: 50, cellWidthPx: 0, cellHeightPx: 0, pixelMouse: false },
    },
    { skipped: 10 },
    { message: { type: "input", data: Uint8Array.from([0x6c, 0x73, 13]) } },
  ]);
  expect(frames.take()).toEqual([]);
});

test("a page key and a clipped region (the Rust's page_keys_and_wheels_decode)", () => {
  // `AttachScroll { source: PageKey { input: "\x1b[5~" }, direction: Up, lines: 23, column: None,
  // row: None, modifiers: 0 }`.
  expect(decode(Uint8Array.from([6, 1, 4, 0x1b, 0x5b, 0x35, 0x7e, 0, 23, 0, 0, 0]))).toEqual({
    message: {
      type: "attach_scroll",
      source: { type: "page_key", input: Uint8Array.from([0x1b, 0x5b, 0x35, 0x7e]) },
      direction: "up",
      lines: 23,
      column: undefined,
      row: undefined,
      modifiers: 0,
    },
  });
});

test("a mouse event names where it is", () => {
  // `AttachMouse { kind: Wheel(Down), position: Cell { column: 0, row: 0 }, geometry: None,
  // modifiers: 0, lines: 1 }`: variant 16, kind 5 (scroll down), cell 0, then column 0, row 0.
  expect(decode(Uint8Array.from([16, 5, 0, 0, 0, 0, 0, 1]))).toEqual({
    message: {
      type: "attach_mouse",
      kind: { type: "scroll_down" },
      position: { type: "cell", column: 0, row: 0 },
      geometry: undefined,
      modifiers: 0,
      lines: 1,
    },
  });
  // A pixel position carries the cell too, and a geometry comes as its four numbers: 900 and 700
  // are over 250, so each is 251 and two bytes.
  const pixels = [16, 0, 0, 1, 100, 200, 10, 20, 1, 80, 24, 251, 0x84, 3, 251, 0xbc, 2, 0, 0];
  expect(decode(Uint8Array.from(pixels))).toEqual({
    message: {
      type: "attach_mouse",
      kind: { type: "down", button: "left" },
      position: { type: "pixels", x: 100, y: 200, column: 10, row: 20 },
      geometry: { cols: 80, rows: 24, widthPx: 900, heightPx: 700 },
      modifiers: 0,
      lines: 0,
    },
  });
});

test("a frame that is not herdr's is refused", () => {
  expect(() => decode(Uint8Array.from([4, 1]))).toThrow("1 bytes after a message");
  expect(() => decode(Uint8Array.from([1, 9]))).toThrow();
  const frames = new Frames(MAX_FRAME);
  frames.push(Uint8Array.from([1, 0, 32, 0]));
  expect(() => frames.take()).toThrow(`a frame of ${MAX_FRAME + 1} bytes`);
});

test("mouse reports (the Rust's own vectors)", () => {
  expect(mouseReport({ type: "scroll_up" }, 4, 2, 0, true)).toEqual(new TextEncoder().encode("\x1b[<64;5;3M"));
  expect(mouseReport({ type: "up", button: "left" }, 0, 0, 0, true)).toEqual(new TextEncoder().encode("\x1b[<0;1;1m"));
  expect(mouseReport({ type: "down", button: "right" }, 0, 0, 0b010, true)).toEqual(new TextEncoder().encode("\x1b[<18;1;1M"));
  expect(mouseReport({ type: "down", button: "left" }, 0, 0, 0, false)).toEqual(
    Uint8Array.from([0x1b, 0x5b, 0x4d, 0x20, 0x21, 0x21]),
  );
  expect(mouseReport({ type: "moved" }, 300, 0, 0, false)).toBeUndefined();
  const drag: MouseKind = { type: "drag", button: "middle" };
  expect(mouseReport(drag, 9, 4, 0, true)).toEqual(new TextEncoder().encode("\x1b[<33;10;5M"));
});
