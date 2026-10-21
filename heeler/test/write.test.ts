// A socket's writes, queued: Bun takes what the kernel has room for and drops the rest, so what
// a write did not take must be sent when the socket drains. These vectors are a socket that
// takes eight bytes a call, as Bun's does when the far side has not read.
import { expect, test } from "bun:test";
import type { Socket } from "bun";
import { Writer } from "../src/write.ts";

/** A socket that takes `room` bytes a write, and keeps what it took. */
class Room {
  got: number[] = [];
  ended = false;
  fails = false;
  constructor(public room: number) {}
  write(bytes: Uint8Array): number {
    if (this.fails) return -1;
    const take = bytes.subarray(0, Math.min(this.room, bytes.length));
    this.got.push(...take);
    return take.length;
  }
  end(): void {
    this.ended = true;
  }
  as(): Socket<undefined> {
    return this as unknown as Socket<undefined>;
  }
}

const bytes = (n: number, from = 0) => Uint8Array.from({ length: n }, (_, i) => (from + i) % 256);

test("a write larger than the room keeps the rest, and drain sends it", () => {
  const socket = new Room(8);
  const writer = new Writer(socket.as());
  writer.write(bytes(20));
  expect(socket.got).toEqual([...bytes(8)]);
  expect(writer.pending).toBe(12);
  writer.flush();
  expect(writer.pending).toBe(4);
  writer.flush();
  expect(writer.pending).toBe(0);
  expect(socket.got).toEqual([...bytes(20)]);
});

test("writes keep their order across drains", () => {
  const socket = new Room(4);
  const writer = new Writer(socket.as());
  writer.write(bytes(6, 1));
  writer.write(bytes(3, 100));
  while (writer.pending > 0) writer.flush();
  expect(socket.got).toEqual([...bytes(6, 1), ...bytes(3, 100)]);
});

test("the socket closes once the queue is empty, not before", () => {
  const socket = new Room(2);
  const writer = new Writer(socket.as());
  writer.write(bytes(5));
  expect(writer.pending).toBe(3);
  writer.end();
  expect(socket.ended).toBe(false);
  expect(writer.pending).toBe(1);
  writer.flush();
  expect(socket.ended).toBe(true);
  expect(socket.got).toEqual([...bytes(5)]);
});

test("a refused write stops the writer and tells the caller what was left", () => {
  const socket = new Room(3);
  let left: Error | undefined;
  const writer = new Writer(socket.as(), (err) => {
    left = err;
  });
  socket.fails = true;
  writer.write(bytes(9));
  expect(writer.pending).toBe(0);
  expect(left?.message).toBe("9 bytes could not be written");
  // Nothing more goes once it has failed.
  socket.fails = false;
  writer.write(bytes(4));
  expect(socket.got).toEqual([]);
});

test("an empty write is nothing", () => {
  const socket = new Room(8);
  const writer = new Writer(socket.as());
  writer.write(new Uint8Array(0));
  expect(socket.got).toEqual([]);
  expect(writer.pending).toBe(0);
});
