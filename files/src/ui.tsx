// What the tree draws, in the window's React tree: a row per entry — its indentation's guides, a
// folder's triangle, its icon, its name in the colour git gives it, and the field it is renamed in —
// the filter box over it, and a row's menu where it was right-pressed. The tree itself, and what a
// gesture does to the disk, is the worker's (`main.ts`, `panel.ts`, `intent.ts`): a key, a click and
// a drop each go there and answer the rows as they are afterwards.
import { useEffect, useState } from "react";
import { Icon, useDraggable, useDroppable, useFocusedPane, useInterval, useMetrics, usePane, useTheme } from "pumi";

import { activate, adding, cancelled, chose, committed, dropped, filtered, firstMatch, load, named, pressed, reread, searching, type View } from "./main.ts";
import { GUIDE_OFFSET, colorToken, type Row } from "./row.ts";

/** How tall a row is, and how big its icons: the core rows view's own numbers. */
const ROW = 28;
const ICON = 14;
const CHEVRON = 12;
const ROW_PL = 10;
const ROW_PR = 4;
/** The room a folder's disclosure triangle takes, present or not, so names line up. */
const DISCLOSURE = CHEVRON + 6;

/** The keys the tree answers, as the panel names them. */
function chordOf(event: { key?: string | null; modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean; cmd?: boolean } | null }): string {
  const m = event.modifiers ?? {};
  const parts = [m.ctrl && "ctrl", m.alt && "alt", m.shift && "shift", m.cmd && "cmd"].filter(Boolean) as string[];
  const key = event.key ?? "";
  return parts.length ? `${parts.join("+")}+${key}` : key;
}

/** A throw the tree cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`files: ${err instanceof Error ? err.message : String(err)}`);
}

/** The `panel` slot's view: the filter box, the rows, and a row's menu. */
export function Tree() {
  const t = useTheme();
  const focused = usePane(useFocusedPane());
  const cwd = focused?.cwd ?? "/";
  const [view, setView] = useState<View | undefined>(undefined);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; key: string } | null>(null);

  /** Every gesture answers the tree as it is after it. */
  const run = (call: Promise<View>) => void call.then(setView).catch(swallow);

  useEffect(() => {
    void load(cwd).then(setView).catch(swallow);
  }, [cwd]);
  // The tree is the disk: a check now and then, and again after anything that wrote to it.
  useInterval(() => void reread().then(setView).catch(swallow), 2_000);

  if (!view) return null;
  const rows = view.rows;

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      {view.filtering ? <Filter value={view.filter} onChange={(text) => setView(filtered(text))} onEnter={() => run(firstMatch())} onEscape={() => setView(searching(false))} /> : null}
      <div
        autoFocus
        tabIndex={0}
        onKeyDown={(e: any) => {
          if (view.naming || view.filtering) return;
          const chord = chordOf(e);
          if (chord === "cmd+f") {
            e.preventDefault?.();
            setView(searching(true));
            return;
          }
          if (chord === "cmd+n") {
            e.preventDefault?.();
            run(adding(false));
            return;
          }
          if (chord === "cmd+shift+n") {
            e.preventDefault?.();
            run(adding(true));
            return;
          }
          e.preventDefault?.();
          run(pressed(chord));
        }}
        style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}
      >
        {rows.map((row) => (
          <RowView
            key={row.key}
            row={row}
            naming={view.naming}
            onActivate={() => run(activate(row.key))}
            onToggle={() => run(activate(row.key))}
            onName={(name) => setView(named(name))}
            onCommit={() => run(committed())}
            onCancel={() => setView(cancelled())}
            onMenu={(at) => setMenu({ at, key: row.key })}
            onDrop={(paths) => run(dropped(row.key, paths))}
          />
        ))}
        {rows.length === 0 ? (
          <div style={{ paddingLeft: ROW_PL, paddingTop: 6, paddingBottom: 6 }}>
            <text style={{ fontSize: 11, color: t.muted }}>{view.filter === "" ? `${view.root} is empty` : `nothing matches “${view.filter}”`}</text>
          </div>
        ) : null}
      </div>
      {menu ? <RowMenu view={view} menu={menu} close={() => setMenu(null)} run={run} /> : null}
    </div>
  );
}

/** The filter box, over the tree, which is where the keyboard is while it is up. */
function Filter({ value, onChange, onEnter, onEscape }: { value: string; onChange(text: string): void; onEnter(): void; onEscape(): void }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: ROW, gap: 6, paddingLeft: ROW_PL, flexShrink: 0 }}>
      <Icon name="search" size={CHEVRON} color={t.muted} />
      <input
        value={value}
        autoFocus
        placeholder="Filter the project"
        onChange={(e: any) => onChange(e?.value ?? "")}
        onSubmit={() => onEnter()}
        onKeyDown={(e: any) => {
          if (e?.key !== "escape") return;
          e?.stopPropagation?.();
          onEscape();
        }}
        style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 22, fontSize: 12, color: t.text }}
      />
    </div>
  );
}

/** One row: its guides, its triangle, its icon and its name, or the field it is renamed in. */
function RowView({
  row,
  naming,
  onActivate,
  onToggle,
  onName,
  onCommit,
  onCancel,
  onMenu,
  onDrop,
}: {
  row: Row;
  naming: { name: string; isDir: boolean } | null;
  onActivate(): void;
  onToggle(): void;
  onName(name: string): void;
  onCommit(): void;
  onCancel(): void;
  onMenu(at: { x: number; y: number }): void;
  onDrop(paths: string[]): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  const drag = useDraggable({ path: row.path }, { disabled: row.path === "" });
  const drop = useDroppable({ onDrop: (data) => onDrop(pathsOf(data)) });
  const color = t[colorToken(row.color)] ?? t.text;
  return (
    <div
      {...drag.props}
      ref={drop.ref}
      onClick={() => {
        if (drag.wasDragged()) return;
        onActivate();
      }}
      onAuxClick={(e: any) => {
        if (!e?.isRightClick) return;
        onMenu({ x: e.x ?? 0, y: e.y ?? 0 });
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: ROW,
        flexShrink: 0,
        paddingLeft: ROW_PL,
        paddingRight: ROW_PR,
        overflow: "hidden",
        cursor: "pointer",
        backgroundColor: row.selected ? t.active : drop.isOver ? t.hover : undefined,
        hover: { backgroundColor: row.selected ? t.active : t.hover },
      }}
    >
      <Indent depth={row.depth} indent={row.indent} />
      {row.kind === "folder" ? (
        <div
          onClick={(e: any) => {
            e?.stopPropagation?.();
            onToggle();
          }}
          style={{ display: "flex", width: DISCLOSURE, flexShrink: 0, alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <Icon name={row.open ? "chevron_down" : "chevron_right"} size={CHEVRON} color={t.muted} />
        </div>
      ) : (
        <div style={{ width: DISCLOSURE, flexShrink: 0 }} />
      )}
      {row.icon !== "" ? <svg src={row.icon} style={{ width: ICON, height: ICON, flexShrink: 0, color: t.muted }} /> : null}
      {row.editing ? (
        <input
          value={naming?.name ?? ""}
          autoFocus
          placeholder="name"
          onChange={(e: any) => onName(e?.value ?? "")}
          onSubmit={() => onCommit()}
          onBlur={() => onCommit()}
          onKeyDown={(e: any) => {
            if (e?.key !== "escape") return;
            e?.stopPropagation?.();
            onCancel();
          }}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 22, fontSize: 13, color: t.text, borderRadius: m.radiusSmall }}
        />
      ) : (
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: 13, color, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.text}</text>
        </div>
      )}
    </div>
  );
}

/** The space a row's depth takes, with a line down each level above it. */
function Indent({ depth, indent }: { depth: number; indent: number }) {
  const t = useTheme();
  if (depth === 0) return null;
  return (
    <div style={{ position: "relative", width: depth * indent, height: ROW, flexShrink: 0 }}>
      {Array.from({ length: depth }, (_, level) => (
        <div key={level} style={{ position: "absolute", left: level * indent + GUIDE_OFFSET, top: 0, width: 1, height: ROW, backgroundColor: t.border }} />
      ))}
    </div>
  );
}

/** A row's menu, where it was right-pressed: what the row's own actions are, and Close. */
function RowMenu({ view, menu, close, run }: { view: View; menu: { at: { x: number; y: number }; key: string }; close(): void; run(call: Promise<View>): void }) {
  const t = useTheme();
  const m = useMetrics();
  const row = view.rows.find((each) => each.key === menu.key);
  const items = [
    ...(row?.actions ?? []).map((name) => ({ label: name, run: () => run(chose(name, menu.key)), danger: name === "Trash" || name === "Delete" })),
    { label: "Close", run: close, danger: false },
  ];
  return (
    <anchored position={menu.at} fit="snap" deferred occlude onMouseDownOutside={close}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 200, padding: 4, borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: "#00000066" } }}>
        <text style={{ paddingLeft: 8, paddingTop: 4, paddingBottom: 4, fontSize: 11, fontWeight: 600, color: t.muted }}>{row?.text ?? "Project"}</text>
        {items.map((item) => (
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

/** The paths a drag carries: this tree's own `{path}`, a list of them, or a bare path. */
export function pathsOf(dragged: unknown): string[] {
  if (typeof dragged === "string") return [dragged];
  if (Array.isArray(dragged)) return dragged.filter((each): each is string => typeof each === "string");
  if (dragged === null || typeof dragged !== "object") return [];
  const at = dragged as { path?: unknown; paths?: unknown };
  if (typeof at.path === "string") return [at.path];
  if (Array.isArray(at.paths)) return at.paths.filter((each): each is string => typeof each === "string");
  if (typeof at.paths === "string") return [at.paths];
  return [];
}
