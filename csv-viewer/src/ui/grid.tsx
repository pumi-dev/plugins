// The table's two drawn parts: the header (a name a press sorts by, a divider a drag moves, a
// field when the column is renamed) and the rows (windowed: only those near the viewport are
// made). They draw what `@tanstack/react-table` works out — the order after a sort, which rows a
// search kept — and what is picked and edited, and keep no state of their own but a drag in
// flight and the text of a field being typed in: the renderer in `ui.tsx` holds the rest.
import { memo, useRef, useState } from "react";
import type { Row, Table } from "@tanstack/react-table";
import { Icon, useTheme } from "pumi";

import { HEADER, MIN_COLUMN, ROW } from "../layout.ts";

/** How many rows are made beyond each end of what shows, so a scroll draws rows that are there. */
export const OVERSCAN = 30;
/** The row number's width at the table's left: wide enough for six figures. */
export const GUTTER = 56;
const PAD = 8;

/** Where the focus goes once a field is done with: the row below (Enter), the cell beside (Tab),
 *  or nowhere (a press elsewhere). */
export type After = "down" | "right" | "left" | null;

/** What a row's cells, and the header's names, do when they are pressed and typed in: one object
 *  for every row, so a row is not drawn again for a new closure. */
export interface GridActions {
  /** The left button went down on a cell (`shift`: the block grows to it). */
  press(row: number, column: number, shift: boolean): void;
  /** The pointer moved, at `x`, `y` in the window, with the left button held (`held`) or not: a
   *  drag grows the block to the cell under it. The moves of a drag go to the cell it started on,
   *  wherever the pointer is, so the cell under it is worked out from where it is. */
  drag(x: number, y: number, held: boolean): void;
  /** The button came up over a cell: the drag is over. */
  release(): void;
  /** A press on a row's number: the whole row. */
  pressRow(row: number, shift: boolean): void;
  /** A double press: the cell is edited. */
  edit(row: number, column: number): void;
  /** A right press: the menu, for a cell or (`row` -1) a column's name. */
  menu(row: number, column: number, at: { x: number; y: number }): void;
  /** A field's text is done with: kept, or (`commit` false) thrown away. `keyed` when a key ended
   *  it (the table takes the keys back), not a press elsewhere (which has them). */
  done(value: string, commit: boolean, after: After, keyed: boolean): void;
  /** ⌘S in a field: keep its text, then save. */
  save(value: string): void;
}

/** The colour of a number, or a drawn arrow: what says a column is sorted, and which way. */
function SortMark({ sorted }: { sorted: false | "asc" | "desc" }) {
  const t = useTheme();
  if (sorted === false) return null;
  return <Icon name="chevron_down" size={11} color={t.accent} style={{ rotate: sorted === "asc" ? 180 : 0 }} />;
}

/**
 * The text field a cell or a name is edited in, in its place: Enter keeps it and goes down, Tab
 * keeps it and goes sideways, Escape throws it away, and a press elsewhere keeps it. The keys it
 * takes are its own, not the table's.
 */
function Field({ initial, right, actions }: { initial: string; right: boolean; actions: GridActions }) {
  const t = useTheme();
  const [value, setValue] = useState(initial);
  // Enter ends the edit and the field's blur follows: only the first of them counts.
  const live = useRef(true);
  const end = (commit: boolean, after: After, keyed: boolean) => {
    if (!live.current) return;
    live.current = false;
    actions.done(value, commit, after, keyed);
  };
  return (
    <input
      value={value}
      autoFocus
      aria-label="Edit the cell"
      onChange={(e: any) => setValue(String(e?.value ?? ""))}
      onSubmit={() => end(true, "down", true)}
      onBlur={() => end(true, null, false)}
      onKeyDown={(e: any) => {
        e?.stopPropagation?.();
        const key = e?.key;
        const mods = e?.modifiers ?? {};
        if (key === "escape") {
          e?.preventDefault?.();
          end(false, null, true);
        } else if (key === "tab") {
          e?.preventDefault?.();
          end(true, mods.shift ? "left" : "right", true);
        } else if (key === "s" && (mods.cmd || mods.ctrl)) {
          e?.preventDefault?.();
          if (!live.current) return;
          live.current = false;
          actions.save(value);
        }
      }}
      onMouseDown={(e: any) => e?.stopPropagation?.()}
      onDoubleClick={(e: any) => e?.stopPropagation?.()}
      style={{ display: "flex", flexGrow: 1, minWidth: 0, height: ROW - 6, fontSize: 13, color: t.text, backgroundColor: t.editor, textAlign: right ? "right" : "left" }}
    />
  );
}

/**
 * The names, and the divider after each: a press sorts by that column (holding shift adds it to
 * the sort), dragging the divider takes width from the column on its right, and a right press
 * opens the column's menu. The column being renamed is a field.
 */
export function HeaderRow({ table, widths, onResize, renaming, actions }: { table: Table<string[]>; widths: number[]; onResize(index: number, delta: number, from: number[]): void; renaming: number; actions: GridActions }) {
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
        const name = String(column.columnDef.header ?? "");
        return (
          <div
            key={column.id}
            onClick={(e: any) => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              if (renaming === index) return;
              column.toggleSorting(undefined, Boolean(e?.modifiers?.shift));
            }}
            onAuxClick={(e: any) => {
              if (e?.isRightClick) actions.menu(-1, index, { x: e?.x ?? 0, y: e?.y ?? 0 });
            }}
            title={`${name}: press to sort${sorted === false ? "" : sorted === "asc" ? " (down the way it is)" : " (the other way)"}; right press for more`}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, width, flexShrink: 0, minWidth: 0, paddingLeft: PAD, paddingRight: 4, overflow: "hidden", cursor: "pointer", hover: { backgroundColor: t.hover } }}
          >
            {renaming === index ? (
              <Field initial={name} right={false} actions={actions} />
            ) : (
              <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: sorted === false ? t.muted : t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{name}</text>
            )}
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

/** One cell: a string, in the colour it is read at, cut with an ellipsis when its column is
 *  narrow; tinted when it is in the picked block, ringed when it is the focus, and a field while
 *  it is edited. */
function Cell({ row, column, value, width, first, right, inBlock, focus, editing, actions }: { row: number; column: number; value: string; width: number; first: boolean; right: boolean; inBlock: boolean; focus: boolean; editing: boolean; actions: GridActions }) {
  const t = useTheme();
  return (
    <div
      onMouseDown={(e: any) => {
        if ((e?.button ?? 0) !== 0) return;
        actions.press(row, column, Boolean(e?.modifiers?.shift));
      }}
      onMouseMove={(e: any) => actions.drag(e?.x ?? 0, e?.y ?? 0, e?.pressedButton === 0)}
      onMouseUp={() => actions.release()}
      onDoubleClick={() => actions.edit(row, column)}
      onAuxClick={(e: any) => {
        if (e?.isRightClick) actions.menu(row, column, { x: e?.x ?? 0, y: e?.y ?? 0 });
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: right ? "flex-end" : "flex-start",
        width,
        flexShrink: 0,
        minWidth: 0,
        paddingLeft: editing ? 3 : PAD,
        paddingRight: editing ? 3 : PAD,
        borderLeftWidth: first ? 0 : 1,
        borderColor: t.border,
        overflow: "hidden",
        backgroundColor: inBlock ? t.selected : undefined,
      }}
    >
      {editing ? (
        <Field initial={value} right={right} actions={actions} />
      ) : (
        <text style={{ fontSize: 13, color: focus ? t.accent : t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{value}</text>
      )}
      {focus ? <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderWidth: 1, borderColor: t.accent }} /> : null}
    </div>
  );
}

/** What of a row is picked, as plain values so a row that has not changed is not drawn again:
 *  the block's columns (`left` -1: none of it), the focus's column (-1: not in this row), whether
 *  the whole row is tinted (one cell picked), and the column being edited (-1: none). */
export interface RowMarks {
  left: number;
  right: number;
  focus: number;
  tinted: boolean;
  editing: number;
}

/** One row: its number in the file, then its cells. `shaded` is the stripe: every other row as it
 *  is shown, sorted and searched, not as it is in the file. */
export const RowView = memo(function RowView({
  row,
  widths,
  numeric,
  firstRow,
  shaded,
  left,
  right,
  focus,
  tinted,
  editing,
  actions,
}: { row: Row<string[]>; widths: number[]; numeric: boolean[]; firstRow: number; shaded: boolean; actions: GridActions } & RowMarks) {
  const t = useTheme();
  const values = row.original;
  const tint = tinted ? t.selected : shaded ? t.hover : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100%", height: ROW, flexShrink: 0, alignItems: "stretch", backgroundColor: tint, hover: { backgroundColor: tinted ? t.selected : t.hover } }}>
      <div
        onMouseDown={(e: any) => {
          if ((e?.button ?? 0) === 0) actions.pressRow(row.index, Boolean(e?.modifiers?.shift));
        }}
        onAuxClick={(e: any) => {
          if (e?.isRightClick) actions.menu(row.index, Math.max(0, focus), { x: e?.x ?? 0, y: e?.y ?? 0 });
        }}
        style={{ display: "flex", width: GUTTER, flexShrink: 0, alignItems: "center", justifyContent: "flex-end", paddingRight: PAD, cursor: "pointer" }}
      >
        <text style={{ fontSize: 11, color: left >= 0 ? t.muted : t.faint }}>{String(row.index + firstRow)}</text>
      </div>
      {values.map((value, index) => (
        <Cell
          key={index}
          row={row.index}
          column={index}
          value={value ?? ""}
          width={widths[index] ?? MIN_COLUMN}
          first={index === 0}
          right={numeric[index] === true}
          inBlock={left >= 0 && index >= left && index <= right && !tinted}
          focus={focus === index && editing !== index}
          editing={editing === index}
          actions={actions}
        />
      ))}
    </div>
  );
});

/** The grid's own shape: the width its rows are laid out at (the pane's, or more when it scrolls). */
export function gridWidth(widths: number[]): number {
  return GUTTER + widths.reduce((a, b) => a + b, 0);
}
