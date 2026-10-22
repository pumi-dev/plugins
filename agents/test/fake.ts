// What an agents test reads the model from: the answer `server.getState` gives — spaces, tabs and
// panes, and what each pane says of itself. A fixture, not an app: nothing of the package's starts.

/** The model as `server.getState` answers it: two spaces, one of them with two tabs. */
export function state(): Record<string, unknown> {
  return {
    seq: 7,
    state: {
      sessions: [
        { id: 1, name: "pumi", tabs: [[0, 10], [1, 11]], current: 11 },
        { id: 2, name: "site", tabs: [[0, 20]], current: 20 },
      ],
      tabs: [
        { id: 10, name: "", active: 100, layout: ["leaf", 100] },
        { id: 11, name: "editor", active: 101, layout: ["row", [["leaf", 101, 0.5], ["leaf", 102, 0.5]]] },
        { id: 20, name: "", active: 200, layout: ["leaf", 200] },
      ],
      panes: [
        {
          id: 100,
          type: "terminal",
          place: { kind: "tiled", tab: 10 },
          options: { title: "zsh", pane_current_path: "/Users/me/Kitchen/pumi", pane_current_command: "zsh" },
        },
        {
          id: 101,
          type: "terminal",
          place: { kind: "tiled", tab: 11 },
          options: {
            "@agent": "claude",
            "@agent_status": "working",
            title: "π - claude",
            pane_current_path: "/Users/me/Kitchen/pumi",
          },
        },
        {
          id: 102,
          type: "terminal",
          place: { kind: "tiled", tab: 11 },
          options: { title: "vim", pane_current_path: "/Users/me/Kitchen/pumi/src" },
        },
        {
          id: 200,
          type: "terminal",
          place: { kind: "tiled", tab: 20 },
          options: {
            "@agent": "pi",
            "@agent_status": "blocked",
            "@program_status": [{ id: "", state: "blocked", kind: "permission", msg: "Bash(npm publish)?" }],
            title: "π - site",
            pane_current_path: "/Users/me/work/site",
          },
        },
        // A float and a detached pane: not in a tab, so not in the list.
        { id: 300, type: "terminal", place: { kind: "float", tab: 11 }, options: { title: "float" } },
        { id: 301, type: "terminal", place: { kind: "detached" }, options: { title: "detached" } },
      ],
      options: {},
      current: { session: 1, tab: 11, pane: 101 },
    },
  };
}
