// csv-viewer: what a file tab draws when this plugin draws it (the manifest's `renderers.file`, matched
// by extension): the file as a table, worked out by TanStack Table — sorted by a press on a
// column's name, searched as you type, laid out to the tab's width with dividers a drag moves,
// and drawn only as far down as the tab shows. Cells are picked, alone or in blocks, with the
// pointer and the keys, copied, and edited in place; edits are kept here, undone and redone here,
// and written to the file when saved. The parsing, and the disk, are the worker's (`main.ts`,
// `parse.ts`, `write.ts`); what an edit is, is `edit.ts`; what is picked, `select.ts`.
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type FilterFn, type SortingState } from "@tanstack/react-table";
import { Icon, IconButton, call, keyGlyphs, useChannelListener, useMetrics, useOption, usePlugin, useTab, useTheme, type RendererProps } from "pumi";

import { note, read as load, reload, save as saveFile, unwatch, watch, type Loaded, type ReadAs } from "./main.ts";
import { apply, deleteColumn, deleteRows, insertColumn, insertRows, inverse, renameColumn, setCells, sheetOf, wire, type Op, type Sheet } from "./edit.ts";
import { HEADER, ROW, bytes as sizeOf, count, naturalWidths, planWidths, resizeWidths } from "./layout.ts";
import { compareCells, matchesRow } from "./parse.ts";
import { blockOf, copied as copyOf, delimited, isRange, moved, placesOf, rowsOf, tsv, type Block, type Selection, type Spot } from "./select.ts";
import { GUTTER, HeaderRow, OVERSCAN, RowView, gridWidth, type After, type GridActions } from "./ui/grid.tsx";
import { Menu, type MenuAt, type MenuEntry } from "./ui/menu.tsx";

/** The rows of a file not read yet, and the same array every render, so the table keeps its state. */
const NOTHING: string[][] = [];
/** The extensions the manifest's `renderers.file` claims. */
const EXTENSIONS = ["csv", "tsv", "tab", "psv", "dsv"];
/** How many rows the window is moved by at a time: scroll a screenful, ask React for rows. */
const STEP = 10;
/** The worker's channel: a file that changed, or was asked to be read again. */
const CHANGED = "changed";
/** The room a scrollbar takes at the grid's right and bottom edge. */
const SCROLLBAR = 8;
/** The keys, as the menus show them. */
const KEYS = { copy: keyGlyphs("cmd+c"), save: keyGlyphs("cmd+s"), undo: keyGlyphs("cmd+z"), redo: keyGlyphs("cmd+shift+z"), edit: "↩", clear: "⌫" };

/** Whether a path is one this plugin draws, by its extension. */
export function isCsv(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).toLowerCase();
  return EXTENSIONS.includes(name.slice(name.lastIndexOf(".") + 1));
}

/** A throw the table cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`csv-viewer: ${err instanceof Error ? err.message : String(err)}`);
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** What the search box keeps: a row with every word of the text in some cell. */
const searchAll: FilterFn<string[]> = (row, _columnId, value) => matchesRow(row.original, String(value ?? ""));

/** A column's id in the table: its key, which an insert or a delete beside it does not change. */
const idOf = (key: number) => `k${key}`;

/** How the table is sorted, as the footer says it: `price ↑, name ↓`. */
function sortedBy(sorting: SortingState, sheet: Sheet): string {
  return sorting
    .map((order) => {
      const index = sheet.keys.findIndex((key) => idOf(key) === order.id);
      return `${sheet.headers[index] ?? order.id} ${order.desc ? "↓" : "↑"}`;
    })
    .join(", ");
}

/** The table being edited, and its edits: those made (oldest first, what a save writes), and those
 *  undone (what ⌘⇧Z makes again). */
interface Doc {
  sheet: Sheet;
  done: Op[];
  undone: Op[];
}

const docOf = (data: Loaded): Doc => ({ sheet: sheetOf(data.headers, data.rows, data.kinds, data.hasHeader), done: [], undone: [] });
const isDirty = (doc: Doc | null) => (doc?.done.length ?? 0) > 0;

/** What the edit strip has to say beyond how many edits there are. */
type Notice =
  /** The file changed on disk while there are edits: they are kept, and it is not read. */
  | { kind: "changed" }
  /** A save found the file changed since it was read. */
  | { kind: "conflict" }
  /** Reading the file again was asked for, with edits that it would drop. */
  | { kind: "reload" }
  | { kind: "error"; text: string };

/** The renderer of the core's `file` block: a delimited file as a table. */
export function Table(props: RendererProps) {
  return (
    <Failure>
      <TableBody {...props} />
    </Failure>
  );
}

/**
 * A throw below it — a file that is not what it says, an option that makes no sense — draws its
 * message over the tab and goes in the plugin's log (`pumi plugin logs pumi_dev/csv-viewer`),
 * rather than leaving a blank tab with nothing to go on.
 */
class Failure extends Component<{ children?: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    void note(`drawing the table threw: ${error?.message ?? String(error)}`).catch(() => undefined);
  }
  override render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    return <Failed error={error} />;
  }
}

/** What the boundary draws instead of the table. */
function Failed({ error }: { error: Error }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12 }}>
      <text style={{ fontSize: 13, color: t.error }}>{`The table could not be drawn: ${error.message}`}</text>
      <text style={{ fontSize: 11, color: t.muted }}>The log (`pumi plugin logs pumi_dev/csv-viewer`) has the rest. Reading the file again often fixes it.</text>
    </div>
  );
}

/** The table itself: what the boundary above draws. */
function TableBody({ tab }: RendererProps) {
  const id = tab.id;
  const each = useTab(id);
  const path = String(((each?.options ?? {}) as Record<string, unknown>).path ?? "");
  // A plugin's prefix is `owner.name.` with `-` as `_`: `pumi_dev.csv_viewer.`.
  const prefix = `${(usePlugin() ?? "").replace("/", ".").replaceAll("-", "_")}.`;
  const [numbers] = useOption<boolean>(`${prefix}numbers`);
  const [striped] = useOption<boolean>(`${prefix}striped`);
  const [follow] = useOption<boolean>(`${prefix}watch_file`);
  // The options the parse depends on: changing one reads the file again.
  const [header] = useOption<string>(`${prefix}header`);
  const [delimiter] = useOption<string>(`${prefix}delimiter`);
  const [atMost] = useOption<number>(`${prefix}max_rows`);
  const [widthsAs, setWidthsAs] = useOption<string>(`${prefix}columns`);
  /** Whether the columns are squeezed to the pane's width instead of scrolling sideways. */
  const fitted = widthsAs === "fit";
  const t = useTheme();

  /** The file as read: what the edits are made on, and what a save says it started from. */
  const [data, setData] = useState<Loaded | null>(null);
  const [doc, setDocState] = useState<Doc | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  /** Bumped to read the file again: a press, or the worker saying it changed. */
  const [asked, setAsked] = useState(0);
  /** How this tab read the file before it saved: kept while the options are the ones it saved under. */
  const [pinned, setPinned] = useState<{ path: string; opts: string; as: ReadAs } | null>(null);
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  /** The cell being edited, and the column being renamed (-1: none). */
  const [editing, setEditing] = useState<Spot | null>(null);
  const [renaming, setRenaming] = useState(-1);
  const [menu, setMenu] = useState<{ at: MenuAt; items: MenuEntry[] } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState("");
  /** Bumped to give the grid the keys back once a field is done with. */
  const [focusTick, setFocusTick] = useState(0);
  /** The room the grid has, measured: its width shares the columns out, its height says how many
   *  rows fit. */
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [widths, setWidths] = useState<number[]>([]);
  /** The step of rows the table is scrolled to: the scroller moves natively (both ways, the header
   *  with it), and this only changes when another step comes into view. */
  const [bucket, setBucket] = useState(0);
  const scroller = useRef<any>(null);
  /** Where the grid is scrolled to, as the scroller last said. */
  const scrolled = useRef({ x: 0, y: 0 });
  /** The widths each column's contents ask for, by place: what `fit` and the pane share out. */
  const natural = useRef<number[]>([]);
  /** The next read is this tab's own doing (a save, or edits dropped): it replaces the edits, and
   *  keeps what is picked and where the table is scrolled. */
  const ownRead = useRef(false);
  const keepScroll = useRef(false);
  /** Where the grid's box is in the window, as it last said: what a pointer's place is measured from. */
  const origin = useRef({ x: 0, y: 0 });
  /** Whether the grid has the keys now (its focus holder is focused). */
  const hasKeys = useRef(false);
  /** A drag across cells is in flight. */
  const dragging = useRef(false);
  const savingNow = useRef(false);

  const docRef = useRef<Doc | null>(null);
  docRef.current = doc;
  const dataRef = useRef<Loaded | null>(null);
  dataRef.current = data;
  const setDoc = useCallback((next: Doc | null) => {
    docRef.current = next;
    setDocState(next);
  }, []);
  const sheet = doc?.sheet ?? null;
  const dirty = isDirty(doc);

  const optsKey = `${header}|${delimiter}`;
  const as = pinned && pinned.path === path && pinned.opts === optsKey ? pinned.as : null;
  const asKey = as ? `${as.header}|${as.delimiter}` : "";

  const resize = useCallback((index: number, delta: number, from: number[]) => setWidths((now) => resizeWidths(now.length === from.length ? now : from, index, delta)), []);

  // Read the file: when the pane shows another, when an option the parse reads changes, and when
  // it is asked for again. Edits not saved are not thrown away by a read the tab did not ask for:
  // the file is left as it was read, and the strip says it changed.
  useEffect(() => {
    if (path === "") {
      setData(null);
      setDoc(null);
      setFailed(null);
      return;
    }
    let live = true;
    setReading(true);
    void load(path, as)
      .then((next) => {
        if (!live) return;
        const own = ownRead.current;
        ownRead.current = false;
        if (!own && isDirty(docRef.current) && dataRef.current?.path === next.path) {
          setNotice({ kind: "changed" });
          return;
        }
        setData(next);
        setDoc(docOf(next));
        setFailed(null);
        setEditing(null);
        setRenaming(-1);
        setNotice(null);
        if (own) keepScroll.current = true;
        else setSelection(null);
      })
      .catch((err) => {
        if (!live) return;
        ownRead.current = false;
        if (isDirty(docRef.current)) {
          setNotice({ kind: "error", text: messageOf(err) });
          return;
        }
        setData(null);
        setDoc(null);
        setFailed(messageOf(err));
      })
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [path, asked, header, delimiter, atMost, asKey]);

  // Follow the file while it is drawn: a script that rewrites it is what this is for.
  useEffect(() => {
    if (path === "" || follow === false) return;
    void watch(path).catch(swallow);
    return () => {
      void unwatch(path).catch(swallow);
    };
  }, [path, follow]);

  /** Read the file again — unless that drops edits, which is asked first. */
  const askReload = useCallback(() => {
    if (isDirty(docRef.current)) setNotice({ kind: "reload" });
    else setAsked((n) => n + 1);
  }, []);

  /** Read the file again, dropping the edits. */
  const readAgain = useCallback(() => {
    ownRead.current = true;
    setNotice(null);
    setAsked((n) => n + 1);
  }, []);

  // The worker says which file changed: the one this pane shows is read again, by every view of it.
  // A change to the time it was read at, or one this tab's own save made, is not news.
  useChannelListener(CHANGED, (message: unknown) => {
    const said = (message ?? {}) as { path?: unknown; mtime?: unknown; from?: unknown };
    if (typeof said.path !== "string" || said.path !== path || said.from === id) return;
    if (typeof said.mtime === "number" && said.mtime === dataRef.current?.mtime) return;
    if (typeof said.mtime === "number" && isDirty(docRef.current)) setNotice({ kind: "changed" });
    else askReload();
  });

  const columns = useMemo<ColumnDef<string[], unknown>[]>(() => {
    if (!sheet) return [];
    return sheet.headers.map((name, index) => ({
      id: idOf(sheet.keys[index]!),
      accessorFn: (row: string[]) => row[index] ?? "",
      header: name,
      sortingFn: (a, b, columnId) => compareCells(String(a.getValue(columnId) ?? ""), String(b.getValue(columnId) ?? ""), sheet.kinds[index] ?? "text"),
    }));
  }, [sheet?.headers, sheet?.keys, sheet?.kinds]);

  // A sort on a column taken out is not a sort any more.
  const validSorting = useMemo(() => sorting.filter((order) => columns.some((column) => column.id === order.id)), [sorting, columns]);

  const table = useReactTable({
    data: sheet?.rows ?? NOTHING,
    columns,
    state: { sorting: validSorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: searchAll,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // A file read again keeps the sort and the search: they are the reader's, not the file's.
    autoResetAll: false,
  });

  // As wide as their contents ask, the way a spreadsheet is — or squeezed to share the pane's width
  // when that is what the reader asked for. Room to spare is shared out either way. A column put in
  // or taken out moves the widths itself (`columnsMoved`), so a drag to one is kept.
  const measured = useRef<Loaded | null>(null);
  useEffect(() => {
    if (!data) {
      natural.current = [];
      setWidths([]);
      return;
    }
    if (measured.current !== data) {
      measured.current = data;
      natural.current = naturalWidths(data.headers, data.rows, data.kinds.map((kind) => kind === "number"));
    }
    const plan = planWidths(natural.current, Math.max(0, box.width - GUTTER), { fit: fitted });
    setWidths(plan.widths.length === natural.current.length ? plan.widths : natural.current);
  }, [data, box.width, fitted]);

  const rows = table.getRowModel().rows;
  const kept = table.getFilteredRowModel().rows.length;
  /** The file's rows in the order shown, and where each is shown. */
  const order = useMemo(() => rows.map((row) => row.index), [rows]);
  const places = useMemo(() => placesOf(order, sheet?.rows.length ?? 0), [order, sheet?.rows.length]);
  const columnCount = sheet?.headers.length ?? 0;
  const block = useMemo(() => blockOf(selection, places, columnCount), [selection, places, columnCount]);
  const width = gridWidth(widths);
  /** The rows' room: below the bar, less the header. At least three rows, so a pane that has not
   *  been laid out yet draws some rather than none. */
  const listHeight = Math.max(ROW * 3, box.height - HEADER);
  const scrolls = width > box.width;
  // Only the rows near what shows are made — and in steps of a screenful, so a swipe makes rows once
  // in a while rather than at every pixel: scrolling itself is the window's, not React's.
  const visible = Math.max(1, Math.ceil(listHeight / ROW));
  const first = Math.max(0, bucket - OVERSCAN);
  const last = Math.min(rows.length, bucket + visible + OVERSCAN * 2);
  const numeric = useMemo(() => (sheet ? sheet.kinds.map((kind) => kind === "number") : []), [sheet?.kinds]);

  // What the handlers below read: the table as it is drawn now, whenever they run.
  const now = useRef({ sheet, data, order, places, block, selection, editing, renaming, widths, box, visible, rows: rows.length });
  now.current = { sheet, data, order, places, block, selection, editing, renaming, widths, box, visible, rows: rows.length };

  /** Give the grid the keys: a new focus holder takes them as it is made. Not while the one there
   *  has them, since taking out the focused element leaves nothing focused. */
  const takeKeys = useCallback(() => {
    if (!hasKeys.current) setFocusTick((n) => n + 1);
  }, []);

  // ---- copying

  const toClipboard = useCallback((text: string, said: string) => {
    void call("clipboard.set", text)
      .then(() => setCopied(said))
      .catch(swallow);
  }, []);

  const short = (value: string) => (value.length > 40 ? `${value.slice(0, 40)}…` : value);

  const copyBlock = useCallback(() => {
    const { block: b, order: o, sheet: s } = now.current;
    if (!b || !s) return;
    const text = copyOf(b, o, s.rows);
    const cells = (b.bottom - b.top + 1) * (b.right - b.left + 1);
    toClipboard(text, cells === 1 ? `${short(text)} copied` : `${count(cells)} cells copied`);
  }, [toClipboard]);

  const copyRows = useCallback(() => {
    const { block: b, order: o, sheet: s, data: d } = now.current;
    if (!b || !s || !d) return;
    const picked = rowsOf(b, o).map((row) => s.rows[row] ?? []);
    toClipboard(delimited(picked, d.delimiter), `${count(picked.length)} ${picked.length === 1 ? "row" : "rows"} copied`);
  }, [toClipboard]);

  const copyColumns = useCallback((left: number, right: number) => {
    const { order: o, sheet: s } = now.current;
    if (!s) return;
    toClipboard(tsv(o.map((row) => (s.rows[row] ?? []).slice(left, right + 1))), `${count(o.length)} values copied`);
  }, [toClipboard]);

  // What was copied is said for a moment, and not once something else is picked.
  useEffect(() => setCopied(""), [selection]);
  // What was copied is said for a moment, not for as long as the pane shows the file.
  useEffect(() => {
    if (copied === "") return;
    const timer = setTimeout(() => setCopied(""), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  // ---- moving about

  /** The file's row shown at `place`, at `column`. */
  const spotAt = (place: number, column: number): Spot | null => {
    const row = now.current.order[place];
    return row === undefined ? null : { row, column };
  };

  /** The cell under a point of the window, as a place shown and a column; null with no rows. Past
   *  an edge it is the cell at that edge, so a drag out of the grid keeps going to it. */
  const cellAt = (x: number, y: number): { place: number; column: number } | null => {
    const { widths: w, rows: shown } = now.current;
    if (shown === 0 || w.length === 0) return null;
    const cx = x - origin.current.x + scrolled.current.x - GUTTER;
    const cy = y - origin.current.y + scrolled.current.y - HEADER;
    const place = Math.max(0, Math.min(shown - 1, Math.floor(cy / ROW)));
    let column = 0;
    let edge = 0;
    while (column < w.length - 1 && cx >= edge + w[column]!) edge += w[column++]!;
    return { place, column };
  };

  /** Scroll so the cell shown at `place`, `column` is in view. */
  const reveal = useCallback((place: number, column: number) => {
    const { widths: w, box: b } = now.current;
    const viewW = Math.max(0, b.width - SCROLLBAR);
    const viewH = Math.max(0, b.height - SCROLLBAR);
    let { x, y } = scrolled.current;
    const top = HEADER + place * ROW;
    if (top < y + (place === 0 ? HEADER : 0)) y = place === 0 ? 0 : top;
    else if (top + ROW > y + viewH) y = top + ROW - viewH;
    const left = GUTTER + w.slice(0, column).reduce((a, c) => a + c, 0);
    const right = left + (w[column] ?? 0);
    if (left < x) x = column === 0 ? 0 : left;
    else if (right > x + viewW) x = Math.min(left, right - viewW);
    if (x === scrolled.current.x && y === scrolled.current.y) return;
    scrolled.current = { x, y };
    scroller.current?.scrollTo?.(x, y);
  }, []);

  /** Pick the cell shown at `place`, or grow the block to it. */
  const goTo = useCallback(
    (place: number, column: number, grow: boolean) => {
      const spot = spotAt(place, column);
      if (!spot) return;
      const sel = now.current.selection;
      setSelection(grow && sel ? { anchor: sel.anchor, focus: spot } : { anchor: spot, focus: spot });
      reveal(place, column);
    },
    [reveal],
  );

  // ---- editing

  /** A message for an edit the file cannot take, or null when it can. */
  const refused = (): string | null => {
    const d = now.current.data;
    if (!d) return "no file";
    if (!d.writable) return "This file is not UTF-8 throughout, so it is not edited: saving it would change the bytes that are not.";
    if (savingNow.current) return "Saving: a moment.";
    return null;
  };

  /** A column put in or taken out moves the widths with it. */
  const columnsMoved = useCallback((op: Op) => {
    if (op.kind === "insertColumn") {
      const w = naturalWidths([op.name], [], [false])[0]!;
      natural.current = natural.current.slice();
      natural.current.splice(op.at, 0, w);
      setWidths((had) => {
        const next = had.slice();
        next.splice(op.at, 0, w);
        return next;
      });
    } else if (op.kind === "deleteColumn") {
      natural.current = natural.current.filter((_, i) => i !== op.at);
      setWidths((had) => had.filter((_, i) => i !== op.at));
    }
  }, []);

  /** Make an edit, and keep it to undo. */
  const edit = useCallback(
    (op: Op | null) => {
      const d = docRef.current;
      if (!d || !op) return;
      const no = refused();
      if (no) {
        setNotice({ kind: "error", text: no });
        return;
      }
      setDoc({ sheet: apply(d.sheet, op), done: [...d.done, op], undone: [] });
      columnsMoved(op);
    },
    [setDoc, columnsMoved],
  );

  /** Where an edit happened, to pick once it is made or undone. */
  const pickAfter = useCallback(
    (op: Op, s: Sheet) => {
      const column = now.current.selection?.focus.column ?? 0;
      let spot: Spot | null = null;
      if (op.kind === "set") spot = { row: op.cells[0]!.row, column: op.cells[0]!.column };
      else if (op.kind === "insertRows") spot = { row: op.at[0]!, column };
      else if (op.kind === "deleteRows") spot = s.rows.length > 0 ? { row: Math.min(op.at[0]!, s.rows.length - 1), column } : null;
      else if (op.kind === "insertColumn" || op.kind === "rename") spot = { row: now.current.selection?.focus.row ?? 0, column: op.kind === "rename" ? op.column : op.at };
      else if (op.kind === "deleteColumn") spot = { row: now.current.selection?.focus.row ?? 0, column: Math.min(op.at, s.headers.length - 1) };
      if (!spot || spot.row >= s.rows.length) return setSelection(null);
      setSelection({ anchor: spot, focus: spot });
    },
    [],
  );

  const undo = useCallback(() => {
    const d = docRef.current;
    if (!d || d.done.length === 0 || savingNow.current) return;
    const op = d.done.at(-1)!;
    const back = inverse(op);
    const sheetNow = apply(d.sheet, back);
    setDoc({ sheet: sheetNow, done: d.done.slice(0, -1), undone: [...d.undone, op] });
    columnsMoved(back);
    pickAfter(back, sheetNow);
  }, [setDoc, columnsMoved, pickAfter]);

  const redo = useCallback(() => {
    const d = docRef.current;
    if (!d || d.undone.length === 0 || savingNow.current) return;
    const op = d.undone.at(-1)!;
    const sheetNow = apply(d.sheet, op);
    setDoc({ sheet: sheetNow, done: [...d.done, op], undone: d.undone.slice(0, -1) });
    columnsMoved(op);
    pickAfter(op, sheetNow);
  }, [setDoc, columnsMoved, pickAfter]);

  /** Throw the edits away: the table as the file was read. */
  const discard = useCallback(() => {
    const d = dataRef.current;
    if (!d) return;
    setDoc(docOf(d));
    natural.current = naturalWidths(d.headers, d.rows, d.kinds.map((kind) => kind === "number"));
    const plan = planWidths(natural.current, Math.max(0, now.current.box.width - GUTTER), { fit: fitted });
    setWidths(plan.widths.length === natural.current.length ? plan.widths : natural.current);
    setEditing(null);
    setRenaming(-1);
    setNotice(null);
  }, [setDoc, fitted]);

  /** Write the edits to the file. `force` writes over a file that changed since it was read. */
  const save = useCallback(
    async (force = false) => {
      const d = docRef.current;
      const base = dataRef.current;
      if (!d || !base || d.done.length === 0 || savingNow.current) return;
      savingNow.current = true;
      setSaving(true);
      try {
        const result = await saveFile({ path: base.path, mtime: base.mtime, delimiter: base.delimiter, hasHeader: base.hasHeader, ops: d.done.map(wire), force, from: id });
        if (!result.ok) {
          setNotice(result.why === "changed" ? { kind: "conflict" } : { kind: "error", text: "The file as it was read is no longer held, so the edits cannot be written over it. Read it again to start from what is there now." });
          return;
        }
        // Read it as it was read, whatever the guess would make of it now, and keep what is picked.
        setPinned({ path, opts: optsKey, as: { header: base.hasHeader ? "first" : "none", delimiter: base.delimiterName } });
        ownRead.current = true;
        setNotice(null);
        setAsked((n) => n + 1);
      } catch (err) {
        setNotice({ kind: "error", text: `Not saved: ${messageOf(err)}` });
      } finally {
        savingNow.current = false;
        setSaving(false);
      }
    },
    [path, optsKey, id],
  );

  /** Edit a cell: the focus, or `spot`. */
  const startEdit = useCallback(
    (spot?: Spot) => {
      const at = spot ?? now.current.selection?.focus;
      if (!at || now.current.renaming >= 0 || !now.current.sheet) return;
      const no = refused();
      if (no) {
        setNotice({ kind: "error", text: no });
        return;
      }
      setSelection({ anchor: at, focus: at });
      setEditing(at);
      const place = now.current.places[at.row] ?? -1;
      if (place >= 0) reveal(place, at.column);
    },
    [reveal],
  );

  /** Rename a column: its name in the header becomes a field. */
  const startRename = useCallback((column: number) => {
    const s = now.current.sheet;
    if (!s?.named || now.current.editing) return;
    const no = refused();
    if (no) {
      setNotice({ kind: "error", text: no });
      return;
    }
    setRenaming(column);
  }, []);

  /** Empty every cell of the block. */
  const clearBlock = useCallback(() => {
    const { block: b, order: o, sheet: s } = now.current;
    if (!b || !s) return;
    const cells: { row: number; column: number; value: string }[] = [];
    for (const row of rowsOf(b, o)) for (let column = b.left; column <= b.right; column++) cells.push({ row, column, value: "" });
    edit(setCells(s, cells));
  }, [edit]);

  const addRows = useCallback(
    (below: boolean) => {
      const s = now.current.sheet;
      if (!s) return;
      const focus = now.current.selection?.focus;
      const at = focus ? focus.row + (below ? 1 : 0) : s.rows.length;
      const op = insertRows(s, at);
      edit(op);
      const spot = { row: op.kind === "insertRows" ? op.at[0]! : at, column: focus?.column ?? 0 };
      setSelection({ anchor: spot, focus: spot });
    },
    [edit],
  );

  const dropRows = useCallback(() => {
    const { block: b, order: o, sheet: s } = now.current;
    if (!b || !s) return;
    const op = deleteRows(s, rowsOf(b, o));
    if (!op) return;
    edit(op);
    pickAfter(op, apply(s, op));
  }, [edit, pickAfter]);

  const addColumn = useCallback(
    (at: number) => {
      const s = now.current.sheet;
      if (!s) return;
      const no = refused();
      if (no) {
        setNotice({ kind: "error", text: no });
        return;
      }
      const op = insertColumn(s, at);
      edit(op);
      const row = now.current.selection?.focus.row ?? 0;
      if (s.rows.length > 0) setSelection({ anchor: { row, column: op.kind === "insertColumn" ? op.at : at }, focus: { row, column: op.kind === "insertColumn" ? op.at : at } });
      // A new column is named as it comes, where the file has names.
      if (s.named && op.kind === "insertColumn") setRenaming(op.at);
    },
    [edit],
  );

  const dropColumn = useCallback(
    (at: number) => {
      const s = now.current.sheet;
      if (!s) return;
      const op = deleteColumn(s, at);
      if (!op) {
        setNotice({ kind: "error", text: "The table keeps at least one column." });
        return;
      }
      edit(op);
      pickAfter(op, apply(s, op));
    },
    [edit, pickAfter],
  );

  // ---- the menus

  const cellMenu = useCallback((): MenuEntry[] => {
    const { block: b, sheet: s } = now.current;
    if (!b || !s) return [];
    const range = isRange(b);
    const rowCount = b.bottom - b.top + 1;
    const column = now.current.selection?.focus.column ?? b.left;
    return [
        { label: range ? "Copy cells" : "Copy", keys: KEYS.copy, run: copyBlock },
        { label: rowCount === 1 ? "Copy row" : `Copy ${count(rowCount)} rows`, run: copyRows },
        { label: b.left === b.right ? "Copy column" : "Copy columns", run: () => copyColumns(b.left, b.right) },
        "-",
        ...(range ? [] : [{ label: "Edit cell", keys: KEYS.edit, run: () => startEdit() }]),
        { label: range ? "Clear cells" : "Clear cell", keys: KEYS.clear, run: clearBlock },
        "-",
        { label: "Insert row above", run: () => addRows(false) },
        { label: "Insert row below", run: () => addRows(true) },
        { label: rowCount === 1 ? "Delete row" : `Delete ${count(rowCount)} rows`, danger: true, run: dropRows },
        "-",
        { label: "Insert column left", run: () => addColumn(column) },
        { label: "Insert column right", run: () => addColumn(column + 1) },
        ...(s.named ? [{ label: "Rename column", run: () => startRename(column) }] : []),
        { label: "Delete column", danger: true, disabled: s.headers.length <= 1, run: () => dropColumn(column) },
      ];
  }, [copyBlock, copyRows, copyColumns, startEdit, clearBlock, addRows, dropRows, addColumn, startRename, dropColumn]);

  const headerMenu = useCallback(
    (column: number): MenuEntry[] => {
      const s = now.current.sheet;
      if (!s) return [];
      const col = table.getColumn(idOf(s.keys[column]!));
      const sorted = col?.getIsSorted() ?? false;
      return [
        { label: "Sort up", disabled: sorted === "asc", run: () => col?.toggleSorting(false, false) },
        { label: "Sort down", disabled: sorted === "desc", run: () => col?.toggleSorting(true, false) },
        { label: "Stop sorting", disabled: sorted === false, run: () => col?.clearSorting() },
        "-",
        { label: "Copy column", run: () => copyColumns(column, column) },
        "-",
        ...(s.named ? [{ label: "Rename column", run: () => startRename(column) }] : []),
        { label: "Insert column left", run: () => addColumn(column) },
        { label: "Insert column right", run: () => addColumn(column + 1) },
        { label: "Delete column", danger: true, disabled: s.headers.length <= 1, run: () => dropColumn(column) },
      ];
    },
    [table, copyColumns, startRename, addColumn, dropColumn],
  );

  // ---- what the cells and names do

  const actions = useMemo<GridActions>(() => {
    const done: GridActions["done"] = (value, commit, after, keyed) => {
      const { editing: cell, renaming: column, sheet: s, places: p, order: o, rows: shown } = now.current;
      if (column >= 0) {
        setRenaming(-1);
        if (commit && s) edit(renameColumn(s, column, value));
      } else if (cell) {
        setEditing(null);
        // Where the focus goes is worked out in the order shown before the edit, which may sort
        // the row somewhere else.
        const place = p[cell.row] ?? -1;
        if (commit && s) edit(setCells(s, [{ row: cell.row, column: cell.column, value }]));
        if (after && place >= 0) {
          const to = moved({ place, column: cell.column }, after, { rows: shown, columns: s?.headers.length ?? 0, page: 1 });
          const row = to ? o[to.place] : undefined;
          if (to && row !== undefined) {
            const spot = { row, column: to.column };
            setSelection({ anchor: spot, focus: spot });
            reveal(to.place, to.column);
          }
        }
      } else return;
      if (keyed) takeKeys();
    };
    return {
      press(row, column, shift) {
        dragging.current = true;
        setMenu(null);
        const sel = now.current.selection;
        const spot = { row, column };
        setSelection(shift && sel ? { anchor: sel.anchor, focus: spot } : { anchor: spot, focus: spot });
        // A press on a cell does not focus the grid by itself: this gives it the keys.
        takeKeys();
      },
      drag(x, y, held) {
        if (!dragging.current) return;
        // A drag that ended outside the grid ends the first time the pointer moves in it again.
        if (!held) {
          dragging.current = false;
          return;
        }
        const cell = cellAt(x, y);
        const spot = cell ? spotAt(cell.place, cell.column) : null;
        if (!spot) return;
        setSelection((had) => (had && (had.focus.row !== spot.row || had.focus.column !== spot.column) ? { anchor: had.anchor, focus: spot } : had));
      },
      release() {
        dragging.current = false;
      },
      pressRow(row, shift) {
        setMenu(null);
        const lastColumn = Math.max(0, (now.current.sheet?.headers.length ?? 1) - 1);
        const sel = now.current.selection;
        setSelection(shift && sel ? { anchor: { row: sel.anchor.row, column: 0 }, focus: { row, column: lastColumn } } : { anchor: { row, column: 0 }, focus: { row, column: lastColumn } });
        takeKeys();
      },
      edit(row, column) {
        startEdit({ row, column });
      },
      menu(row, column, at) {
        dragging.current = false;
        if (row < 0) {
          setMenu({ at, items: headerMenu(column) });
          return;
        }
        // A right press outside the block picks the cell it was on; inside, the block stays.
        const b = now.current.block;
        const place = now.current.places[row] ?? -1;
        const inside = b !== null && place >= b.top && place <= b.bottom && column >= b.left && column <= b.right;
        if (!inside) {
          const spot = { row, column };
          const sel = { anchor: spot, focus: spot };
          setSelection(sel);
          now.current = { ...now.current, selection: sel, block: blockOf(sel, now.current.places, now.current.sheet?.headers.length ?? 0) };
        }
        setMenu({ at, items: cellMenu() });
      },
      done,
      save(value) {
        done(value, true, null, true);
        // The edit is made by the time the save reads it: `edit` sets the doc's ref at once.
        void save();
      },
    };
  }, [startEdit, headerMenu, cellMenu, edit, reveal, save, takeKeys]);

  // ---- the keys

  const onKey = (e: any) => {
    const key = typeof e?.key === "string" ? e.key : "";
    const mods = e?.modifiers ?? {};
    const primary = Boolean(mods.cmd || mods.ctrl);
    const handled = () => e?.preventDefault?.();
    if (menu) {
      if (key === "escape") {
        handled();
        setMenu(null);
      }
      return;
    }
    if (primary && !mods.alt) {
      if (key === "c") return handled(), copyBlock();
      if (key === "s") return handled(), void save();
      if (key === "z") return handled(), mods.shift ? redo() : undo();
      if (key === "a") {
        handled();
        if (rows.length > 0 && columnCount > 0) {
          const from = spotAt(0, 0);
          const to = spotAt(rows.length - 1, columnCount - 1);
          if (from && to) setSelection({ anchor: from, focus: to });
        }
        return;
      }
    }
    if (mods.alt || !sheet || rows.length === 0) return;
    const edgeKeys = ["up", "down", "left", "right", "home", "end"];
    if (primary && !edgeKeys.includes(key)) return;
    const focus = selection?.focus;
    const place = focus ? (places[focus.row] ?? -1) : -1;
    // Nothing picked (or the pick hidden by a search): a key that moves picks the first cell shown.
    if (!block || !focus || place < 0) {
      if ([...edgeKeys, "tab", "enter", "pageup", "pagedown"].includes(key)) {
        handled();
        goTo(0, 0, false);
      }
      return;
    }
    switch (key) {
      case "enter":
      case "f2":
        handled();
        startEdit();
        return;
      case "escape":
        if (isRange(block)) setSelection({ anchor: focus, focus });
        else setSelection(null);
        return;
      case "backspace":
      case "delete":
        handled();
        clearBlock();
        return;
      case "tab": {
        handled();
        const to = moved({ place, column: focus.column }, mods.shift ? "left" : "right", { rows: rows.length, columns: columnCount, page: 1 });
        if (to) goTo(to.place, to.column, false);
        return;
      }
    }
    const to = moved({ place, column: focus.column }, key, { rows: rows.length, columns: columnCount, page: Math.max(1, visible - 1) }, primary);
    if (!to) return;
    handled();
    goTo(to.place, to.column, Boolean(mods.shift));
  };

  // ---- drawing

  // The rows are drawn from the window: one array of elements, made again only when the window
  // moves or what is picked or edited changes, so the scroll itself costs the rows nothing.
  const rowElements = useMemo(() => {
    const single = block !== null && !isRange(block);
    return rows.slice(first, last).map((row, i) => {
      const place = first + i;
      const inRows = block !== null && place >= block.top && place <= block.bottom;
      const focusHere = selection !== null && block !== null && selection.focus.row === row.index;
      return (
        <RowView
          key={row.id}
          row={row}
          widths={widths}
          numeric={numeric}
          firstRow={data?.firstRow ?? 1}
          shaded={striped !== false && place % 2 === 1}
          left={inRows ? block!.left : -1}
          right={inRows ? block!.right : -1}
          focus={focusHere ? Math.min(selection!.focus.column, columnCount - 1) : -1}
          tinted={single && inRows}
          editing={editing !== null && editing.row === row.index ? editing.column : -1}
          actions={actions}
        />
      );
    });
  }, [rows, first, last, widths, numeric, data?.firstRow, striped, block, selection, editing, columnCount, actions]);

  // The names do not change while the rows move: made once, so a scroll does not redraw them.
  const headerElement = useMemo(() => <HeaderRow table={table} widths={widths} onResize={resize} renaming={renaming} actions={actions} />, [table, widths, resize, renaming, actions, columns, validSorting]);

  // Another file, a sort or a search: the table goes back to where its first row is. A read after
  // this tab's own save is the same file, and stays where it was.
  const keptBy = `${path}:${data?.mtime ?? 0}:${filter}:${validSorting.map((o) => `${o.id}${o.desc}`).join()}`;
  useEffect(() => {
    if (keepScroll.current) {
      keepScroll.current = false;
      return;
    }
    setBucket(0);
    scrolled.current = { x: 0, y: 0 };
    scroller.current?.scrollTo?.(0, 0);
  }, [keptBy]);

  const focusValue = block && selection && sheet ? (sheet.rows[selection.focus.row]?.[selection.focus.column] ?? "") : "";
  const picked = block === null ? "" : isRange(block) ? `${count(block.bottom - block.top + 1)} × ${count(block.right - block.left + 1)} cells` : focusValue;

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: t.editor }}>
      <Bar
        filter={filter}
        onFilter={setFilter}
        reading={reading}
        rows={sheet?.rows.length ?? 0}
        columns={columnCount}
        kept={kept}
        onReload={askReload}
        fitted={fitted}
        scrolls={scrolls}
        onFit={(fit) => {
          try {
            void Promise.resolve(setWidthsAs(fit ? "fit" : "natural")).catch(swallow);
          } catch (err) {
            swallow(err);
          }
        }}
      />
      {dirty || notice || saving ? (
        <Edits
          edits={doc?.done.length ?? 0}
          canUndo={(doc?.done.length ?? 0) > 0}
          canRedo={(doc?.undone.length ?? 0) > 0}
          saving={saving}
          notice={notice}
          onUndo={undo}
          onRedo={redo}
          onDiscard={discard}
          onSave={() => void save()}
          onOverwrite={() => void save(true)}
          onReadAgain={readAgain}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
      <div
        onLayout={(event: any) => {
          const w = Math.round(event?.width ?? 0);
          const h = Math.round(event?.height ?? 0);
          origin.current = { x: event?.x ?? 0, y: event?.y ?? 0 };
          setBox((had) => (had.width === w && had.height === h ? had : { width: w, height: h }));
        }}
        tabIndex={0}
        onKeyDown={onKey}
        style={{ position: "relative", display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}
      >
        {/* What takes the keys back once a field is done with: a field's end leaves nothing
            focused, and a new one of these takes the focus as it is made. */}
        {focusTick > 0 ? (
          <div
            key={focusTick}
            tabIndex={0}
            autoFocus
            onFocus={() => {
              hasKeys.current = true;
            }}
            onBlur={() => {
              hasKeys.current = false;
            }}
            style={{ position: "absolute", top: 0, left: 0, width: 0, height: 0 }}
          />
        ) : null}
        {data === null || sheet === null ? (
          <Blank text={failed ?? (path === "" ? "This tab shows no file." : reading ? "Reading…" : "")} failed={failed !== null} />
        ) : columnCount === 0 ? (
          <Blank text="The file is empty." failed={false} />
        ) : rows.length === 0 ? (
          <Blank text={filter === "" ? "The file has no rows." : `Nothing matches “${filter}”`} failed={false} action={filter === "" ? { label: "Add a row", run: () => addRows(true) } : undefined} />
        ) : (
          // The names are the table's first row, in the same scroller as the rows: they go up and
          // sideways with them, natively, so nothing about them can trail the scroll.
          <div
            ref={scroller}
            onScrollChange={(event: any) => {
              const x = Math.max(0, -(event?.scrollX ?? 0));
              const top = Math.max(0, -(event?.scrollY ?? 0));
              scrolled.current = { x, y: top };
              const y = Math.max(0, top - HEADER);
              const step = Math.floor(Math.floor(y / ROW) / STEP) * STEP;
              setBucket((had) => (had === step ? had : step));
            }}
            // A drag across the cells picks a block of them, not the text in them.
            style={{ position: "relative", flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "scroll", scrollbarColor: t.faint, scrollbarWidth: SCROLLBAR, userSelect: "none" }}
          >
            <div style={{ position: "relative", width, height: HEADER + Math.max(rows.length * ROW, listHeight) }}>
              <div style={{ position: "absolute", top: 0, left: 0, width, height: HEADER }}>{headerElement}</div>
              <div style={{ position: "absolute", top: HEADER + first * ROW, left: 0, width, display: "flex", flexDirection: "column" }}>{rowElements}</div>
            </div>
          </div>
        )}
        {menu ? <Menu at={menu.at} items={menu.items} close={() => setMenu(null)} /> : null}
      </div>
      {data && sheet ? <Foot data={data} sheet={sheet} sorting={sortedBy(validSorting, sheet)} filter={filter} kept={kept} picked={picked} single={block !== null && !isRange(block)} copied={copied} onCopy={copyBlock} right={numbers !== false} /> : null}
    </div>
  );
}

/** What says a pane has no table to draw, and why; and what can be done about it, when something
 *  can. */
function Blank({ text, failed, action }: { text: string; failed: boolean; action?: { label: string; run(): void } }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, flexGrow: 1, minHeight: ROW * 3, padding: 16 }}>
      <text style={{ fontSize: 13, color: failed ? t.error : t.faint }}>{text}</text>
      {action ? <TextButton label={action.label} onClick={action.run} /> : null}
    </div>
  );
}

/** A button of words, in the edit strip. `main` is the one the strip is for (Save). */
function TextButton({ label, title, onClick, main, disabled }: { label: string; title?: string; onClick(): void; main?: boolean; disabled?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      onClick={() => {
        if (!disabled) onClick();
      }}
      title={title}
      role="button"
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        height: 20,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: m.radiusSmall,
        cursor: disabled ? "default" : "pointer",
        backgroundColor: main && !disabled ? t.accent : undefined,
        hover: disabled ? undefined : { backgroundColor: main ? t.accent : t.hover, opacity: main ? 0.85 : 1 },
      }}
    >
      <text style={{ fontSize: 12, color: disabled ? t.faint : main ? t.accentText : t.text, whiteSpace: "nowrap" }}>{label}</text>
    </div>
  );
}

/** The strip under the bar while there are edits: how many, undo and redo, throw them away, save;
 *  or what is in the way of saving them, and what can be done about it. */
function Edits({
  edits,
  canUndo,
  canRedo,
  saving,
  notice,
  onUndo,
  onRedo,
  onDiscard,
  onSave,
  onOverwrite,
  onReadAgain,
  onDismiss,
}: {
  edits: number;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  notice: Notice | null;
  onUndo(): void;
  onRedo(): void;
  onDiscard(): void;
  onSave(): void;
  onOverwrite(): void;
  onReadAgain(): void;
  onDismiss(): void;
}) {
  const t = useTheme();
  const unsaved = `${count(edits)} unsaved ${edits === 1 ? "edit" : "edits"}`;
  let said: string;
  let tone = t.muted;
  let buttons: ReactNode;
  if (notice?.kind === "changed") {
    said = "The file changed on disk. Your edits are kept, over the file as it was read.";
    tone = t.warning;
    buttons = (
      <>
        <TextButton label="Read it again" title="Show the file as it is now, dropping your edits" onClick={onReadAgain} />
        <TextButton label="Keep my edits" onClick={onDismiss} />
      </>
    );
  } else if (notice?.kind === "conflict") {
    said = "The file changed on disk since it was read.";
    tone = t.warning;
    buttons = (
      <>
        <TextButton label="Overwrite it" title="Write the file as you edited it, over what changed" onClick={onOverwrite} main />
        <TextButton label="Read it again" title="Show the file as it is now, dropping your edits" onClick={onReadAgain} />
        <TextButton label="Cancel" onClick={onDismiss} />
      </>
    );
  } else if (notice?.kind === "reload") {
    said = `Reading the file again drops ${unsaved}.`;
    tone = t.warning;
    buttons = (
      <>
        <TextButton label="Read it again" onClick={onReadAgain} />
        <TextButton label="Cancel" onClick={onDismiss} />
      </>
    );
  } else if (notice?.kind === "error") {
    said = notice.text;
    tone = t.error;
    buttons = <TextButton label="OK" onClick={onDismiss} />;
  } else {
    said = saving ? "Saving…" : unsaved;
    buttons = (
      <>
        <TextButton label="Undo" title={`Undo the last edit (${KEYS.undo})`} onClick={onUndo} disabled={!canUndo || saving} />
        <TextButton label="Redo" title={`Make it again (${KEYS.redo})`} onClick={onRedo} disabled={!canRedo || saving} />
        <TextButton label="Discard" title="Throw every edit away: the table as the file is" onClick={onDiscard} disabled={edits === 0 || saving} />
        <TextButton label="Save" title={`Write the edits to the file (${KEYS.save})`} onClick={onSave} main disabled={edits === 0 || saving} />
      </>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 28, flexShrink: 0, paddingLeft: 10, paddingRight: 6, borderBottomWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
      <text style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 12, color: tone, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{said}</text>
      {buttons}
    </div>
  );
}

/** The search box, what it keeps of the file, the widths the columns are drawn at, and the way to
 *  read the file again. */
function Bar({
  filter,
  onFilter,
  reading,
  rows,
  columns,
  kept,
  onReload,
  fitted,
  scrolls,
  onFit,
}: {
  filter: string;
  onFilter(text: string): void;
  reading: boolean;
  rows: number;
  columns: number;
  kept: number;
  onReload(): void;
  fitted: boolean;
  scrolls: boolean;
  onFit(fit: boolean): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  const said = reading ? "reading…" : filter === "" ? (rows > 0 ? `${count(rows)} rows · ${count(columns)} columns` : "") : `${count(kept)} of ${count(rows)} rows`;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: HEADER + 4, flexShrink: 0, paddingLeft: 10, paddingRight: 6, borderBottomWidth: 1, borderColor: t.border, backgroundColor: t.window }}>
      <Icon name="search" size={13} color={filter === "" ? t.faint : t.muted} />
      <input
        value={filter}
        placeholder="Search the table…"
        aria-label="Search the table"
        onChange={(event: any) => onFilter(String(event?.value ?? ""))}
        style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 22, fontSize: 13, color: t.text, backgroundColor: "transparent" }}
      />
      {filter !== "" ? (
        <div onClick={() => onFilter("")} title="Clear the search" style={{ display: "flex", padding: 3, cursor: "pointer", borderRadius: m.radiusSmall, hover: { backgroundColor: t.hover } }}>
          <Icon name="close" size={11} color={t.muted} />
        </div>
      ) : null}
      <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap" }}>{said}</text>
      {/* The columns: as wide as their contents ask (a table wider than the pane scrolls sideways,
          which the arrow says), or squeezed to share the pane's width (the arrows closing in). */}
      <IconButton icon={fitted ? "minimize" : "arrow_right"} title={fitted ? "Columns share the tab's width — press to give each its own width, and scroll sideways" : "Columns are as wide as their contents ask — press to squeeze them into the tab"} active={scrolls && !fitted} onClick={() => onFit(!fitted)} />
      <IconButton icon="rotate_ccw" title="Read the file again" onClick={onReload} />
    </div>
  );
}

/** What the file is — its size, its separator, whether it has names, how it is sorted — and what
 *  is picked (a cell's value, or a block's size), which a press copies. */
function Foot({ data, sheet, sorting, filter, kept, picked, single, copied, onCopy, right }: { data: Loaded; sheet: Sheet; sorting: string; filter: string; kept: number; picked: string; single: boolean; copied: string; onCopy(): void; right: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  const [hovered, setHovered] = useState(false);
  const says = [
    `${count(sheet.rows.length)} rows`,
    `${count(sheet.headers.length)} columns`,
    sizeOf(data.bytes),
    data.delimiterName,
    data.hasHeader ? "names" : "no names",
    right ? "numbers right" : "",
    sorting === "" ? "" : `sorted by ${sorting}`,
    filter === "" ? "" : `“${filter}” kept ${count(kept)}`,
  ].filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: 24, flexShrink: 0, paddingLeft: 10, paddingRight: 6, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.window }}>
      <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{says.join(" · ")}</text>
      {data.notes.length > 0 ? <text style={{ fontSize: 11, color: t.warning, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", flexShrink: 1 }}>{data.notes.join(" · ")}</text> : null}
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }} />
      {copied !== "" ? (
        <text style={{ fontSize: 11, color: t.success, whiteSpace: "nowrap" }}>{copied}</text>
      ) : picked === "" ? null : (
        <div
          onClick={onCopy}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title={single ? `Copy the picked cell (${KEYS.copy})` : `Copy the picked cells, as tab-separated text (${KEYS.copy})`}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "55%", paddingLeft: 6, paddingRight: 6, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: hovered ? t.hover : undefined }}
        >
          <text style={{ fontSize: 11, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{picked}</text>
          <Icon name="copy" size={11} color={t.muted} />
        </div>
      )}
    </div>
  );
}

/** The tab's title bar, on a file tab this plugin draws: read the file again, without looking
 *  for the command that does it. */
export function Toolbar({ tab }: { tab: string }) {
  const each = useTab(tab);
  const path = String(((each?.options ?? {}) as Record<string, unknown>).path ?? "");
  if (!isCsv(path)) return null;
  return <IconButton icon="rotate_ccw" title="Read the file again" onClick={() => void reload(tab).catch(swallow)} />;
}
