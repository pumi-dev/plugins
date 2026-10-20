// The table's two drawn parts: the header (a name a press sorts by, a divider a drag moves) and
// the rows (windowed: only those near the viewport are made). They draw what `@tanstack/react-table`
// works out — the order after a sort, which rows a search kept — and keep no state of their own but
// the drag in flight: the renderer in `ui.tsx` holds what the table is and how wide its columns are.
import { memo, useRef } from "react";
import type { Row, Table } from "@tanstack/react-table";
import { Icon, useTheme } from "pumi";

import { HEADER, MIN_COLUMN, ROW } from "../layout.ts";

/** How many rows are made beyond each end of what shows, so a scroll draws rows that are there. */
export const OVERSCAN = 30;
/** The row number's width at the table's left: wide enough for six figures. */
export const GUTTER = 56;
const PAD = 8;

/** Which cell is picked: its place in the file (not in the drawn order), and its column. */
export interface Picked {
  row: number;
  column: number;
}

export interface GridProps {
  table: Table<string[]>;
  /** Each column's width: from the renderer, which shares the pane's room out. */
  widths: number[];
  /** True when the columns are wider than the pane: the grid scrolls sideways. */
  overflow: boolean;
  striped: boolean;
  /** Whether a column holds numbers, which are lined up on the right. */
  numeric: boolean[];
  /** The file's record number of the first row, so the gutter counts as a person reading it does. */
  firstRow: number;
  picked: Picked | null;
  onPick(row: number, column: number, value: string): void;
  onResize(index: number, delta: number, from: number[]): void;
}

/** The colour of a number, or a drawn arrow: what says a column is sorted, and which way. */
function SortMark({ sorted }: { sorted: false | "asc" | "desc" }) {
  const t = useTheme();
  if (sorted === false) return null;
  return <Icon name="chevron_down" size={11} color={t.accent} style={{ rotate: sorted === "asc" ? 180 : 0 }} />;
}

/**
 * The names, and the divider after each: a press sorts by that column (holding shift adds it to
 * the sort), and dragging the divider takes width from the column on its right.
 */
export function HeaderRow({ table, widths, onResize }: Pick<GridProps, "table" | "widths" | "onResize">) {
  const t = useTheme();
  const drag = useRef<{ index: number; x: number; from: number[] } | null>(null);
  // A drag ends with a click on the header it moved a divider inside: that click is not a sort.
  const moved = useRef(false);
  const total = widths.reduce((a, b) => a + b, 0);
  const columns = table.getVisibleLeafColumns();
  return (
    <div style={{ display: "flex", flexDirection: "row", width: GUTTER + total, height: HEADER, flexShrink: 0, borderBottomWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
      <div style={{ display: "flex", width: GUTTER, flexShrink: 0, alignItems: "center", justifyContent: "flex-end", paddingRight: PAD }}>
        <text style={{ fontSize: 11, color: t.faint }}>#</text>
      </div>
      {columns.map((column, index) => {
        const sorted = column.getIsSorted();
        const width = widths[index] ?? MIN_COLUMN;
        return (
          <div
            key={column.id}
            onClick={(e: any) => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              column.toggleSorting(undefined, Boolean(e?.modifiers?.shift));
            }}
            title={`${column.columnDef.header as string}: press to sort${sorted === false ? "" : sorted === "asc" ? " (down the way it is)" : " (the other way)"}`}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, width, flexShrink: 0, minWidth: 0, paddingLeft: PAD, paddingRight: 4, overflow: "hidden", cursor: "pointer", hover: { backgroundColor: t.hover } }}
          >
            <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: sorted === false ? t.muted : t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{String(column.columnDef.header ?? "")}</text>
            <SortMark sorted={sorted} />
            {index < columns.length - 1 ? (
              <div
                aria-label="Resize"
                onMouseDown={(e: any) => {
                  drag.current = { index, x: e?.x ?? 0, from: widths };
                  moved.current = false;
                  e?.stopPropagation?.();
                }}
                onMouseMove={(e: any) => {
                  const at = drag.current;
                  if (!at || at.index !== index) return;
                  moved.current = true;
                  onResize(index, (e?.x ?? 0) - at.x, at.from);
                }}
                onMouseUp={() => {
                  drag.current = null;
                }}
                style={{ width: 7, height: "100%", flexShrink: 0, marginRight: -4, cursor: "col-resize", hover: { backgroundColor: t.accent } }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** One cell: a string, in the colour it is read at, cut with an ellipsis when its column is narrow. */
function Cell({ value, width, first, right, picked, onClick }: { value: string; width: number; first: boolean; right: boolean; picked: boolean; onClick(e: unknown): void }) {
  const t = useTheme();
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: right ? "flex-end" : "flex-start",
        width,
        flexShrink: 0,
        minWidth: 0,
        paddingLeft: PAD,
        paddingRight: PAD,
        borderLeftWidth: first ? 0 : 1,
        borderColor: t.border,
        overflow: "hidden",
      }}
    >
      <text style={{ fontSize: 13, color: picked ? t.accent : t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{value}</text>
    </div>
  );
}

/** One row: its number in the file, then its cells. */
export const RowView = memo(function RowView({ row, widths, numeric, firstRow, striped, picked, onPick }: { row: Row<string[]>; widths: number[]; numeric: boolean[]; firstRow: number; striped: boolean; picked: Picked | null; onPick: GridProps["onPick"] }) {
  const t = useTheme();
  const cells = row.getVisibleCells();
  const tint = picked ? t.selected : striped && row.index % 2 === 1 ? t.hover : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100%", height: ROW, flexShrink: 0, alignItems: "stretch", backgroundColor: tint, hover: { backgroundColor: picked ? t.selected : t.hover } }}>
      <div style={{ display: "flex", width: GUTTER, flexShrink: 0, alignItems: "center", justifyContent: "flex-end", paddingRight: PAD }}>
        <text style={{ fontSize: 11, color: t.faint }}>{String(row.index + firstRow)}</text>
      </div>
      {cells.map((cell, index) => (
        <Cell
          key={cell.id}
          value={String(cell.getValue() ?? "")}
          width={widths[index] ?? MIN_COLUMN}
          first={index === 0}
          right={numeric[index] === true}
          picked={picked !== null && picked.row === row.index && picked.column === index}
          onClick={(e: any) => {
            e?.stopPropagation?.();
            onPick(row.index, index, String(cell.getValue() ?? ""));
          }}
        />
      ))}
    </div>
  );
});

/** The grid's own shape: the width its rows are laid out at (the pane's, or more when it scrolls). */
export function gridWidth(widths: number[]): number {
  return GUTTER + widths.reduce((a, b) => a + b, 0);
}
