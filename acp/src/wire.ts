// The attach protocol: how a client (the package's worker, or a test) speaks to a pane's host over
// its unix socket, one JSON message per line. The host is the agent's only ACP client and keeps the
// conversation; a client says `hello` with the cursor it has and gets the host's state and an
// update (the batches it missed, or a snapshot), then every update after. No `import … from "pumi"`
// here.
import { join } from "node:path";

import type { Update } from "../../lib/conversation/src/change.ts";
import type { Ack, Command, Cursor } from "../../lib/conversation/src/model.ts";

/** Where the host is: starting the agent, waiting for a sign-in, a session to be picked, replaying one, ready, or the agent gone. */
export type Phase = "starting" | "auth" | "picking" | "loading" | "ready" | "exited";

export interface AuthMethod {
  id: string;
  name: string;
  description?: string;
}

/** A session `session/list` offers. */
export interface ListedSession {
  id: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
}

/** What the host says of itself, apart from the conversation. */
export interface HostState {
  phase: Phase;
  /** The table's id (`claude`), and its name (`Claude`). */
  agent: string;
  name: string;
  cwd: string;
  /** The ACP session, once there is one. */
  session?: string;
  /** The host's own pid. */
  pid: number;
  /** In `auth`: how the agent offers to sign in. */
  authMethods?: AuthMethod[];
  /** In `picking`: the agent's sessions (empty when it cannot list them). */
  sessions?: ListedSession[];
  /** What the agent can do: `session/load`, `session/list`, `session/resume`. */
  canLoad: boolean;
  canList: boolean;
  canResume: boolean;
  /** Why it is not ready: the agent failed to start, refused, or exited. */
  error?: string;
}

/** A client's message. */
export type ToHost =
  | { t: "hello"; since?: Cursor }
  | { t: "command"; command: Command }
  /** In `picking`: load `session`, or begin a new one. */
  | { t: "start"; session?: string | null }
  /** In `auth`: sign in with one of the agent's methods. */
  | { t: "auth"; method: string }
  /** Try the session again (after signing in elsewhere). */
  | { t: "retry" }
  /** Stop the agent and the host. */
  | { t: "stop" };

/** The host's message. */
export type FromHost = { t: "state"; state: HostState } | { t: "update"; update: Update } | { t: "ack"; ack: Ack };

/** What the host is started with: one JSON argument. */
export interface HostSpec {
  /** The unix socket it serves. */
  socket: string;
  agent: string;
  name: string;
  /** The agent's ACP server and what its environment adds. */
  command: string[];
  env?: Record<string, string>;
  cwd: string;
  /** `new` begins a session; `load` continues `session`; `pick` lists the agent's sessions first. */
  mode: "new" | "load" | "pick";
  session?: string;
  /** How long a replay may be quiet before it counts as done, in ms (`session/load` says no end). */
  replayIdleMs?: number;
}

/** The longest unix socket path macOS takes (`sun_path`, 104 bytes with its NUL). */
export const SOCKET_PATH_MAX = 103;

/**
 * Where pane `pane`'s host listens: in `dir` (the package's state), or, when that path is too
 * long for a socket, in a directory of the user's own under `/tmp`.
 */
export function socketPath(dir: string, pane: number, uid: number = process.getuid?.() ?? 0): string {
  const path = join(dir, `${pane}.sock`);
  return Buffer.byteLength(path) <= SOCKET_PATH_MAX ? path : join("/tmp", `pumi-acp-${uid}`, `${pane}.sock`);
}
