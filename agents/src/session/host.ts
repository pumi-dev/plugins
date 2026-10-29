// The host: one per session tab, a Bun process the worker starts detached, so the agent outlives
// the app (pumid keeps the tab; the worker goes with the app). It starts the agent's server and is
// its only client, over ACP or the agent's own protocol (`engines.ts`), and serves the
// conversation on a unix socket (`wire.ts`): every client that says `hello` gets the state and the
// updates, and may send commands. It exits when a client says `stop` (the tab closed), or on
// SIGTERM; when the agent exits by itself it says so and stays, so the tab can show why.
//
//   bun src/session/host.ts '<HostSpec as JSON>'
//
// No `import … from "pumi"` here: the host is not a plugin's worker.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { dirname } from "node:path";

import { driverFor } from "./engines.ts";
import { searchPath } from "./launch.ts";
import { lineReader } from "./rpc.ts";
import type { FromHost, HostSpec, ToHost } from "./wire.ts";

/** The lines of the agent's stderr kept, to say why it failed. */
const STDERR_LINES = 20;
/** How long the agent's process group has after SIGTERM before SIGKILL. */
const GRACE_MS = 2000;

const spec: HostSpec = JSON.parse(process.argv[2] ?? "null");
if (!spec?.socket || !Array.isArray(spec.command) || (spec.command.length === 0 && spec.engine !== "claude")) {
  console.error("chat host: give the spec as one JSON argument");
  process.exit(2);
}

/** Whether a host already serves `path`: then this one is not needed. */
function serving(path: string): Promise<boolean> {
  if (!existsSync(path)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const probe = createConnection(path);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}

if (await serving(spec.socket)) {
  console.error(`chat host: ${spec.socket} is served already`);
  process.exit(0);
}
mkdirSync(dirname(spec.socket), { recursive: true, mode: 0o700 });
try {
  unlinkSync(spec.socket);
} catch {
  // No stale socket to remove.
}

const clients = new Set<Socket>();
const send = (socket: Socket, message: FromHost) => {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
};
const broadcast = (message: FromHost) => {
  for (const socket of clients) send(socket, message);
};

// The agent's server, in a process group of its own so stopping it stops what it started (npx's
// node, its tools); an engine that runs the agent itself (`claude`, the SDK) has none here.
const [program, ...args] = spec.command;
const agent = program
  ? spawn(program, args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env, PATH: searchPath(process.env.PATH) },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    })
  : undefined;
const stderr: string[] = [];
const session = driverFor(spec, (line) => !!agent?.stdin.writable && agent.stdin.write(line), {
  update: (update) => broadcast({ t: "update", update }),
  state: (state) => broadcast({ t: "state", state }),
});
if (agent) {
  agent.stderr.on(
    "data",
    lineReader((line) => {
      process.stderr.write(`agent: ${line}\n`);
      stderr.push(line.slice(0, 400));
      if (stderr.length > STDERR_LINES) stderr.shift();
    }),
  );
  agent.stdout.on("data", lineReader((line) => session.feed(line)));
  agent.stdin.on("error", () => {});
  agent.on("error", (err) => session.exited(null, null, [err.message]));
  agent.on("exit", (code, signal) => session.exited(code, signal, stderr));
}

const server = createServer((socket) => {
  socket.on("data", lineReader((line) => handle(socket, line)));
  socket.on("error", () => {});
  socket.on("close", () => clients.delete(socket));
});

function handle(socket: Socket, line: string): void {
  let message: ToHost;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  switch (message.t) {
    case "hello": {
      // What is pending goes out first, to those already here; this client starts from the answer.
      session.producer.flush();
      clients.add(socket);
      send(socket, { t: "state", state: session.state });
      send(socket, { t: "update", update: session.producer.read(message.since) });
      return;
    }
    case "command":
      // What the command changed goes out before its ack, so a client that has the ack sees it.
      void session.command(message.command).then((ack) => {
        session.producer.flush();
        send(socket, { t: "ack", ack });
      });
      return;
    case "start":
      void session.start(message.session);
      return;
    case "auth":
      void session.auth(message.method);
      return;
    case "retry":
      void session.retry();
      return;
    case "stop":
      stop(0);
      return;
  }
}

let stopping = false;
/** Stops the agent's process group, closes the socket, and exits. */
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  server.close();
  try {
    unlinkSync(spec.socket);
  } catch {
    // Removed already.
  }
  for (const socket of clients) socket.end();
  if (!agent) {
    // The engine runs the agent itself: it stops it.
    void Promise.race([session.stop?.(), Bun.sleep(GRACE_MS)]).finally(() => process.exit(code));
    return;
  }
  const group = agent.pid;
  const signal = (sig: NodeJS.Signals) => {
    try {
      if (group) process.kill(-group, sig);
    } catch {
      // The group is gone already.
    }
  };
  if (agent.exitCode !== null || agent.signalCode !== null) process.exit(code);
  signal("SIGTERM");
  const kill = setTimeout(() => {
    signal("SIGKILL");
    process.exit(code);
  }, GRACE_MS);
  agent.once("exit", () => {
    clearTimeout(kill);
    signal("SIGKILL");
    process.exit(code);
  });
}

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
process.on("SIGHUP", () => stop(0));

server.listen(spec.socket, () => {
  chmodSync(spec.socket, 0o600);
  void session.begin();
});
