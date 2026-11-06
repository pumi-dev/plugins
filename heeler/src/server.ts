// herdr's socket (`herdr.sock`): newline-delimited `{"id","method","params"}` requests, each
// answered with `{"id","result"}` or `{"id","error":{"code","message"}}`; `events.subscribe`
// answers `subscription_started` and then streams event envelopes on the same connection.
//
// PROVENANCE: framing and envelopes from herdr `src/api/server.rs` @ v0.9.3 (Apache-2.0).

import type { Socket } from "bun";
import { Fail, dispatch, fromApi, numberOf, translate, view, type CoreEvent } from "./api.ts";
import { find as findEvent } from "./events.ts";
import { listen, type Handler, type Listener } from "./listen.ts";
import { log } from "./log.ts";
import { codes, result } from "./protocol.ts";
import { bump, closed, publish, setView, subscribe, subscribed, view as lastView, type Want } from "./state.ts";
import type { Json } from "./types.ts";
import { Writer } from "./write.ts";

const NEWLINE = 0x0a;
const decoder = new TextDecoder();

interface Connection {
  id: number;
  socket: Socket<undefined>;
  /** The line being read, bytes and all: a request can split across reads. */
  line: Uint8Array;
  /** A connection's requests run one after another, so its answers keep their order. */
  queue: Promise<void>;
  /** Its answers and events, in order and all of them (`pane.read` can be megabytes). */
  feed: Writer;
}

let nextId = 0;
/** Each connection, by its socket (what the handlers have) and by its id (what a subscription has). */
const bySocket = new Map<Socket<undefined>, Connection>();
const byId = new Map<number, Connection>();

/** Serve herdr's socket at `path`. The listener goes when the package stops. */
export function serve(path: string): Promise<Listener> {
  return listen(path, handler);
}

const handler: Handler = {
  open(socket) {
    const conn = {
      id: ++nextId,
      socket,
      line: new Uint8Array(0),
      queue: Promise.resolve(),
      feed: new Writer(socket, () => drop(bySocket.get(socket))),
    };
    bySocket.set(socket, conn);
    byId.set(conn.id, conn);
  },
  drain(socket) {
    bySocket.get(socket)?.feed.flush();
  },
  data(socket, bytes) {
    const conn = bySocket.get(socket);
    if (conn) read(conn, bytes);
  },
  close(socket) {
    const conn = bySocket.get(socket);
    if (conn) drop(conn);
  },
  error(socket, err) {
    log(`herdr's socket: ${err.message}`);
    const conn = bySocket.get(socket);
    if (conn) drop(conn);
  },
};

/** What a connection sent, as the complete lines it now holds. */
function read(conn: Connection, bytes: Uint8Array): void {
  const all = new Uint8Array(conn.line.length + bytes.length);
  all.set(conn.line);
  all.set(bytes, conn.line.length);
  conn.line = all;
  for (;;) {
    const at = conn.line.indexOf(NEWLINE);
    if (at < 0) return;
    const line = decoder.decode(conn.line.slice(0, at)).trim();
    conn.line = conn.line.slice(at + 1);
    if (line !== "") request(conn, line);
  }
}

/** A line one of herdr's clients sent: one request, one answer. */
function request(conn: Connection, line: string): void {
  conn.queue = conn.queue.then(() => answer(conn, line)).catch((err) => log(`herdr's socket: ${(err as Error)?.message ?? err}`));
}

async function answer(conn: Connection, line: string): Promise<void> {
  let parsed: Json;
  try {
    parsed = JSON.parse(line) as Json;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    reply(conn, "", { error: new Fail(codes.INVALID_REQUEST, `invalid request: ${why}`) });
    return;
  }
  const request = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  const id = request.id ?? "";
  const method = request.method;
  if (typeof method !== "string") {
    reply(conn, id, { error: new Fail(codes.INVALID_REQUEST, "missing method") });
    return;
  }
  const params = request.params ?? {};
  if (method === "events.subscribe") {
    try {
      const subscriptions = typeof params === "object" && params !== null && !Array.isArray(params) ? params.subscriptions : undefined;
      subscribe(conn.id, parse(subscriptions));
      reply(conn, id, { result: result("subscription_started") });
    } catch (err) {
      const why = asFail(err);
      log(`herdr.sock: events.subscribe → ${why.code} ${why.message} ${JSON.stringify(params)}`);
      reply(conn, id, { error: why });
    }
    return;
  }
  try {
    reply(conn, id, { result: await dispatch(method, params) });
  } catch (err) {
    const why = asFail(err);
    log(`herdr.sock: ${method} → ${why.code} ${why.message}`);
    reply(conn, id, { error: why });
  }
}

/** What a subscription asked to hear, or why pumi cannot send it. */
function parse(subscriptions: Json | undefined): Want[] {
  const bad = (message: string) => new Fail(codes.INVALID_PARAMS, message);
  const wants: Want[] = [];
  for (const sub of Array.isArray(subscriptions) ? subscriptions : []) {
    const kind = typeof sub === "object" && sub !== null && !Array.isArray(sub) ? sub.type : undefined;
    if (typeof kind !== "string") throw bad("a subscription needs `type`");
    const event = findEvent(kind);
    if (event === undefined) throw bad(`unknown subscription type: ${kind}`);
    if (event.delivery === "lifecycle") {
      wants.push({ kind: "lifecycle", snake: event.snake });
      continue;
    }
    if (event.dotted === "pane.agent_status_changed") {
      const paneId = typeof sub === "object" && sub !== null && !Array.isArray(sub) ? sub.pane_id : undefined;
      if (typeof paneId !== "string") throw bad("missing `pane_id`");
      const status = typeof sub === "object" && sub !== null && !Array.isArray(sub) ? sub.agent_status : undefined;
      wants.push({ kind: "status", paneId, ...(typeof status === "string" ? { status } : {}) });
      continue;
    }
    throw bad(`${kind} cannot be subscribed to on pumi yet`);
  }
  return wants;
}

function asFail(err: unknown): Fail {
  return err instanceof Fail ? err : fromApi(err);
}

function reply(conn: Connection, id: Json, outcome: { result: Json } | { error: Fail }): void {
  if ("error" in outcome) send(conn, { id, error: { code: outcome.error.code, message: outcome.error.message } });
  else send(conn, { id, result: outcome.result });
}

/** One JSON value, as herdr's clients read the socket: a line each. */
function send(conn: Connection, value: Json): void {
  conn.feed.write(`${JSON.stringify(value)}\n`);
}

/** A connection that cannot be written to is gone. */
function drop(conn: Connection | undefined): void {
  if (!conn) return;
  if (!bySocket.delete(conn.socket)) return;
  byId.delete(conn.id);
  conn.feed.stop();
  closed(conn.id);
  try {
    conn.socket.end();
  } catch {
    // It is gone already.
  }
}

/** An event of the core's: what it means to herdr's clients goes to whoever asked for it. */
export async function onEvent(event: CoreEvent): Promise<void> {
  if (!subscribed()) return;
  // The pane an event is about — a pumi tab — has changed.
  const at = numberOf(event.tab);
  if (at !== undefined) bump(at);
  let now;
  try {
    now = await view();
  } catch {
    return;
  }
  const before = lastView() ?? now;
  const envelopes = translate(now, before, event);
  setView(now);
  for (const [conn, envelope] of publish(envelopes)) {
    const connection = byId.get(conn);
    if (connection) send(connection, { event: envelope.event, data: envelope.data });
  }
}
