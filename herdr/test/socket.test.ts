// herdr's API end to end: the package started by pumi/testing's fake app, its socket answered over a
// real unix socket, and the model read from the fake's `server.getState`.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

const dir = join(import.meta.dir, "..");

/** $5 `main` with tabs @7 and @8, $6 `other` with tab @9, and the first pane current. */
const MODEL = {
  sessions: [
    { id: 5, name: "main", tabs: [[0, 7], [1, 8]], current: 8 },
    { id: 6, name: "other", tabs: [[0, 9]], current: 9 },
  ],
  tabs: [
    { id: 7, name: null, layout: ["row", [["leaf", 1], ["leaf", 2]]], active: 1, zoomed: false },
    { id: 8, name: "logs", layout: ["leaf", 3], active: 3, zoomed: false },
    { id: 9, name: null, layout: ["leaf", 4], active: 4, zoomed: false },
  ],
  panes: [
    { id: 1, type: "terminal", place: { kind: "tiled", tab: 7 }, options: { title: "zsh", pane_current_path: "/tmp", pane_pid: 42, pane_tty: "/dev/ttys001" } },
    { id: 2, type: "terminal", place: { kind: "tiled", tab: 7 }, options: { "@agent": "claude", "@agent_status": "working", "@label": "worker" } },
    { id: 3, type: "terminal", place: { kind: "tiled", tab: 8 }, options: {} },
    { id: 4, type: "terminal", place: { kind: "tiled", tab: 9 }, options: {} },
  ],
  options: {},
  current: { session: 5, tab: 7, pane: 1 },
};

/** A herdr client: a request a line, an answer a line, as its clients speak it. */
class Client {
  private buffer = "";
  private lines: string[] = [];
  private wake?: () => void;

  private constructor(readonly socket: Bun.Socket<undefined>) {}

  static async open(path: string): Promise<Client> {
    let client: Client;
    const socket = await Bun.connect<undefined>({
      unix: path,
      socket: {
        data(_socket, chunk) {
          client.received(chunk.toString());
        },
        open() {},
      },
    });
    client = new Client(socket);
    return client;
  }

  private received(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const at = this.buffer.indexOf("\n");
      if (at < 0) break;
      this.lines.push(this.buffer.slice(0, at));
      this.buffer = this.buffer.slice(at + 1);
    }
    this.wake?.();
  }

  send(value: unknown): void {
    this.socket.write(`${JSON.stringify(value)}\n`);
  }

  /** The next line the socket sent, parsed. */
  async next(): Promise<any> {
    for (;;) {
      const line = this.lines.shift();
      if (line !== undefined) return JSON.parse(line);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no answer from herdr.sock")), 3000);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  /** One request and its answer. */
  async ask(id: number, method: string, params?: unknown): Promise<any> {
    this.send({ id, method, ...(params === undefined ? {} : { params }) });
    return this.next();
  }

  close(): void {
    this.socket.end();
  }
}

let app: FakeApp;
let main: typeof import("../src/main.ts");
let client: Client;

afterEach(() => {
  client?.close();
  main?.stop();
  app?.stop();
  delete process.env.PUMI_DATA_DIR;
  delete process.env.XDG_CONFIG_HOME;
});

/** Starts the package with its sockets in a directory of their own, and the model the fake answers. */
async function start(opts: { options?: Record<string, unknown>; answers?: Record<string, unknown> } = {}): Promise<string> {
  const data = mkdtempSync(join(tmpdir(), "herdr-data-"));
  process.env.PUMI_DATA_DIR = data;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "herdr-config-"));
  app = await FakeApp.start({
    dir,
    main: "src/main.ts",
    options: { session: "", ...opts.options },
    answers: {
      "server.getState": () => ({ seq: 0, state: MODEL }),
      "pane.call": (pane: number, method: string) => (method === "read" ? `pane ${pane}, said` : null),
      ...opts.answers,
    },
  });
  main = await import("../src/main.ts");
  return data;
}

async function connect(data: string): Promise<Client> {
  client = await Client.open(join(data, "herdr.sock"));
  return client;
}

test("ping says which herdr pumi answers as", async () => {
  const client = await connect(await start());
  expect(await client.ask(1, "ping")).toEqual({
    id: 1,
    result: {
      type: "pong",
      version: "0.9.4",
      protocol: 22,
      capabilities: {
        live_handoff: true,
        detached_server_daemon: true,
        surface_interest: false,
        health_check: true,
        ssh_agent_registration: false,
      },
    },
  });
});

test("a method herdr has and pumi has not says which", async () => {
  const client = await connect(await start());
  expect((await client.ask(1, "no.such.method")).error).toEqual({ code: "unknown_method", message: "unknown method: no.such.method" });
  expect((await client.ask(2, "plugin.list")).error).toEqual({
    code: "unsupported",
    message: "plugin.list is not supported by pumi: herdr plugins are not part of pumi",
  });
  expect((await client.ask(3, "workspace.move")).error).toEqual({
    code: "unsupported",
    message: "workspace.move is not implemented by pumi yet",
  });
});

test("a request that is not one is refused, and the connection stays", async () => {
  const client = await connect(await start());
  client.socket.write("not json\n");
  expect(await client.next()).toEqual({ id: "", error: { code: "invalid_request", message: expect.stringContaining("invalid request:") } });
  expect((await client.ask(3, "workspace.move")).error.code).toBe("unsupported");
  client.send({ id: 2 });
  expect(await client.next()).toEqual({ id: 2, error: { code: "invalid_request", message: "missing method" } });
  // An id is echoed as it was given.
  client.send({ id: "seven", method: "workspace.list" });
  expect((await client.next()).id).toBe("seven");
});

test("the model is herdr's: workspaces, tabs, panes and agents", async () => {
  const client = await connect(await start());
  const workspaces = (await client.ask(1, "workspace.list")).result;
  expect(workspaces.type).toBe("workspace_list");
  expect(workspaces.workspaces.map((workspace: any) => [workspace.workspace_id, workspace.label, workspace.pane_count])).toEqual([
    ["w5", "main", 3],
    ["w6", "other", 1],
  ]);
  const tabs = (await client.ask(2, "tab.list", { workspace_id: "w5" })).result.tabs;
  expect(tabs.map((tab: any) => tab.tab_id)).toEqual(["w5:t7", "w5:t8"]);
  const panes = (await client.ask(3, "pane.list")).result.panes;
  expect(panes.map((pane: any) => pane.pane_id)).toEqual(["w5:p1", "w5:p2", "w5:p3", "w6:p4"]);
  expect((await client.ask(4, "pane.get", { pane_id: "w5:p2" })).result.pane.agent).toBe("claude");
  // pumi's own ids read the same pane.
  expect((await client.ask(5, "pane.get", { pane_id: "%3" })).result.pane.pane_id).toBe("w5:p3");
  expect((await client.ask(6, "pane.current")).result.pane.pane_id).toBe("w5:p1");
  expect((await client.ask(7, "agent.list")).result.agents.map((agent: any) => agent.pane_id)).toEqual(["w5:p2"]);
  const snapshot = (await client.ask(8, "session.snapshot")).result.snapshot;
  expect([snapshot.version, snapshot.protocol, snapshot.focused_pane_id]).toEqual(["0.9.4", 22, "w5:p1"]);
});

test("what is not there is named: a workspace, a tab, a pane, an agent", async () => {
  const client = await connect(await start());
  expect((await client.ask(1, "workspace.get", { workspace_id: "w9" })).error).toEqual({
    code: "workspace_not_found",
    message: "workspace not found: w9",
  });
  expect((await client.ask(2, "tab.get", { tab_id: "w5:t4" })).error).toEqual({ code: "tab_not_found", message: "tab not found: w5:t4" });
  expect((await client.ask(3, "pane.get", { pane_id: "%9" })).error).toEqual({ code: "pane_not_found", message: "pane not found: %9" });
  expect((await client.ask(4, "agent.get", { target: "w5:p1" })).error).toEqual({ code: "agent_not_found", message: "no agent in that pane" });
  expect((await client.ask(5, "pane.read", {})).error).toEqual({ code: "invalid_params", message: "missing `pane_id`" });
});

test("a pane's text is the core's own, and colours can stay", async () => {
  const client = await connect(
    await start({ answers: { "pane.call": (pane: number) => (pane === 1 ? "\x1b[31mred\x1b[0m and \x1b[2Jplain" : null) } }),
  );
  const read = (await client.ask(1, "pane.read", { pane_id: "w5:p1", lines: 20 })).result.read;
  expect(read).toEqual({
    pane_id: "w5:p1",
    workspace_id: "w5",
    tab_id: "w5:t7",
    source: "recent",
    format: "text",
    text: "\x1b[31mred\x1b[0m and \x1b[2Jplain",
    revision: 0,
    truncated: false,
  });
  expect(app.called("pane.call").at(-1)).toEqual([1, "read", { lines: 20 }]);
  // The ansi format keeps SGR and drops every other escape; `strip_ansi: false` keeps them all.
  expect((await client.ask(2, "pane.read", { pane_id: "w5:p1", format: "ansi" })).result.read.text).toBe("\x1b[31mred\x1b[0m and plain");
  expect((await client.ask(3, "pane.read", { pane_id: "w5:p1", format: "ansi", strip_ansi: false })).result.read.text).toBe(
    "\x1b[31mred\x1b[0m and \x1b[2Jplain",
  );
  expect((await client.ask(4, "pane.read", { pane_id: "w5:p1", source: "visible", format: "ansi" })).result.read.source).toBe("visible");
  expect((await client.ask(5, "pane.read", { pane_id: "w5:p1", source: "nowhere" })).error.code).toBe("invalid_params");
});

test("typing and keys go to the pane", async () => {
  const client = await connect(await start());
  expect((await client.ask(1, "pane.send_text", { pane_id: "w5:p1", text: "ls\n" })).result).toEqual({ type: "ok" });
  expect(app.called("pane.call").at(-1)).toEqual([1, "input", { text: "ls\n" }]);
  await client.ask(2, "pane.send_keys", { pane_id: "w5:p1", keys: ["C-c"] });
  expect(app.called("pane.call").at(-1)).toEqual([1, "input", { keys: ["C-c"] }]);
  await client.ask(3, "pane.send_input", { pane_id: "w5:p1", text: "pwd", keys: ["Enter"] });
  expect(app.called("pane.call").slice(-2)).toEqual([
    [1, "input", { text: "pwd" }],
    [1, "input", { keys: ["Enter"] }],
  ]);
  await client.ask(4, "agent.send_keys", { target: "w5:p2", keys: ["Enter"] });
  expect(app.called("pane.call").at(-1)).toEqual([2, "input", { keys: ["Enter"] }]);
  // No keys at all is no call.
  await client.ask(5, "pane.send_keys", { pane_id: "w5:p1", keys: [] });
  expect(app.called("pane.call").at(-1)).toEqual([2, "input", { keys: ["Enter"] }]);
});

test("what changes the model goes to the core's own calls", async () => {
  const client = await connect(await start());
  await client.ask(1, "workspace.focus", { workspace_id: "w6" });
  expect(app.called("session.select").at(-1)).toEqual([{ session: 6 }]);
  await client.ask(2, "workspace.rename", { workspace_id: "w6", label: "  work  " });
  expect(app.called("session.rename").at(-1)).toEqual([6, "work"]);
  await client.ask(3, "tab.focus", { tab_id: "w5:t8" });
  expect(app.called("tab.select").at(-1)).toEqual([{ tab: 8 }]);
  await client.ask(4, "tab.rename", { tab_id: "w5:t8", label: " " });
  expect(app.called("tab.rename").at(-1)).toEqual([8, null]);
  await client.ask(5, "pane.focus", { pane_id: "w5:p2" });
  expect(app.called("pane.select").at(-1)).toEqual([{ to: 2 }]);
  await client.ask(6, "pane.rename", { pane_id: "w5:p2", label: " build " });
  expect(app.called("option.set").at(-1)).toEqual(["@label", "build", { pane: 2 }]);
  await client.ask(7, "pane.close", { pane_id: "w5:p2" });
  expect(app.called("pane.close").at(-1)).toEqual([2, true]);
  await client.ask(8, "tab.close", { tab_id: "w5:t8" });
  expect(app.called("tab.close").at(-1)).toEqual([8, true]);
  await client.ask(9, "workspace.close", { workspace_id: "w6" });
  expect(app.called("session.close").at(-1)).toEqual([6, true]);
});

test("a new workspace, tab and split open a terminal where herdr says", async () => {
  const client = await connect(await start());
  await client.ask(1, "workspace.create", { label: "build", cwd: "/src", env: { A: "1" }, command: ["make"] });
  expect(app.called("pane.open").at(-1)).toEqual(["terminal", { cwd: "/src", env: { A: "1" }, command: ["make"] }, { kind: "session", focus: true, name: "build" }]);
  await client.ask(2, "tab.create", { workspace_id: "w5", label: "logs" });
  expect(app.called("pane.open").at(-1)).toEqual(["terminal", {}, { kind: "tab", focus: true, session: 5, name: "logs" }]);
  // Splitting takes the ratio as the share of what is left, beside the pane, and its directory.
  await client.ask(3, "pane.split", { target_pane_id: "w5:p1", direction: "down", ratio: 0.25, focus: true });
  expect(app.called("pane.open").at(-1)).toEqual(["terminal", { cwd: "/tmp" }, { beside: 1, split: "down", focus: true, size: "75%" }]);
  expect((await client.ask(4, "pane.split", { direction: "up" })).error.code).toBe("invalid_params");
});

test("zoom, clear, the process info and the agent's report", async () => {
  const client = await connect(await start());
  expect((await client.ask(1, "pane.zoom", { pane_id: "w5:p1" })).result).toEqual({ type: "pane_zoom", pane_id: "w5:p1", zoomed: true });
  expect(app.called("pane.setZoom").at(-1)).toEqual([1, true]);
  expect((await client.ask(2, "pane.zoom", { pane_id: "w5:p1", zoomed: false })).result.zoomed).toBe(false);
  expect((await client.ask(3, "pane.clear", { pane_id: "w5:p1" })).result).toEqual({ type: "ok" });
  expect(app.called("pane.call").at(-1)).toEqual([1, "clear_history"]);
  expect((await client.ask(4, "pane.process_info", { pane_id: "w5:p1" })).result.process_info).toEqual({
    pane_id: "w5:p1",
    shell_pid: 42,
    tty: "/dev/ttys001",
  });
  await client.ask(5, "pane.report_agent", { pane_id: "w5:p2", agent: "claude", state: "blocked" });
  expect(app.called("option.set").at(-1)).toEqual(["@agent", "claude", { pane: 2 }]);
  expect(app.called("pane.report").at(-1)).toEqual([2, "state=blocked:app=claude"]);
  await client.ask(6, "pane.report_agent", { pane_id: "w5:p2", state: "unknown" });
  expect(app.called("pane.report").at(-1)).toEqual([2, "state=clear"]);
  expect((await client.ask(7, "pane.report_agent", { pane_id: "w5:p2", state: "busy" })).error).toEqual({
    code: "invalid_params",
    message: "no agent state `busy`",
  });
});

test("a notification is herdr's, and the server's own methods are pumi's", async () => {
  const client = await connect(await start());
  expect((await client.ask(1, "notification.show", { title: "Build", body: "done" })).result).toEqual({
    type: "notification_show",
    shown: true,
    reason: "shown",
  });
  expect(app.notices.at(-1)).toEqual({ msg: "Build: done", level: "info" });
  expect((await client.ask(2, "server.stop")).result).toEqual({ type: "ok" });
  expect(app.called("server.kill")).toHaveLength(1);
  expect((await client.ask(3, "pumi.server.restart")).result).toEqual({ type: "restarting" });
  expect(app.called("server.restart")).toHaveLength(1);
});

test("events.subscribe answers, and what happens next streams", async () => {
  const client = await connect(await start());
  expect((await client.ask(1, "events.subscribe", { subscriptions: [{ type: "workspace.created" }, { type: "pane.created" }] })).result).toEqual({
    type: "subscription_started",
  });
  await app.fire("session.created", { session: 6 }, { match: "other" });
  const created = await client.next();
  expect(created.event).toBe("workspace_created");
  expect(created.data.type).toBe("workspace_created");
  expect(created.data.workspace.workspace_id).toBe("w6");
  await app.fire("pane.opened", { pane: 2 }, { match: "terminal", pane: 2 });
  const opened = await client.next();
  expect(opened.event).toBe("pane_created");
  expect(opened.data.pane.pane_id).toBe("w5:p2");
  // What the subscription did not name is not sent.
  await app.fire("tab.opened", { tab: 7 }, { match: "zsh" });
  expect((await client.ask(2, "ping")).id).toBe(2);
});

test("a pane's agent status is a subscription of its own", async () => {
  const client = await connect(await start());
  await client.ask(1, "events.subscribe", { subscriptions: [{ type: "pane.agent_status_changed", pane_id: "w5:p2" }] });
  // Another pane's status is not this subscription's.
  await app.fire("option.changed", { name: "@agent_status", id: 1, new: "blocked" }, { match: "@agent_status", pane: 1 });
  expect((await client.ask(2, "ping")).id).toBe(2);
  await app.fire("option.changed", { name: "@agent_status", id: 2, new: "blocked" }, { match: "@agent_status", pane: 2 });
  expect(await client.next()).toEqual({
    event: "pane.agent_status_changed",
    data: { pane_id: "w5:p2", workspace_id: "w5", agent_status: "working", agent: "claude" },
  });
  // A subscription that waits for one status hears only that one.
  await client.ask(3, "events.subscribe", { subscriptions: [{ type: "pane.agent_status_changed", pane_id: "w5:p2", agent_status: "blocked" }] });
  await app.fire("option.changed", { name: "@agent_status", id: 2, new: "working" }, { match: "@agent_status", pane: 2 });
  expect((await client.ask(4, "ping")).id).toBe(4);
  // A subscription pumi cannot keep is refused, and a name it does not know too.
  expect((await client.ask(5, "events.subscribe", { subscriptions: [{ type: "pane.output_matched" }] })).error).toEqual({
    code: "invalid_params",
    message: "pane.output_matched cannot be subscribed to on pumi yet",
  });
  expect((await client.ask(6, "events.subscribe", { subscriptions: [{ type: "nope" }] })).error.message).toBe("unknown subscription type: nope");
  expect((await client.ask(7, "events.subscribe", { subscriptions: [{}] })).error.message).toBe("a subscription needs `type`");
});

test("the sockets are also in herdr's session directory", async () => {
  await start({ options: { session: "pumi" } });
  const sessions = join(process.env.XDG_CONFIG_HOME ?? "", "herdr", "sessions", "pumi");
  expect(existsSync(join(sessions, "herdr.sock"))).toBe(true);
  expect(existsSync(join(sessions, "herdr-client.sock"))).toBe(true);
  client = await Client.open(join(sessions, "herdr.sock"));
  expect((await client.ask(1, "ping")).result.type).toBe("pong");
});
