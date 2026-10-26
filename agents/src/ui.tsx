// The agents page, in the sidebar: every space, tab and agent, what each is doing, and a click to
// go there. The rows are `tree.ts`'s (which space holds what, and what the attention section says),
// the state's word is `status.ts`'s; this draws them — a row is a mark, a title, its state's word
// and its buttons, and a folded group is a header with a chevron. What the user does goes to the
// API (`call`), which is the only way a window moves the panes.
import { useMemo, useState } from "react";
import { Icon, useDraggable, useDroppable, useMetrics, usePane, usePanes, useSession, useSessions, useTab, useTabs, useTheme, workspace } from "pumi";

import { fromWindow } from "./adapt.ts";
import { paneRef, sessionRef, tabRef } from "./ids.ts";
import type { Pane, Space, Tab } from "./snapshot.ts";
import { bold, shown, word, type State } from "./status.ts";
import { detail, icon as kindIcon, rows, spaceLabel, tabLabel, title, type Row, type Shape } from "./tree.ts";

/** A row is 26 pixels: the weight the core's rows have in the dock. */
const ROW = 26;
/** A tab's panes are indented by one chevron and a mark. */
const INDENT = 26;

/** A menu a `⋯` opens: its rows, where it was pressed. */
interface Menu {
  at: { x: number; y: number };
  items: { label: string; run(): void; danger?: boolean }[];
}

/** What is being renamed: a space's name, or a tab's. */
interface Renaming {
  kind: "space" | "tab";
  id: number;
  text: string;
}

/** A throw the page cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`agents: ${err instanceof Error ? err.message : String(err)}`);
}

/** The `panel` slot's view: the search field, the rows, and the menus over them. */
export function Agents() {
  const t = useTheme();
  const sessions = useSessions();
  const tabs = useTabs();
  const panes = usePanes();
  const session = useSession();
  const tab = useTab();
  const pane = usePane(useTab()?.activePane?.id);
  const model = useMemo(() => fromWindow({ sessions, tabs, panes, session, tab, pane }), [sessions, tabs, panes, session, tab, pane]);
  const [query, setQuery] = useState("");
  const [foldedSpaces, setFoldedSpaces] = useState<number[]>([]);
  const [foldedTabs, setFoldedTabs] = useState<number[]>([]);
  const [attention, setAttention] = useState(false);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  const shape: Shape = { query, spaces: new Set(foldedSpaces), tabs: new Set(foldedTabs), attention };
  const list = rows(model, shape);

  /** Changes the list as `f` says, closing what was open over it. */
  const act = (f: () => void) => {
    setMenu(null);
    f();
  };
  const toggle = (which: "space" | "tab" | "attention", id: number) =>
    act(() => {
      if (query !== "") return;
      if (which === "attention") setAttention((now) => !now);
      else if (which === "space") setFoldedSpaces((now) => (now.includes(id) ? now.filter((each) => each !== id) : [...now, id]));
      else setFoldedTabs((now) => (now.includes(id) ? now.filter((each) => each !== id) : [...now, id]));
    });

  /** Keeps a name the user typed, when it says something new. */
  const commit = (rename: Renaming) => {
    setRenaming(null);
    const label = rename.text.trim();
    const before =
      rename.kind === "space"
        ? (model.spaces.find((each) => each.id === rename.id)?.label ?? "")
        : (model.tabs.find((each) => each.id === rename.id)?.label ?? "");
    if (label === "" || label === before.trim()) return;
    if (rename.kind === "space") workspace.getSession(sessionRef(rename.id))?.update({ name: label }).catch(swallow);
    else workspace.getTab(tabRef(rename.id))?.update({ name: label }).catch(swallow);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <Search value={query} onChange={(v) => act(() => setQuery(v))} onNew={() => void newSpace()} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingTop: 2, paddingBottom: 2 }}>
        {list.map((row) => (
          <RowView
            key={key(row)}
            row={row}
            renaming={renaming}
            onToggle={toggle}
            onRename={setRenaming}
            onCommit={commit}
            onMenu={(at, items) => setMenu({ at, items })}
            close={() => setMenu(null)}
          />
        ))}
      </div>
      {menu ? <Overlay menu={menu} close={() => setMenu(null)} /> : null}
    </div>
  );
}

/** A row's key: what it stands for, so React keeps a row as the list moves under it. */
function key(row: Row): string {
  switch (row.kind) {
    case "attention-header":
      return "attention-header";
    case "attention":
      return `attention-${row.pane.id}`;
    case "space":
      return `space-${row.space.id}`;
    case "tab":
      return `tab-${row.tab.id}`;
    case "pane":
      return `pane-${row.pane.id}`;
    case "note":
      return `note-${row.text}`;
  }
}

/** The search field, and the button that opens a space. */
function Search({ value, onChange, onNew }: { value: string; onChange(value: string): void; onNew(): void }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, flexShrink: 0 }}>
      <Icon name="search" size={12} color={t.muted} />
      <input
        value={value}
        placeholder="Search Agents…"
        onChange={(e: any) => onChange(e?.value ?? "")}
        style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 22, fontSize: 12, color: t.text }}
      />
      <Button icon="plus" title="New session" onClick={onNew} />
    </div>
  );
}

/** An icon button: a press runs `click`. */
function Button({ icon, title, onClick, color }: { icon: string; title: string; onClick(at: { x: number; y: number }): void; color?: string }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      aria-label={title}
      onClick={(e: any) => {
        e?.stopPropagation?.();
        onClick({ x: e?.x ?? 0, y: e?.y ?? 0 });
      }}
      style={{ display: "flex", width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.active } }}
    >
      <Icon name={icon} size={11} color={color ?? t.muted} />
    </div>
  );
}

/** One row of the list, drawn as what it stands for. */
function RowView(props: {
  row: Row;
  renaming: Renaming | null;
  onToggle(which: "space" | "tab" | "attention", id: number): void;
  onRename(rename: Renaming): void;
  onCommit(rename: Renaming): void;
  onMenu(at: { x: number; y: number }, items: Menu["items"]): void;
  close(): void;
}) {
  const { row } = props;
  switch (row.kind) {
    case "attention-header":
      return (
        <Header
          label="Needs attention"
          icon="status_alert"
          tint={tintOf(row.lead)}
          count={row.count}
          folded={row.folded}
          onToggle={() => props.onToggle("attention", 0)}
        />
      );
    case "attention":
      return (
        <PaneLine
          pane={row.pane}
          state={row.state}
          said={row.said}
          dragIt
          onActivate={() => void goTo(row.pane.id)}
          onClose={() => void closePane(row.pane.id)}
          dropOn={(dragged) => dropOnPane(row.pane, dragged)}
        />
      );
    case "space": {
      const space = row.space;
      const renaming = props.renaming?.kind === "space" && props.renaming.id === space.id ? props.renaming : null;
      return (
        <Header
          label={spaceLabel(space)}
          tint={row.active ? undefined : "muted"}
          active={row.active}
          folded={row.folded}
          onToggle={() => props.onToggle("space", space.id)}
          onActivate={() => void selectSpace(space.id)}
          buttons={[
            <Button key="new" icon="plus" title="New tab" onClick={() => void newTab(space.id)} />,
            <Button
              key="menu"
              icon="ellipsis"
              title="More"
              onClick={(at) =>
                props.onMenu(at, [
                  { label: "Rename", run: () => props.onRename({ kind: "space", id: space.id, text: spaceLabel(space) }) },
                  { label: "Remove", run: () => void removeSpace(space.id), danger: true },
                ])
              }
            />,
          ]}
          renaming={renaming}
          onRename={(text) => props.onRename({ ...(renaming ?? { kind: "space", id: space.id, text }), text })}
          onCommit={() => renaming && props.onCommit(renaming)}
          cancel={() => props.onCommit({ ...(renaming ?? { kind: "space", id: space.id, text: "" }), text: "" })}
          dropOn={(dragged) => dropOnSpace(space, dragged)}
        />
      );
    }
    case "tab": {
      const tab = row.tab;
      const renaming = props.renaming?.kind === "tab" && props.renaming.id === tab.id ? props.renaming : null;
      return (
        <Line
          icon={iconOf(row.icon)}
          label={row.label}
          said={row.detail}
          disclosure={row.disclosure}
          selected={tab.focused && row.single !== null}
          onActivate={() => void goToTab(tab.id)}
          onToggle={() => props.onToggle("tab", tab.id)}
          buttons={[
            ...row.marks.map((mark, i) => <Dot key={`m${i}`} state={mark} size={9} />),
            <Button key="close" icon="close" title="Close tab" onClick={() => void closeTab(tab.id)} />,
            <Button
              key="menu"
              icon="ellipsis"
              title="More"
              onClick={(at) =>
                props.onMenu(at, [
                  { label: "Rename", run: () => props.onRename({ kind: "tab", id: tab.id, text: tabLabel(tab) }) },
                  { label: "Close", run: () => void closeTab(tab.id), danger: true },
                ])
              }
            />,
          ]}
          renaming={renaming}
          onRename={(text) => props.onRename({ ...(renaming ?? { kind: "tab", id: tab.id, text }), text })}
          onCommit={() => renaming && props.onCommit(renaming)}
          drag={{ tab: tab.id }}
          dropOn={(dragged) => dropOnTab(tab, dragged)}
        />
      );
    }
    case "pane":
      return <PaneLine pane={row.pane} agent={row.agent} depth={row.depth} state={shown(row.pane)} onActivate={() => void goTo(row.pane.id)} onClose={() => void closePane(row.pane.id)} dragIt dropOn={(dragged) => dropOnPane(row.pane, dragged)} />;
    case "note": {
      const t = useTheme();
      return (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: ROW, gap: 6, paddingLeft: 10, paddingRight: 10 }}>
          <Icon name="dot" size={10} color={t.muted} />
          <text style={{ fontSize: 12, color: t.muted, flexShrink: 1, minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.text}</text>
        </div>
      );
    }
  }
}

/** A pane's row: its mark or its type's icon, its title, and the state's word. */
function PaneLine({
  pane,
  agent,
  depth = 0,
  state,
  said,
  dragIt,
  onActivate,
  onClose,
  dropOn,
}: {
  pane: Pane;
  agent?: boolean;
  depth?: number;
  state: State | "";
  said?: string;
  dragIt?: boolean;
  onActivate(): void;
  onClose(): void;
  dropOn(dragged: unknown): boolean;
}) {
  return (
    <Line
      icon={agent ? "terminal" : iconOf(kindIcon(pane))}
      label={title(pane)}
      said={said ?? (state === "" ? detail(pane) : "")}
      word={state === "" ? "" : word(state)}
      state={state}
      indent={depth}
      selected={pane.focused}
      onActivate={onActivate}
      buttons={[<Button key="close" icon="close" title="Close pane" onClick={onClose} />]}
      drag={dragIt ? { pane: pane.id } : undefined}
      dropOn={dropOn}
    />
  );
}

/** A space's, a tab's or the attention section's name, with its buttons. */
function Header({
  label,
  icon,
  tint,
  count,
  active,
  folded,
  buttons = [],
  renaming,
  onToggle,
  onActivate,
  onRename,
  onCommit,
  cancel,
  dropOn,
}: {
  label: string;
  icon?: string;
  tint?: string;
  count?: number;
  active?: boolean;
  folded: boolean;
  buttons?: React.ReactNode[];
  renaming?: Renaming | null;
  onToggle(): void;
  onActivate?(): void;
  onRename?(text: string): void;
  onCommit?(): void;
  cancel?(): void;
  dropOn?(dragged: unknown): boolean;
}) {
  const t = useTheme();
  const m = useMetrics();
  const color = tint === "muted" ? t.muted : tint;
  const drop = useDroppable({ onDrop: (data) => void dropOn?.(data) });
  return (
    <div
      ref={drop.ref}
      onClick={() => (renaming ? undefined : onToggle())}
      onDoubleClick={() => (renaming ? undefined : onActivate?.())}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", height: ROW, gap: 4, paddingLeft: 8, paddingRight: 8, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: drop.isOver ? t.hover : undefined, hover: { backgroundColor: t.hover } }}
    >
      <Icon name={folded ? "chevron_right" : "chevron_down"} size={11} color={t.muted} />
      {icon ? <Icon name={icon} size={12} color={color ?? t.muted} /> : null}
      {renaming ? (
        <NameField
          value={renaming.text}
          onChange={(text) => onRename?.(text)}
          onCommit={() => onCommit?.()}
          onCancel={() => cancel?.()}
        />
      ) : (
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: color ?? t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</text>
        </div>
      )}
      {count !== undefined ? <text style={{ fontSize: 11, color: t.muted }}>{String(count)}</text> : null}
      {renaming ? null : <div style={{ display: "flex", flexGrow: 1 }} />}
      {buttons}
    </div>
  );
}

/** A tab's, a pane's or an attention row's line: a disclosure, a mark, a name, its detail, its word. */
function Line({
  icon,
  label,
  said,
  word: said_word,
  state,
  indent = 0,
  disclosure,
  selected,
  buttons = [],
  renaming,
  onActivate,
  onToggle,
  onRename,
  onCommit,
  cancel,
  drag,
  dropOn,
}: {
  icon: string;
  label: string;
  said?: string;
  word?: string;
  state?: State | "";
  indent?: number;
  disclosure?: "space" | "open" | "closed";
  selected?: boolean;
  buttons?: React.ReactNode[];
  renaming?: Renaming | null;
  onActivate(): void;
  onToggle?(): void;
  onRename?(text: string): void;
  onCommit?(): void;
  cancel?(): void;
  drag?: { tab?: number; pane?: number };
  dropOn(dragged: unknown): boolean;
}) {
  const t = useTheme();
  const m = useMetrics();
  const draggable = useDraggable(drag ?? {}, { disabled: drag === undefined });
  const drop = useDroppable({ onDrop: (data) => void dropOn(data) });
  const fold = onToggle ?? onActivate;
  return (
    <div
      {...draggable.props}
      ref={drop.ref}
      onClick={() => {
        if (draggable.wasDragged()) return;
        if (renaming) return;
        onToggle?.() ?? onActivate();
      }}
      onDoubleClick={() => (renaming ? undefined : onActivate())}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", height: ROW, gap: 6, paddingLeft: 8 + (indent ?? 0) * INDENT, paddingRight: 8, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: selected ? t.active : drop.isOver ? t.hover : undefined, hover: { backgroundColor: selected ? t.active : t.hover } }}
    >
      {disclosure === "space" ? (
        <div style={{ width: 12, flexShrink: 0 }} />
      ) : disclosure !== undefined ? (
        <div
          onClick={(e: any) => {
            e?.stopPropagation?.();
            fold();
          }}
          style={{ display: "flex", width: 12, height: 12, flexShrink: 0, alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <Icon name={disclosure === "closed" ? "chevron_right" : "chevron_down"} size={11} color={t.muted} />
        </div>
      ) : null}
      {state ? <Dot state={state} size={11} /> : <Icon name={icon} size={12} color={t.muted} />}
      {renaming ? (
        <NameField value={renaming.text} onChange={(text) => onRename?.(text)} onCommit={() => onCommit?.()} onCancel={() => cancel?.()} />
      ) : (
        <>
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
            <text style={{ fontSize: 12, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</text>
          </div>
          {said ? (
            <div style={{ display: "flex", flexShrink: 0, maxWidth: 120, minWidth: 0 }}>
              <text style={{ fontSize: 11, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{said}</text>
            </div>
          ) : null}
          {said_word ? (
            <text style={{ fontSize: 11, fontWeight: bold(said_word as State) ? 600 : 400, color: state ? tintOf(said_word as State) : t.text }}>{said_word}</text>
          ) : null}
        </>
      )}
      {buttons}
    </div>
  );
}

/** A name being typed: Enter keeps it, Escape (or a press elsewhere) leaves it as it was. */
function NameField({ value, onChange, onCommit, onCancel }: { value: string; onChange(value: string): void; onCommit(): void; onCancel(): void }) {
  const t = useTheme();
  return (
    <input
      value={value}
      autoFocus
      onFocus={(e: any) => e?.selectAll?.()}
      onChange={(e: any) => onChange(e?.value ?? "")}
      onSubmit={() => onCommit()}
      onBlur={() => onCommit()}
      onKeyDown={(e: any) => {
        if (e?.key === "escape") onCancel();
      }}
      style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 20, fontSize: 12, color: t.text }}
    />
  );
}

/** A state's mark: a dot in the theme's colour for it. */
function Dot({ state, size = 12 }: { state: string; size?: number }) {
  const t = useTheme();
  return <div style={{ width: size, height: size, flexShrink: 0, borderRadius: size, backgroundColor: t[`agent.${state || "unknown"}`] ?? t["agent.unknown"] }} />;
}

/** The theme's colour for a state (`agent.working`, …). */
function tintOf(state: string): string {
  const t = useTheme();
  return t[`agent.${state || "unknown"}`] ?? t["agent.unknown"];
}

/** A menu, where the `⋯` was pressed. */
function Overlay({ menu, close }: { menu: Menu; close(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <anchored position={menu.at} fit="snap" deferred occlude onMouseDownOutside={close}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 160, padding: 4, borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: "#00000066" } }}>
        {menu.items.map((item) => (
          <div
            key={item.label}
            onClick={() => {
              close();
              item.run();
            }}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
          >
            <text style={{ fontSize: 12, color: item.danger ? t.error : t.text }}>{item.label}</text>
          </div>
        ))}
      </div>
    </anchored>
  );
}

/** An icon's name: the marks the rows name are the app's, under their snake_case names. */
function iconOf(name: string): string {
  const alias: Record<string, string> = {
    "status-alert": "status_alert",
    "chevron-right": "chevron_right",
    "chevron-down": "chevron_down",
    "square-dot": "square_dot",
    split: "split",
    terminal: "terminal",
    globe: "tool_web",
    code: "code",
    dot: "dot",
  };
  return alias[name] ?? name;
}

// ---- what a click does: the API's own calls

function goTo(pane: number): Promise<unknown> | undefined {
  return workspace.getPane(paneRef(pane))?.focus().catch(swallow);
}

function goToTab(tab: number): Promise<unknown> | undefined {
  return workspace.getTab(tabRef(tab))?.focus().catch(swallow);
}

function selectSpace(space: number): Promise<unknown> | undefined {
  return workspace.getSession(sessionRef(space))?.focus().catch(swallow);
}

function newSpace(): Promise<unknown> {
  return workspace.openPane("terminal", {}, { kind: "session", focus: false }).catch(swallow);
}

function newTab(space: number): Promise<unknown> {
  return workspace.openPane("terminal", {}, { kind: "tab", session: sessionRef(space) }).catch(swallow);
}

function closePane(pane: number): Promise<unknown> | undefined {
  return workspace.getPane(paneRef(pane))?.close().catch(swallow);
}

function closeTab(tab: number): Promise<unknown> | undefined {
  const model = workspace.getTab(tabRef(tab));
  return model?.focus().then(() => model.close()).catch(swallow);
}

function removeSpace(space: number): Promise<unknown> | undefined {
  const model = workspace.getSession(sessionRef(space));
  return model?.focus().then(() => model.close()).catch(swallow);
}

/** What a row drags. */
interface Dragged {
  pane?: number;
  tab?: number;
}

function dragged(data: unknown): Dragged {
  if (typeof data !== "object" || data === null) return {};
  const each = data as { pane?: unknown; tab?: unknown };
  return { pane: typeof each.pane === "number" ? each.pane : undefined, tab: typeof each.tab === "number" ? each.tab : undefined };
}

/** Onto a space: a tab joins it, a pane goes into the tab it is showing. */
function dropOnSpace(space: Space, data: unknown): boolean {
  const it = dragged(data);
  if (it.tab !== undefined) {
    void workspace.getTab(tabRef(it.tab))?.update({ session: sessionRef(space.id) }).catch(swallow);
    return true;
  }
  const into = space.current ?? space.tabs[0]?.id;
  if (it.pane !== undefined && into !== undefined) {
    void workspace.getPane(paneRef(it.pane))?.update({ place: { kind: "tiled", tab: tabRef(into) } }).catch(swallow);
    return true;
  }
  return false;
}

/** Onto a tab: a pane joins it, a tab takes its index in its space. */
function dropOnTab(tab: Tab, data: unknown): boolean {
  const it = dragged(data);
  if (it.pane !== undefined) {
    void workspace.getPane(paneRef(it.pane))?.update({ place: { kind: "tiled", tab: tabRef(tab.id) } }).catch(swallow);
    return true;
  }
  if (it.tab !== undefined) {
    void workspace.getTab(tabRef(it.tab))?.update({ session: sessionRef(tab.space), index: tab.index }).catch(swallow);
    return true;
  }
  return false;
}

/** Onto a pane: another pane trades places with it. */
function dropOnPane(pane: Pane, data: unknown): boolean {
  const it = dragged(data);
  if (it.pane === undefined || it.pane === pane.id) return false;
  void workspace.getPane(paneRef(it.pane))?.update({ place: { kind: "tiled", swap: paneRef(pane.id) } }).catch(swallow);
  return true;
}
