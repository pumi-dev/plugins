// Markdown as the chat draws it, parsed apart from drawing it: the blocks of a message (paragraphs,
// headings, lists, quotes, code, tables, rules) and the runs of a line (bold, italic, code, links,
// struck). It is the subset agents write, forgiving of a message still being streamed (a code fence
// not closed yet is code to the end). A line break in a paragraph is kept: agents mean them. No
// `import … from "pumi"` here.

/** A stretch of a line drawn one way. */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** A link's target. */
  href?: string;
}

export interface ListItem {
  /** How deep it is: 0 at the margin. */
  depth: number;
  /** Its marker: `•`, or the number an ordered list gives it (`3.`). */
  marker: string;
  /** A task's box: checked or not; absent when it is no task. */
  task?: boolean;
  text: string;
}

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; text: string; open?: boolean }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "quote"; text: string }
  | { type: "table"; header: string[]; align: ("left" | "center" | "right" | undefined)[]; rows: string[][] }
  | { type: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** The blocks of `text`. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let at = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  while (at < lines.length) {
    const line = lines[at]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const mark = fence[1]!;
      const body: string[] = [];
      at++;
      let closed = false;
      while (at < lines.length) {
        const next = lines[at]!;
        if (next.trim().startsWith(mark[0]!.repeat(mark.length)) && next.trim().replace(new RegExp(`^\\${mark[0]}+`), "").trim() === "") {
          closed = true;
          at++;
          break;
        }
        body.push(next);
        at++;
      }
      blocks.push({ type: "code", lang: fence[2] ?? "", text: body.join("\n"), ...(closed ? {} : { open: true }) });
      continue;
    }
    if (line.trim() === "") {
      flush();
      at++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      at++;
      continue;
    }
    if (RULE.test(line) && paragraph.length === 0) {
      blocks.push({ type: "rule" });
      at++;
      continue;
    }
    if (line.includes("|") && at + 1 < lines.length && TABLE_RULE.test(lines[at + 1]!) && lines[at + 1]!.includes("-")) {
      flush();
      const header = cells(line);
      const align = cells(lines[at + 1]!).map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : undefined));
      at += 2;
      const rows: string[][] = [];
      while (at < lines.length && lines[at]!.includes("|") && lines[at]!.trim() !== "") {
        const row = cells(lines[at]!);
        rows.push(header.map((_, i) => row[i] ?? ""));
        at++;
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const body: string[] = [];
      while (at < lines.length && QUOTE.test(lines[at]!)) body.push(QUOTE.exec(lines[at]!)![1]!), at++;
      blocks.push({ type: "quote", text: body.join("\n") });
      continue;
    }
    const item = ITEM.exec(line);
    if (item && (paragraph.length === 0 || !/^\d/.test(item[2]!) || item[2] === "1." || item[2] === "1)")) {
      flush();
      const ordered = /\d/.test(item[2]!);
      const items: ListItem[] = [];
      const base = item[1]!.length;
      while (at < lines.length) {
        const each = ITEM.exec(lines[at]!);
        if (each) {
          const indent = Math.max(0, each[1]!.length - base);
          const task = /^\[([ xX])\]\s+(.*)$/.exec(each[3]!);
          items.push({
            depth: Math.min(6, Math.floor(indent / 2)),
            marker: /\d/.test(each[2]!) ? `${parseInt(each[2]!, 10)}.` : "•",
            ...(task ? { task: task[1] !== " " } : {}),
            text: task ? task[2]! : each[3]!,
          });
          at++;
          continue;
        }
        const next = lines[at]!;
        // An indented line goes on the item before it; a blank one ends the list unless an item follows.
        if (next.trim() !== "" && /^\s+/.test(next) && items.length > 0) {
          items[items.length - 1]!.text += `\n${next.trim()}`;
          at++;
          continue;
        }
        if (next.trim() === "" && at + 1 < lines.length && ITEM.exec(lines[at + 1]!)) {
          at++;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    paragraph.push(line);
    at++;
  }
  flush();
  return blocks;
}

/** A table row's cells, its outer pipes left off and `\|` kept as a pipe. */
function cells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

type Style = Omit<Run, "text">;

/** The runs of one line or paragraph: its marks taken off, what they mark styled. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  inline(text, {}, runs);
  // Neighbours drawn the same are one run.
  const out: Run[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && sameStyle(last, run)) last.text += run.text;
    else if (run.text !== "") out.push({ ...run });
  }
  return out;
}

/** Whether `text` has marks of its own: else it is drawn as one plain line. */
export function hasMarks(text: string): boolean {
  return /[*_`~[\]<\\]|https?:\/\//.test(text);
}

function sameStyle(a: Run, b: Run): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && !!a.code === !!b.code && a.href === b.href;
}

const URL_AT = /^(https?:\/\/[^\s<>()"'`]*[^\s<>()"'`.,;:!?*_~\]])/;

function inline(text: string, style: Style, out: Run[]): void {
  let plain = "";
  const push = (run: Run) => {
    if (plain !== "") out.push({ ...style, text: plain });
    plain = "";
    out.push(run);
  };
  let at = 0;
  while (at < text.length) {
    const ch = text[at]!;
    const rest = text.slice(at);
    if (ch === "\\" && at + 1 < text.length && /[\\`*_{}[\]()#+\-.!|~<>]/.test(text[at + 1]!)) {
      plain += text[at + 1];
      at += 2;
      continue;
    }
    if (ch === "`") {
      const ticks = /^`+/.exec(rest)![0];
      const end = text.indexOf(ticks, at + ticks.length);
      if (end > 0) {
        let code = text.slice(at + ticks.length, end);
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        push({ ...style, code: true, text: code });
        at = end + ticks.length;
        continue;
      }
    }
    if (ch === "[" && !style.href) {
      const link = /^\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (link) {
        if (plain !== "") out.push({ ...style, text: plain });
        plain = "";
        inline(link[1]!, { ...style, href: link[2]! }, out);
        at += link[0].length;
        continue;
      }
    }
    if (ch === "<") {
      const auto = /^<(https?:\/\/[^\s>]+)>/.exec(rest);
      if (auto) {
        push({ ...style, href: auto[1]!, text: auto[1]! });
        at += auto[0].length;
        continue;
      }
    }
    if (ch === "h" && !style.href && (at === 0 || /[\s(]/.test(text[at - 1]!))) {
      const url = URL_AT.exec(rest);
      if (url) {
        push({ ...style, href: url[1]!, text: url[1]! });
        at += url[1]!.length;
        continue;
      }
    }
    if (ch === "~" && rest.startsWith("~~")) {
      const end = text.indexOf("~~", at + 2);
      if (end > at + 2) {
        if (plain !== "") out.push({ ...style, text: plain });
        plain = "";
        inline(text.slice(at + 2, end), { ...style, strike: true }, out);
        at = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const double = rest.startsWith(ch + ch) && !rest.startsWith(ch + ch + ch);
      const triple = rest.startsWith(ch + ch + ch);
      const width = triple ? 3 : double ? 2 : 1;
      const mark = ch.repeat(width);
      const before = at === 0 ? " " : text[at - 1]!;
      const after = text[at + width] ?? " ";
      // An opener is followed by text; `_` only opens and closes at a word's edge (snake_case stays).
      const opens = !/\s/.test(after) && (ch === "*" || !/[A-Za-z0-9]/.test(before));
      if (opens) {
        const end = closer(text, at + width, mark, ch);
        if (end > at + width) {
          if (plain !== "") out.push({ ...style, text: plain });
          plain = "";
          const inner = text.slice(at + width, end);
          inline(inner, { ...style, ...(width >= 2 ? { bold: true } : {}), ...(width !== 2 ? { italic: true } : {}) }, out);
          at = end + width;
          continue;
        }
      }
    }
    plain += ch;
    at++;
  }
  if (plain !== "") out.push({ ...style, text: plain });
}

/** Where the mark that closes one opened before `from` is: not after a space, `_` at a word's edge. */
function closer(text: string, from: number, mark: string, ch: string): number {
  let at = text.indexOf(mark, from);
  while (at >= 0) {
    const before = text[at - 1] ?? " ";
    const after = text[at + mark.length] ?? " ";
    const edge = ch === "*" || !/[A-Za-z0-9]/.test(after);
    // `**` inside `*…*` is not the single mark's end.
    const exact = text[at + mark.length] !== ch || mark.length === 3;
    if (!/\s/.test(before) && edge && exact) return at;
    at = text.indexOf(mark, at + 1);
  }
  return -1;
}

/** The text of `runs`, as it reads. */
export function plainText(runs: Run[]): string {
  return runs.map((run) => run.text).join("");
}

/** Words as the chat wraps them: each with the spaces after it, a line break as its own `"\n"`. */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (i > 0) out.push("\n");
    const parts = line.match(/\S+\s*|\s+/g) ?? [];
    out.push(...parts);
  }
  return out;
}
