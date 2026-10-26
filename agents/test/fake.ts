// What an agents test reads the model from: the window's state — sessions, tabs and panes, and
// what each pane says of itself. A fixture, not an app: nothing of the package's starts.
import type { Given } from "../src/snapshot.ts";

/** The window's state: two spaces, one of them with two tabs, and a float and a detached pane. */
export function state(): Given {
  return {
    spaces: [
      { id: 1, label: "pumi", current: 11, focused: true },
      { id: 2, label: "site", current: 20, focused: false },
    ],
    tabs: [
      { id: 10, space: 1, index: 0, label: "Tab 1", focused: false },
      { id: 11, space: 1, index: 1, label: "editor", focused: true },
      { id: 20, space: 2, index: 0, label: "Tab 1", focused: false },
    ],
    // Each tab's panes in the order its layout lays them out, then the panes in no tab: a float
    // and a detached pane have none, so they are in no space.
    panes: [
      {
        id: 100,
        block: "terminal",
        tab: 10,
        space: 1,
        title: "zsh",
        cwd: "/Users/me/Kitchen/pumi",
        label: "",
        options: { title: "zsh", pane_current_path: "/Users/me/Kitchen/pumi", pane_current_command: "zsh" },
        focused: false,
      },
      {
        id: 101,
        block: "terminal",
        tab: 11,
        space: 1,
        title: "π - claude",
        cwd: "/Users/me/Kitchen/pumi",
        label: "",
        options: {
          "@agent": "claude",
          "@agent.status": "working",
          title: "π - claude",
          pane_current_path: "/Users/me/Kitchen/pumi",
        },
        focused: true,
      },
      {
        id: 102,
        block: "terminal",
        tab: 11,
        space: 1,
        title: "vim",
        cwd: "/Users/me/Kitchen/pumi/src",
        label: "",
        options: { title: "vim", pane_current_path: "/Users/me/Kitchen/pumi/src" },
        focused: false,
      },
      {
        id: 200,
        block: "terminal",
        tab: 20,
        space: 2,
        title: "π - site",
        cwd: "/Users/me/work/site",
        label: "",
        options: {
          "@agent": "pi",
          "@agent.status": "blocked",
          "@program_status": [{ id: "", state: "blocked", kind: "permission", msg: "Bash(npm publish)?" }],
          title: "π - site",
          pane_current_path: "/Users/me/work/site",
        },
        focused: false,
      },
      {
        id: 300,
        block: "terminal",
        tab: null,
        space: null,
        title: "float",
        cwd: "/Users/me/Kitchen/pumi",
        label: "",
        options: { title: "float" },
        focused: false,
      },
      {
        id: 301,
        block: "terminal",
        tab: null,
        space: null,
        title: "detached",
        cwd: "/Users/me/Kitchen/pumi",
        label: "",
        options: { title: "detached" },
        focused: false,
      },
    ],
  };
}
