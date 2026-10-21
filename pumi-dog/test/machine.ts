// The fake app the dog runs against: its pane, its three options, and no pumi running.
import { join } from "node:path";
import { FakeApp, type FakeOptions } from "pumi/testing";

export const dir = join(import.meta.dir, "..");

export interface Machine {
  /** The panes the app has: the dog's, when it is out. */
  panes?: number[];
  /** Its options, by key (`speed`, `track`, `size`), beyond the manifest's defaults. */
  options?: Record<string, unknown>;
}

/** Starts the fake app with the dog's pane and options as `m` says, its `main` imported. */
export function machine(m: Machine = {}): Promise<FakeApp> {
  const answers: FakeOptions["answers"] = { "pane.list": () => m.panes ?? [] };
  return FakeApp.start({ dir, main: "src/main.ts", answers, options: m.options });
}
