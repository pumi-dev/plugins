// What the tree draws, in the window's React tree: a list whose first item is the search box and the
// rest a row per entry —
// its indentation's guides, a folder's triangle, its icon (the Material Icon Theme's, in colour), its
// name in the colour git gives it, and the field it is renamed in — and a row's menu where it was
// right-pressed. The rows are a windowed `<virtual-list>`: only those near the viewport are made, so
// a project of any size draws as fast as a small one. The tree itself, and what a gesture does to the
// disk, is the worker's (`main.ts`, `panel.ts`, `intent.ts`): a key, a click and a drop each go
// there and answer the rows as they are afterwards.
import { Fragment, memo, useEffect, useRef, useState } from "react";
import { Icon, useAppearance, useDraggable, useDroppable, useInterval, useMetrics, useSession, useTab, useTheme } from "pumi";

import { activate, adding, cancelled, chose, committed, dropped, filtered, firstMatch, load, named, pressed, reread, searching, type View } from "./main.ts";
import { adopt } from "./adopt.ts";
import { iconPath } from "./icon-path.ts";
import { GUIDE_OFFSET, colorTokens, type Row } from "./row.ts";

/** How tall a row is, and how big its icons (the Material icons are drawn at the 16 px they are
 *  made for). */
const ROW = 22;
const ICON = 16;
/** The search box's height: the agents' search's. */
const SEARCH_ROW = 34;
/** Rows made beyond each end of what shows, so a scroll draws rows that are there already. */
const OVERSCAN = 40;
const CHEVRON = 12;
const ROW_PL = 8;
const ROW_PR = 8;
/** The room a folder's disclosure triangle takes, present or not, so names line up; its middle is
 *  where the guides of the rows under it run (`GUIDE_OFFSET`). */
const DISCLOSURE = 16;
/** Between the icon and the name. */
const ICON_GAP = 6;

/** The keys the tree answers, as the panel names them. */
function chordOf(event: { key?: string | null; modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean; cmd?: boolean } | null }): string {
  const m = event.modifiers ?? {};
  const parts = [m.ctrl && "ctrl", m.alt && "alt", m.shift && "shift", m.cmd && "cmd"].filter(Boolean) as string[];
  const key = event.key ?? "";
  return parts.length ? `${parts.join("+")}+${key}` : key;
}

/** A throw the tree cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`file-tree: ${err instanceof Error ? err.message : String(err)}`);
}

/** What a row does, by its key: one object for every row and every render, so a row that has not
 *  changed is not drawn again for a new closure. */
interface RowActions {
  activate(key: string): void;
  name(name: string): void;
  commit(): void;
  cancel(): void;
  menu(key: string, at: { x: number; y: number }): void;
  drop(key: string, paths: string[]): void;
}

/** The `panel` slot's component: the tree of the focused tab's directory. Only the directory is
 *  read here, so a tab's title or status changing draws nothing of the tree. A tab with no
 *  directory of its own (one just opened, whose directory has not arrived yet) is not somewhere
 *  the user went: the tree stays on the project it was showing, rather than blinking to `/` and
 *  back, which would close every folder. */
export function Tree() {
  const focused = useTab();
  const session = useSession();
  const last = useRef<string | null>(null);
  const cwd = focused?.cwd;
  if (cwd && cwd !== "/") last.current = cwd;
  // Before any tab has said where it is, the session's own directory is the project.
  const at = last.current ?? session?.cwd ?? null;
  return at === null ? null : <TreeAt cwd={at} />;
}

/** The search box, the rows, and a row's menu. */
const TreeAt = memo(function TreeAt({ cwd }: { cwd: string }) {
  const t = useTheme();
  const [view, setView] = useState<View | undefined>(undefined);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; key: string } | null>(null);
  // What the search box holds, ahead of the worker's answer (it is the keyboard's, not the view's).
  const [query, setQuery] = useState("");
  const asked = useRef("");
  // The rows that are made: a window around the ones that show, moved as they scroll.
  const [made, setMade] = useState({ start: 0, end: OVERSCAN * 2 });
  const shown = useRef({ start: 0, end: 0 });
  const list = useRef<any>(null);

  /** Every gesture answers the tree as it is after it; one that cleared the search clears the box. */
  const take = (next: View | null) => setView((had) => adopt(had, next));
  const run = (call: Promise<View>) =>
    void call
      .then((next) => {
        take(next);
        if (next.filter !== asked.current) {
          asked.current = next.filter;
          setQuery(next.filter);
        }
      })
      .catch(swallow);
  /** The worker's exports answer asynchronously, the plain ones too. */
  const apply = (answer: View | Promise<View>) => run(Promise.resolve(answer));
  /** A keystroke in the search box: only the answer to the latest one is drawn. */
  const typed = (text: string) => {
    setQuery(text);
    asked.current = text;
    void filtered(text)
      .then((next) => {
        if (asked.current === text) take(next);
      })
      .catch(swallow);
  };

  useEffect(() => {
    void load(cwd).then(take).catch(swallow);
  }, [cwd]);
  // The tree is the disk: a check now and then (answered `null` when it is as it was), and again
  // after anything that wrote to it.
  const had = useRef(-1);
  had.current = view?.version ?? -1;
  useInterval(() => void reread(had.current).then(take).catch(swallow), 2_000);

  // The rows' actions, made once: each reads the latest `run`/`apply` through the ref.
  const latest = useRef({ run, apply });
  latest.current = { run, apply };
  const actions = useRef<RowActions>({
    activate: (key) => latest.current.run(activate(key)),
    name: (name) => latest.current.apply(named(name)),
    commit: () => latest.current.run(committed()),
    cancel: () => latest.current.apply(cancelled()),
    menu: (key, at) => setMenu({ at, key }),
    drop: (key, paths) => latest.current.run(dropped(key, paths)),
  }).current;

  const rows = view?.rows ?? [];
  // A new search starts at its best match, at the top; so does `cmd+f`, where the search box is.
  useEffect(() => {
    setMade({ start: 0, end: OVERSCAN * 2 });
    list.current?.scrollToItem?.(0);
  }, [view?.filter]);
  useEffect(() => {
    if (view?.filtering) list.current?.scrollToItem?.(0);
  }, [view?.filtering]);
  // The cursor moved by the keyboard stays in sight: a row above what shows comes to the top, one
  // below it to the bottom. The list's first item is the search box, so a row's item is one on.
  const selected = view?.selection ?? null;
  useEffect(() => {
    if (selected === null) return;
    const found = rows.findIndex((row) => row.key === selected);
    if (found < 0) return;
    const at = found + 1;
    const { start, end } = shown.current;
    if (at < start) list.current?.scrollToItem?.(at);
    else if (end > start && at >= end - 1) {
      const viewport = list.current?.listScrollTop?.()?.[2] ?? (end - start) * ROW;
      list.current?.scrollToItem?.(at, -(viewport - ROW));
    }
  }, [selected]);

  if (!view) return null;
  // The list's items: the search box, then the rows.
  const items = rows.length + 1;
  const start = Math.max(0, Math.min(made.start, items - 1));
  const end = Math.min(items, Math.max(made.end, start));
  const search = (
    <Search
      key={view.filtering ? "searching" : "idle"}
      value={query}
      focus={view.filtering}
      onChange={typed}
      onEnter={() => run(firstMatch())}
      onMove={(chord) => run(pressed(chord))}
      onEscape={() => apply(searching(false))}
    />
  );

  return (
    // The tree is chrome: a drag across it moves nothing and selects no names.
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, userSelect: "none" }}>
      <div
        autoFocus
        tabIndex={0}
        onKeyDown={(e: any) => {
          if (view.naming) return;
          const chord = chordOf(e);
          if (chord === "cmd+f") {
            e.preventDefault?.();
            apply(searching(true));
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
        style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}
      >
        {rows.length > 0 ? (
          <virtual-list
            ref={list}
            itemCount={items}
            estimatedItemHeight={ROW}
            windowStart={start}
            overdraw={ROW * 10}
            aria-label="Files"
            onVisibleRange={(e: any) => {
              const first = e?.startIndex ?? 0;
              const last = e?.endIndex ?? first;
              shown.current = { start: first, end: last };
              // The window moves once what shows comes within half an overscan of its edge.
              setMade((had) => {
                if (first - had.start >= OVERSCAN / 2 && had.end - last >= OVERSCAN / 2) return had;
                const next = { start: Math.max(0, first - OVERSCAN), end: last + OVERSCAN };
                return next.start === had.start && next.end === had.end ? had : next;
              });
            }}
            style={{ flexGrow: 1, minHeight: 0 }}
          >
            {Array.from({ length: end - start }, (_, i) => {
              const row = rows[start + i - 1];
              return row ? <RowView key={row.key} row={row} naming={row.editing ? view.naming : null} actions={actions} /> : search;
            })}
          </virtual-list>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {search}
            <div style={{ paddingLeft: ROW_PL, paddingTop: 6, paddingBottom: 6 }}>
              <text style={{ fontSize: 11, color: t.muted }}>{view.filter === "" ? `${view.root} is empty` : `nothing matches “${view.filter}”`}</text>
            </div>
          </div>
        )}
      </div>
      {menu ? <RowMenu view={view} menu={menu} close={() => setMenu(null)} run={run} /> : null}
    </div>
  );
});

/** The search box, the list's first item, as the agents' search: a strip the side bar's width
 *  between two rules. It searches the whole project as it is typed into; the arrows move through
 *  what it found, enter opens it, escape clears it. */
function Search({
  value,
  focus,
  onChange,
  onEnter,
  onMove,
  onEscape,
}: {
  value: string;
  focus: boolean;
  onChange(text: string): void;
  onEnter(): void;
  onMove(chord: string): void;
  onEscape(): void;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: "100%", height: SEARCH_ROW, flexShrink: 0, paddingLeft: ROW_PL + 4, paddingRight: ROW_PR, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.border }}>
      <Icon name="search" size={14} color={focused ? t.muted : t.faint} />
      <input
        value={value}
        autoFocus={focus}
        placeholder="Search files…"
        aria-label="Search files"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e: any) => onChange(e?.value ?? "")}
        onSubmit={() => onEnter()}
        onKeyDown={(e: any) => {
          // The box is inside the list: what is typed here is the box's, not the tree's keys.
          e?.stopPropagation?.();
          const chord = chordOf(e);
          if (chord === "escape") {
            onEscape();
          } else if (value !== "" && (chord === "down" || chord === "up" || chord === "ctrl+n" || chord === "ctrl+p")) {
            e?.preventDefault?.();
            onMove(chord);
          }
        }}
        style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 22, fontSize: 13, color: t.text, backgroundColor: "transparent" }}
      />
      {value !== "" ? (
        <div onClick={() => onEscape()} style={{ display: "flex", cursor: "pointer" }}>
          <Icon name="close" size={CHEVRON} color={t.muted} />
        </div>
      ) : null}
    </div>
  );
}

/** One row: its guides, its triangle, its icon and its name, or the field it is renamed in. It
 *  takes the list's whole width (a virtual row is laid out on its own and would otherwise grow to
 *  its content), and a name too long for it ends in an ellipsis rather than running past it. */
const RowView = memo(function RowView({ row, naming, actions }: { row: Row; naming: { name: string; isDir: boolean } | null; actions: RowActions }) {
  const t = useTheme();
  const m = useMetrics();
  const light = useAppearance() === "light";
  const drag = useDraggable({ path: row.path }, { disabled: row.path === "" });
  const drop = useDroppable({ onDrop: (data) => actions.drop(row.key, pathsOf(data)) });
  const color = colorTokens(row.color).map((token) => t[token]).find((each) => each !== undefined) ?? t.text;
  return (
    <div
      {...drag.props}
      ref={drop.ref}
      onClick={() => {
        if (drag.wasDragged()) return;
        actions.activate(row.key);
      }}
      onAuxClick={(e: any) => {
        if (!e?.isRightClick) return;
        actions.menu(row.key, { x: e.x ?? 0, y: e.y ?? 0 });
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        width: "100%",
        minWidth: 0,
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
      <div style={{ display: "flex", width: DISCLOSURE, height: ROW, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
        {row.kind === "folder" ? <Icon name={row.open ? "chevron_down" : "chevron_right"} size={CHEVRON} color={t.muted} /> : null}
      </div>
      {row.icon !== "" ? <img src={iconPath(row.icon, light)} objectFit="contain" style={{ width: ICON, height: ICON, flexShrink: 0, marginRight: ICON_GAP }} /> : null}
      {row.editing ? (
        <input
          value={naming?.name ?? ""}
          autoFocus
          placeholder="name"
          onChange={(e: any) => actions.name(e?.value ?? "")}
          onSubmit={() => actions.commit()}
          onBlur={() => actions.commit()}
          onKeyDown={(e: any) => {
            if (e?.key !== "escape") return;
            e?.stopPropagation?.();
            actions.cancel();
          }}
          style={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0, height: ROW - 4, fontSize: 13, color: t.text, borderRadius: m.radiusSmall }}
        />
      ) : (
        <div style={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: "hidden" }}>
          <text style={{ fontSize: 13, color, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>{row.text}</text>
        </div>
      )}
    </div>
  );
});

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

/** Which group of the menu an action is in: a rule is drawn between groups, as in Zed's. */
const MENU_GROUP: Record<string, number> = {
  "New File": 0,
  "New Folder": 0,
  "Reveal in Finder": 1,
  "Open in Default App": 1,
  "Unfold Directory": 1,
  "Fold Directory": 1,
  Cut: 2,
  Copy: 2,
  Duplicate: 2,
  Paste: 2,
  "Copy Path": 3,
  "Copy Relative Path": 3,
  "Add to .gitignore": 4,
  "Add to .git/info/exclude": 4,
  Rename: 5,
  Trash: 5,
  Delete: 5,
  "Expand All": 6,
  "Collapse All": 6,
};

/** The keys the tree itself answers for an action (`TreeAt`'s and the panel's `key`), as a Mac
 *  menu writes them. Only keys that work are shown. */
const MENU_KEYS: Record<string, string> = {
  "New File": "⌘ N",
  "New Folder": "⇧ ⌘ N",
  Cut: "⌘ X",
  Copy: "⌘ C",
  Paste: "⌘ V",
  Rename: "F2",
  Trash: "⌫",
  Delete: "⌦",
};

/** A row's menu, where it was right-pressed: the row's own actions in their groups, a rule between,
 *  each with its keys at the far end. A press outside it closes it. */
function RowMenu({ view, menu, close, run }: { view: View; menu: { at: { x: number; y: number }; key: string }; close(): void; run(call: Promise<View>): void }) {
  const t = useTheme();
  const m = useMetrics();
  const row = view.rows.find((each) => each.key === menu.key);
  const actions = row?.actions ?? [];
  return (
    // The layer is transparent (a fill of its own paints a square behind the card's corners), so
    // the card is what hears the press outside.
    <anchored position={menu.at} fit="snap" snapMargin={8} deferred occlude style={{ backgroundColor: "transparent" }}>
      <div
        onMouseDownOutside={close}
        style={{ display: "flex", flexDirection: "column", minWidth: 220, userSelect: "none", paddingTop: 4, paddingBottom: 4, borderRadius: m.radius + 2, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: "#00000066" } }}
      >
        {actions.map((name, i) => (
          <Fragment key={name}>
            {i > 0 && MENU_GROUP[name] !== MENU_GROUP[actions[i - 1]!] ? <div style={{ height: 1, flexShrink: 0, marginTop: 4, marginBottom: 4, backgroundColor: t.border }} /> : null}
            <div
              onClick={() => {
                close();
                run(chose(name, menu.key));
              }}
              style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16, height: 22, flexShrink: 0, marginLeft: 4, marginRight: 4, paddingLeft: 6, paddingRight: 6, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
            >
              <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap", flexShrink: 1, minWidth: 0 }}>{name}</text>
              <div style={{ flexGrow: 1 }} />
              {MENU_KEYS[name] ? <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", flexShrink: 0 }}>{MENU_KEYS[name]}</text> : null}
            </div>
          </Fragment>
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
