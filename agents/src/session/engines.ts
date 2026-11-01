// The engines a session tab's host runs its agent with: one `Driver` each, behind the same face, so
// the host, the wire and the worker never know which. `acp` is any ACP server (`acp.ts`), the
// plugin's own; any other is a sub-plugin's (`registry.ts` `EngineDef`): its module, which the
// host imports, makes the driver (`createDriver`), as pi's, Codex's and Claude Code's do over their
// own protocols. Each turns what its agent says into the conversation's changes on its `producer`,
// and a view's commands into what its agent takes. No `import … from "pumi"` here.
import type { Producer, Update } from "../conversation/change.ts";
import type { Ack, Command } from "../conversation/model.ts";
import { AcpSession } from "./acp.ts";
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

/** What a sub-plugin's engine module gives. */
export interface EngineModule {
  createDriver(spec: HostSpec, write: (line: string) => void, events: SessionEvents): Driver;
}

/** The driver for `spec`'s engine: ACP's, or the one its module makes; `write` sends a line to the agent's stdin. */
export async function driverFor(spec: HostSpec, write: (line: string) => void, events: SessionEvents): Promise<Driver> {
  const engine = spec.engine ?? "acp";
  if (engine === "acp") return new AcpSession(spec, write, events);
  if (!spec.engineModule) throw new Error(`no engine \`${engine}\`: no sub-plugin gives its module`);
  const module = (await import(spec.engineModule)) as Partial<EngineModule>;
  if (typeof module.createDriver !== "function") throw new Error(`${spec.engineModule} has no \`createDriver\``);
  return module.createDriver(spec, write, events);
}
