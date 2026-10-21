// The `herdr` CLI, as Heeler's app calls it on this Host.
//
// The plugin is the server, so its shim is the client too: `src/host.ts` writes `<state>/bin/herdr`,
// first on the SSH session's PATH, and it runs this file with pumi's own embedded Bun. A machine
// with herdr installed keeps its own CLI (Heeler's commands put `~/.local/bin` first), and that one
// talks to the same sockets this plugin serves; a machine without it gets the same commands here.
//
// The commands Heeler runs:
//
//   herdr --version                                     herdr 0.9.4
//   herdr session list --json                           the sessions this plugin answers as
//   herdr plugin list --json                            plugin.list's envelope (the heeler entry)
//   herdr plugin config-dir <id>                        the config directory, created
//   herdr remote-api-bridge [--check]                   stdin/stdout ↔ herdr.sock
//   herdr remote-client-bridge                          stdin/stdout ↔ herdr-client.sock
//   herdr agent attach <pane> [--takeover]              a live terminal on herdr-client.sock
//   herdr terminal attach <pane> [--takeover]           the same, for a shell
//   herdr __enroll --state-dir … --pairing-id …         the forced command behind a Bootstrap Key
//
// Nothing else is claimed: herdr's own TUI and its plugin administration are not part of pumi, and
// say so instead of pretending.
//
// PROVENANCE: Heeler `Sources/Heeler/Transport/SSHTransportSettings.swift` (the commands and their
// flags) @ plugin 0.6.2 (Apache-2.0); the bridge answer and the one-line Enrollment protocol are
// Heeler's `plugin/README.md`.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Frames } from "./frames.ts";
import { hostPaths, type HostRecord } from "./host.ts";
import { acceptEnrollment, acceptLine } from "./pairing/session.ts";
import { HERDR_VERSION, HEELER_PLUGIN_VERSION } from "./protocol.ts";
import { MAX_FRAME, PROTOCOL_VERSION, decodeServerMessage, encodeClientMessage } from "./wire.ts";
import { Writer } from "./write.ts";

const CAPABILITY = "herdr-api-bridge-v1";
const ENROLL_MAX_INPUT_BYTES = 4096;
/** How long a bridge with nothing more to carry waits for the far side before it ends. */
const IDLE_MS = 1_500;
const ENROLL_INPUT_TIMEOUT_MS = 30_000;

function out(text: string): void {
  process.stdout.write(text);
}

function err(text: string): void {
  process.stderr.write(text);
}

function exit(code: number): never {
  process.exit(code);
}

/** Stop reading and let stdout drain: what a bridge does when its socket closes. */
function finish(code: number): void {
  try {
    process.stdin.pause();
  } catch {
    // Not reading.
  }
  process.exitCode = code;
}

function stateDir(): string {
  const given = process.env.HEELER_STATE;
  if (given === undefined || given === "") {
    err("pumi: this herdr is the heeler plugin's; HEELER_STATE is not set, so run it through the plugin's shim\n");
    exit(127);
  }
  return given;
}

function record(): HostRecord {
  const path = join(stateDir(), "host.json");
  let value: HostRecord;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as HostRecord;
  } catch {
    err(`pumi: the heeler plugin is not serving (no ${path})\n`);
    exit(127);
  }
  return value;
}

/** One global `--session <name>` is accepted and ignored: this plugin is the session it is. */
function withoutSession(args: string[]): string[] {
  const out: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] as string;
    if (arg === "--session" || arg === "-L") {
      at += 1;
      continue;
    }
    if (arg.startsWith("--session=")) continue;
    out.push(arg);
  }
  return out;
}

/** `--flag`, `--flag=value`, `--flag value`: the tokens, and the words that are neither. */
function parseWords(args: string[]): { words: string[]; flags: Map<string, string | true> } {
  const words: string[] = [];
  const flags = new Map<string, string | true>();
  const takesValue = new Set(["plugin", "session", "entrypoint", "state-dir", "pairing-id"]);
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] as string;
    if (arg === "--") {
      words.push(...args.slice(at + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const [name, value] = arg.slice(2).split("=", 2);
    if (value !== undefined) {
      flags.set(name as string, value);
      continue;
    }
    const next = args[at + 1];
    if (takesValue.has(name as string) && next !== undefined && !next.startsWith("-")) {
      flags.set(name as string, next);
      at += 1;
      continue;
    }
    flags.set(name as string, true);
  }
  return { words, flags };
}

// ---- the bridges: a socket on one side, this process's stdio on the other

async function bridge(path: string): Promise<void> {
  if (!existsSync(path)) {
    err(`pumi: ${path} is not being served\n`);
    exit(1);
  }
  // A bridge lives as long as there is something to carry: stdin's bytes go to the socket, the
  // socket's to stdout, and the process ends when the socket does. `stdin` ending is not the end —
  // an API request may still be answered — so a quiet socket with nothing sent is a probe (the wake
  // command) and exits at once, and one that has carried bytes exits after a short quiet.
  let sent = 0;
  let received = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const quiet = () => {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(() => {
      try {
        socket?.unref();
      } catch {
        // Not open.
      }
      finish(0);
    }, IDLE_MS);
  };
  let socket;
  try {
    socket = await Bun.connect<undefined>({
      unix: path,
      socket: {
        data: (_socket, bytes) => {
          received += bytes.length;
          process.stdout.write(bytes);
          quiet();
        },
        drain: () => stdio.flush(),
        close: () => finish(0),
        error: (_socket, error) => {
          err(`pumi: ${error.message}\n`);
          finish(1);
        },
      },
    });
  } catch (failure) {
    err(`pumi: cannot open ${path}: ${failure instanceof Error ? failure.message : String(failure)}\n`);
    exit(1);
  }
  const stdio = new Writer(socket, () => finish(1));
  process.stdin.on("data", (chunk: Buffer) => {
    sent += chunk.length;
    stdio.write(chunk);
  });
  const probe = () => {
    try {
      socket?.unref();
    } catch {
      // Not open.
    }
    finish(0);
  };
  process.stdin.on("end", () => {
    if (sent === 0 && received === 0) return probe();
    quiet();
  });
  process.stdin.on("error", () => {
    if (sent === 0 && received === 0) return probe();
    quiet();
  });
  process.stdin.resume();
  await new Promise(() => {});
}

// ---- the live terminal: herdr's direct attach, from this side

async function attach(record: HostRecord, target: string, takeover: boolean): Promise<void> {
  if (!existsSync(record.clientSocket)) {
    err(`pumi: ${record.clientSocket} is not being served\n`);
    exit(1);
  }
  const stdout = process.stdout as NodeJS.WriteStream;
  const columns = (): number => (typeof stdout.columns === "number" && stdout.columns > 0 ? stdout.columns : 80);
  const rows = (): number => (typeof stdout.rows === "number" && stdout.rows > 0 ? stdout.rows : 24);
  let socket;
  try {
    socket = await Bun.connect<undefined>({
      unix: record.clientSocket,
      socket: {
        data: (_socket, bytes) => {
          frames.push(bytes);
          for (const payload of frames.take()) message(payload);
        },
        drain: () => feed.flush(),
        close: () => finish(0),
        error: (_socket, error) => {
          err(`pumi: ${error.message}\n`);
          finish(1);
        },
      },
    });
  } catch (failure) {
    err(`pumi: cannot open ${record.clientSocket}: ${failure instanceof Error ? failure.message : String(failure)}\n`);
    exit(1);
  }
  const feed = new Writer(socket, () => finish(1));
  const frames = new Frames(MAX_FRAME);
  let welcomed = false;

  function message(payload: Uint8Array): void {
    let decoded;
    try {
      decoded = decodeServerMessage(payload);
    } catch (failure) {
      err(`pumi: ${failure instanceof Error ? failure.message : String(failure)}\n`);
      return exit(1);
    }
    if (decoded === undefined) return;
    if (decoded.type === "welcome") {
      if (decoded.error !== undefined) {
        err(`herdr: ${decoded.error}\n`);
        return exit(1);
      }
      welcomed = true;
      return;
    }
    if (decoded.type === "terminal") {
      stdout.write(decoded.frame.bytes);
      return;
    }
    if (decoded.type === "server_shutdown") {
      if (decoded.reason !== undefined && decoded.reason !== "detached") err(`herdr: ${decoded.reason}\n`);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      return finish(0);
    }
  }

  feed.write(
    encodeClientMessage({
      type: "terminal_hello",
      version: PROTOCOL_VERSION,
      cols: columns(),
      rows: rows(),
      cellWidthPx: 0,
      cellHeightPx: 0,
      pixelMouse: false,
    }),
  );
  feed.write(encodeClientMessage({ type: "control_terminal", target, takeover }));

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on("data", (chunk: Buffer) => feed.write(encodeClientMessage({ type: "input", data: new Uint8Array(chunk) })));
  process.stdin.on("error", () => exit(1));
  process.stdin.resume();
  process.on("SIGWINCH", () => {
    if (!welcomed) return;
    feed.write(
      encodeClientMessage({
        type: "resize",
        cols: columns(),
        rows: rows(),
        cellWidthPx: 0,
        cellHeightPx: 0,
        pixelMouse: false,
      }),
    );
  });
  await new Promise(() => {});
}

// ---- the forced command: Enrollment

function stdinLine(): Promise<string | null> {
  return new Promise((resolve) => {
    let data = "";
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(data === "" ? null : data.split("\n")[0] as string), ENROLL_INPUT_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
      if (data.includes("\n") || data.length >= ENROLL_MAX_INPUT_BYTES) finish(data.split("\n")[0] as string);
    });
    process.stdin.on("end", () => finish(data === "" ? null : data.split("\n")[0] as string));
    process.stdin.on("error", () => finish(data === "" ? null : data.split("\n")[0] as string));
  });
}

async function enroll(args: string[]): Promise<never> {
  const { flags } = parseWords(args);
  const dir = typeof flags.get("state-dir") === "string" ? (flags.get("state-dir") as string) : undefined;
  const pairingId = typeof flags.get("pairing-id") === "string" ? (flags.get("pairing-id") as string) : undefined;
  if (dir === undefined || pairingId === undefined) {
    out("HERDR-ENROLL:ERR:unknown_pairing\n");
    err("__enroll needs --state-dir and --pairing-id\n");
    exit(1);
  }
  const submission = await stdinLine();
  const result = await acceptEnrollment({
    // The account's own authorized_keys: the machine's sshd is what ran this forced command.
    authorizedKeysPath: hostPaths(dir).authorizedKeys,
    stateDir: dir,
    pairingId,
    submission,
  });
  out(`${acceptLine(result)}\n`);
  if (!result.ok) {
    err(`${result.detail}\n`);
    exit(1);
  }
  exit(0);
}

// ---- the rest of the CLI

interface SessionList {
  sessions: { default: boolean; name: string; running: boolean; session_dir: string; socket_path: string }[];
}

function sessions(record: HostRecord): SessionList {
  if (record.session === "" || record.sessionDir === undefined) return { sessions: [] };
  const isDefault = record.session === "default" || record.session === "-";
  return {
    sessions: [
      {
        default: isDefault,
        name: isDefault ? "default" : record.session,
        running: true,
        session_dir: record.sessionDir,
        socket_path: join(record.sessionDir, "herdr.sock"),
      },
    ],
  };
}

function pluginEntry(record: HostRecord): Record<string, unknown> {
  return {
    plugin_id: "heeler",
    name: "heeler",
    version: HEELER_PLUGIN_VERSION,
    min_herdr_version: "0.7.5",
    description: "Heeler's Host, from pumi: Pairing, Agent Notifications and Live Activities",
    manifest_path: join(record.configDir, "herdr-plugin.toml"),
    plugin_root: record.configDir,
    enabled: true,
    source: { kind: "local" },
    warnings: [],
  };
}

function main(): void {
  const argv = withoutSession(process.argv.slice(2));
  const command = argv[0] ?? "";
  const rest = argv.slice(1);

  switch (command) {
    case "--version":
    case "-V":
    case "version":
      out(`herdr ${HERDR_VERSION}\n`);
      return exit(0);
    case "--help":
    case "-h":
    case "help":
      out(
        [
          "herdr, answered by the pumi heeler plugin",
          "",
          "  herdr --version",
          "  herdr session list --json",
          "  herdr plugin list --json",
          "  herdr plugin config-dir <id>",
          "  herdr remote-api-bridge [--check]",
          "  herdr remote-client-bridge",
          "  herdr agent attach <pane> [--takeover]",
          "  herdr terminal attach <pane> [--takeover]",
          "",
          "herdr's own TUI and plugin administration are not part of pumi.",
          "",
        ].join("\n"),
      );
      return exit(0);
    case "session": {
      const { words, flags } = parseWords(rest);
      if (words[0] !== "list") {
        err(`pumi: \`herdr session ${words[0] ?? ""}\` is not answered here; only \`session list --json\`\n`);
        exit(127);
      }
      const value = sessions(record());
      if (flags.has("json")) out(`${JSON.stringify(value)}\n`);
      else {
        const list = value.sessions;
        for (const session of list) out(`${session.name}\t${session.running ? "running" : "stopped"}\t${session.session_dir}\n`);
      }
      return exit(0);
    }
    case "plugin": {
      const { words, flags } = parseWords(rest);
      const host = record();
      const sub = words[0];
      if (sub === "list") {
        const only = flags.get("plugin");
        const plugins = only === undefined || only === true || only === "heeler" ? [pluginEntry(host)] : [];
        const answer = { id: "cli:plugin", result: { type: "plugin_list", plugins } };
        if (flags.has("json")) out(`${JSON.stringify(answer)}\n`);
        else for (const plugin of plugins) out(`${plugin.plugin_id}\t${plugin.version}\t${plugin.plugin_root}\n`);
        return exit(0);
      }
      if (sub === "config-dir") {
        const id = words[1] ?? ((flags.get("plugin") as string | undefined) ?? "heeler");
        const dir = id === "heeler" ? host.configDir : join(dirname(host.configDir), id);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        out(`${dir}\n`);
        return exit(0);
      }
      err(`pumi: \`herdr plugin ${sub ?? ""}\` is not answered here; this plugin is installed by pumi\n`);
      exit(127);
    }
    case "remote-api-bridge": {
      if (rest.includes("--check")) {
        out(`${CAPABILITY}\n`);
        return exit(0);
      }
      void bridge(record().apiSocket);
      return;
    }
    case "remote-client-bridge": {
      void bridge(record().clientSocket);
      return;
    }
    case "agent":
    case "terminal": {
      const { words, flags } = parseWords(rest);
      if (words[0] !== "attach" || words[1] === undefined) {
        err(`pumi: only \`herdr ${command} attach <pane>\` is answered here\n`);
        exit(127);
      }
      void attach(record(), words[1], flags.has("takeover"));
      return;
    }
    case "status": {
      out(`${JSON.stringify(record(), null, 2)}\n`);
      return exit(0);
    }
    case "__enroll":
      void enroll(rest);
      return;
    default:
      err(`pumi: \`herdr ${argv.join(" ")}\` is not a command the heeler plugin answers\n`);
      exit(127);
  }
}

main();
