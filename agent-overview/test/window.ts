// What an agent-overview test reads: the window's own snapshot, with the panes that say what they
// are — two sessions, three agents, one of them blocked, and the panes that are not agents at all.
// A fixture, not an app: nothing of the package's starts.
import type { Snapshot } from "pumi";

/** The snapshot the app hands a window: the same panes, as the app has them. */
export function snapshot(): Snapshot {
  return {
    focused_workspace_id: "$1",
    focused_tab_id: "@10",
    focused_pane_id: "%100",
    workspaces: [
      { workspace_id: "$1", label: "main", active_tab_id: "@10", agent_status: "" },
      { workspace_id: "$2", label: "work", active_tab_id: "@20", agent_status: "" },
    ],
    tabs: [
      { tab_id: "@10", workspace_id: "$1", number: 0, label: "agents", agent_status: "" },
      { tab_id: "@11", workspace_id: "$1", number: 1, label: "build", agent_status: "" },
      { tab_id: "@20", workspace_id: "$2", number: 0, label: "review", agent_status: "" },
    ],
    panes: [
      {
        pane_id: "%100",
        kind: "terminal",
        tab_id: "@10",
        workspace_id: "$1",
        agent: "claude",
        agent_status: "blocked",
        cwd: "/Users/me/Kitchen/pumi",
        terminal_title: "⠋ claude",
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
        pane_id: "%101",
        kind: "terminal",
        tab_id: "@11",
        workspace_id: "$1",
        agent_status: "done",
        cwd: "/Users/me/Kitchen/pumi",
        options: {
          pane_current_path: "/Users/me/Kitchen/pumi",
          pane_current_command: "make",
          "@agent_status": "done",
          "@program_status": [{ id: "", state: "error", msg: "recipe failed" }],
        },
      },
      {
        pane_id: "%200",
        kind: "terminal",
        tab_id: "@20",
        workspace_id: "$2",
        agent: "pi",
        agent_status: "idle",
        cwd: "/Users/me/other",
        terminal_title: "π - other",
        options: { "@agent": "pi", "@agent_status": "idle", pane_current_path: "/Users/me/other", title: "π - other" },
      },
      // A shell nobody reported on: not an agent, so not in the list.
      { pane_id: "%201", kind: "terminal", tab_id: "@20", workspace_id: "$2", agent_status: "", cwd: "/tmp", options: { pane_current_path: "/tmp" } },
    ],
    layouts: [],
  };
}
