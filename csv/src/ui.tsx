// csv: what a file tab draws when this plugin draws it (the manifest's `renderers.file`, matched
// by extension): the file as a table, worked out by TanStack Table — sorted by a press on a
// column's name, searched as you type, laid out to the pane's width with dividers a drag moves,
// and drawn only as far down as the pane shows. The parsing, and the disk, are the worker's
// (`main.ts`, `parse.ts`); this holds the table's state and the little around it: a bar to search
// in, a line saying what the file is, and the cell that is picked.
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type FilterFn, type SortingState } from "@tanstack/react-table";
import { Icon, IconButton, call, useChannelListener, useMetrics, useOption, usePlugin, useTab, useTheme, type RendererProps } from "pumi";

import { note, read as load, reload, unwatch, watch, type Loaded } from "./main.ts";
import { HEADER, ROW, bytes as sizeOf, count, naturalWidths, planWidths, resizeWidths } from "./layout.ts";
import { compareCells, matchesRow, type ColumnKind } from "./parse.ts";
import { GUTTER, HeaderRow, OVERSCAN, RowView, gridWidth, type Picked } from "./ui/grid.tsx";

/** The rows of a file not read yet, and the same array every render, so the table keeps its state. */
const NOTHING: string[][] = [];
/** The extensions the manifest's `renderers.file` claims. */
const EXTENSIONS = ["csv", "tsv", "tab", "psv", "dsv"];
/** How many rows the window is moved by at a time: scroll a screenful, ask React for rows. */
const STEP = 10;
/** The worker's channel: a file that changed, or was asked to be read again. */
const CHANGED = "changed";

/** Whether a path is one this plugin draws, by its extension. */
export function isCsv(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).toLowerCase();
  return EXTENSIONS.includes(name.slice(name.lastIndexOf(".") + 1));
}

/** A throw the table cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`csv: ${err instanceof Error ? err.message : String(err)}`);
}

/** What the search box keeps: a row with every word of the text in some cell. */
const searchAll: FilterFn<string[]> = (row, _columnId, value) => matchesRow(row.original, String(value ?? ""));

/** How the table is sorted, as the footer says it: `price ↑, name ↓`. */
function sortedBy(sorting: SortingState, headers: string[]): string {
  return sorting
    .map((order) => {
      const index = Number(order.id.slice(1));
      return `${headers[index] ?? order.id} ${order.desc ? "↓" : "↑"}`;
    })
    .join(", ");
}

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
 * message over the pane and goes in the plugin's log (`pumi plugin logs csv`), rather than leaving
 * a blank pane with nothing to go on.
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
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12 }}>
        <text style={{ fontSize: 13, color: "#cc6666" }}>{`The table could not be drawn: ${error.message}`}</text>
        <text style={{ fontSize: 11, color: "#888888" }}>The log (`pumi plugin logs csv`) has the rest. Reading the file again often fixes it.</text>
      </div>
    );
  }
}

/** The table itself: what the boundary above draws. */
function TableBody({ tab }: RendererProps) {
  const id = tab.id;
  const each = useTab(id);
  const path = String(((each?.options ?? {}) as Record<string, unknown>).path ?? "");
  const prefix = `${(usePlugin() ?? "").replace("/", ".")}.`;
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

  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  /** Bumped to read the file again: a press, or the worker saying it changed. */
  const [asked, setAsked] = useState(0);
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [copied, setCopied] = useState("");
  /** The room the grid has, measured: its width shares the columns out, its height says how many
   *  rows fit. */
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [widths, setWidths] = useState<number[]>([]);
  /** The step of rows the table is scrolled to: the scroller moves natively (both ways, the header
   *  with it), and this only changes when another step comes into view. */
  const [bucket, setBucket] = useState(0);
  const scroller = useRef<any>(null);

  const pick = useCallback((row: number, column: number) => setPicked({ row, column }), []);
  const resize = useCallback((index: number, delta: number, from: number[]) => setWidths((now) => resizeWidths(now.length === from.length ? now : from, index, delta)), []);

  // Read the file: when the pane shows another, when an option the parse reads changes, and when
  // it is asked for again.
  useEffect(() => {
    if (path === "") {
      setData(null);
      setFailed(null);
      return;
    }
    let live = true;
    setReading(true);
    void load(path)
      .then((next) => {
        if (!live) return;
        setData(next);
        setFailed(null);
      })
      .catch((err) => {
        if (!live) return;
        setData(null);
        setFailed(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [path, asked, header, delimiter, atMost]);

  // Follow the file while it is drawn: a script that rewrites it is what this is for.
  useEffect(() => {
    if (path === "" || follow === false) return;
    void watch(path).catch(swallow);
    return () => {
      void unwatch(path).catch(swallow);
    };
  }, [path, follow]);

  // The worker says which file changed: the one this pane shows is read again, by every view of it.
  useChannelListener(CHANGED, (message: unknown) => {
    const said = (message ?? {}) as { path?: unknown };
    if (typeof said.path === "string" && said.path === path) setAsked((n) => n + 1);
  });

  const columns = useMemo<ColumnDef<string[], unknown>[]>(() => {
    if (!data) return [];
    return data.headers.map((name, index) => ({
      id: `c${index}`,
      accessorFn: (row: string[]) => row[index] ?? "",
      header: name,
      sortingFn: (a, b, id) => compareCells(String(a.getValue(id) ?? ""), String(b.getValue(id) ?? ""), (data.kinds[index] ?? "text") as ColumnKind),
    }));
  }, [data]);

  const table = useReactTable({
    data: data?.rows ?? NOTHING,
    columns,
    state: { sorting, globalFilter: filter },
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
  // when that is what the reader asked for. Room to spare is shared out either way.
  useEffect(() => {
    if (!data) {
      setWidths([]);
      return;
    }
    const natural = naturalWidths(data.headers, data.rows, data.kinds.map((kind) => kind === "number"));
    const plan = planWidths(natural, Math.max(0, box.width - GUTTER), { fit: fitted });
    setWidths(plan.widths.length === natural.length ? plan.widths : natural);
  }, [data, box.width, fitted]);

  // A file read again is a file whose rows changed: nothing is picked in it until it is picked again.
  useEffect(() => setPicked(null), [data]);

  const rows = table.getRowModel().rows;
  const kept = table.getFilteredRowModel().rows.length;
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
  const numeric = useMemo(() => (data ? data.kinds.map((kind) => kind === "number") : []), [data]);
  const value = picked && data ? (data.rows[picked.row]?.[picked.column] ?? "") : "";

  // The rows are drawn from the window: one array of elements, made again only when the window
  // moves, so the scroll itself costs the header and the rows nothing to redraw.
  const rowElements = useMemo(
    () =>
      rows.slice(first, last).map((row) => (
        <RowView key={row.id} row={row} widths={widths} numeric={numeric} firstRow={data?.firstRow ?? 1} striped={striped !== false} picked={picked} onPick={pick} />
      )),
    [rows, first, last, widths, numeric, data?.firstRow, striped, picked, pick],
  );

  // The names do not change while the rows move: made once, so a scroll does not redraw them.
  const headerElement = useMemo(() => <HeaderRow table={table} widths={widths} onResize={resize} />, [table, widths, resize]);

  // Another file, a sort or a search: the table goes back to where its first row is.
  const keptBy = `${path}:${data?.mtime ?? 0}:${filter}:${sorting.map((order) => `${order.id}${order.desc}`).join()}`;
  useEffect(() => {
    setBucket(0);
    scroller.current?.scrollTo?.(0, 0);
  }, [keptBy]);

  const copy = useCallback(() => {
    if (value === "") return;
    void call("clipboard.set", value)
      .then(() => setCopied(`${value.length > 40 ? `${value.slice(0, 40)}…` : value} copied`))
      .catch(swallow);
  }, [value]);

  // What was copied is said for a moment, not for as long as the pane shows the file.
  useEffect(() => {
    if (copied === "") return;
    const timer = setTimeout(() => setCopied(""), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: t.editor }}>
      <Bar
        filter={filter}
        onFilter={setFilter}
        reading={reading}
        rows={data?.rows.length ?? 0}
        columns={data?.columns ?? 0}
        kept={kept}
        onReload={() => setAsked((n) => n + 1)}
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
      <div
        onLayout={(event: any) => {
          const width = Math.round(event?.width ?? 0);
          const height = Math.round(event?.height ?? 0);
          setBox((had) => (had.width === width && had.height === height ? had : { width, height }));
        }}
        style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}
      >
        {data === null ? (
          <Blank text={failed ?? (path === "" ? "This pane shows no file." : reading ? "Reading…" : "")} failed={failed !== null} />
        ) : data.columns === 0 ? (
          <Blank text="The file is empty." failed={false} />
        ) : rows.length === 0 ? (
          <Blank text={filter === "" ? "The file has no rows." : `Nothing matches “${filter}”`} failed={false} />
        ) : (
          // The names are the table's first row, in the same scroller as the rows: they go up and
          // sideways with them, natively, so nothing about them can trail the scroll.
          <div
            ref={scroller}
            onScrollChange={(event: any) => {
              const y = Math.max(0, -(event?.scrollY ?? 0) - HEADER);
              const step = Math.floor(Math.floor(y / ROW) / STEP) * STEP;
              setBucket((had) => (had === step ? had : step));
            }}
            style={{ position: "relative", flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "scroll", scrollbarColor: t.faint, scrollbarWidth: 8 }}
          >
            <div style={{ position: "relative", width, height: HEADER + Math.max(rows.length * ROW, listHeight) }}>
              <div style={{ position: "absolute", top: 0, left: 0, width, height: HEADER }}>{headerElement}</div>
              <div style={{ position: "absolute", top: HEADER + first * ROW, left: 0, width, display: "flex", flexDirection: "column" }}>{rowElements}</div>
            </div>
          </div>
        )}
      </div>
      {data ? <Foot data={data} sorting={sortedBy(sorting, data.headers)} filter={filter} kept={kept} value={value} copied={copied} onCopy={copy} right={numbers !== false} /> : null}
    </div>
  );
}

/** What says a pane has no table to draw, and why. */
function Blank({ text, failed }: { text: string; failed: boolean }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexGrow: 1, minHeight: ROW * 3, padding: 16 }}>
      <text style={{ fontSize: 13, color: failed ? t.error : t.faint }}>{text}</text>
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
      <IconButton icon={fitted ? "minimize" : "arrow_right"} title={fitted ? "Columns share the pane's width — press to give each its own width, and scroll sideways" : "Columns are as wide as their contents ask — press to squeeze them into the pane"} active={scrolls && !fitted} onClick={() => onFit(!fitted)} />
      <IconButton icon="rotate_ccw" title="Read the file again" onClick={onReload} />
    </div>
  );
}

/** What the file is — its size, its separator, whether it has names, how it is sorted — and the
 *  cell that is picked, which a press copies. */
function Foot({ data, sorting, filter, kept, value, copied, onCopy, right }: { data: Loaded; sorting: string; filter: string; kept: number; value: string; copied: string; onCopy(): void; right: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  const [hovered, setHovered] = useState(false);
  const says = [
    `${count(data.rows.length)} rows`,
    `${count(data.columns)} columns`,
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
      ) : value === "" ? null : (
        <div
          onClick={onCopy}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title="Copy the picked cell"
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "55%", paddingLeft: 6, paddingRight: 6, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: hovered ? t.hover : undefined }}
        >
          <text style={{ fontSize: 11, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{value}</text>
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
  return <IconButton icon="rotate_ccw" title="CSV: read the file again" onClick={() => void reload(tab).catch(swallow)} />;
}
