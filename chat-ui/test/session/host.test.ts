// The host end to end: `src/session/host.ts` run as its own process against `fake-agent.ts`, spoken to over
// its socket as the worker speaks to it.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";

import { follow } from "../../src/conversation/change.ts";
import { newCommandId, type Ack, type Command, type Transcript } from "../../src/conversation/model.ts";
import { lineReader } from "../../src/session/rpc.ts";
import type { FromHost, HostSpec, HostState, ToHost } from "../../src/session/wire.ts";

const dirs: string[] = [];
const hosts: Bun.Subprocess[] = [];
afterEach(() => {
  // A test that failed left its host running: stop it, and its agent with it.
  for (const proc of hosts.splice(0)) proc.kill("SIGTERM");
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A host on a socket of its own, and a client following it: over ACP to `fake-agent.ts`, or pi's protocol to `fake-pi.ts`. */
async function startHost(mode: HostSpec["mode"], engine: "acp" | "pi" | "codex" | "claude" = "acp", session?: string) {
  const dir = mkdtempSync("/tmp/chat-host-test-");
  dirs.push(dir);
  const fakes = { acp: "fake-agent.ts", pi: "fake-pi.ts", codex: "fake-codex.ts", claude: "" };
  const agent = [join(import.meta.dir, fakes[engine]), ...(engine === "pi" && session ? ["--session", session] : [])];
  const spec: HostSpec = {
    socket: join(dir, "h.sock"),
    agent: "fake",
    name: "Fake",
    engine,
    // The `claude` engine runs the SDK in the host: no process of its own, a stand-in SDK.
    command: engine === "claude" ? [] : [process.execPath, ...agent],
    ...(engine === "claude" ? { claudeSdk: join(import.meta.dir, "fake-claude-sdk.ts") } : {}),
    cwd: dir,
    mode,
    ...(session ? { session } : {}),
    replayIdleMs: 300,
  };
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../../src/session/host.ts"), JSON.stringify(spec)], { stdout: "ignore", stderr: "ignore" });
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

test("pi: a turn streamed with a call, a question an extension asks, a model, and a cancel", async () => {
  const host = await startHost("new", "pi");
  await until(() => host.state?.phase === "ready");
  expect(host.state?.session).toBe("fresh");
  expect(host.transcript?.options.find((o) => o.category === "model")?.current).toBe("fake/small");
  expect(host.transcript?.commands.map((c) => c.name)).toEqual(["review"]);

  await host.command({ type: "prompt", id: newCommandId(), text: "hi" });
  await until(() => host.transcript?.entries.some((e) => e.kind === "turn"));
  let t = host.transcript!;
  expect(t.entries.map((e) => e.kind)).toEqual(["user", "thought", "tool", "agent", "turn"]);
  expect(t.entries.find((e) => e.kind === "agent")?.text).toBe("Done.");
  expect(t.entries.find((e) => e.kind === "tool")?.tool?.status).toBe("completed");
  expect(t.usage.cost?.amount).toBeCloseTo(0.01);
  expect(t.status).toBe("done");

  await host.command({ type: "prompt", id: newCommandId(), text: "ask" });
  const asked = await until(() => host.transcript?.permissions[0]);
  expect(asked.kind).toBe("question");
  expect(asked.options.map((o) => o.id)).toEqual(["yes", "no"]);
  await host.command({ type: "answer", id: newCommandId(), permissionId: asked.id, optionId: "yes" });
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 2);
  expect(host.transcript?.entries.filter((e) => e.kind === "agent").at(-1)?.text).toBe("Went on.");

  expect((await host.command({ type: "setOption", id: newCommandId(), category: "model", value: "fake/big" })).rejected).toBeUndefined();
  expect(host.transcript?.options.find((o) => o.category === "model")?.current).toBe("fake/big");

  await host.command({ type: "prompt", id: newCommandId(), text: "wait" });
  await until(() => host.transcript?.status === "working");
  expect((await host.command({ type: "cancel", id: newCommandId() })).rejected).toBeUndefined();
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 3);
  t = host.transcript!;
  expect(t.entries.at(-1)?.turn?.stop).toBe("cancelled");

  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
}, 20_000);

test("pi: a session loaded shows its messages", async () => {
  const host = await startHost("load", "pi", "earlier");
  await until(() => host.state?.phase === "ready");
  expect(host.state?.session).toBe("earlier");
  expect(host.transcript?.entries.map((e) => [e.kind, e.text ?? e.turn?.stop])).toEqual([
    ["user", "Earlier question"],
    ["agent", "Earlier answer"],
    ["turn", "end_turn"],
  ]);
  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
}, 20_000);

test("claude: a turn streamed, a permission asked through canUseTool, and a cancel", async () => {
  const host = await startHost("new", "claude");
  await until(() => host.state?.phase === "ready");
  expect(host.transcript?.options.find((o) => o.category === "model")?.choices?.map((c) => c.id)).toEqual(["default", "opus"]);
  expect(host.transcript?.commands.map((c) => c.name)).toEqual(["review"]);

  await host.command({ type: "prompt", id: newCommandId(), text: "hi" });
  const asked = await until(() => host.transcript?.permissions[0]);
  expect(asked.title).toBe("Run `ls`?");
  expect(asked.options.map((o) => o.id)).toEqual(["allow", "always", "deny"]);
  await until(() => host.state?.session === "fake-session");
  await host.command({ type: "answer", id: newCommandId(), permissionId: asked.id, optionId: "allow" });
  await until(() => host.transcript?.entries.some((e) => e.kind === "turn"));
  const t = host.transcript!;
  expect(t.entries.map((e) => e.kind)).toEqual(["user", "thought", "tool", "agent", "turn"]);
  expect(t.entries.find((e) => e.kind === "agent")?.text).toBe("Listed.");
  expect(t.entries.find((e) => e.kind === "tool")?.tool?.status).toBe("completed");
  expect(t.session?.model).toBe("claude-fake");
  expect(t.usage.cost?.amount).toBeCloseTo(0.01);

  await host.command({ type: "prompt", id: newCommandId(), text: "wait" });
  await until(() => host.transcript?.status === "working");
  expect((await host.command({ type: "cancel", id: newCommandId() })).rejected).toBeUndefined();
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 2);
  expect(host.transcript?.entries.at(-1)?.turn?.stop).toBe("cancelled");

  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
}, 20_000);

test("codex: a turn streamed, a command approved, the tokens, and an interrupt", async () => {
  const host = await startHost("new", "codex");
  await until(() => host.state?.phase === "ready");
  expect(host.state?.session).toBe("th1");
  expect(host.transcript?.options.find((o) => o.category === "model")?.current).toBe("gpt-fake");

  await host.command({ type: "prompt", id: newCommandId(), text: "hi" });
  const asked = await until(() => host.transcript?.permissions[0]);
  expect(asked.title).toBe("Run `ls`?");
  await host.command({ type: "answer", id: newCommandId(), permissionId: asked.id, optionId: "accept" });
  await until(() => host.transcript?.entries.some((e) => e.kind === "turn"));
  const t = host.transcript!;
  expect(t.entries.map((e) => e.kind)).toEqual(["user", "thought", "tool", "agent", "turn"]);
  expect(t.entries.find((e) => e.kind === "agent")?.text).toBe("Ran it.");
  const tool = t.entries.find((e) => e.kind === "tool")?.tool;
  expect(tool?.status).toBe("completed");
  expect(tool?.content).toEqual([{ type: "terminal", output: "a.txt\n", exitCode: 0 }]);
  expect(t.usage.contextPct).toBe(10);

  await host.command({ type: "prompt", id: newCommandId(), text: "wait" });
  await until(() => host.transcript?.status === "working");
  await Bun.sleep(50);
  expect((await host.command({ type: "cancel", id: newCommandId() })).rejected).toBeUndefined();
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 2);
  expect(host.transcript?.entries.at(-1)?.turn?.stop).toBe("cancelled");
  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
}, 20_000);

test("codex: a thread resumed shows its turns", async () => {
  const host = await startHost("load", "codex", "th0");
  await until(() => host.state?.phase === "ready");
  expect(host.transcript?.entries.map((e) => [e.kind, e.text ?? e.turn?.stop])).toEqual([
    ["user", "Earlier"],
    ["agent", "Answered"],
    ["turn", "end_turn"],
  ]);
  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
}, 20_000);

/** The calls the stand-in SDK logged in the host's directory. */
function calls(dir: string): Record<string, any>[] {
  const path = join(dir, "calls.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
}

test("claude: thinking, effort and mode; an edit resumes at the record before; a fork cuts through its turn; a checkpoint restored", async () => {
  const host = await startHost("new", "claude");
  await until(() => host.state?.phase === "ready");
  expect(host.state?.canEdit).toBe(true);
  expect(host.state?.canFork).toBe(true);
  const thinking = host.transcript?.options.find((o) => o.category === "thought_level");
  expect(thinking?.choices?.map((c) => c.id)).toEqual(["off", "low", "medium", "high"]);
  expect(thinking?.off).toBe("off");
  expect(host.transcript?.options.find((o) => o.category === "mode")?.current).toBe("default");
  expect(calls(host.spec.cwd)[0]).toMatchObject({ call: "query", enableFileCheckpointing: true });

  await host.command({ type: "setOption", id: newCommandId(), category: "thought_level", value: "off" });
  expect(host.transcript?.options.find((o) => o.category === "thought_level")?.current).toBe("off");
  await host.command({ type: "setOption", id: newCommandId(), category: "thought_level", value: "medium" });
  expect(host.transcript?.options.find((o) => o.category === "thought_level")?.current).toBe("medium");
  await host.command({ type: "setOption", id: newCommandId(), category: "mode", value: "plan" });
  expect(host.transcript?.options.find((o) => o.category === "mode")?.current).toBe("plan");
  expect(calls(host.spec.cwd).filter((c) => c.call !== "query").map((c) => c.call)).toEqual(["setMaxThinkingTokens", "setMaxThinkingTokens", "applyFlagSettings", "setPermissionMode"]);

  await host.command({ type: "prompt", id: newCommandId(), text: "one quick" });
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 1);
  await host.command({ type: "prompt", id: newCommandId(), text: "two quick" });
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 2);
  expect(host.transcript?.usage.contextPct).toBe(50);
  const [first, second] = host.transcript!.entries.filter((e) => e.kind === "user");
  expect(first?.source).toBeTruthy();
  expect(first?.checkpoint).toBe(true);
  const forked = await host.command({ type: "fork", id: newCommandId(), entry: first!.id });
  expect(forked.rejected).toBeUndefined();
  expect(forked.session).toBe("forked-session");
  const fork = calls(host.spec.cwd).find((c) => c.call === "forkSession");
  expect(fork).toMatchObject({ session: "fake-session", dir: host.spec.cwd });
  expect(typeof fork?.upToMessageId).toBe("string");

  const restored = await host.command({ type: "restore", id: newCommandId(), entry: first!.id });
  expect(restored.rejected).toBeUndefined();
  expect(calls(host.spec.cwd).find((c) => c.call === "rewindFiles")?.uuid).toBe(first!.source);
  expect(host.transcript?.entries.at(-1)?.text).toContain("Restored 1 file");

  const edited = await host.command({ type: "prompt", id: newCommandId(), text: "three quick", replaces: second!.id });
  expect(edited.rejected).toBeUndefined();
  await until(() => host.transcript?.entries.some((e) => e.kind === "agent" && e.text === "Said three quick."));
  expect(host.transcript?.entries.filter((e) => e.kind === "user").map((e) => e.text)).toEqual(["one quick", "three quick"]);
  const reopened = calls(host.spec.cwd).filter((c) => c.call === "query").at(-1);
  expect(reopened).toMatchObject({ resume: "fake-session", resumeSessionAt: fork?.upToMessageId, permissionMode: "plan", effort: "medium" });

  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
}, 20_000);

test("pi: the thinking level; an edit forks at the message; a fork for a tab of its own comes back", async () => {
  const host = await startHost("new", "pi");
  await until(() => host.state?.phase === "ready");
  const thinking = () => host.transcript?.options.find((o) => o.category === "thought_level");
  expect(thinking()?.choices?.map((c) => c.id)).toEqual(["off", "low", "high"]);
  expect(thinking()?.current).toBe("high");
  expect(thinking()?.off).toBe("off");
  await host.command({ type: "setOption", id: newCommandId(), category: "thought_level", value: "medium" });
  expect(thinking()?.current).toBe("high");
  await host.command({ type: "setOption", id: newCommandId(), category: "thought_level", value: "low" });
  expect(thinking()?.current).toBe("low");

  await host.command({ type: "prompt", id: newCommandId(), text: "one quick" });
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 1);
  await host.command({ type: "prompt", id: newCommandId(), text: "two quick" });
  await until(() => host.transcript?.entries.filter((e) => e.kind === "user").every((e) => e.source) && host.transcript?.entries.filter((e) => e.kind === "turn").length === 2);
  const [first, second] = host.transcript!.entries.filter((e) => e.kind === "user");
  expect([first?.source, second?.source]).toEqual(["e1", "e3"]);

  const forked = await host.command({ type: "fork", id: newCommandId(), entry: first!.id });
  expect(forked.rejected).toBeUndefined();
  expect(forked.session).toBe("forked-e3");

  const edited = await host.command({ type: "prompt", id: newCommandId(), text: "three quick", replaces: second!.id });
  expect(edited.rejected).toBeUndefined();
  await until(() => host.transcript?.entries.some((e) => e.kind === "agent" && e.text === "Said three quick."));
  expect(host.transcript?.entries.filter((e) => e.kind === "user").map((e) => e.text)).toEqual(["one quick", "three quick"]);
  await until(() => host.state?.session === "forked-e3");
  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
}, 20_000);

test("codex: the reasoning effort and approvals go with each turn; an edit reverts its turn; a fork copies through it", async () => {
  const host = await startHost("new", "codex");
  await until(() => host.state?.phase === "ready");
  const effort = host.transcript?.options.find((o) => o.category === "thought_level");
  expect(effort?.choices?.map((c) => c.id)).toEqual(["low", "medium", "high"]);
  expect(effort?.current).toBe("medium");
  expect(host.transcript?.options.find((o) => o.category === "mode")?.current).toBe("auto");
  await host.command({ type: "setOption", id: newCommandId(), category: "thought_level", value: "high" });
  await host.command({ type: "setOption", id: newCommandId(), category: "mode", value: "read-only" });

  await host.command({ type: "prompt", id: newCommandId(), text: "one quick" });
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 1);
  await host.command({ type: "prompt", id: newCommandId(), text: "two quick" });
  await until(() => host.transcript?.entries.filter((e) => e.kind === "turn").length === 2);
  const [first, second] = host.transcript!.entries.filter((e) => e.kind === "user");
  expect([first?.source, second?.source]).toEqual(["turn1", "turn2"]);

  const forked = await host.command({ type: "fork", id: newCommandId(), entry: first!.id });
  expect(forked.session).toBe("th-forked");
  const edited = await host.command({ type: "prompt", id: newCommandId(), text: "three quick", replaces: second!.id });
  expect(edited.rejected).toBeUndefined();
  await until(() => host.transcript?.entries.some((e) => e.kind === "agent" && e.text === "Said three quick."));
  expect(host.transcript?.entries.filter((e) => e.kind === "user").map((e) => e.text)).toEqual(["one quick", "three quick"]);

  host.send({ t: "stop" });
  expect(await host.proc.exited).toBe(0);
}, 20_000);
