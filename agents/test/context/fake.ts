// What the tests read the model from: sessions, their views, panes and tabs, as `session.get` with
// `deep` carries them — the API's own names, so a walk over `tabs` or a `pane` at the wrong level
// fails here as it would in the app. A fixture, not an app: nothing of the package starts, and no
// pumi needs to be running.
import type { GivenSession } from "../../src/context/snapshot.ts";

/**
 * Two sessions. `$1` has two views: `@1` split in two panes (`:4` with a shell, `:5` with an agent
 * and an editor) and a float, and `@2` a pane zoomed on a log. `$2` has `@3`, whose one tab is an
 * agent that is blocked.
 */
export function sessions(): GivenSession[] {
  return [
    {
      id: "$1",
      name: "pumi",
      views: ["@1", "@2"],
      activeView: "@1",
      tree: [
        {
          id: "@1",
          session: "$1",
          name: "main",
          index: 0,
          layout: {
            axis: "row",
            ratio: 0.5,
            first: { pane: ":4", tabs: ["%10"], active: "%10" },
            second: { pane: ":5", tabs: ["%11", "%12"], active: "%11" },
          },
          activeTab: "%11",
          activePane: ":5",
          zoom: null,
          tabs: [
            {
              id: "%10",
              session: "$1",
              view: "@1",
              block: "terminal",
              place: { kind: "tiled", view: "@1", pane: ":4" },
              title: "zsh",
              cwd: "/Users/me/Kitchen/pumi",
              isFocused: false,
              options: { title: "zsh", pane_current_path: "/Users/me/Kitchen/pumi" },
            },
            {
              id: "%11",
              session: "$1",
              view: "@1",
              block: "terminal",
              place: { kind: "tiled", view: "@1", pane: ":5" },
              title: "π - claude",
              cwd: "/Users/me/Kitchen/pumi",
              isFocused: true,
              options: { "@agent": "claude", "@agent.status": "working", title: "π - claude" },
            },
            {
              id: "%12",
              session: "$1",
              view: "@1",
              block: "terminal",
              place: { kind: "tiled", view: "@1", pane: ":5" },
              title: "vim",
              cwd: "/Users/me/Kitchen/pumi/src",
              isFocused: false,
              options: { title: "vim" },
            },
            {
              id: "%13",
              session: "$1",
              view: "@1",
              block: "terminal",
              place: { kind: "float", view: "@1", pane: null },
              title: "notes",
              cwd: "/Users/me/tmp",
              isFocused: false,
              options: { title: "notes" },
            },
          ],
        },
        {
          id: "@2",
          session: "$1",
          name: "logs",
          index: 1,
          layout: { pane: ":6", tabs: ["%14"], active: "%14" },
          activeTab: "%14",
          activePane: ":6",
          zoom: ":6",
          tabs: [
            {
              id: "%14",
              session: "$1",
              view: "@2",
              block: "terminal",
              place: { kind: "tiled", view: "@2", pane: ":6" },
              title: "tail",
              cwd: "/var/log",
              isFocused: false,
              options: { title: "tail" },
            },
          ],
        },
      ],
    },
    {
      id: "$2",
      name: "site",
      views: ["@3"],
      activeView: "@3",
      tree: [
        {
          id: "@3",
          session: "$2",
          name: null,
          index: 0,
          layout: { pane: ":7", tabs: ["%20"], active: "%20" },
          activeTab: "%20",
          activePane: ":7",
          zoom: null,
          tabs: [
            {
              id: "%20",
              session: "$2",
              view: "@3",
              block: "terminal",
              place: { kind: "tiled", view: "@3", pane: ":7" },
              title: "π - site",
              cwd: "/Users/me/work/site",
              isFocused: false,
              options: {
                "@agent": "pi",
                "@agent.status": "blocked",
                "@program_status": [{ id: "", state: "blocked", kind: "permission", msg: "Bash(npm publish)?" }],
                title: "π - site",
              },
            },
          ],
        },
      ],
    },
  ];
}
