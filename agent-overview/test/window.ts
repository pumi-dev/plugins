// What an agent-overview test reads: the panes, tabs and sessions the model is built from — two
// sessions, three agents, one of them blocked, and the panes that are not agents at all. A fixture,
// not an app: nothing of the package's starts.
import type { State } from "../src/overview.ts";

/** The panes, tabs and sessions, as the window has them: the same ids the server gives. */
export function state(): State {
  return {
    spaces: [
      { id: 1, name: "main" },
      { id: 2, name: "work" },
    ],
    tabs: [
      { id: 10, session: 1, name: "agents" },
      { id: 11, session: 1, name: "build" },
      { id: 20, session: 2, name: "review" },
    ],
    panes: [
      {
        id: 100,
        tab: 10,
        session: 1,
        title: "⠋ claude",
        cwd: "/Users/me/Kitchen/pumi",
        options: {
          "@agent": "claude",
          "@agent_status": "blocked",
          "@agent_session": "conv-1",
          pane_current_path: "/Users/me/Kitchen/pumi",
          pane_current_command: "claude",
          "@program_status": [
            { id: "", state: "working", app: "claude" },
            { id: "tool", state: "blocked", kind: "permission", msg: "Bash(rm -rf build)?", app: "claude" },
          ],
        },
      },
      {
        id: 101,
        tab: 11,
        session: 1,
        title: "",
        cwd: "/Users/me/Kitchen/pumi",
        options: {
          pane_current_path: "/Users/me/Kitchen/pumi",
          pane_current_command: "make",
          "@agent_status": "done",
          "@program_status": [{ id: "", state: "error", msg: "recipe failed" }],
        },
      },
      {
        id: 200,
        tab: 20,
        session: 2,
        title: "π - other",
        cwd: "/Users/me/other",
        options: { "@agent": "pi", "@agent_status": "idle", pane_current_path: "/Users/me/other" },
      },
      // A shell nobody reported on: not an agent, so not in the list.
      { id: 201, tab: 20, session: 2, title: "", cwd: "/tmp", options: { pane_current_path: "/tmp" } },
      // A float that reports: in no tab, so not in the list either.
      { id: 300, tab: null, session: null, title: "float", cwd: "/tmp", options: { "@agent": "claude", "@agent_status": "blocked" } },
    ],
    here: 100,
  };
}
