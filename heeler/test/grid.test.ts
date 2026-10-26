// pumi's grid socket against vectors worked out by hand from the Rust (`herdr/ui/src/grid.rs` and
// pumi's `crates/pumi-proto/src/native.rs`): nothing here runs Rust. A payload is postcard's: the
// variant's index as a varint, then the fields in order, a string or a byte vector as its length
// and then the bytes, and `Option` as 0 or 1 and then the value.
import { expect, test } from "bun:test";
import { Frames } from "../src/frames.ts";
import {
  MAX_FRAME,
  PROTOCOL,
  decodeServer,
  decodeWelcome,
  encodeAttach,
  encodeClient,
  encodeHello,
  type AttachServer,
} from "../src/grid.ts";

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => [...new TextEncoder().encode(value)];

test("a hello is the server's protocol and who is asking", () => {
  expect(encodeHello({ protocol: PROTOCOL, client: "herdr", clientVersion: "0.9.4" })).toEqual(
    bytes(13, 0, 0, 0, 2, 5, ...text("herdr"), 5, ...text("0.9.4")),
  );
});

test("an attach is the third control message and says the pane, its mode and its size", () => {
  const attach = encodeAttach({ pane: "%7", mode: "control", size: { cols: 80, rows: 24, cellWidth: 0, cellHeight: 0 } });
  // The Rust's own assertion: the variant index of `ClientMsg::Attach` is 2.
  expect(attach[4]).toBe(2);
  expect(attach).toEqual(bytes(11, 0, 0, 0, 2, 2, 0x25, 0x37, 0, 80, 24, 0, 0, 0, 0));
  // Observing is the other mode, and what a client asks to resume with is a varint after it.
  const observe = encodeAttach({ pane: "%7", mode: "observe", size: { cols: 80, rows: 24, cellWidth: 0, cellHeight: 0 }, budget: 3, resume: 9 });
  expect(observe).toEqual(bytes(13, 0, 0, 0, 2, 2, 0x25, 0x37, 1, 80, 24, 0, 0, 1, 3, 1, 9));
});

test("what an attached client sends", () => {
  expect(encodeClient({ type: "input", bytes: bytes(0x6c, 0x73, 13) })).toEqual(bytes(5, 0, 0, 0, 0, 3, 0x6c, 0x73, 13));
  expect(encodeClient({ type: "paste", text: "hi" })).toEqual(bytes(4, 0, 0, 0, 1, 2, 0x68, 0x69));
  expect(encodeClient({ type: "resize", size: { cols: 80, rows: 24, cellWidth: 0, cellHeight: 0 } })).toEqual(
    bytes(5, 0, 0, 0, 2, 80, 24, 0, 0),
  );
  expect(encodeClient({ type: "claim" })).toEqual(bytes(1, 0, 0, 0, 3));
  expect(encodeClient({ type: "release" })).toEqual(bytes(1, 0, 0, 0, 4));
});

test("the server's welcome, or its refusal", () => {
  expect(decodeWelcome(bytes(0, 2, 5, ...text("0.5.0"), 0, 42))).toEqual({
    type: "ok",
    protocol: 2,
    serverVersion: "0.5.0",
    bootId: "",
    pid: 42,
  });
  expect(decodeWelcome(bytes(1, 2, 5, ...text("0.5.0"), 24, ...text("client speaks protocol 1")))).toEqual({
    type: "refused",
    protocol: 2,
    serverVersion: "0.5.0",
    reason: "client speaks protocol 1",
  });
});

test("a snapshot, its output, and the rest", () => {
  // `Snapshot { cols: 80, rows: 24, bytes: "\x1b[?1h", seq: 9, mode: Control }`.
  expect(decodeServer(bytes(0, 80, 24, 5, 0x1b, ...text("[?1h"), 9, 0))).toEqual({
    type: "snapshot",
    cols: 80,
    rows: 24,
    bytes: bytes(0x1b, ...text("[?1h")),
    seq: 9,
    mode: "control",
  });
  expect(decodeServer(bytes(1, 10, 1, 0x78))).toEqual({ type: "output", seq: 10, bytes: bytes(0x78) });
  expect(decodeServer(bytes(2, 100, 30))).toEqual({ type: "resized", cols: 100, rows: 30 });
  expect(decodeServer(bytes(3))).toEqual({ type: "control_lost" });
  expect(decodeServer(bytes(4))).toEqual({ type: "control_gained" });
  // An exit status is zigzagged: 1 is 2, and -1 is 1.
  expect(decodeServer(bytes(5, 1, 2))).toEqual({ type: "exited", status: 1 });
  expect(decodeServer(bytes(5, 1, 1))).toEqual({ type: "exited", status: -1 });
  expect(decodeServer(bytes(5, 0))).toEqual({ type: "exited", status: undefined });
  expect(decodeServer(bytes(6, 18, ...text("pane not found: %9")))).toEqual({
    type: "error",
    message: "pane not found: %9",
  });
});

test("the server's messages split across reads (the Rust's own test)", () => {
  const messages: AttachServer[] = [
    { type: "snapshot", cols: 80, rows: 24, bytes: bytes(0x1b, ...text("[?1h")), seq: 9, mode: "control" },
    { type: "output", seq: 10, bytes: bytes(0x78) },
    { type: "exited", status: 1 },
  ];
  const parts = [
    bytes(11, 0, 0, 0, 0, 80, 24, 5, 0x1b, ...text("[?1h"), 9, 0),
    bytes(4, 0, 0, 0, 1, 10, 1, 0x78),
    bytes(3, 0, 0, 0, 5, 1, 2),
  ];
  const joined = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  const frames = new Frames(MAX_FRAME);
  frames.push(joined.slice(0, 5));
  expect(frames.take()).toEqual([]);
  frames.push(joined.slice(5));
  expect(frames.take().map(decodeServer)).toEqual(messages);
});

test("a long field's length is a varint too, and a short payload is refused", () => {
  const long = new Uint8Array(200).fill(0x61);
  const wire = encodeClient({ type: "input", bytes: long });
  // 200 needs two bytes of varint (0xc8 0x01), so the payload is 1 + 2 + 200.
  expect(wire.slice(0, 4)).toEqual(bytes(203, 0, 0, 0));
  expect(wire.slice(4, 7)).toEqual(bytes(0, 0xc8, 0x01));
  expect(() => decodeServer(bytes(1, 10, 3, 0x78))).toThrow("a field of 3 bytes past the frame's end");
  expect(() => decodeServer(bytes(1, 10, 1, 0x78, 0x21))).toThrow("1 bytes after a message");
  expect(() => decodeServer(bytes(9))).toThrow("not a message of the grid's");
});
