// The `panel` slot's Agents section: every agent tab the open views hold now, a row for each
// under the view it is in, and a search over them. A press brings its tab up, where its own chat
// or terminal is. History is the way back into a session; this is the way to one running.
import { useState } from "react";
import { Icon, TabIcon, call, useMetrics, useTabStatus, useTabs, useTheme, useWindow } from "pumi";

import { folder, latest, matching, row, type AgentRow } from "../active.ts";
import { ago } from "../history.ts";
import { ACTIVE, AGENT } from "../names.ts";

/** The trait whose tabs this lists: the plugin's own, as `tab.list` names it. */
const TRAIT = AGENT.slice(1);

/** What a status is called in a row's mark: what the agent is doing. */
const STATUS_WORD: Record<string, string> = {
  working: "working",
  blocked: "waiting on you",
  error: "failed",
  done: "done",
};

function swallow(err: unknown): void {
  console.error(`agents: ${err instanceof Error ? err.message : String(err)}`);
}

export function Agents() {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");
  const tabs = useTabs({ trait: TRAIT });
  // Read afresh: the section is drawn again when a tab, its view or its trait changes.
  const rows = tabs.flatMap((tab) => {
    const view = tab.view;
    // A model reached through another's field may not be filled yet (`Model.ready`): its id is, its
    // path is not, so a row waits for a tab whose project is read.
    const project = tab.project as { id: string; path?: string } | null;
    if (!view || !project) return [];
    const options = (tab.options ?? {}) as Record<string, unknown>;
    const fields = ((tab.traits ?? {}) as Record<string, Record<string, unknown> | undefined>)[TRAIT];
    const one = row({
      tab: tab.id,
      agent: options[AGENT],
      model: fields?.model,
      title: tab.title,
      cwd: tab.foregroundCwd || tab.cwd,
      activeAt: options[ACTIVE],
      view: view.id,
      viewName: view.name,
      project: project.id,
      projectFolder: folder(project.path),
    });
    return one ? [one] : [];
  });
  const shown = latest(matching(rows, query));
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: t.surface }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: "100%", height: 34, flexShrink: 0, paddingLeft: 12, paddingRight: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.border }}>
        <Icon name="magnifying_glass" size={14} color={focused ? t.muted : t.faint} />
        <input
          aria-label="Search agents"
          value={query}
          placeholder="Search agents…"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setQuery(e.value ?? "")}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 22, fontSize: 13, color: t.text, backgroundColor: "transparent" }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingBottom: 6 }}>
        {shown.length === 0 ? (
          <text style={{ fontSize: 12, color: t.faint, paddingLeft: 14, paddingRight: 10, paddingTop: 4 }}>
            {rows.length === 0 ? "No agents in the views open now. Start one from the + menu." : "Nothing matches that."}
          </text>
        ) : (
          shown.map((agent) => <Row key={agent.tab} agent={agent} />)
        )}
      </div>
    </div>
  );
}

/** The model's own name of a model id (`openrouter/deepseek/deepseek-chat` is `deepseek-chat`). */
function short(model: string): string {
  const parts = model.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? model;
}

/**
 * What a row says under the name: its agent, where it runs (the folder, else the view's name, when
 * the user gave it one), and when it last did something — the order's own reason. The model is in
 * the tooltip, where it does not push these off the row.
 */
function detail(agent: AgentRow): string {
  return [agent.agentName, agent.folder ?? agent.viewName, agent.activeAt ? ago(agent.activeAt) : undefined].filter((part): part is string => !!part).join(" · ");
}

/** All a row knows, for its tooltip: the agent and its model, where it runs, its named view, and when. */
function tip(agent: AgentRow): string {
  return [agent.agentName, agent.model ? short(agent.model) : undefined, agent.folder, agent.viewName, agent.activeAt ? ago(agent.activeAt) : undefined].filter((part): part is string => !!part).join(" · ");
}

/** One agent: its mark (or its status), its name, and what it is doing. A press shows its view and
 *  brings its tab up. */
function Row({ agent }: { agent: AgentRow }) {
  const t = useTheme();
  const m = useMetrics();
  const window = useWindow();
  const status = useTabStatus(agent.tab);
  const doing = status ? STATUS_WORD[status] : undefined;
  const color = status ? (t[`status.${status}`] ?? t["status.unknown"]) : undefined;
  // Its view first, in this window (as the side bar's own rows do), then the tab in its pane: the
  // focus alone leaves the window where it is.
  const open = () => {
    window.show(agent.project, agent.view);
    void call("tab.focus", agent.tab).catch(swallow);
  };
  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-label={`${agent.title}: ${detail(agent)}${doing ? `, ${doing}` : ""}`}
      title={`${agent.title}\n${tip(agent)}`}
      onClick={open}
      onKeyDown={(event: { key?: string }) => (event.key === "enter" ? open() : undefined)}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, paddingLeft: 12, paddingRight: 10, paddingTop: 5, paddingBottom: 5, cursor: "pointer", hover: { backgroundColor: t.hover } }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, flexShrink: 0 }}>
        <TabIcon tab={agent.tab} size={14} color={t.muted} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <text style={{ fontSize: m.fontSize, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{agent.title}</text>
        <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{detail(agent)}</text>
      </div>
      {/* What it does, while it does something: a worker or one waiting on the user. */}
      {doing && color ? <div aria-label={doing} title={doing} style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, backgroundColor: color }} /> : null}
    </div>
  );
}
