// The fake app an agent-overview test reads: the model `server.getState` answers with, the panes
// there are, and the package's options.
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

export const dir = join(import.meta.dir, "..");

/** A model as `server.getState` answers it: two sessions, three agents, one of them blocked. */
export function state(): Record<string, unknown> {
  return {
    seq: 12,
    state: {
      sessions: [
        { id: 1, name: "main", tabs: [[0, 10], [1, 11]], current: 10 },
        { id: 2, name: "work", tabs: [[0, 20]], current: 20 },
      ],
      tabs: [
        { id: 10, name: "agents", active: 100 },
        { id: 11, name: "build", active: 101 },
        { id: 20, name: "review", active: 200 },
      ],
      panes: [
        {
          id: 100,
          type: "terminal",
          place: { kind: "tiled", tab: 10 },
          options: {
            "@agent": "claude",
            "@agent_status": "blocked",
            "@agent_session": "conv-1",
            pane_current_path: "/Users/me/Kitchen/pumi",
            pane_current_command: "claude",
            title: "⠋ claude",
            "@program_status": [
              { id: "", state: "working", app: "claude" },
              { id: "tool", state: "blocked", kind: "permission", msg: "Bash(rm -rf build)?", app: "claude" },
            ],
          },
        },
        {
          id: 101,
          type: "terminal",
          place: { kind: "tiled", tab: 11 },
          options: {
            pane_current_path: "/Users/me/Kitchen/pumi",
            pane_current_command: "make",
            "@agent_status": "done",
            "@program_status": [{ id: "", state: "error", msg: "recipe failed" }],
          },
        },
        {
          id: 200,
          type: "terminal",
          place: { kind: "tiled", tab: 20 },
          options: { "@agent": "pi", "@agent_status": "idle", pane_current_path: "/Users/me/other", title: "π - other" },
        },
        { id: 201, type: "terminal", place: { kind: "tiled", tab: 20 }, options: { pane_current_path: "/tmp" } },
        { id: 202, type: "terminal", place: { kind: "float" }, options: { "@agent": "pi", "@agent_status": "working" } },
        { id: 203, type: "agent-overview.overview", place: { kind: "tiled", tab: 20 }, options: {} },
        { id: 204, type: "terminal", place: { kind: "detached" }, options: { "@agent": "pi", "@agent_status": "working" } },
      ],
      current: { session: 1, tab: 10, pane: 100 },
    },
  };
}

/** What the fake app answers beyond the model: the view's panes open, and its options. */
export interface Machine {
  /** The model `server.getState` answers with. */
  state?: unknown;
  /** The panes of the package's view that are open, by id. */
  open?: number[];
  /** The package's options, by key (`poll_secs`, `hide_idle`, …). */
  options?: Record<string, unknown>;
  /** The package's `main`, for a test of the package as it starts. */
  main?: string;
}

/** Starts the fake app on `machine`'s model. */
export function machine(m: Machine = {}): Promise<FakeApp> {
  return FakeApp.start({
    dir,
    main: m.main,
    options: m.options,
    answers: {
      "server.getState": m.state ?? state(),
      "pane.list": m.open ?? [],
    },
  });
}
