// A patch, drawn the way the Agents plugin's chats draw one: each file under its own head (its name,
// its folder, what changed, what it adds up to), each line on a wash of the theme's success or error
// colour with its numbers in a gutter and its sign between, the hunk's place in a thin band above.
// The code itself keeps the colours the Code editor plugin gives it: the worker parses each file it
// knows and hands over its lines as runs, which are drawn here in the palette's own colours.
// `PatchView` is a whole patch of any size, windowed: only the rows near the viewport are made, so a
// change of a hundred thousand lines scrolls as one of ten.
import { memo, useMemo, useRef, useState } from "react";
import { Icon, useFont, useMetrics, usePalette, useTheme } from "pumi";

import { foldedAtFirst, patchItems, tint, widestNumber, type DiffRow, type FileDiff, type PatchItem } from "./patch.ts";
import { colorsFrom, type TokensLike } from "./syntax/colors.ts";
import type { LineRuns, Run } from "./syntax/highlight.ts";

export { foldedAtFirst, parsePatch, type DiffRow, type FileDiff } from "./patch.ts";

/** A file's lines cut into runs, by path: what the worker read and parsed (`main.ts:syntaxOf`). */
export type Syntax = Record<string, LineRuns>;

/** Each token class's colour, from the terminals' palette or, without one, the theme's tokens. */
function useTokenColors(): Record<string, string> {
  const palette = usePalette();
  const t = useTheme();
  return useMemo(() => colorsFrom(palette, t as unknown as TokensLike).tokens, [palette, t]);
}

/** The sizes a diff draws with, from the theme's font size and the window's font family. */
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

/** 1234567 as `1,234,567`. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** `+12 −3`, in the theme's colours. */
function Stats({ added, removed }: { added: number; removed: number }) {
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

interface DiffLineProps {
  row: DiffRow;
  /** One column's width (`gutterWidth`). */
  gutter: number;
  /** The row's code as its file's grammar cut it: absent for a line drawn plain (a deletion, a file
   *  whose language nothing here knows). */
  runs?: Run[];
  onDoubleClick?(row: DiffRow): void;
}

/** A line's code: its runs in their own colours, or its text as it is. */
const Code = memo(function Code({ runs, text, type, colors }: { runs?: Run[]; text: string; type: { code: number; line: number; mono: string }; colors: Record<string, string> }) {
  const t = useTheme();
  const plain = text.replace(/\t/g, "    ") || " ";
  if (!runs || runs.length === 0) {
    return <text style={{ fontFamily: type.mono, fontSize: type.code, lineHeight: type.line, color: t.text }}>{plain}</text>;
  }
  return (
    <>
      {runs.map((run, at) => (
        <text key={at} style={{ fontFamily: type.mono, fontSize: type.code, lineHeight: type.line, color: run.cls === "" ? t.text : (colors[run.cls] ?? t.text) }}>
          {run.text.replace(/\t/g, "    ") || " "}
        </text>
      ))}
    </>
  );
});

/** One line of a patch: its two numbers, its sign, its code. */
const DiffLine = memo(function DiffLine({ row, gutter, runs, onDoubleClick }: DiffLineProps) {
  const t = useTheme();
  const type = useDiffType();
  const colors = useTokenColors();
  if (row.kind === "hunk" || row.kind === "note") {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: "100%", minWidth: 0, paddingLeft: 8, paddingRight: 8, minHeight: type.line, backgroundColor: tint(t.accent, 0.08) }}>
        <text style={{ fontFamily: type.mono, fontSize: type.code - 1, color: t.faint, userSelect: "none" }}>{row.kind === "hunk" ? "⋯" : "\\"}</text>
        {row.text ? (
          <text style={{ fontFamily: type.mono, fontSize: type.code - 1, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{row.text}</text>
        ) : null}
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
      {number(row.old)}
      {number(row.new)}
      <text style={{ width: 16, flexShrink: 0, textAlign: "center", fontFamily: type.mono, fontSize: type.code, lineHeight: type.line, color: tone ?? t.faint, userSelect: "none" }}>{sign}</text>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", flexGrow: 1, flexShrink: 1, minWidth: 0, paddingRight: 8 }}>
        <Code runs={row.cut ? undefined : runs} text={row.text} type={type} colors={colors} />
        {row.cut ? <text style={{ fontFamily: type.mono, fontSize: type.code - 1, lineHeight: type.line, color: t.faint }}>{` … ${row.cut} more characters`}</text> : null}
      </div>
    </div>
  );
});

const STATUS: Record<FileDiff["status"], string | undefined> = { modified: undefined, added: "New", deleted: "Deleted", renamed: "Renamed", binary: "Binary" };

interface FileHeadProps {
  file: FileDiff;
  folded: boolean;
  onToggle?(): void;
  /** Opens the file. */
  onOpen?(): void;
}

/** A file's head: its name and folder, how it changed, what it adds up to; pressed, it folds. */
const FileHead = memo(function FileHead({ file, folded, onToggle, onOpen }: FileHeadProps) {
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
});

/** Rows made beyond each end of what shows: a scroll of a few screens finds them made. */
const OVERSCAN = 120;

/** One line of a patch as the list draws it, made again only when the line or its colours are. */
const PatchRow = memo(function PatchRow({ file, row, gutter, runs, onLine }: { file: FileDiff; row: DiffRow; gutter: number; runs?: Run[]; onLine?: (file: FileDiff, line: number) => void }) {
  // The runs are the file's own line as the worker read it: drawn only while it is still the line the
  // patch shows (a file that changed between the two reads is drawn plain until the next read).
  const same = runs !== undefined && runs.length > 0 && runs.reduce((sum, run) => sum + run.text, "") === row.text;
  return (
    <div style={{ display: "flex", width: "100%", minWidth: 0 }}>
      <DiffLine
        row={row}
        gutter={gutter}
        runs={same ? runs : undefined}
        onDoubleClick={onLine ? (it) => onLine(file, it.kind === "del" ? (it.old ?? 1) : (it.new ?? it.old ?? 1)) : undefined}
      />
    </div>
  );
});

export interface PatchViewProps {
  files: FileDiff[];
  /** The files folded, by path. */
  folded: ReadonlySet<string>;
  /** Each file's lines as its grammar cut them (`main.ts:syntaxOf`). */
  syntax?: Syntax;
  onToggle?(path: string): void;
  onOpen?(file: FileDiff): void;
  /** A line double-clicked: the file, and the line it is on the new side (a deletion's old side). */
  onLine?(file: FileDiff, line: number): void;
}

/** A whole patch, windowed: every file's head and lines, only those near the viewport made. */
export function PatchView({ files, folded, syntax, onToggle, onOpen, onLine }: PatchViewProps) {
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
    const runs = syntax === undefined || item.row.new === undefined ? undefined : syntax[file.path]?.[item.row.new];
    return <PatchRow key={`r${item.file}.${item.at}`} file={file} row={item.row} gutter={gutter} runs={runs} onLine={onLine} />;
  };
  return (
    <virtual-list
      ref={list}
      itemCount={items.length}
      estimatedItemHeight={type.line}
      windowStart={start}
      overdraw={type.line * 40}
      aria-label="Diff"
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
