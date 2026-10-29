// The engines a session tab's host runs its agent with: one `Driver` each, behind the same face, so
// the host, the wire and the worker never know which. `acp` is any ACP server (`acp.ts`); `pi`,
// `codex` and `claude` are those agents' own protocols (`pi.ts`, `codex.ts`, `claude.ts`). Each
// turns what its agent says into the conversation's changes on its `producer`, and a view's
// commands into what its agent takes. No `import … from "pumi"` here.
import type { Producer, Update } from "../conversation/change.ts";
import type { Ack, Command } from "../conversation/model.ts";
import { AcpSession } from "./acp.ts";
import { ClaudeSession } from "./claude.ts";
import { CodexSession } from "./codex.ts";
import { PiSession } from "./pi.ts";
import type { HostSpec, HostState } from "./wire.ts";

/** Where a session's news goes: the conversation's updates, and the host's state. */
export interface SessionEvents {
  update(update: Update): void;
  state(state: HostState): void;
}

/** One agent's session, as the host runs it. */
export interface Driver {
  readonly producer: Producer;
  readonly state: HostState;
  /** Starts the session the spec asks for: a new one, a loaded one, or the agent's list to pick from. */
  begin(): Promise<void>;
  /** In `picking`: continue `session`, or begin a new one. */
  start(session?: string | null): Promise<void>;
  /** In `auth`: sign in with one of the agent's methods. */
  auth(method: string): Promise<void>;
  /** The session again, after signing in elsewhere or a failure. */
  retry(): Promise<void>;
  /** What a view asked; answered once per command id. */
  command(command: Command): Promise<Ack>;
  /** One line of the agent's stdout, for an engine that runs a process. */
  feed(line: string): void;
  /** The agent's process ended. */
  exited(code: number | null, signal: string | null, stderr: string[]): void;
  /** Stops what the engine runs itself (an engine without a process of the host's). */
  stop?(): Promise<void>;
}

/** The driver for `spec`'s engine; `write` sends a line to the agent's stdin. */
export function driverFor(spec: HostSpec, write: (line: string) => void, events: SessionEvents): Driver {
  switch (spec.engine ?? "acp") {
    case "acp":
      return new AcpSession(spec, write, events);
    case "pi":
      return new PiSession(spec, write, events);
    case "codex":
      return new CodexSession(spec, write, events);
    case "claude":
      return new ClaudeSession(spec, events);
    default:
      throw new Error(`no engine \`${spec.engine}\``);
  }
}
