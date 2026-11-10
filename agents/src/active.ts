// The agents the open views hold now: each agent tab of the workspace, as the Agents side bar
// section lists it (`ui/agents.tsx`), the one its agent used last first and searchable by what it
// says. The window reads a tab and the view around it and gives them here; nothing here imports
// `pumi`.
import { catalogAgent } from "./catalog.ts";

/** An agent tab in an open view, as the Agents section lists it. */
export interface AgentRow {
  /** The tab's id (`%3`). */
  tab: string;
  /** The agent's catalog id (`claude`), and what the menu calls it (`Claude Code`). */
  agent: string;
  agentName: string;
  /** The model it runs (`opus`), while its hook said one. */
  model?: string;
  /** What the tab is called: its own title, else its agent's. */
  title: string;
  /** Where it runs: its tab's directory's last folder (`pumi`). */
  folder?: string;
  /** The view it is in, and the name the user gave it (`undefined` while it has none: an unnamed
   *  view is called after its active tab, which is the agent's own). */
  view: string;
  viewName?: string;
  /** The project it is in, and its folder's name. */
  project: string;
  projectName: string;
  /** When its agent last did something (ms since the epoch), as the plugin stamped it (`names.ts` `ACTIVE`). */
  activeAt?: number;
}

/** What the window reads of a tab, and of the view around it, for a row. */
export interface SeenTab {
  tab: string;
  /** The tab's trait option (`@pumi_dev.agents.agent`): the agent's id, unset for no agent's tab. */
  agent?: unknown;
  /** The trait's field of the same name. */
  model?: unknown;
  /** What the tab is called, its directory, and its `@status`. */
  title?: unknown;
  cwd?: unknown;
  /** The view it is in, and the name the user gave it (`undefined` while it has none). */
  view: string;
  viewName?: unknown;
  /** The project it is in, and its path's last folder. */
  project: string;
  projectFolder?: unknown;
  /** When the plugin last saw its agent do something. */
  activeAt?: unknown;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** The last folder of a path (`/Users/me/pumi` is `pumi`). */
export function folder(path: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

/** A row of an agent tab; `undefined` for a tab that is no agent's. */
export function row(seen: SeenTab): AgentRow | undefined {
  const agent = text(seen.agent);
  if (!agent) return undefined;
  const name = catalogAgent(agent)?.title ?? agent;
  const projectName = text(seen.projectFolder) ?? folder(seen.project) ?? seen.project;
  return {
    tab: seen.tab,
    agent,
    agentName: name,
    model: text(seen.model),
    title: text(seen.title) ?? name,
    folder: folder(text(seen.cwd)),
    view: seen.view,
    viewName: text(seen.viewName),
    project: seen.project,
    projectName,
    activeAt: typeof seen.activeAt === "number" ? seen.activeAt : undefined,
  };
}

/**
 * The rows in the order their agents were used: the one that did something last first, as `ACTIVE`
 * stamps it. One no stamp yet is no older than another, so they keep the order they came in (the
 * workspace's own: projects, their views, their tabs, as `tab.list` has them).
 */
export function latest(rows: readonly AgentRow[]): AgentRow[] {
  const at = (one: AgentRow) => one.activeAt ?? 0;
  return [...rows].sort((a, b) => at(b) - at(a));
}

/** The rows a search keeps: its title, its agent's name and id, its model, and the view, project and folder it is in. */
export function matching(rows: readonly AgentRow[], query: string): AgentRow[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return [...rows];
  const words = wanted.split(/\s+/);
  return rows.filter((one) => {
    const haystack = `${one.title} ${one.agentName} ${one.agent} ${one.model ?? ""} ${one.viewName ?? ""} ${one.projectName} ${one.folder ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
