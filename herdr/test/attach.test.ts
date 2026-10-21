// herdr's client socket end to end: herdr's own client attaches to a pane's terminal, and what it
// says and hears is herdr's protocol (bincode 2) on one side and pumi's grid socket (postcard) on
// the other. The fake app answers what pumi's core would; a fake grid socket stands in for pumi's
// own, and the bytes each side gets are the ones the Rust's protocol has (wire.test.ts and
// grid.test.ts pin both codecs against vectors from it).
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";
import { Frames, framed } from "../src/frames.ts";
import { encodeAttach, encodeClient, encodeHello } from "../src/grid.ts";

const dir = join(import.meta.dir, "..");

/** $5 `main` with tab @7: pane %1 a shell, pane %2 an agent's terminal. */
const MODEL = {
  sessions: [{ id: 5, name: "main", tabs: [[0, 7]], current: 7 }],
  tabs: [{ id: 7, name: null, layout: ["row", [["leaf", 1], ["leaf", 2]]], active: 1, zoomed: false }],
  panes: [
    { id: 1, type: "terminal", place: { kind: "tiled", tab: 7 }, options: {} },
    { id: 2, type: "terminal", place: { kind: "tiled", tab: 7 }, options: { "@agent": "claude" } },
  ],
  current: { session: 5, tab: 7, pane: 1 },
};

const encoder = new TextEncoder();
const text = (value: string): number[] => [...encoder.encode(value)];

/** What a frame carries, without the length in front of it: what the other side reads. */
const payloadOf = (frame: Uint8Array): Uint8Array => frame.subarray(4);

/** What herdr's client sends: its private protocol, variant by variant. */
const herdr = {
  hello: (version = 22) => Uint8Array.from([0, version, 80, 24, 0, 0, 0]),
  attach: (terminal: string) => Uint8Array.from([5, terminal.length, ...text(terminal), 0]),
  observe: (target: string) => Uint8Array.from([7, target.length, ...text(target)]),
  input: (data: string) => Uint8Array.from([1, data.length, ...text(data)]),
  resize: (cols: number, rows: number) => Uint8Array.from([3, cols, rows, 0, 0, 0]),
  detach: () => Uint8Array.from([4]),
  endpointControl: (kind: string, data: string) => Uint8Array.from([20, kind.length, ...text(kind), data.length, ...text(data)]),
  /** `AttachMouse { Down(Left), Cell { 0, 0 }, None, 0, 1 }`: the kind, its button, the cell, then
   * no geometry, no modifiers and one line. */
  click: () => Uint8Array.from([16, 0, 0, 0, 0, 0, 0, 0, 1]),
  /** `AttachScroll { Wheel, Up, 23, None, None, 0 }`. */
  wheelUp: () => Uint8Array.from([6, 0, 0, 23, 0, 0, 0]),
};

/** pumi's grid socket, as much of it as an attach uses: it takes what the package sends, and
 * answers what the test tells it to. */
class FakeGrid {
  readonly payloads: Uint8Array[] = [];
  private frames = new Frames(64 << 20);
  private socket?: Bun.Socket<undefined>;
  private listener?: Bun.SocketListener<undefined>;
  closed = false;

  static start(path: string): FakeGrid {
    const grid = new FakeGrid();
    grid.listener = Bun.listen<undefined>({
      unix: path,
      socket: {
        open(socket) {
          grid.socket = socket;
        },
        data(_socket, chunk) {
          grid.frames.push(chunk);
          for (const payload of grid.frames.take()) grid.payloads.push(payload);
        },
        close() {
          grid.closed = true;
        },
      },
    });
    return grid;
  }

  send(payload: Uint8Array): void {
    this.socket?.write(framed(payload));
  }

  stop(): void {
    this.listener?.stop(true);
  }
}

/** herdr's client, as its own terminal attach is: it writes herdr's frames and reads them. */
class Attach {
  private frames = new Frames(2 * 1024 * 1024);
  private payloads: Uint8Array[] = [];
  closed = false;
  private wake?: () => void;
  private socket!: Bun.Socket<undefined>;

  static async open(path: string): Promise<Attach> {
    const attach = new Attach();
    attach.socket = await Bun.connect<undefined>({
      unix: path,
      socket: {
        data(_socket, chunk) {
          attach.frames.push(chunk);
          attach.payloads.push(...attach.frames.take());
          attach.wake?.();
        },
        close() {
          attach.closed = true;
          attach.wake?.();
        },
        open() {},
      },
    });
    return attach;
  }

  send(payload: Uint8Array): void {
    this.socket.write(framed(payload));
  }

  close(): void {
    this.socket?.end();
  }

  /** The next frame's payload, as herdr's server sent it. */
  async next(): Promise<Uint8Array> {
    for (;;) {
      const payload = this.payloads.shift();
      if (payload !== undefined) return payload;
      if (this.closed) throw new Error("the attach closed");
      await this.wait();
    }
  }

  async gone(): Promise<void> {
    while (!this.closed) await this.wait();
  }

  private wait(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("nothing from herdr-client.sock")), 3000);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

/** Waits for `check` to hold, a few milliseconds at a time. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 3000; waited += 5) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`waited for ${what}`);
}

let app: FakeApp;
let main: typeof import("../src/main.ts");
let grid: FakeGrid;
let attach: Attach;

afterEach(() => {
  attach?.close();
  grid?.stop();
  main?.stop();
  app?.stop();
  delete process.env.PUMI_DATA_DIR;
  delete process.env.XDG_CONFIG_HOME;
});

/** The package up, its sockets in a directory of their own, and a grid socket it can attach to. */
async function start(options: { modes?: unknown } = {}): Promise<string> {
  const data = mkdtempSync(join(tmpdir(), "herdr-attach-"));
  process.env.PUMI_DATA_DIR = data;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "herdr-config-"));
  app = await FakeApp.start({
    dir,
    main: "src/main.ts",
    options: { session: "" },
    answers: {
      "server.getState": () => ({ seq: 0, state: MODEL }),
      "pane.call": (_pane: number, method: string) =>
        method === "modes" ? (options.modes ?? { dec: [[1, false], [1000, true], [1006, true]], alt: false }) : null,
    },
  });
  main = await import("../src/main.ts");
  grid = FakeGrid.start(join(data, "grid.sock"));
  return data;
}

const WELCOME = Uint8Array.from([0, 22, 1, 0]);
/** `Welcome::Ok { protocol: 2, server_version: "0.5.0", boot_id: "", pid: 42 }`. */
const GRID_WELCOME = Uint8Array.from([0, 2, 5, ...text("0.5.0"), 0, 42]);
/** A screen to draw a snapshot on: home, then erase. */
const CLEAR = [0x1b, 0x5b, 0x48, 0x1b, 0x5b, 0x32, 0x4a];
/** `Welcome { version: 22, encoding: TerminalAnsi, error: Some(…) }`: tag 0, 22, 1, `Some`, the string. */
const welcomeWith = (error: string) => Uint8Array.from([0, 22, 1, 1, error.length, ...text(error)]);
/** `ServerShutdown { reason: Some(…) }`: tag 3, `Some`, the string. */
const shutdown = (reason: string) => Uint8Array.from([3, 1, reason.length, ...text(reason)]);

test("a hello is answered with herdr's welcome, and a client of another protocol is refused", async () => {
  const data = await start();
  attach = await Attach.open(join(data, "herdr-client.sock"));
  attach.send(herdr.hello());
  expect(await attach.next()).toEqual(WELCOME);
  // herdr 0.10 would speak another protocol: it is told which one to use, and let go.
  const other = await Attach.open(join(data, "herdr-client.sock"));
  other.send(herdr.hello(23));
  expect(await other.next()).toEqual(welcomeWith("pumi's herdr package speaks herdr's protocol 22, this client 23: use herdr 0.9.4"));
  await other.gone();
});

test("an attach draws the snapshot, and passes the output on as it comes", async () => {
  const data = await start();
  attach = await Attach.open(join(data, "herdr-client.sock"));
  attach.send(herdr.hello());
  expect(await attach.next()).toEqual(WELCOME);
  attach.send(herdr.attach("term_2"));
  await until(() => grid.payloads.length === 2, "the grid's hello and attach");
  expect(grid.payloads[0]).toEqual(payloadOf(encodeHello({ protocol: 2, client: "herdr", clientVersion: "0.9.4" })));
  expect(grid.payloads[1]).toEqual(payloadOf(encodeAttach({ pane: "%2", mode: "control", size: { cols: 80, rows: 24, cellWidth: 0, cellHeight: 0 } })));
  // The welcome, then a snapshot: a fresh screen, with the snapshot's queries taken out.
  grid.send(GRID_WELCOME);
  grid.send(Uint8Array.from([0, 80, 24, 5, 0x1b, ...text("[?1h"), 9, 0]));
  expect(await attach.next()).toEqual(Uint8Array.from([1, 1, 80, 24, 1, CLEAR.length + 5, ...CLEAR, 0x1b, ...text("[?1h")]));
  // Live output is a diff of the same screen, not a full redraw.
  grid.send(Uint8Array.from([1, 10, 1, 0x78]));
  expect(await attach.next()).toEqual(Uint8Array.from([1, 2, 80, 24, 0, 1, 0x78]));
});

test("what the client types, and its size, go to the grid", async () => {
  const data = await start();
  attach = await Attach.open(join(data, "herdr-client.sock"));
  attach.send(herdr.hello());
  await attach.next();
  attach.send(herdr.attach("term_2"));
  await until(() => grid.payloads.length === 2, "the grid's hello and attach");
  grid.send(GRID_WELCOME);
  attach.send(herdr.input("ls\r"));
  await until(() => grid.payloads.length === 3, "the typing");
  expect(grid.payloads[2]).toEqual(payloadOf(encodeClient({ type: "input", bytes: encoder.encode("ls\r") })));
  // A whole bracketed paste is a paste, which pumi brackets when the program asked for it.
  attach.send(herdr.input("\x1b[200~hi\nthere\x1b[201~"));
  await until(() => grid.payloads.length === 4, "the paste");
  expect(grid.payloads[3]).toEqual(payloadOf(encodeClient({ type: "paste", text: "hi\nthere" })));
  attach.send(herdr.resize(100, 30));
  await until(() => grid.payloads.length === 5, "the resize");
  expect(grid.payloads[4]).toEqual(payloadOf(encodeClient({ type: "resize", size: { cols: 100, rows: 30, cellWidth: 0, cellHeight: 0 } })));
  // Its frames carry the size it last said.
  grid.send(Uint8Array.from([1, 11, 1, 0x79]));
  expect(await attach.next()).toEqual(Uint8Array.from([1, 1, 100, 30, 0, 1, 0x79]));
});

test("a mouse event is a report when the program reports the mouse", async () => {
  const data = await start();
  attach = await Attach.open(join(data, "herdr-client.sock"));
  attach.send(herdr.hello());
  await attach.next();
  attach.send(herdr.attach("term_2"));
  await until(() => grid.payloads.length === 2, "the attach");
  grid.send(GRID_WELCOME);
  attach.send(herdr.click());
  await until(() => grid.payloads.length === 3, "the click");
  expect(grid.payloads[2]).toEqual(payloadOf(encodeClient({ type: "input", bytes: encoder.encode("\x1b[<0;1;1M") })));
  expect(app.called("pane.call").some((call) => call[0] === 2 && call[1] === "modes")).toBe(true);
});

test("a wheel on the alternate screen is arrow keys, as terminals do", async () => {
  const data = await start({ modes: { dec: [[1, false], [1000, false], [1006, false]], alt: true } });
  attach = await Attach.open(join(data, "herdr-client.sock"));
  attach.send(herdr.hello());
  await attach.next();
  attach.send(herdr.attach("term_2"));
  await until(() => grid.payloads.length === 2, "the attach");
  grid.send(GRID_WELCOME);
  attach.send(herdr.wheelUp());
  await until(() => grid.payloads.length === 3, "the wheel");
  // 23 rows clamped to 10, with the program not asking for cursor keys.
  expect(grid.payloads[2]).toEqual(payloadOf(encodeClient({ type: "input", bytes: encoder.encode("\x1b[A".repeat(10)) })));
});

test("detach, an exit and an error each tell the client why, and let it go", async () => {
  const data = await start();
  attach = await Attach.open(join(data, "herdr-client.sock"));
  attach.send(herdr.hello());
  await attach.next();
  attach.send(herdr.attach("term_2"));
  await until(() => grid.payloads.length === 2, "the attach");
  grid.send(GRID_WELCOME);
  attach.send(herdr.detach());
  expect(await attach.next()).toEqual(shutdown("detached"));
  await attach.gone();

  const second = await Attach.open(join(data, "herdr-client.sock"));
  second.send(herdr.hello());
  await second.next();
  second.send(herdr.attach("term_2"));
  await until(() => grid.payloads.length >= 4, "the second attach");
  grid.send(GRID_WELCOME);
  grid.send(Uint8Array.from([5, 1, 2])); // Exited { Some(1) }
  expect(await second.next()).toEqual(shutdown("terminal term_2 exited"));
  await second.gone();

  const third = await Attach.open(join(data, "herdr-client.sock"));
  third.send(herdr.hello());
  await third.next();
  third.send(herdr.observe("term_1"));
  await until(() => grid.payloads.some((payload) => new TextDecoder().decode(payload).includes("%1")), "the observe");
  expect(grid.payloads.at(-1)).toEqual(payloadOf(encodeAttach({ pane: "%1", mode: "observe", size: { cols: 80, rows: 24, cellWidth: 0, cellHeight: 0 } })));
  grid.send(GRID_WELCOME);
  grid.send(Uint8Array.from([6, 4, ...text("nope")])); // Error("nope")
  expect(await third.next()).toEqual(shutdown("terminal attach failed: nope"));
  await third.gone();
});

test("a terminal that is not there, and herdr's own TUI, are told so", async () => {
  const data = await start();
  attach = await Attach.open(join(data, "herdr-client.sock"));
  attach.send(herdr.hello());
  await attach.next();
  attach.send(herdr.attach("term_9"));
  expect(await attach.next()).toEqual(shutdown("terminal attach failed: terminal term_9 not found"));

  const tui = await Attach.open(join(data, "herdr-client.sock"));
  tui.send(herdr.endpointControl("endpoint", "1"));
  expect(await tui.next()).toEqual(shutdown("pumi serves herdr's terminal attach, not herdr's TUI"));
  await tui.gone();
});
