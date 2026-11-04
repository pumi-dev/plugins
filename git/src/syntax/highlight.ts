// The colours of the code in a diff: CodeMirror's syntax tree for a file cut into the runs of one
// class each line is, so a line of a patch draws exactly as the code editor draws that line. The
// file is read whole and parsed once — a grammar needs the whole of it to know where a string or a
// block ends — and only the lines the patch shows are cut, so a change of ten lines in a file of
// ten thousand costs one read and one parse.
import { EditorState, ensureSyntaxTree, highlightTree, syntaxTree, tagHighlighter, tags as t, type Extension, type Tree } from "./codemirror.ts";

/** The classes a run can have; "" is plain text. */
export type TokenClass = "" | "keyword" | "string" | "number" | "constant" | "comment" | "type" | "function" | "property" | "operator" | "punctuation" | "tag" | "attribute" | "heading" | "link" | "meta" | "regexp" | "invalid";

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.self], class: "keyword" },
  { tag: [t.string, t.special(t.string), t.character, t.docString], class: "string" },
  { tag: [t.number, t.integer, t.float], class: "number" },
  { tag: [t.bool, t.null, t.atom, t.unit, t.constant(t.variableName), t.standard(t.variableName)], class: "constant" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "comment" },
  { tag: [t.typeName, t.className, t.namespace, t.macroName, t.standard(t.typeName)], class: "type" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], class: "function" },
  { tag: [t.propertyName, t.definition(t.propertyName), t.labelName], class: "property" },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator, t.definitionOperator, t.typeOperator, t.controlOperator], class: "operator" },
  { tag: [t.punctuation, t.separator, t.bracket, t.angleBracket, t.squareBracket, t.paren, t.brace], class: "punctuation" },
  { tag: [t.tagName], class: "tag" },
  { tag: [t.attributeName], class: "attribute" },
  { tag: [t.heading, t.strong], class: "heading" },
  { tag: [t.link, t.url], class: "link" },
  { tag: [t.meta, t.processingInstruction, t.annotation, t.modifier], class: "meta" },
  { tag: [t.regexp, t.escape], class: "regexp" },
  { tag: [t.invalid], class: "invalid" },
]);

/** One run of a line: its text and its class. */
export interface Run {
  text: string;
  cls: TokenClass;
}

/** The lines of a file, cut into runs: by their number in the file (1-based). */
export type LineRuns = Record<number, Run[]>;

/** The most of a file read and parsed for its colours; longer ones are drawn plain. */
export const MAX_PARSE = 2_000_000;

/** The lines of `text` numbered `lines` (1-based), each cut into runs by `language`, which is a
 *  grammar (`rust()`) or none (a file whose language nothing here highlights). */
export function highlightLines(text: string, lines: Iterable<number>, language: Extension, budget = 100): LineRuns {
  const wanted = [...lines].filter((n) => n >= 1).sort((a, b) => a - b);
  if (wanted.length === 0) return {};
  const state = EditorState.create({ doc: text, extensions: [language] });
  const doc = state.doc;
  const last = wanted[wanted.length - 1]!;
  if (last > doc.lines) return {};
  // One parse for the file: up to the last line the patch shows, giving up after `budget` ms (the
  // part not parsed is drawn plain, and the next read parses more of it).
  const tree: Tree = ensureSyntaxTree(state, doc.line(last).to, budget) ?? syntaxTree(state);
  const from = doc.line(wanted[0]!).from;
  const to = doc.line(last).to;
  const spans: { from: number; to: number; cls: TokenClass }[] = [];
  highlightTree(
    tree,
    highlighter,
    (start, end, cls) => {
      spans.push({ from: start, to: end, cls: cls.split(" ")[0] as TokenClass });
    },
    from,
    to,
  );
  const runs: LineRuns = {};
  let span = 0;
  for (const n of wanted) {
    const line = doc.line(n);
    const out: Run[] = [];
    let at = line.from;
    while (span < spans.length && spans[span]!.to <= line.from) span++;
    for (let i = span; i < spans.length && spans[i]!.from < line.to; i++) {
      const s = spans[i]!;
      const start = Math.max(s.from, line.from);
      const end = Math.min(s.to, line.to);
      if (start > at) out.push({ text: doc.sliceString(at, start), cls: "" });
      if (end > start) out.push({ text: doc.sliceString(start, end), cls: s.cls });
      at = Math.max(at, end);
    }
    if (at < line.to) out.push({ text: doc.sliceString(at, line.to), cls: "" });
    runs[n] = out;
  }
  return runs;
}
