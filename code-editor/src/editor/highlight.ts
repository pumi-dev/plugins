// The colours of the code: the syntax tree's highlight tags as a few classes, and each visible
// line cut into the runs of one class. The view gives each class a colour from the palette.
import { ensureSyntaxTree, highlightTree, syntaxTree, tagHighlighter, tags as t, type EditorState, type Tree } from "../codemirror.ts";

/** The classes a run can have; "" is plain text. */
export type TokenClass =
  | ""
  | "keyword"
  | "string"
  | "number"
  | "constant"
  | "comment"
  | "type"
  | "function"
  | "property"
  | "operator"
  | "punctuation"
  | "tag"
  | "attribute"
  | "heading"
  | "link"
  | "meta"
  | "regexp"
  | "invalid";

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

/** One run of a line: its text (tabs as they are) and its class. `composing` is an input method's
 *  text, not in the document yet. */
export interface Run {
  text: string;
  cls: TokenClass;
  composing?: boolean;
}

/** The syntax tree up to `to`, parsing for at most `budget` ms more: the newest there is if that
 *  is not enough, which may stop short of `to` (the rest is drawn plain until it parses). */
export function treeUpTo(state: EditorState, to: number, budget: number): { tree: Tree; complete: boolean } {
  const tree = ensureSyntaxTree(state, to, budget);
  return tree ? { tree, complete: true } : { tree: syntaxTree(state), complete: false };
}

/**
 * Lines `first`..`last` (1-based, inclusive) cut into runs. The tree is walked once over the whole
 * range, and each line gets the runs that fall in it, with its gaps as plain text.
 */
export function lineRuns(state: EditorState, tree: Tree, first: number, last: number): Run[][] {
  const doc = state.doc;
  const from = doc.line(first).from;
  const to = doc.line(last).to;
  const spans: { from: number; to: number; cls: TokenClass }[] = [];
  highlightTree(
    tree,
    highlighter,
    (start, end, cls) => {
      // A node with two tags gets both classes: the first is the one drawn.
      spans.push({ from: start, to: end, cls: cls.split(" ")[0] as TokenClass });
    },
    from,
    to,
  );
  const lines: Run[][] = [];
  let span = 0;
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    const runs: Run[] = [];
    let at = line.from;
    while (span < spans.length && spans[span].to <= line.from) span++;
    for (let i = span; i < spans.length && spans[i].from < line.to; i++) {
      const s = spans[i];
      const start = Math.max(s.from, line.from);
      const end = Math.min(s.to, line.to);
      if (start > at) runs.push({ text: doc.sliceString(at, start), cls: "" });
      if (end > start) runs.push({ text: doc.sliceString(start, end), cls: s.cls });
      at = Math.max(at, end);
    }
    if (at < line.to) runs.push({ text: doc.sliceString(at, line.to), cls: "" });
    lines.push(runs);
  }
  return lines;
}

/** A line's runs with `text` in place of offsets `from`..`to` of it: an input method's
 *  composition, drawn where it will go. */
export function withComposition(runs: Run[], from: number, to: number, text: string): Run[] {
  const out: Run[] = [];
  let at = 0;
  let placed = false;
  const place = () => {
    if (!placed) out.push({ text, cls: "", composing: true });
    placed = true;
  };
  for (const run of runs) {
    const end = at + run.text.length;
    if (end <= from) out.push(run);
    else {
      if (at < from) out.push({ ...run, text: run.text.slice(0, from - at) });
      if (end > from) place();
      if (end > to) out.push({ ...run, text: run.text.slice(Math.max(0, to - at)) });
    }
    at = end;
  }
  place();
  return out;
}

/** A line's runs as one string, which changes when what is drawn does: what a row is memoized on. */
export function signature(runs: Run[]): string {
  let out = "";
  for (const run of runs) out += `${run.composing ? "\u0003" : run.cls}\u0001${run.text}\u0002`;
  return out;
}
