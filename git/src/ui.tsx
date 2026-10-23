// What the git page draws, in the window's React tree: the branch and what the changes add up to,
// the two groups of the tree — staged and unstaged, conflicts on top — a row a path with its mark,
// its checkbox and its stats, the commit box under them, and the history beside them as a tab. The
// repository, the rows and every action are the worker's (`main.ts`, `panel.ts`, `tree.ts`).
import { useEffect, useState } from "react";
import { Icon, useFocusedPane, useMetrics, usePane, useTheme } from "pumi";

import { changes, chose, composing, filtered, history, picked, pressed, typed, type ChangesView, type GroupView, type HistoryView } from "./main.ts";
import type { Row } from "./tree.ts";
import { when } from "./time.ts";

/** A row's height, in pixels. */
const ROW = 26;
/** A directory level's indent. */
const INDENT = 16;

/** A row's action in words, as its menu shows it. */
const LABELS: Record<string, string> = {
  stage: "Stage",
  unstage: "Unstage",
  "stage-all": "Stage All",
  "unstage-all": "Unstage All",
  discard: "Discard",
  ignore: "Ignore",
  ours: "Ours",
  theirs: "Theirs",
  commit: "Commit",
  publish: "Publish",
};

/** A throw the page cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`git: ${err instanceof Error ? err.message : String(err)}`);
}

/** The `panel` slot's view: the changes, and the history as a tab of the same page. */
export function Git() {
  const t = useTheme();
  const m = useMetrics();
  const focused = usePane(useFocusedPane());
  const cwd = focused?.cwd ?? "/";
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [view, setView] = useState<ChangesView | undefined>(undefined);
  const [past, setPast] = useState<HistoryView | undefined>(undefined);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; actions: string[]; id: string } | null>(null);

  /** Reads the page again: the changes, and the history when it is the tab showing. */
  const load = () => {
    if (tab === "changes") void changes(cwd).then(setView).catch(swallow);
    else void history(cwd).then(setPast).catch(swallow);
  };
  useEffect(load, [cwd, tab]);

  const act = (name: string, id: string) => {
    setMenu(null);
    void chose(name, id).then(load).catch(swallow);
  };

  return (
    <div
      autoFocus
      tabIndex={0}
      onKeyDown={(e: any) => {
        if (e?.key === undefined) return;
        void pressed(e.key)
          .then((mine) => {
            if (!mine) return;
            e?.preventDefault?.();
            load();
          })
          .catch(swallow);
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, backgroundColor: t.surface, color: t.text }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 26, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderBottomWidth: 1, borderColor: t.border }}>
        {(["changes", "history"] as const).map((each) => (
          <div
            key={each}
            onClick={() => setTab(each)}
            style={{ display: "flex", alignItems: "center", height: 22, paddingLeft: 8, paddingRight: 8, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: tab === each ? t.selected : undefined, hover: { backgroundColor: tab === each ? t.selected : t.hover } }}
          >
            <text style={{ fontSize: 11, fontWeight: 600, color: tab === each ? t.text : t.muted }}>{each === "changes" ? "Changes" : "History"}</text>
          </div>
        ))}
        <div style={{ flexGrow: 1 }} />
        {tab === "changes" && view ? (
          <text style={{ fontSize: 10, color: t.faint }}>{`+${view.added} −${view.deleted}`}</text>
        ) : null}
      </div>
      {tab === "history" ? <History view={past} /> : <Changes view={view} act={act} menu={(at, actions, id) => setMenu({ at, actions, id })} load={load} />}
      {menu ? <Menu at={menu.at} actions={menu.actions} close={() => setMenu(null)} run={(name) => act(name, menu.id)} /> : null}
    </div>
  );
}

/** The changes: the branch, the groups, and the commit box. */
function Changes({
  view,
  act,
  menu,
  load,
}: {
  view: ChangesView | undefined;
  act(name: string, id: string): void;
  menu(at: { x: number; y: number }, actions: string[], id: string): void;
  load(): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  if (!view) return null;
  if (view.error !== null) {
    return (
      <div style={{ padding: 10 }}>
        <text style={{ fontSize: 11, color: t.error }}>{view.error}</text>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 26, flexShrink: 0, paddingLeft: 10, paddingRight: 8 }}>
        <Icon name="git_branch" size={12} color={t.muted} />
        <text style={{ fontSize: 11, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{view.branch || "no branch"}</text>
      </div>
      {view.notice ? (
        <text style={{ paddingLeft: 10, paddingRight: 10, paddingBottom: 4, fontSize: 11, color: view.notice.ok ? t.success : t.error }}>{view.notice.text}</text>
      ) : null}
      {view.filtering ? (
        <div style={{ display: "flex", alignItems: "center", height: ROW, paddingLeft: 10, paddingRight: 10, flexShrink: 0 }}>
          <input
            value={view.filter}
            autoFocus
            placeholder="Filter the changes"
            onChange={(e: any) => {
              filtered(e?.value ?? "");
              load();
            }}
            style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 20, fontSize: 11, color: t.text }}
          />
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
        {view.groups.map((group) => (
          <Group key={group.label} group={group} act={act} menu={menu} load={load} />
        ))}
        {view.groups.length === 0 ? <text style={{ padding: 10, fontSize: 11, color: t.faint }}>{view.looked ? "No changes to commit" : "Reading the repository…"}</text> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0, padding: 8, borderTopWidth: 1, borderColor: t.border }}>
        <input
          value={view.message}
          placeholder="Commit message"
          onChange={(e: any) => {
            typed(e?.value ?? "");
            load();
          }}
          onSubmit={() => {
            act("commit", "");
            composing(false);
          }}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 24, paddingLeft: 8, paddingRight: 8, fontSize: 12, color: t.text, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border }}
        />
        <div
          onClick={() => act("commit", "")}
          style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 10, paddingRight: 10, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: view.message.trim() === "" ? t.active : t.accent, hover: { backgroundColor: view.message.trim() === "" ? t.active : t.accent } }}
        >
          <text style={{ fontSize: 11, fontWeight: 600, color: view.message.trim() === "" ? t.faint : t.accentText }}>Commit</text>
        </div>
      </div>
    </div>
  );
}

/** One group: its name, how many it holds, its own checkbox, and its rows. */
function Group({
  group,
  act,
  menu,
  load,
}: {
  group: GroupView;
  act(name: string, id: string): void;
  menu(at: { x: number; y: number }, actions: string[], id: string): void;
  load(): void;
}) {
  const t = useTheme();
  const bulk = group.group === "staged" ? "unstage-all" : "stage-all";
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: ROW, paddingLeft: 8, paddingRight: 8, cursor: "pointer" }}>
        <Checkbox state={group.state} onClick={() => act(bulk, "")} />
        <text style={{ fontSize: 11, fontWeight: 600, color: t.muted, flexGrow: 1 }}>{group.label.toUpperCase()}</text>
        <text style={{ fontSize: 10, color: t.faint }}>{String(group.rows.filter((row) => row.kind === "file").length)}</text>
      </div>
      {group.rows.map((row) => (
        <RowView key={row.id} row={row} act={act} menu={menu} load={load} />
      ))}
    </div>
  );
}

/** One row of the tree: its indent, its mark, its checkbox, its name and its stats. */
function RowView({
  row,
  act,
  menu,
  load,
}: {
  row: Row;
  act(name: string, id: string): void;
  menu(at: { x: number; y: number }, actions: string[], id: string): void;
  load(): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  if (row.kind === "note") {
    return (
      <div style={{ display: "flex", alignItems: "center", height: ROW, paddingLeft: 10 + row.depth * INDENT, paddingRight: 8 }}>
        <text style={{ fontSize: 10, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.text}</text>
      </div>
    );
  }
  const color = t[row.color] ?? t.text;
  return (
    <div
      onClick={() => {
        void picked(row.id).then(load).catch(swallow);
      }}
      onAuxClick={(e: any) => {
        if (!e?.isRightClick) return;
        menu({ x: e.x ?? 0, y: e.y ?? 0 }, row.actions, row.id);
      }}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: ROW, flexShrink: 0, paddingLeft: 8 + row.depth * INDENT, paddingRight: 8, cursor: "pointer", borderRadius: m.radiusSmall, backgroundColor: row.selected ? t.selected : undefined, hover: { backgroundColor: row.selected ? t.selected : t.hover } }}
    >
      {row.kind === "folder" ? (
        <Icon name={row.open ? "chevron_down" : "chevron_right"} size={10} color={t.muted} />
      ) : (
        <div style={{ display: "flex", width: 10, flexShrink: 0, justifyContent: "center" }}>
          <text style={{ fontSize: 10, fontWeight: 600, color }}>{row.glyph}</text>
        </div>
      )}
      <Checkbox state={row.checkbox} onClick={() => act(row.checkbox === "on" ? "unstage" : "stage", row.id)} />
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
        <text style={{ fontSize: 12, color: row.kind === "folder" ? t.muted : color, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.text}</text>
      </div>
      {row.stats !== "" ? <text style={{ fontSize: 10, color: t.faint, flexShrink: 0 }}>{row.stats}</text> : null}
      {row.actions.length > 0 ? (
        <div
          aria-label="What can be done to this row"
          onClick={(e: any) => {
            e?.stopPropagation?.();
            menu({ x: e?.x ?? 0, y: e?.y ?? 0 }, row.actions, row.id);
          }}
          style={{ display: "flex", width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: m.radiusSmall, hover: { backgroundColor: t.active } }}
        >
          <Icon name="ellipsis" size={10} color={t.muted} />
        </div>
      ) : null}
    </div>
  );
}

/** A row's checkbox: git's own three states. */
function Checkbox({ state, onClick }: { state: string; onClick(): void }) {
  const t = useTheme();
  if (state === "") return <div style={{ width: 12, flexShrink: 0 }} />;
  const glyph = state === "on" ? "check" : state === "partial" ? "dash" : "";
  return (
    <div
      aria-label="Stage or unstage"
      onClick={(e: any) => {
        e?.stopPropagation?.();
        onClick();
      }}
      style={{ display: "flex", width: 12, height: 12, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 3, borderWidth: 1, borderColor: state === "off" ? t.border : t.accent, backgroundColor: state === "off" ? undefined : t.accent, cursor: "pointer" }}
    >
      {glyph === "" ? null : <Icon name={glyph} size={9} color={t.accentText} />}
    </div>
  );
}

/** The history: the commits, newest first. */
function History({ view }: { view: HistoryView | undefined }) {
  const t = useTheme();
  if (!view) return null;
  if (view.commits === null) {
    return (
      <div style={{ padding: 10 }}>
        <text style={{ fontSize: 11, color: t.faint }}>{view.root === null ? "No repository here" : "Reading the history…"}</text>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
      {view.commits.map((commit) => (
        <div key={commit.sha} style={{ display: "flex", flexDirection: "column", flexShrink: 0, paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, gap: 1 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
            <text style={{ fontSize: 12, color: t.text, flexGrow: 1, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{commit.subject}</text>
            <text style={{ fontSize: 10, color: t.faint }}>{commit.sha.slice(0, 7)}</text>
          </div>
          <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
            <text style={{ fontSize: 10, color: t.faint }}>{commit.author}</text>
            <text style={{ fontSize: 10, color: t.faint }}>{when(commit.timestamp, "relative")}</text>
            {commit.unpushed ? <text style={{ fontSize: 10, color: t.warning }}>unpushed</text> : null}
            {commit.tags.length > 0 ? <text style={{ fontSize: 10, color: t.accent }}>{commit.tags.join(" ")}</text> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A row's menu, where it was pressed. */
function Menu({ at, actions, close, run }: { at: { x: number; y: number }; actions: string[]; close(): void; run(name: string): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <anchored position={at} fit="snap" deferred occlude onMouseDownOutside={close}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 160, padding: 4, borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: "#00000066" } }}>
        {actions.map((name) => (
          <div
            key={name}
            onClick={() => {
              close();
              run(name);
            }}
            style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
          >
            <text style={{ fontSize: 12, color: name === "discard" ? t.error : t.text }}>{LABELS[name] ?? name}</text>
          </div>
        ))}
      </div>
    </anchored>
  );
}
