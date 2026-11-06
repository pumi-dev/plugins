// Markdown, drawn from the elements the app has (`div`, `text`): what an agent writes, with its
// emphasis, code, links, lists, quotes, tables and code blocks. A line with no marks is one `<text>`;
// one with marks is its words in a wrapping row, so a bold word or a link sits in the line. Colours
// are the theme's; code is in the terminal's font.
import { useState, type ReactNode } from "react";
import { call, Icon, useMetrics, useTheme, type StyleDesc } from "pumi";

import { hasMarks, parseBlocks, parseInline, words, type Block, type ListItem, type Run } from "../markdown.ts";
import { clipLines } from "../view.ts";
import { Press } from "./press.tsx";
import { swallow, tint, useType } from "./style.ts";

/** Opens a link: `onLink` when the chat was given one, else the system's handler for it. */
export function openLink(url: string, onLink?: (url: string) => void): void {
  if (onLink) return onLink(url);
  void call("fs.open", url).catch(swallow);
}

/** Puts `text` on the clipboard. */
export function copyText(text: string): void {
  void call("clipboard.set", text).catch(swallow);
}

export interface MarkdownProps {
  text: string;
  /** Drawn in the muted colour (a thought). */
  muted?: boolean;
  /** Smaller type (a card's text). */
  small?: boolean;
  onLink?(url: string): void;
}

/** A message's markdown, block by block. */
export function Markdown({ text, muted = false, small = false, onLink }: MarkdownProps) {
  const blocks = parseBlocks(text);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {blocks.map((block, at) => (
        <BlockView key={at} block={block} muted={muted} small={small} onLink={onLink} />
      ))}
    </div>
  );
}

function BlockView({ block, muted, small, onLink }: { block: Block; muted: boolean; small: boolean; onLink?(url: string): void }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const size = small ? type.small : type.body;
  const line = small ? type.smallLine : type.bodyLine;
  const color = muted ? t.muted : t.text;
  switch (block.type) {
    case "paragraph":
      return <Inline text={block.text} size={size} line={line} color={color} onLink={onLink} />;
    case "heading": {
      const bump = block.level === 1 ? 5 : block.level === 2 ? 3 : block.level === 3 ? 1 : 0;
      return (
        <div style={{ display: "flex", flexDirection: "column", paddingTop: block.level <= 2 ? 4 : 2 }}>
          <Inline text={block.text} size={size + bump} line={Math.round((size + bump) * 1.35)} color={t.text} weight={block.level <= 3 ? 650 : 600} onLink={onLink} />
        </div>
      );
    }
    case "rule":
      return <div style={{ height: 1, backgroundColor: t.border, marginTop: 4, marginBottom: 4 }} />;
    case "quote":
      return (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 10, borderLeftWidth: 3, borderColor: t.border }}>
          <Markdown text={block.text} muted small={small} onLink={onLink} />
        </div>
      );
    case "code":
      return <CodeBlock code={block.text} lang={block.lang} />;
    case "list":
      return (
        <div role="list" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {block.items.map((item, at) => (
            <ListRow key={at} item={item} ordered={block.ordered} size={size} line={line} color={color} onLink={onLink} />
          ))}
        </div>
      );
    case "table":
      return (
        <div role="table" style={{ display: "flex", flexDirection: "column", borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, overflow: "hidden" }}>
          <TableRow cells={block.header} align={block.align} header size={type.small} line={type.smallLine} onLink={onLink} />
          {block.rows.map((row, at) => (
            <TableRow key={at} cells={row} align={block.align} striped={at % 2 === 1} size={type.small} line={type.smallLine} onLink={onLink} />
          ))}
        </div>
      );
  }
}

function ListRow({ item, ordered, size, line, color, onLink }: { item: ListItem; ordered: boolean; size: number; line: number; color: string; onLink?(url: string): void }) {
  const t = useTheme();
  const marker =
    item.task !== undefined ? (
      <div style={{ display: "flex", height: line, alignItems: "center" }}>
        <Icon name={item.task ? "status_check" : "status_ring"} size={size} color={item.task ? t.success : t.faint} />
      </div>
    ) : (
      <text style={{ fontSize: size, lineHeight: line, color: t.faint, whiteSpace: "nowrap" }}>{item.marker}</text>
    );
  return (
    <div role="listitem" style={{ display: "flex", flexDirection: "row", gap: 6, paddingLeft: item.depth * 16, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", flexShrink: 0, minWidth: ordered ? 18 : 12 }}>{marker}</div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <Inline text={item.text} size={size} line={line} color={item.task ? t.muted : color} strike={item.task === true} onLink={onLink} />
      </div>
    </div>
  );
}

function TableRow({ cells, align, header = false, striped = false, size, line, onLink }: { cells: string[]; align: ("left" | "center" | "right" | undefined)[]; header?: boolean; striped?: boolean; size: number; line: number; onLink?(url: string): void }) {
  const t = useTheme();
  return (
    <div role="row" style={{ display: "flex", flexDirection: "row", backgroundColor: header ? t.surface : striped ? tint(t.surface, 0.5) : undefined, borderBottomWidth: header ? 1 : 0, borderColor: t.border }}>
      {cells.map((cell, at) => (
        <div
          key={at}
          role={header ? "columnheader" : "cell"}
          style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderLeftWidth: at === 0 ? 0 : 1, borderColor: t.border }}
        >
          <Inline text={cell} size={size} line={line} color={t.text} weight={header ? 600 : undefined} align={align[at]} onLink={onLink} />
        </div>
      ))}
    </div>
  );
}

export interface InlineProps {
  text: string;
  size: number;
  line: number;
  color: string;
  weight?: number;
  strike?: boolean;
  /** Where its lines sit across its width (a table column's alignment). */
  align?: "left" | "center" | "right";
  onLink?(url: string): void;
}

/** One paragraph's text: a `<text>` a line when it has no marks, else its runs' words in a wrapping row. */
export function Inline({ text, size, line, color, weight, strike = false, align, onLink }: InlineProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const base = { fontSize: size, lineHeight: line, color, ...(weight ? { fontWeight: weight } : {}), ...(strike ? { textDecoration: "line-through" as const } : {}) };
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";
  if (!hasMarks(text)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, alignItems: justify }}>
        {text.split("\n").map((each, at) => (
          <text key={at} style={base}>
            {each === "" ? " " : each}
          </text>
        ))}
      </div>
    );
  }
  // A line a row: its words wrap in it, and it is one line to copy (`textFlow`), not a word a line.
  const rows: ReactNode[][] = [[]];
  parseInline(text).forEach((run, r) => {
    if (run.code) {
      rows.at(-1)!.push(
        <div key={`${r}`} style={{ display: "flex", flexShrink: 1, minWidth: 0, maxWidth: "100%", paddingLeft: 4, paddingRight: 4, borderRadius: m.radiusSmall, backgroundColor: tint(t.text, 0.08) }}>
          <text style={{ ...base, ...style(run), fontFamily: type.mono, fontSize: Math.max(9, size - 1), color: run.href ? t.accent : t.text, minWidth: 0 }}>{run.text}</text>
        </div>,
      );
      return;
    }
    words(run.text).forEach((word, w) => {
      const key = `${r}.${w}`;
      if (word === "\n") rows.push([]);
      else if (run.href) {
        const href = run.href;
        rows.at(-1)!.push(
          <div key={key} role="link" title={href} onClick={() => openLink(href, onLink)} style={{ display: "flex", cursor: "pointer", flexShrink: 1, minWidth: 0 }}>
            <text style={{ ...base, ...style(run), color: t.accent, hover: { textDecoration: "underline" } }}>{word}</text>
          </div>,
        );
      } else rows.at(-1)!.push(<text key={key} style={{ ...base, ...style(run), flexShrink: 1, minWidth: 0 }}>{word}</text>);
    });
  });
  // Rows stretch to the width they are given (never wider: a long path wraps in it), and their
  // lines stack from the top, however tall the row is made.
  const row = (pieces: ReactNode[], at: number) => (
    <div key={at} textFlow style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", alignContent: "flex-start", justifyContent: justify, minWidth: 0, minHeight: pieces.length === 0 ? line : undefined }}>
      {pieces}
    </div>
  );
  return rows.length === 1 ? row(rows[0]!, 0) : <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>{rows.map(row)}</div>;
}

function style(run: Run): StyleDesc {
  return {
    ...(run.bold ? { fontWeight: 650 } : {}),
    ...(run.italic ? { fontStyle: "italic" } : {}),
    ...(run.strike ? { textDecoration: "line-through" as const } : {}),
  };
}

/** How many lines a block shows before "Show all". */
const CODE_LINES = 40;

/** A block of code: its language and a copy button over it, the code in the terminal's font. */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [all, setAll] = useState(false);
  const text = code.replace(/\t/g, "    ");
  const { text: shown, more } = all ? { text, more: 0 } : clipLines(text, CODE_LINES);
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 24, paddingLeft: 10, paddingRight: 4, borderBottomWidth: 1, borderColor: t.border }}>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: type.tiny, color: t.faint, whiteSpace: "nowrap" }}>{lang || "code"}</text>
        </div>
        <CopyButton text={code} />
      </div>
      <Mono text={shown} />
      {more > 0 ? <MoreLines more={more} onPress={() => setAll(true)} /> : null}
    </div>
  );
}

/** Monospaced lines, wrapped where the pane is narrow, their indentation kept. */
export function Mono({ text, color, padding = 10 }: { text: string; color?: string; padding?: number }) {
  const t = useTheme();
  const type = useType();
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, paddingLeft: padding, paddingRight: padding, paddingTop: 6, paddingBottom: 6 }}>
      {text.split("\n").map((line, at) => (
        <text key={at} style={{ fontFamily: type.mono, fontSize: type.code, lineHeight: type.codeLine, color: color ?? t.text }}>
          {line === "" ? " " : line}
        </text>
      ))}
    </div>
  );
}

/** "Show N more lines", under a clipped block. */
export function MoreLines({ more, onPress }: { more: number; onPress(): void }) {
  const t = useTheme();
  const type = useType();
  return (
    <Press
      aria-label={`Show ${more} more lines`}
      onClick={onPress}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 22, cursor: "pointer", borderTopWidth: 1, borderColor: t.border, hover: { backgroundColor: t.hover } }}
    >
      <Icon name="chevron_down" size={10} color={t.faint} />
      <text style={{ fontSize: type.tiny, color: t.muted }}>{`Show ${more} more ${more === 1 ? "line" : "lines"}`}</text>
    </Press>
  );
}

/** A small button that copies `text`, and says so for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [done, setDone] = useState(false);
  return (
    <Press
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={() => {
        copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 20, paddingLeft: 5, paddingRight: 5, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
    >
      <Icon name={done ? "check" : "copy"} size={11} color={done ? t.success : t.faint} />
      {done ? <text style={{ fontSize: type.tiny, color: t.success }}>Copied</text> : null}
    </Press>
  );
}
