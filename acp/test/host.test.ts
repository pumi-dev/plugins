// The host end to end: `src/host.ts` run as its own process against `fake-agent.ts`, spoken to over
// its socket as the worker speaks to it.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";

import { follow } from "../../lib/conversation/src/change.ts";
import { newCommandId, type Ack, type Command, type Transcript } from "../../lib/conversation/src/model.ts";
import { lineReader } from "../src/rpc.ts";
import type { FromHost, HostSpec, HostState, ToHost } from "../src/wire.ts";

const dirs: string[] = [];
const hosts: Bun.Subprocess[] = [];
afterEach(() => {
  // A test that failed left its host running: stop it, and its agent with it.
  for (const proc of hosts.splice(0)) proc.kill("SIGTERM");
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A host on a socket of its own, and a client following it. */
async function startHost(mode: HostSpec["mode"]) {
  const dir = mkdtempSync("/tmp/acp-test-");
  dirs.push(dir);
  const spec: HostSpec = {
    socket: join(dir, "h.sock"),
    agent: "fake",
    name: "Fake",
    command: [process.execPath, join(import.meta.dir, "fake-agent.ts")],
    cwd: dir,
    mode,
    replayIdleMs: 300,
  };
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../src/host.ts"), JSON.stringify(spec)], { stdout: "ignore", stderr: "ignore" });
  hosts.push(proc);
  const socket = await connect(spec.socket);
  const client = {
    spec,
    proc,
    socket,
    state: undefined as HostState | undefined,
    transcript: undefined as Transcript | undefined,
    acks: new Map<string, Ack>(),
    send(message: ToHost) {
      socket.write(`${JSON.stringify(message)}\n`);
    },
    command(command: Command) {
      client.send({ t: "command", command });
      return until(() => client.acks.get(command.id));
    },
  };
  socket.on(
    "data",
    lineReader((line) => {
      const message: FromHost = JSON.parse(line);
      if (message.t === "state") client.state = message.state;
      else if (message.t === "ack") client.acks.set(message.ack.id, message.ack);
      else client.transcript = follow(client.transcript, message.update) ?? client.transcript;
    }),
  );
  client.send({ t: "hello" });
  return client;
}

async function connect(path: string): Promise<Socket> {
  for (let i = 0; i < 100; i++) {
    // Bun throws a missing socket's ENOENT at once, rather than as the socket's `error`.
    const socket = existsSync(path)
      ? await new Promise<Socket | undefined>((resolve) => {
          const s = createConnection(path);
          s.once("connect", () => resolve(s));
          s.once("error", () => resolve(undefined));
        })
      : undefined;
    if (socket) return socket;
    await Bun.sleep(50);
  }
  throw new Error(`no host on ${path}`);
}

async function until<T>(fn: () => T | undefined | false, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value;
    await Bun.sleep(20);
  }
  throw new Error("timed out");
}

test("a new session: a turn with a permission, a mode, a cancel, and stop", async () => {
  const host = await startHost("new");
  await until(() => host.state?.phase === "ready");
  expect(host.state?.session).toBe("fake-2");
  await until(() => host.transcript?.options.some((o) => o.category === "mode"));

  expect((await host.command({ type: "prompt", id: newCommandId(), text: "hi" })).rejected).toBeUndefined();
  const asked = await until(() => host.transcript?.permissions[0]);
  expect(host.transcript?.status).toBe("blocked");
  expect(asked.options.map((o) => o.id)).toEqual(["yes", "no"]);
  // A prompt during the turn waits in the queue.
  await host.command({ type: "prompt", id: newCommandId(), text: "wait" });
  expect(host.transcript?.queue.map((q) => q.text)).toEqual(["wait"]);

  const answer: Command = { type: "answer", id: newCommandId(), permissionId: asked.id, optionId: "yes" };
  expect((await host.command(answer)).rejected).toBeUndefined();
  // The turn ends, and the queued prompt runs: it waits until cancelled.
  await until(() => host.transcript?.entries.some((e) => e.kind === "turn"));
  const t = host.transcript!;
  expect(t.entries.find((e) => e.kind === "agent")?.text).toBe("Hello, there.");
  expect(t.entries.find((e) => e.kind === "tool")?.tool?.status).toBe("completed");
  await until(() => host.transcript?.queue.length === 0 && host.transcript.status === "working");

  expect((await host.command({ type: "setOption", id: newCommandId(), category: "mode", value: "code" })).rejected).toBeUndefined();
  expect(host.transcript?.options.find((o) => o.category === "mode")?.current).toBe("code");

  expect((await host.command({ type: "cancel", id: newCommandId() })).rejected).toBeUndefined();
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 2);
  expect(host.transcript?.entries.at(-1)?.turn?.stop).toBe("cancelled");

  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
  expect(existsSync(host.spec.socket)).toBe(false);
}, 20_000);

test("pick: the agent's sessions, then one loaded, its replay ended by quiet", async () => {
  const host = await startHost("pick");
  await until(() => host.state?.phase === "picking");
  expect(host.state?.sessions?.map((s) => s.id)).toEqual(["fake-1"]);
  host.send({ t: "start", session: "fake-1" });
  await until(() => host.state?.phase === "ready");
  expect(host.state?.session).toBe("fake-1");
  await until(() => host.transcript?.entries.length === 2);
  expect(host.transcript?.entries.map((e) => [e.kind, e.text])).toEqual([
    ["user", "an old question"],
    ["agent", "an old answer"],
  ]);
  // A client that comes later, from the cursor it has, gets nothing twice.
  const late = await connect(host.spec.socket);
  const got: FromHost[] = [];
  late.on("data", lineReader((line) => got.push(JSON.parse(line))));
  late.write(`${JSON.stringify({ t: "hello", since: { epoch: host.transcript!.epoch, seq: host.transcript!.seq } })}\n`);
  const update = await until(() => got.find((m) => m.t === "update"));
  expect(update.t === "update" && update.update.type === "changes" && update.update.changes).toEqual([]);
  late.end();
  host.proc.kill("SIGTERM");
  expect(await host.proc.exited).toBe(0);
}, 20_000);
