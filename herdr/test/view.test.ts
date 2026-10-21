// pumi's sessions, tabs and panes as herdr's workspaces, tabs and panes: each object's shape, the
// ids read off pumi's numbers, and the status a pane rolls up to.
import { expect, test } from "bun:test";
import type { Json } from "../src/types.ts";
import { View } from "../src/view.ts";

/** session $5 with tabs @7 and @8, session $6 with tab @9, and a float that is no tab's. */
const state: Json = {
  sessions: [
    { id: 5, name: "main", tabs: [[0, 7], [1, 8]], current: 8, cwd: null, last: null, activity: {}, created: 0 },
    { id: 6, name: "other", tabs: [[0, 9]], current: 9 },
  ],
  tabs: [
    { id: 7, name: null, layout: ["row", [["leaf", 1, 0.5], ["leaf", 2, 0.5]]], active: 1, last: null, zoomed: false },
    { id: 8, name: "logs", layout: ["leaf", 3], active: 3, last: null, zoomed: true },
    { id: 9, name: null, layout: ["leaf", 4], active: 4, last: null, zoomed: false },
  ],
  panes: [
    { id: 1, type: "terminal", place: { kind: "tiled", tab: 7 }, activity: {}, options: { title: "zsh", pane_current_path: "/tmp", pane_pid: 42, pane_tty: "/dev/ttys001" } },
    { id: 2, type: "terminal", place: { kind: "tiled", tab: 7 }, options: { "@agent": "claude", "@agent_status": "working", "@label": "worker" } },
    { id: 3, type: "terminal", place: { kind: "tiled", tab: 8 }, options: { "@agent_status": "error", "@program_status": [{ state: "done" }] } },
    { id: 4, type: "terminal", place: { kind: "tiled", tab: 9 }, options: {} },
    { id: 90, type: "terminal", place: { kind: "float", tab: 7 }, options: {} },
  ],
  options: {},
  current: { session: 5, tab: 7, pane: 1 },
};

const view = () => View.fromState(state);

test("a session is a workspace, numbered by the order it came in", () => {
  expect(view().workspaceInfo(5)).toEqual({
    workspace_id: "w5",
    number: 1,
    label: "main",
    focused: true,
    pane_count: 3,
    tab_count: 2,
    active_tab_id: "w5:t8",
    agent_status: "working",
  });
  expect(view().workspaceInfo(6)).toEqual({
    workspace_id: "w6",
    number: 2,
    label: "other",
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: "w6:t9",
    agent_status: "unknown",
  });
  expect(view().workspaceInfo(7)).toBeUndefined();
});

test("a tab is a tab: its label is its name, else its pane's title, else its number", () => {
  expect(view().tabInfo(7)).toEqual({
    tab_id: "w5:t7",
    workspace_id: "w5",
    number: 1,
    label: "zsh",
    focused: true,
    pane_count: 2,
    agent_status: "working",
  });
  expect(view().tabInfo(8)).toEqual({
    tab_id: "w5:t8",
    workspace_id: "w5",
    number: 2,
    label: "logs",
    focused: false,
    pane_count: 1,
    agent_status: "done",
  });
  expect(view().tabInfo(9)?.label).toBe("1");
});

test("a pane is a pane, with nothing empty in it", () => {
  expect(view().paneInfo(1, 3)).toEqual({
    pane_id: "w5:p1",
    terminal_id: "term_1",
    workspace_id: "w5",
    tab_id: "w5:t7",
    focused: true,
    cwd: "/tmp",
    title: "zsh",
    terminal_title: "zsh",
    terminal_title_stripped: "zsh",
    agent_status: "unknown",
    revision: 3,
  });
  expect(view().paneInfo(2, 0)).toEqual({
    pane_id: "w5:p2",
    terminal_id: "term_2",
    workspace_id: "w5",
    tab_id: "w5:t7",
    focused: false,
    label: "worker",
    agent: "claude",
    display_agent: "claude",
    agent_status: "working",
    revision: 0,
  });
  // herdr has no `error`: a failed program is `done`, and pumi's own record says the rest.
  expect(view().paneInfo(3, 0)?.agent_status).toBe("done");
  expect(view().paneInfo(3, 0)?.program_status).toEqual([{ state: "done" }]);
  // A float is in no tab, so it is no pane of herdr's.
  expect(view().paneInfo(90, 0)).toBeUndefined();
});

test("an agent is a pane's @agent, with the pane around it", () => {
  expect(view().agentInfo(2)).toEqual({
    terminal_id: "term_2",
    name: "worker",
    agent: "claude",
    display_agent: "claude",
    agent_status: "working",
    workspace_id: "w5",
    tab_id: "w5:t7",
    pane_id: "w5:p2",
    focused: false,
    interactive_ready: true,
    state_change_seq: 0,
    revision: 0,
  });
  expect(view().agentInfo(1)).toBeUndefined();
});

test("what herdr lists is the panes in tabs, in order", () => {
  expect(view().tiled()).toEqual([1, 2, 3, 4]);
  const snapshot = view().snapshot((pane) => pane * 10);
  expect(snapshot.version).toBe("0.9.4");
  expect(snapshot.protocol).toBe(22);
  expect(snapshot.focused_workspace_id).toBe("w5");
  expect(snapshot.focused_tab_id).toBe("w5:t7");
  expect(snapshot.focused_pane_id).toBe("w5:p1");
  expect(snapshot.workspaces).toHaveLength(2);
  expect(snapshot.tabs.map((tab) => tab.tab_id)).toEqual(["w5:t7", "w5:t8", "w6:t9"]);
  expect(snapshot.panes.map((pane) => [pane.pane_id, pane.revision])).toEqual([
    ["w5:p1", 10],
    ["w5:p2", 20],
    ["w5:p3", 30],
    ["w6:p4", 40],
  ]);
  expect(snapshot.layouts).toEqual([]);
  expect(snapshot.agents.map((agent) => agent.pane_id)).toEqual(["w5:p2"]);
});

test("herdr's ids and pumi's name the same tab and pane", () => {
  expect(view().session("w5")).toBe(5);
  expect(view().session("$5")).toBe(5);
  expect(view().session("w9")).toBeUndefined();
  expect(view().session("nobody")).toBeUndefined();
  expect(view().tab("w5:t7")).toBe(7);
  expect(view().tab("@8")).toBe(8);
  expect(view().tab("w5:t4")).toBeUndefined();
  expect(view().pane("w5:p2")).toBe(2);
  expect(view().pane("term_3")).toBe(3);
  expect(view().pane("%4")).toBe(4);
  expect(view().pane("%91")).toBeUndefined();
  expect(view().tabId(9)).toBe("w6:t9");
  expect(view().paneId(2)).toBe("w5:p2");
  expect(view().paneId(4)).toBe("w6:p4");
});

test("nothing to show is an empty view", () => {
  const empty = View.fromState(undefined);
  expect(empty.snapshot(() => 0)).toEqual({
    version: "0.9.4",
    protocol: 22,
    workspaces: [],
    tabs: [],
    panes: [],
    layouts: [],
    agents: [],
  });
});
