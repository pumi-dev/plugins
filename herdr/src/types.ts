// The objects herdr's results and events carry.
//
// PROVENANCE: herdr `src/api/schema/{common,workspaces,tabs,panes,agents,worktrees,session}.rs`
// @ v0.9.3 (Apache-2.0). A field herdr leaves out when it is empty (a map, a `None`) is left out
// here too, so herdr's clients see herdr's shape.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** What an agent is doing, as herdr names it. */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export const AGENT_STATUSES: AgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

/** The status `value` names, or nothing. */
export function parseAgentStatus(value: string): AgentStatus | undefined {
  return AGENT_STATUSES.find((status) => status === value);
};

export type SplitDirection = "right" | "down";

export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";
export const READ_SOURCES: ReadSource[] = ["visible", "recent", "recent_unwrapped", "detection"];

export type ReadFormat = "text" | "ansi";
export const READ_FORMATS: ReadFormat[] = ["text", "ansi"];

export type WorkspaceInfo = {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
  tokens?: Record<string, string>;
  worktree?: WorkspaceWorktreeInfo;
};

export type WorkspaceWorktreeInfo = {
  repo_key: string;
  repo_name: string;
  repo_root: string;
  checkout_path: string;
  is_linked_worktree: boolean;
};

export type TabInfo = {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus;
};

export type AgentSessionInfo = {
  source: string;
  agent: string;
  /** `id` or `path`. */
  kind: string;
  value: string;
};

export type PaneScrollInfo = {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
  viewport_rows: number;
};

export type PaneInfo = {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd?: string;
  foreground_cwd?: string;
  restore_error?: string;
  label?: string;
  agent?: string;
  title?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  display_agent?: string;
  agent_status: AgentStatus;
  state_labels?: Record<string, string>;
  tokens?: Record<string, string>;
  agent_session?: AgentSessionInfo;
  scroll?: PaneScrollInfo;
  revision: number;
  /** pumi's: what the program says it is doing (OSC 7501), every record, as the pane's
   * `@program_status` has them. Not herdr's; absent when there is none. */
  program_status?: Json[];
};

export type AgentInfo = {
  terminal_id: string;
  name?: string;
  agent?: string;
  title?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  display_agent?: string;
  agent_status: AgentStatus;
  screen_detection_skipped?: boolean;
  state_labels?: Record<string, string>;
  tokens?: Record<string, string>;
  agent_session?: AgentSessionInfo;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  focused: boolean;
  launch_pending?: boolean;
  interactive_ready?: boolean;
  state_change_seq?: number;
  completion_seq?: number;
  cwd?: string;
  foreground_cwd?: string;
  revision: number;
};

/** What a pane is without inspecting its processes: its shell and its tty. */
export type PaneProcessInfo = {
  pane_id: string;
  shell_pid?: number;
  tty?: string;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PaneLayoutSnapshot = {
  workspace_id: string;
  tab_id: string;
  zoomed: boolean;
  area: Rect;
  focused_pane_id: string;
  panes: PaneLayoutPane[];
  splits: PaneLayoutSplit[];
};

export type PaneLayoutPane = {
  pane_id: string;
  focused: boolean;
  rect: Rect;
};

export type PaneLayoutSplit = {
  id: string;
  direction: SplitDirection;
  ratio: number;
  rect: Rect;
};

export type SessionSnapshot = {
  version: string;
  protocol: number;
  focused_workspace_id?: string;
  focused_tab_id?: string;
  focused_pane_id?: string;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: PaneLayoutSnapshot[];
  agents: AgentInfo[];
};
