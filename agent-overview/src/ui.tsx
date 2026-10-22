// What the dashboard draws, in the window's React tree: the rail that narrows the list by state and
// by name, a row per agent, and — beside it — the agent picked, its place and why it waits, or every
// agent as a table by session. The agents are the app's own panes (`useAgents` and the snapshot's
// `@program_status`), read through `overview.ts`; a press goes to a pane with `pane.select`.
import { useMemo, useState } from "react";
import { Icon, call, num, useApp, useMetrics, useTheme, type Snapshot as Window } from "pumi";

import { Overview, folder, path, place, type Agent } from "./overview.ts";
import { FILTERS, filterLabel, needsYou, statusLabel, type Filter, type Status } from "./status.ts";

/** A throw the dashboard cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`agent-overview: ${err instanceof Error ? err.message : String(err)}`);
}

/** The `overview` view: the rail, and the table or the agent picked. */
export function Dashboard({ pane }: { pane: string }) {
  const t = useTheme();
  const app = useApp((s) => s.snapshot);
  const model = useMemo(() => Overview.fromWindow(app as Window | undefined), [app]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number | null>(null);

  const visible = model.visible(filter, query);
  const chosen = visible.find((agent) => agent.pane === picked);

  /** A press on an agent: the first picks it, the second goes to its pane. */
  const press = (agent: Agent) => {
    if (picked === agent.pane) {
      void call("pane.select", { to: agent.pane }).catch(swallow);
      return;
    }
    setPicked(agent.pane);
  };

  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100%", height: "100%", minWidth: 0, minHeight: 0, backgroundColor: t.editor, color: t.text }}>
      <Rail
        model={model}
        visible={visible}
        filter={filter}
        query={query}
        picked={picked}
        onFilter={setFilter}
        onQuery={setQuery}
        onPress={press}
      />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
        <Cards model={model} />
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", padding: 12, gap: 10 }}>
          {chosen ? <Brief agent={chosen} shown={pane} /> : <Table agents={visible} onPress={press} />}
        </div>
      </div>
    </div>
  );
}

/** The left rail: the filters, then the agents by session. */
function Rail({
  model,
  visible,
  filter,
  query,
  picked,
  onFilter,
  onQuery,
  onPress,
}: {
  model: Overview;
  visible: Agent[];
  filter: Filter;
  query: string;
  picked: number | null;
  onFilter(filter: Filter): void;
  onQuery(text: string): void;
  onPress(agent: Agent): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  const groups = model.groups(filter, query);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 280, flexShrink: 0, minHeight: 0, backgroundColor: t.surface, borderRightWidth: 1, borderColor: t.border }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 30, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderBottomWidth: 1, borderColor: t.border }}>
        <Icon name="search" size={12} color={t.faint} />
        <input
          value={query}
          placeholder="Search agents…"
          onChange={(e: any) => onQuery(e?.value ?? "")}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 22, fontSize: 12, color: t.text }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, paddingTop: 4, paddingBottom: 4 }}>
        {FILTERS.map((each) => {
          const count = each === "all" ? model.total() : model.agents.filter((agent) => matchesFilter(each, agent.status)).length;
          const active = each === filter;
          return (
            <div
              key={each}
              onClick={() => onFilter(each)}
              style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 26, paddingLeft: 10, paddingRight: 10, cursor: "pointer", backgroundColor: active ? t.selected : undefined, hover: { backgroundColor: active ? t.selected : t.hover } }}
            >
              <text style={{ fontSize: 12, color: active ? t.text : t.muted, flexGrow: 1 }}>{filterLabel(each)}</text>
              <text style={{ fontSize: 11, color: t.faint }}>{String(count)}</text>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", borderTopWidth: 1, borderColor: t.border }}>
        {groups.map((group) => (
          <div key={group.session} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 10, paddingRight: 10 }}>
              <text style={{ fontSize: 11, fontWeight: 600, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {group.name || `$${group.session}`}
              </text>
            </div>
            {group.agents.map((agent) => (
              <div
                key={agent.pane}
                onClick={() => onPress(agent)}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingLeft: 14, paddingRight: 10, flexShrink: 0, cursor: "pointer", borderRadius: m.radiusSmall, backgroundColor: picked === agent.pane ? t.selected : undefined, hover: { backgroundColor: picked === agent.pane ? t.selected : t.hover } }}
              >
                <Dot status={agent.status} />
                <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                  <text style={{ fontSize: 12, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {`${agent.kind || agent.command || "terminal"}${agent.title === "" ? "" : ` · ${agent.title}`}`}
                  </text>
                </div>
                {agent.here ? <text style={{ fontSize: 10, color: t.accent }}>here</text> : null}
                <text style={{ fontSize: 10, color: t.faint }}>{folder(agent)}</text>
              </div>
            ))}
          </div>
        ))}
        {visible.length === 0 ? (
          <text style={{ paddingLeft: 12, paddingTop: 8, fontSize: 11, color: t.faint }}>No agents match</text>
        ) : null}
      </div>
    </div>
  );
}

/** The counts across the top: what is working, what wants you, and how many sessions they are in. */
function Cards({ model }: { model: Overview }) {
  const t = useTheme();
  const m = useMetrics();
  const cards: { title: string; count: number; caption: string; tone: string }[] = [
    { title: "Working", count: model.count("working"), caption: "turning", tone: t["agent.working"] ?? t.accent },
    { title: "Needs you", count: model.needsYou(), caption: "blocked or failed", tone: t["agent.blocked"] ?? t.warning },
    { title: "Sessions", count: model.sessions(), caption: "with agents", tone: t.muted },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 10, flexShrink: 0, padding: 12, borderBottomWidth: 1, borderColor: t.border }}>
      {cards.map((card) => (
        <div key={card.title} style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, padding: 10, borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}>
          <text style={{ fontSize: 11, color: t.muted }}>{card.title}</text>
          <text style={{ fontSize: 22, fontWeight: 600, color: card.count === 0 ? t.faint : card.tone }}>{String(card.count)}</text>
          <text style={{ fontSize: 10, color: t.faint }}>{card.caption}</text>
        </div>
      ))}
    </div>
  );
}

/** One agent, in full: what it is, where it is, why it waits, and what it last said. */
function Brief({ agent, shown }: { agent: Agent; shown: string }) {
  const t = useTheme();
  const m = useMetrics();
  const tone = t[`agent.${agent.status}`] ?? t["agent.unknown"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Dot status={agent.status} size={10} />
        <text style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{agent.title || agent.kind || `%${agent.pane}`}</text>
        <text style={{ fontSize: 12, color: tone }}>{statusLabel(agent.status)}</text>
        <div style={{ flexGrow: 1 }} />
        <div
          onClick={() => void call("pane.select", { to: agent.pane }).catch(swallow)}
          style={{ display: "flex", paddingLeft: 8, paddingRight: 8, height: 24, alignItems: "center", borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: t.active, hover: { backgroundColor: t.hover } }}
        >
          <text style={{ fontSize: 12, color: t.text }}>Go to the pane</text>
        </div>
      </div>
      {agent.why !== "" ? <text style={{ fontSize: 12, color: tone }}>{agent.why}</text> : null}
      <Row label="Where" value={place(agent)} />
      <Row label="Directory" value={path(agent)} />
      <Row label="Agent" value={agent.kind || agent.command || "terminal"} />
      {agent.conversation !== "" ? <Row label="Session" value={agent.conversation} /> : null}
      {agent.message !== "" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
          <text style={{ fontSize: 11, color: t.muted }}>It said</text>
          <text style={{ fontSize: 12, color: t.text }}>{agent.message}</text>
        </div>
      ) : null}
      <text style={{ fontSize: 10, color: t.faint }}>{`pane %${agent.pane} · drawn in ${shown === "" ? "the window" : "this tab"}`}</text>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
      <div style={{ display: "flex", width: 80, flexShrink: 0 }}>
        <text style={{ fontSize: 11, color: t.muted }}>{label}</text>
      </div>
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
        <text style={{ fontSize: 12, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{value}</text>
      </div>
    </div>
  );
}

/** Every agent the rail lets through, as a table. */
function Table({ agents, onPress }: { agents: Agent[]; onPress(agent: Agent): void }) {
  const t = useTheme();
  const m = useMetrics();
  if (agents.length === 0) return <text style={{ fontSize: 12, color: t.faint }}>No agents yet: start one in a terminal and it says so here.</text>;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, overflow: "hidden" }}>
      {agents.map((agent) => (
        <div
          key={agent.pane}
          onClick={() => onPress(agent)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: 30, paddingLeft: 12, paddingRight: 12, flexShrink: 0, cursor: "pointer", borderBottomWidth: 1, borderColor: t.border, hover: { backgroundColor: t.hover } }}
        >
          <Dot status={agent.status} />
          <div style={{ display: "flex", width: 180, flexShrink: 0, minWidth: 0 }}>
            <text style={{ fontSize: 12, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{agent.kind || agent.command || "terminal"}</text>
          </div>
          <div style={{ display: "flex", width: 90, flexShrink: 0 }}>
            <text style={{ fontSize: 11, color: t[`agent.${agent.status}`] ?? t.muted }}>{statusLabel(agent.status)}</text>
          </div>
          <div style={{ display: "flex", width: 170, flexShrink: 0, minWidth: 0 }}>
            <text style={{ fontSize: 11, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{place(agent)}</text>
          </div>
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
            <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{agent.why || agent.title || folder(agent)}</text>
          </div>
          {agent.here ? <text style={{ fontSize: 10, color: t.accent }}>here</text> : null}
        </div>
      ))}
    </div>
  );
}

/** A state's mark: a dot in the theme's colour for it. */
function Dot({ status, size = 8 }: { status: Status; size?: number }) {
  const t = useTheme();
  return <div style={{ width: size, height: size, flexShrink: 0, borderRadius: size, backgroundColor: t[`agent.${status}`] ?? t["agent.unknown"] }} />;
}

/** Whether a status is one a filter shows. */
function matchesFilter(filter: Filter, status: Status): boolean {
  if (filter === "all") return true;
  if (filter === "needs-you") return needsYou(status);
  if (filter === "working") return status === "working";
  return status === "idle" || status === "done";
}

/** Kept for the package's own calls: the pane id of an agent, as the API writes it. */
export const paneOf = num;
