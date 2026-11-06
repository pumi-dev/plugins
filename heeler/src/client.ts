// `herdr-client.sock`: herdr's direct terminal attach, on pumi's terminals.
//
// herdr's mobile apps show a pane live by running `herdr agent attach <pane>` (or `herdr terminal
// attach <terminal>`) in a PTY over SSH. That command is herdr's own client: it asks `herdr.sock`
// which terminal the agent is in, opens `herdr-client.sock` beside it, says hello with its size, and
// writes whatever terminal bytes it is sent to its terminal, sending back what is typed.
//
// herdr's server draws those bytes from a screen it keeps. pumi keeps none (the core relays a
// program's output, and each client runs its own terminal), and a terminal at the far end of herdr's
// client is exactly such a client: so each attach here is a client of pumi's grid socket for that
// pane, its snapshot and output passed through as herdr's terminal frames, and the input, resizes,
// pastes and mouse herdr's client sends turned into the grid's own.
//
// An attach controls the pane, as herdr's does: its size is the pane's while it lasts, and the app's
// view gets control back when someone types there.
import { call } from "pumi";
import type { Socket } from "bun";
import { paneRef, view } from "./api.ts";
import { Frames } from "./frames.ts";
import {
  MAX_FRAME as GRID_MAX_FRAME,
  PROTOCOL,
  decodeServer,
  decodeWelcome,
  encodeAttach,
  encodeClient,
  encodeHello,
  type AttachClient,
  type AttachServer,
  type Mode,
  type Size,
  type Welcome,
} from "./grid.ts";
import { terminal as terminalId } from "./ids.ts";
import { listen, type Handler, type Listener } from "./listen.ts";
import { log } from "./log.ts";
import { HERDR_VERSION } from "./protocol.ts";
import { strip } from "./queries.ts";
import type { Json } from "./types.ts";
import {
  MAX_FRAME,
  PROTOCOL_VERSION,
  decode,
  encode,
  mouseReport,
  terminal,
  type ClientMessage,
  type Decoded,
  type MouseKind,
} from "./wire.ts";
import { Writer } from "./write.ts";

/** A screen to draw a snapshot on: home, and erase. */
const CLEAR = new Uint8Array([0x1b, 0x5b, 0x48, 0x1b, 0x5b, 0x32, 0x4a]);
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** One of herdr's clients. */
interface Client {
  /** The bytes of the frame being read. */
  frames: Frames;
  /** Its size, from its hello and resizes. */
  size: Size;
  /** It said hello and was welcomed. */
  welcomed: boolean;
  /** The pane it is attached to, and its terminal id as herdr names it. */
  pane?: { pane: number; terminal: string };
  /** Its connection to the grid socket, and the bytes of the frame being read there. */
  grid?: Socket<undefined>;
  gridFrames: Frames;
  /** The grid's welcome came. */
  gridWelcomed: boolean;
  /** The frame counter of its terminal frames. */
  seq: { value: number };
  /** What goes to it, and to its grid connection, in order and all of it. */
  feed: Writer;
  gridFeed: Writer;
}

const clients = new Map<Socket<undefined>, Client>();
const grids = new Map<Socket<undefined>, Socket<undefined>>();
let gridPath = "";

/** Serve herdr's client socket at `path`, attaching to the terminals of the grid socket at
 * `grid`'. The listener goes when the package stops. */
export function serve(path: string, grid: string): Promise<Listener> {
  gridPath = grid;
  return listen(path, handler);
}

const handler: Handler = {
  open(socket) {
    const feed = new Writer(socket, () => end(socket));
    clients.set(socket, {
      frames: new Frames(MAX_FRAME),
      size: { cols: 0, rows: 0, cellWidth: 0, cellHeight: 0 },
      welcomed: false,
      gridFrames: new Frames(GRID_MAX_FRAME),
      gridWelcomed: false,
      seq: { value: 0 },
      feed,
      // The grid connection is made by the attach; this stands in until then.
      gridFeed: feed,
    });
  },
  drain(socket) {
    clients.get(socket)?.feed.flush();
  },
  data(socket, bytes) {
    const client = clients.get(socket);
    if (!client) return;
    let payloads: Uint8Array[];
    try {
      client.frames.push(bytes);
      payloads = client.frames.take();
    } catch (err) {
      log(`herdr client: ${why(err)}`);
      return end(socket);
    }
    for (const payload of payloads) {
      let frame: Decoded;
      try {
        frame = decode(payload);
      } catch (err) {
        log(`herdr client: ${why(err)}`);
        return end(socket);
      }
      if ("message" in frame) message(socket, frame.message);
    }
  },
  close(socket) {
    end(socket);
  },
  error(socket, err) {
    log(`herdr client: ${err.message}`);
    end(socket);
  },
};

function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What a handler starts and does not wait for: a failure is the log's, not the worker's. */
function quietly(started: Promise<void>): void {
  started.catch((err) => log(`herdr client: ${why(err)}`));
}

/** The client's attach is over: it is told why (when it is still there), and both connections
 * close. */
function end(socket: Socket<undefined>, reason?: string): void {
  const client = clients.get(socket);
  if (!client) return;
  clients.delete(socket);
  if (client.grid) {
    grids.delete(client.grid);
    if (client.gridFeed !== client.feed) client.gridFeed.stop();
    try {
      client.grid.end();
    } catch {
      // It is gone already.
    }
  }
  if (reason !== undefined) {
    log(client.pane ? `attach ${client.pane.terminal} (%${client.pane.pane}) ended: ${reason}` : `herdr's client ended: ${reason}`);
    client.feed.write(encode({ type: "server_shutdown", reason }));
  }
  client.feed.end();
  // A writer stopped by a refused write closes nothing; the socket still goes.
  if (client.feed.pending === 0) {
    try {
      socket.end();
    } catch {
      // It is gone already.
    }
  }
}

function send(socket: Socket<undefined>, bytes: Uint8Array): void {
  clients.get(socket)?.feed.write(bytes);
}

/** One message of herdr's client, and what this package does with it. */
function message(socket: Socket<undefined>, msg: ClientMessage): void {
  const client = clients.get(socket);
  if (!client) return;
  if (!client.welcomed) {
    if (msg.type === "terminal_hello") {
      const error =
        msg.version === PROTOCOL_VERSION
          ? undefined
          : `pumi's herdr package speaks herdr's protocol ${PROTOCOL_VERSION}, this client ${msg.version}: use herdr ${HERDR_VERSION}`;
      client.welcomed = error === undefined;
      client.size = { cols: msg.cols, rows: msg.rows, cellWidth: msg.cellWidthPx, cellHeight: msg.cellHeightPx };
      send(socket, encode({ type: "welcome", version: PROTOCOL_VERSION, encoding: "terminal_ansi", ...(error === undefined ? {} : { error }) }));
      if (error !== undefined) end(socket);
      return;
    }
    if (msg.type === "endpoint_control") {
      // herdr's own TUI (a client-owned shell): it needs herdr's server.
      return end(socket, "pumi serves herdr's terminal attach, not herdr's TUI");
    }
    return end(socket, "expected TerminalHello");
  }
  const attached = client.pane !== undefined;
  if (!attached && msg.type === "attach_terminal") return quietly(attach(socket, msg.terminalId, "control"));
  if (!attached && msg.type === "control_terminal") return quietly(attach(socket, msg.target, "control"));
  if (!attached && msg.type === "observe_terminal") return quietly(attach(socket, msg.target, "observe"));
  if (msg.type === "detach") return end(socket, "detached");
  if (!attached) return;
  switch (msg.type) {
    case "input":
      toGrid(socket, typed(msg.data));
      break;
    case "resize": {
      const size: Size = { cols: msg.cols, rows: msg.rows, cellWidth: msg.cellWidthPx, cellHeight: msg.cellHeightPx };
      client.size = size;
      toGrid(socket, { type: "resize", size });
      break;
    }
    case "attach_scroll":
      if (msg.source.type === "page_key") toGrid(socket, { type: "input", bytes: msg.source.input });
      else
        quietly(
          mouse(socket, msg.direction === "up" ? { type: "scroll_up" } : { type: "scroll_down" }, msg.column ?? 0, msg.row ?? 0, msg.modifiers, msg.lines),
        );
      break;
    case "attach_mouse": {
      const cell = msg.position;
      quietly(mouse(socket, msg.kind, cell.column, cell.row, msg.modifiers, msg.lines));
      break;
    }
    // Clipboard images, herdr's graphics and its shell's messages have no pumi side.
    default:
      break;
  }
}

const PASTE_START = ENCODER.encode("\x1b[200~");
const PASTE_END = ENCODER.encode("\x1b[201~");

/** Typed bytes; a whole bracketed paste is a paste, which pumi brackets only when the program asked
 * for it (herdr's client turns bracketed paste on for its own terminal). */
function typed(data: Uint8Array): AttachClient {
  const starts = PASTE_START.every((byte, at) => data[at] === byte);
  const ends = PASTE_END.every((byte, at) => data[data.length - PASTE_END.length + at] === byte);
  if (data.length >= PASTE_START.length + PASTE_END.length && starts && ends) {
    return { type: "paste", text: DECODER.decode(data.slice(PASTE_START.length, data.length - PASTE_END.length)) };
  }
  return { type: "input", bytes: data };
}

/** The pane `target` names, and herdr's id of its terminal. */
async function resolve(target: string): Promise<{ pane: number; terminal: string } | undefined> {
  try {
    const pane = (await view()).pane(target);
    return pane === undefined ? undefined : { pane, terminal: terminalId(pane) };
  } catch {
    return undefined;
  }
}

async function attach(socket: Socket<undefined>, target: string, mode: Mode): Promise<void> {
  const client = clients.get(socket);
  if (!client) return;
  const found = await resolve(target);
  if (found === undefined) return end(socket, `terminal attach failed: terminal ${target} not found`);
  let grid: Socket<undefined>;
  try {
    grid = await Bun.connect<undefined>({
      unix: gridPath,
      socket: {
        data: (from, bytes) => fromGrid(from, bytes),
        drain: (from) => {
          const socket = grids.get(from);
          if (socket) clients.get(socket)?.gridFeed.flush();
        },
        close: (from) => {
          const socket = grids.get(from);
          grids.delete(from);
          if (socket) end(socket, "terminal attach ended: pumi closed the terminal");
        },
        error: (from, err) => {
          const socket = grids.get(from);
          grids.delete(from);
          if (socket) end(socket, `terminal attach ended: pumi's grid socket: ${err.message}`);
        },
      },
    });
  } catch (err) {
    return end(socket, `terminal attach failed: pumi's grid socket: ${why(err)}`);
  }
  client.pane = found;
  client.grid = grid;
  client.gridFeed = new Writer(grid, () => end(socket, "terminal attach ended: pumi's grid socket closed"));
  grids.set(grid, socket);
  log(`attach ${found.terminal} (%${found.pane}) from herdr's client, ${client.size.cols}x${client.size.rows}`);
  // The server reads the hello, answers, then reads the attach: both go now.
  const hello = encodeHello({ protocol: PROTOCOL, client: "herdr", clientVersion: HERDR_VERSION });
  const attach = encodeAttach({ pane: `%${found.pane}`, mode, size: client.size });
  const bytes = new Uint8Array(hello.length + attach.length);
  bytes.set(hello);
  bytes.set(attach, hello.length);
  client.gridFeed.write(bytes);
}

function toGrid(socket: Socket<undefined>, message: AttachClient): void {
  const client = clients.get(socket);
  if (!client?.grid) return;
  client.gridFeed.write(encodeClient(message));
}

/** What the grid sent, as herdr's frames for the client. */
function fromGrid(grid: Socket<undefined>, bytes: Uint8Array): void {
  const socket = grids.get(grid);
  if (!socket) return;
  const client = clients.get(socket);
  if (!client) return;
  let payloads: Uint8Array[];
  try {
    client.gridFrames.push(bytes);
    payloads = client.gridFrames.take();
  } catch (err) {
    return end(socket, `terminal attach ended: pumi's grid socket: ${why(err)}`);
  }
  for (const payload of payloads) {
    if (!client.gridWelcomed) {
      let welcome: Welcome;
      try {
        welcome = decodeWelcome(payload);
      } catch (err) {
        return end(socket, `terminal attach failed: pumi's grid socket: ${why(err)}`);
      }
      if (welcome.type === "ok") {
        client.gridWelcomed = true;
        continue;
      }
      return end(socket, `terminal attach failed: pumi refused: ${welcome.reason}`);
    }
    let message: AttachServer;
    try {
      message = decodeServer(payload);
    } catch (err) {
      return end(socket, `terminal attach ended: pumi's grid socket: ${why(err)}`);
    }
    if (!server(socket, message)) return;
  }
}

/** One message of the grid's, passed on; false when the attach is over. */
function server(socket: Socket<undefined>, msg: AttachServer): boolean {
  const client = clients.get(socket);
  if (!client) return false;
  const frames = (full: boolean, bytes: Uint8Array) =>
    send(socket, terminal(client.seq, client.size.cols, client.size.rows, full, bytes));
  switch (msg.type) {
    case "snapshot": {
      const stripped = strip(msg.bytes);
      const screen = new Uint8Array(CLEAR.length + stripped.length);
      screen.set(CLEAR);
      screen.set(stripped, CLEAR.length);
      frames(true, screen);
      return true;
    }
    case "output":
      frames(false, msg.bytes);
      return true;
    case "exited":
      end(socket, `terminal ${client.pane?.terminal ?? ""} exited`);
      return false;
    case "error":
      end(socket, `terminal attach failed: ${msg.message}`);
      return false;
    // The size follows whoever controls the pane; the program redraws for it.
    default:
      return true;
  }
}

/** The DEC private modes of a pane that say how it wants the mouse. */
interface MouseModes {
  /** It asked for presses (1000), drags (1002) or all motion (1003). */
  buttons: boolean;
  drag: boolean;
  motion: boolean;
  sgr: boolean;
  altScreen: boolean;
  cursorKeys: boolean;
}

async function modes(pane: number): Promise<MouseModes | undefined> {
  let answer: Json;
  try {
    answer = (await call("tab.call", paneRef(pane), "modes", {})) as Json;
  } catch {
    return undefined;
  }
  const dec = typeof answer === "object" && answer !== null && !Array.isArray(answer) ? answer.dec : undefined;
  const alt = typeof answer === "object" && answer !== null && !Array.isArray(answer) ? answer.alt : undefined;
  const on = (mode: number) =>
    Array.isArray(dec) && dec.some((pair) => Array.isArray(pair) && pair[0] === mode && pair[1] === true);
  return {
    buttons: on(1000) || on(1002) || on(1003),
    drag: on(1002) || on(1003),
    motion: on(1003),
    sgr: on(1006),
    altScreen: alt === true,
    cursorKeys: on(1),
  };
}

/** A mouse event of herdr's client, as the program asked to hear it: a report when it reports the
 * mouse, a wheel as arrow keys on the alternate screen (as terminals do), and nothing otherwise. */
async function mouse(socket: Socket<undefined>, kind: MouseKind, column: number, row: number, modifiers: number, lines: number): Promise<void> {
  const pane = clients.get(socket)?.pane?.pane;
  if (pane === undefined) return;
  const m = await modes(pane);
  if (m === undefined) return;
  const wheel = kind.type === "scroll_up" || kind.type === "scroll_down";
  const wanted = kind.type === "moved" ? m.motion : kind.type === "drag" ? m.drag : m.buttons;
  let bytes: Uint8Array | undefined;
  if (wanted) {
    bytes = mouseReport(kind, column, row, modifiers, m.sgr);
  } else if (wheel && m.altScreen) {
    const key = kind.type === "scroll_up" ? (m.cursorKeys ? "\x1bOA" : "\x1b[A") : m.cursorKeys ? "\x1bOB" : "\x1b[B";
    bytes = ENCODER.encode(key.repeat(Math.min(Math.max(lines, 1), 10)));
  }
  if (bytes !== undefined) toGrid(socket, { type: "input", bytes });
}
