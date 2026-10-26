// What the tests read the model from: sessions, tabs and panes, and what each pane says of itself.
// A fixture, not an app: nothing of the package's starts, and no pumi needs to be running.
import type { Given } from "../src/snapshot.ts";

/** The model: two spaces, one of them with two tabs, and a float and a detached pane. */
export function state(): Given {
  return {
    spaces: [
      { id: 1, label: "pumi", focused: true },
      { id: 2, label: "site", focused: false },
    ],
    tabs: [
      { id: 10, space: 1, index: 0, label: "Tab 1" },
      { id: 11, space: 1, index: 1, label: "editor" },
      { id: 20, space: 2, index: 0, label: "Tab 1" },
    ],
    // Each tab's panes in the order its layout lays them out, then the panes in no tab: a float
    // and a detached pane have none, so they are in no space.
    panes: [
      {
        id: 100,
        tab: 10,
        space: 1,
        title: "zsh",
        cwd: "/Users/me/Kitchen/pumi",
        label: "",
        options: { title: "zsh", pane_current_path: "/Users/me/Kitchen/pumi", pane_current_command: "zsh" },
      },
      {
        id: 101,
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
      },
      {
        id: 102,
        tab: 11,
        space: 1,
        title: "vim",
        cwd: "/Users/me/Kitchen/pumi/src",
        label: "",
        options: { title: "vim", pane_current_path: "/Users/me/Kitchen/pumi/src" },
      },
      {
        id: 200,
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
      },
      {
        id: 300,
        tab: null,
        space: null,
        title: "float",
        cwd: "/Users/me/Kitchen/pumi",
        label: "",
        options: { title: "float" },
      },
      {
        id: 301,
        tab: null,
        space: null,
        title: "detached",
        cwd: "/Users/me/Kitchen/pumi",
        label: "",
        options: { title: "detached" },
      },
    ],
  };
}
