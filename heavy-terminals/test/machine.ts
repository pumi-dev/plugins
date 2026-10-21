// The fake app a heavy-terminals test measures against: its terminal panes, each running a program,
// the processes of the machine, and the package's options.
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

export const dir = join(import.meta.dir, "..");

/** What the fake app answers. */
export interface Machine {
  /** The terminal panes it has. */
  panes?: number[];
  /** Each pane's program: pane → pid. */
  pids?: Record<number, number>;
  /** The package's options, by key (`cpu`, `sustain`, `auto_sleep`, …). */
  options?: Record<string, unknown>;
  /** What `system.process.list` lists. */
  processes?: unknown[];
  /** The package's `main`, for a test of the package as it starts. */
  main?: string;
}

/** Starts the fake app on a machine of `panes`, each running the program `pids` names. */
export function machine(m: Machine = {}): Promise<FakeApp> {
  const options: Record<string, unknown> = {
    interval: 5,
    cpu: 150,
    memory: 4096,
    sustain: 3,
    auto_sleep: false,
    ...m.options,
  };
  const pids = m.pids ?? {};
  return FakeApp.start({
    dir,
    main: m.main,
    answers: {
      "pane.list": m.panes ?? [],
      // The names cross prefixed (`local.heavy_terminals.cpu`): the option is what follows the dot.
      "option.get": (name: string, opts: { pane?: number } = {}) => {
        const key = name.split(".").at(-1) ?? name;
        return key === "pane_pid" ? (pids[opts.pane ?? -1] ?? null) : (options[key] ?? null);
      },
      "system.process.list": m.processes ?? [],
    },
  });
}
