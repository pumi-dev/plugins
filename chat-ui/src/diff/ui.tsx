// A patch, drawn in the window's theme: each line on a wash of the theme's success or error colour,
// its numbers in a gutter, the hunk's place between. `DiffView` is one file's change, small, for a
// card (a chat's edit); `PatchView` is a whole patch of any size, windowed: only the rows near the
// viewport are made, so a change of a hundred thousand lines scrolls as one of ten. Both are built
// from `div` and `text` alone.
import { useMemo, useRef, useState } from "react";
import { Icon, useFont, useMetrics, useTheme } from "pumi";

import { parsePatch, patchItems, tint, widestNumber, type DiffRow, type FileDiff, type PatchItem } from "./patch.ts";

export { foldedAtFirst, parsePatch, type DiffRow, type FileDiff } from "./patch.ts";

/** The sizes a diff draws with, from the theme's font size and the terminal's family. */
function useDiffType() {
  const m = useMetrics();
  const font = useFont();
  return useMemo(() => {
    const code = Math.max(10, m.fontSize - 1);
    return { code, line: Math.round(code * 1.5), small: Math.max(10, m.fontSize - 1), tiny: Math.max(9, m.fontSize - 2), mono: font.family };
  }, [m.fontSize, font.family]);
}

/** The gutter's width for numbers up to `widest`. */
function gutterWidth(widest: number, code: number): number {
  return Math.max(2, String(widest).length) * Math.round(code * 0.62) + 10;
}

export interface DiffLineProps {
  row: DiffRow;
  /** One column's width (`gutterWidth`). */
  gutter: number;
  /** Both sides' numbers (a wide view), or the one the line has (a narrow card). */
  columns?: 1 | 2;
  onDoubleClick?(row: DiffRow): void;
}

/** One line of a patch. */
export function DiffLine({ row, gutter, columns = 1, onDoubleClick }: DiffLineProps) {
  const t = useTheme();
  const type = useDiffType();
  if (row.kind === "hunk" || row.kind === "note") {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: "100%", minWidth: 0, paddingLeft: 8, paddingRight: 8, minHeight: type.line, backgroundColor: tint(t.accent, 0.08) }}>
        <text style={{ fontFamily: type.mono, fontSize: type.code - 1, color: t.faint, userSelect: "none" }}>{row.kind === "hunk" ? "⋯" : "\\"}</text>
        {row.text ? <text style={{ fontFamily: type.mono, fontSize: type.code - 1, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{row.text}</text> : null}
      </div>
    );
  }
  const tone = row.kind === "add" ? t.success : row.kind === "del" ? t.error : undefined;
  const sign = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
  const number = (n: number | undefined) => (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", width: gutter, flexShrink: 0, paddingRight: 6, backgroundColor: tone ? tint(tone, 0.08) : undefined }}>
      <text style={{ fontFamily: type.mono, fontSize: type.code - 1, lineHeight: type.line, color: t.faint, userSelect: "none" }}>{n !== undefined ? String(n) : ""}</text>
    </div>
  );
  return (
    <div onDoubleClick={onDoubleClick ? () => onDoubleClick(row) : undefined} style={{ display: "flex", flexDirection: "row", width: "100%", minWidth: 0, backgroundColor: tone ? tint(tone, 0.13) : undefined }}>
      {columns === 2 ? (
        <>
          {number(row.old)}
          {number(row.new)}
        </>
      ) : (
        number(row.kind === "del" ? row.old : row.new)
      )}
      <text style={{ width: 16, flexShrink: 0, textAlign: "center", fontFamily: type.mono, fontSize: type.code, lineHeight: type.line, color: tone ?? t.faint, userSelect: "none" }}>{sign}</text>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", flexGrow: 1, flexShrink: 1, minWidth: 0, paddingRight: 8 }}>
        <text style={{ fontFamily: type.mono, fontSize: type.code, lineHeight: type.line, color: t.text }}>{row.text.replace(/\t/g, "    ") || " "}</text>
        {row.cut ? <text style={{ fontFamily: type.mono, fontSize: type.code - 1, lineHeight: type.line, color: t.faint }}>{` … ${row.cut} more characters`}</text> : null}
      </div>
    </div>
  );
}

/** `+12 −3`, in the theme's colours. */
export function Stats({ added, removed }: { added: number; removed: number }) {
  const t = useTheme();
  const type = useDiffType();
  if (added === 0 && removed === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 4, flexShrink: 0 }}>
      {added > 0 ? <text style={{ fontSize: type.tiny, fontFamily: type.mono, color: t.success, whiteSpace: "nowrap" }}>{`+${count(added)}`}</text> : null}
      {removed > 0 ? <text style={{ fontSize: type.tiny, fontFamily: type.mono, color: t.error, whiteSpace: "nowrap" }}>{`−${count(removed)}`}</text> : null}
    </div>
  );
}

/** 1234567 as `1,234,567`. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

const STATUS: Record<FileDiff["status"], string | undefined> = { modified: undefined, added: "New", deleted: "Deleted", renamed: "Renamed", binary: "Binary" };

export interface FileHeadProps {
  file: FileDiff;
  folded: boolean;
  onToggle?(): void;
  /** Opens the file (a button on its head). */
  onOpen?(): void;
}

/** A file's head: its name and folder, how it changed, what it adds up to; pressed, it folds. */
export function FileHead({ file, folded, onToggle, onOpen }: FileHeadProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useDiffType();
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash > 0 ? file.path.slice(0, slash) : "";
  const tag = STATUS[file.status];
  return (
    <div
      role="button"
      aria-expanded={!folded}
      aria-label={`${file.path}${tag ? `, ${tag.toLowerCase()}` : ""}: ${folded ? "open it" : "fold it"}`}
      onClick={onToggle}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 8, paddingRight: 6, cursor: onToggle ? "pointer" : "default", borderBottomWidth: 1, borderColor: t.border, backgroundColor: t.surface, hover: onToggle ? { backgroundColor: t.hover } : {} }}
    >
      {onToggle ? <Icon name={folded ? "chevron_right" : "chevron_down"} size={10} color={t.faint} /> : null}
      <Icon name="file" size={12} color={t.faint} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }} title={file.from ? `${file.from} → ${file.path}` : file.path}>
        <text style={{ fontSize: type.small, fontWeight: 600, color: t.text, whiteSpace: "nowrap", flexShrink: 0 }}>{name}</text>
        {dir ? <text style={{ fontSize: type.tiny, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{file.from ? `${file.from} →` : dir}</text> : null}
      </div>
      {tag ? (
        <div style={{ display: "flex", alignItems: "center", height: 16, paddingLeft: 5, paddingRight: 5, flexShrink: 0, borderRadius: m.radiusSmall, backgroundColor: tint(file.status === "deleted" ? t.error : file.status === "added" ? t.success : t.accent, 0.16) }}>
          <text style={{ fontSize: type.tiny, color: file.status === "deleted" ? t.error : file.status === "added" ? t.success : t.accent }}>{tag}</text>
        </div>
      ) : null}
      {folded && file.rows.length > 0 ? <text style={{ fontSize: type.tiny, color: t.faint, whiteSpace: "nowrap" }}>{`${count(file.rows.length)} lines`}</text> : null}
      <Stats added={file.added} removed={file.removed} />
      {onOpen ? (
        <div
          role="button"
          aria-label={`Open ${file.path}`}
          title="Open the file"
          onClick={(e: any) => {
            e?.stopPropagation?.();
            onOpen();
          }}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.active } }}
        >
          <Icon name="arrow_up_right" size={11} color={t.muted} />
        </div>
      ) : null}
    </div>
  );
}

export interface DiffViewProps {
  /** A unified patch of one file (or a few). */
  patch: string;
  /** Leave out the file's head (a card that names it already). */
  bare?: boolean;
  /** Lines shown before "Show all". */
  maxLines?: number;
}

/** One file's change, for a card: its head, its first `maxLines` lines, "Show all". */
export function DiffView({ patch, bare = false, maxLines = 60 }: DiffViewProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useDiffType();
  const [all, setAll] = useState(false);
  const files = useMemo(() => parsePatch(patch), [patch]);
  const gutter = gutterWidth(widestNumber(files), type.code);
  let budget = all ? Number.POSITIVE_INFINITY : maxLines;
  let hidden = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.editor, overflow: "hidden" }}>
      {files.map((file, index) => {
        const rows = file.rows.slice(0, Math.max(0, budget));
        budget -= rows.length;
        hidden += file.rows.length - rows.length;
        return (
          <div key={index} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            {bare && files.length === 1 ? null : <FileHead file={file} folded={false} />}
            {rows.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", paddingTop: 2, paddingBottom: 2 }}>
                {rows.map((row, at) => (
                  <DiffLine key={at} row={row} gutter={gutter} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {hidden > 0 ? (
        <div
          role="button"
          aria-label={`Show ${hidden} more lines`}
          onClick={() => setAll(true)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 22, cursor: "pointer", borderTopWidth: 1, borderColor: t.border, hover: { backgroundColor: t.hover } }}
        >
          <Icon name="chevron_down" size={10} color={t.faint} />
          <text style={{ fontSize: type.tiny, color: t.muted }}>{`Show ${count(hidden)} more ${hidden === 1 ? "line" : "lines"}`}</text>
        </div>
      ) : null}
    </div>
  );
}

/** Rows made beyond each end of what shows. */
const OVERSCAN = 60;

export interface PatchViewProps {
  files: FileDiff[];
  /** The files folded, by path. */
  folded: ReadonlySet<string>;
  onToggle?(path: string): void;
  onOpen?(file: FileDiff): void;
  /** A line double-clicked: the file, and the line it is on the side it has (the new side's, a deletion's old). */
  onLine?(file: FileDiff, line: number): void;
}

/** A whole patch, windowed: every file's head and lines, only those near the viewport made. */
export function PatchView({ files, folded, onToggle, onOpen, onLine }: PatchViewProps) {
  const t = useTheme();
  const type = useDiffType();
  const items = useMemo(() => patchItems(files, folded), [files, folded]);
  const gutter = useMemo(() => gutterWidth(widestNumber(files), type.code), [files, type.code]);
  const [made, setMade] = useState({ start: 0, end: OVERSCAN * 2 });
  const list = useRef<any>(null);
  const start = Math.max(0, Math.min(made.start, items.length - 1));
  const end = Math.min(items.length, Math.max(made.end, start + 1));
  const draw = (item: PatchItem) => {
    if (item.type === "file") {
      return (
        <div key={`f${item.index}`} style={{ display: "flex", flexDirection: "column", width: "100%", paddingTop: item.index === 0 ? 0 : 10 }}>
          <div style={{ display: "flex", flexDirection: "column", borderTopWidth: item.index === 0 ? 0 : 1, borderColor: t.border }}>
            <FileHead file={item.file} folded={item.folded} onToggle={onToggle ? () => onToggle(item.file.path) : undefined} onOpen={onOpen ? () => onOpen(item.file) : undefined} />
          </div>
        </div>
      );
    }
    const file = files[item.file]!;
    return (
      <div key={`r${item.file}.${item.at}`} style={{ display: "flex", width: "100%", minWidth: 0 }}>
        <DiffLine row={item.row} gutter={gutter} columns={2} onDoubleClick={onLine ? (row) => onLine(file, row.kind === "del" ? (row.old ?? 1) : (row.new ?? row.old ?? 1)) : undefined} />
      </div>
    );
  };
  return (
    <virtual-list
      ref={list}
      itemCount={items.length}
      estimatedItemHeight={type.line}
      windowStart={start}
      overdraw={type.line * 20}
      aria-label="Changes"
      role="list"
      onVisibleRange={(e: any) => {
        const first = e?.startIndex ?? 0;
        const last = e?.endIndex ?? first;
        setMade((had) => {
          if (first - had.start >= OVERSCAN / 2 && had.end - last >= OVERSCAN / 2) return had;
          const next = { start: Math.max(0, first - OVERSCAN), end: last + OVERSCAN };
          return next.start === had.start && next.end === had.end ? had : next;
        });
      }}
      style={{ flexGrow: 1, minHeight: 0, backgroundColor: t.editor }}
    >
      {items.slice(start, end).map(draw)}
    </virtual-list>
  );
}
