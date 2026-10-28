// The editor itself: a CodeMirror state drawn with pumi's elements. `<text-input>` holds the
// keyboard and the platform's typing; inside it a gutter and a surface of rows, one per line in
// view, each a row of coloured runs, under the selections, the carets and an input method's
// composition. Scrolling is the view's own (the wheel moves it), so only the lines in view exist.
//
// Fast by construction: a keystroke is one transaction, one render of the lines in view, and a row
// whose text and colours did not change is not drawn again (`Row` is memoized on its signature).
import { memo, useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";
import { call, type EventPayload, type KeyEvent, type MotionProps, type PressEvent } from "pumi";
import { Transaction, type EditorState, type TransactionSpec } from "../codemirror.ts";
import { copied, dragRange, paste, unitAt } from "../editor/commands.ts";
import type { Colors } from "../editor/colors.ts";
import { bracketBoxes, caretBoxes, maxTop, posAt, reveal, selectionBoxes, visibleLines, type Metrics, type Viewport } from "../editor/geometry.ts";
import { lineRuns, signature, treeUpTo, withComposition, type Run } from "../editor/highlight.ts";
import { inputProps, mapWindow, rangeOf, typedSpec, windowFor, type InputWindow } from "../editor/input.ts";
import { actionFor } from "../editor/keys.ts";
import { columnAt, expandTabs, widthOf } from "../editor/layout.ts";
import { EditorSelection, perform } from "../editor/state.ts";

/** How long a render may spend parsing to colour the lines in view; the rest parses after. */
const PARSE_BUDGET = 12;
/** Space left of the text, and either side of the line numbers. */
const PADDING = 8;
/** What the font's advance is measured on: a row of one character. */
const MEASURE = "0".repeat(80);
/** A caret's blink: lit half the time, in two steps. Native, so it costs no renders. */
const BLINK: MotionProps = { animate: { opacity: [1, 1, 0, 0] }, transition: { duration: 1.06, repeat: "infinite", times: [0, 0.5, 0.5, 1], ease: "linear" } };

export interface CodeViewProps {
  /** The state it starts from; after that the view holds its own, and reports each new one. */
  initial: EditorState;
  font: { family: string; size: number; lineHeight: number };
  colors: Colors;
  focused: boolean;
  /** Called with each transaction applied, and the state it made. */
  onState: (state: EditorState, tr: Transaction) => void;
  onSave: () => void;
}

/** What the view keeps between renders and changes without React: the scroll and size, the
 *  font's measured advance, the window `<text-input>` was given, a composition, a drag. A change
 *  asks for a render with `redraw()`. */
interface Live {
  vp: Viewport;
  charWidth: number;
  input: InputWindow | null;
  /** An input method's text, drawn over `from`..`to` of the document, with its caret at `caret`
   *  (an offset in `text`). */
  composition: { text: string; from: number; to: number; caret: number } | null;
  focused: boolean;
  drag: { start: ReturnType<typeof unitAt>; clicks: number; add: boolean } | null;
  /** The widest line, for how far the view scrolls sideways; worked out per document, when asked. */
  widest: { doc: EditorState["doc"]; width: number } | null;
}

export function CodeView({ initial, font, colors, focused, onState, onSave }: CodeViewProps) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const stateRef = useRef(initial);
  const live = useRef<Live>({ vp: { top: 0, left: 0, width: 0, height: 0 }, charWidth: font.size * 0.6, input: null, composition: null, focused, drag: null, widest: null }).current;
  const lineHeight = Math.round(font.size * font.lineHeight);
  const m: Metrics = { lineHeight, charWidth: live.charWidth, padding: PADDING };
  const metrics = useRef(m);
  metrics.current = m;

  const dispatch = useCallback(
    (spec: Transaction | TransactionSpec | null): boolean => {
      if (!spec) return false;
      const tr = spec instanceof Transaction ? spec : stateRef.current.update(spec);
      stateRef.current = tr.state;
      if (tr.docChanged) {
        if (live.input) live.input = mapWindow(live.input, tr.changes);
        const c = live.composition;
        if (c) live.composition = { ...c, from: tr.changes.mapPos(c.from, -1), to: tr.changes.mapPos(c.to, 1) };
      }
      if (tr.scrollIntoView || tr.docChanged) live.vp = reveal(tr.state, live.vp, metrics.current);
      redraw();
      onState(tr.state, tr);
      return true;
    },
    [onState],
  );

  const grid = () => ({ pageRows: Math.max(1, Math.floor(live.vp.height / metrics.current.lineHeight)) });

  // ── Keys and text ─────────────────────────────────────────────

  const onKeyDown = useCallback(
    (e: KeyEvent) => {
      const action = actionFor(e);
      const mods = e.modifiers ?? { ctrl: false, alt: false, shift: false, cmd: false };
      if (!action) {
        // A key that types text: its text follows as `onTextInput`. It is the editor's either
        // way, so the window's keymap does not take a plain key while the editor has it.
        if (!mods.cmd && !mods.ctrl && e.keyChar) e.stopPropagation();
        return;
      }
      const s = stateRef.current;
      // Escape with one caret and nothing selected is not the editor's: a dialog or the window's
      // keymap may want it.
      if (action.t === "escape" && s.selection.ranges.length === 1 && s.selection.main.empty) return;
      e.stopPropagation();
      e.preventDefault();
      switch (action.t) {
        case "copy":
        case "cut":
          void call("clipboard.set", copied(s).text).catch(() => undefined);
          if (action.t === "cut") dispatch(perform(s, action, grid()));
          return;
        case "paste":
          void call("clipboard.get")
            .then((text: string | null) => {
              if (typeof text === "string" && text) dispatch(paste(stateRef.current, text));
            })
            .catch(() => undefined);
          return;
        case "save":
          onSave();
          return;
        default:
          dispatch(perform(s, action, grid()));
      }
    },
    [dispatch, onSave],
  );

  // The ranges below are in the window `<text-input>` was given (`live.input`), which the element
  // keeps as each typed text left it, as `dispatch` keeps `live.input`.
  const onTextInput = useCallback(
    (e: EventPayload) => {
      const text = e.value ?? "";
      live.composition = null;
      // Enter and Tab arrive as keys; a platform that also sends their text is not heard twice.
      if (text === "\n" || text === "\r" || text === "\t") return redraw();
      const s = stateRef.current;
      const w = live.input ?? windowFor(s, null);
      const range = rangeOf(w, e.startIndex, e.endIndex);
      const spec = typedSpec(s, w, range, text);
      if (!spec) return redraw();
      const tr = spec instanceof Transaction ? spec : s.update(spec);
      dispatch(tr);
      // The element has the caret after what it typed, whatever this made of it.
      if (live.input) {
        const caret = Math.min(tr.state.doc.length, tr.changes.mapPos(range.from, -1) + text.length);
        live.input = { ...live.input, anchor: caret, head: caret };
      }
    },
    [dispatch],
  );

  const onComposition = useCallback((e: EventPayload) => {
    const text = e.value ?? "";
    const w = live.input ?? windowFor(stateRef.current, null);
    const { from, to } = rangeOf(w, e.startIndex, e.endIndex);
    live.composition = text ? { text, from, to, caret: Math.min(text.length, e.selectionEnd ?? text.length) } : null;
    redraw();
  }, []);

  // ── Pointer ───────────────────────────────────────────────────

  const pointAt = (e: { localX?: number; localY?: number }) => posAt(stateRef.current, e.localX ?? 0, e.localY ?? 0, live.vp, metrics.current);

  const onMouseDown = useCallback(
    (e: PressEvent) => {
      if (e.button !== 0) return;
      const s = stateRef.current;
      const pos = pointAt(e);
      if (e.modifiers?.shift) {
        const anchor = s.selection.main.anchor;
        live.drag = { start: EditorSelection.cursor(anchor), clicks: 1, add: false };
        dispatch({ selection: s.selection.replaceRange(EditorSelection.range(anchor, pos)), userEvent: "select.pointer" });
        return;
      }
      const clicks = Math.min(3, e.clickCount ?? 1);
      const unit = unitAt(s, pos, clicks);
      // Option-press adds a caret, as in VS Code and Zed.
      const add = !!e.modifiers?.alt;
      live.drag = { start: unit, clicks, add };
      dispatch({ selection: add ? s.selection.addRange(unit) : EditorSelection.create([unit]), userEvent: "select.pointer" });
    },
    [dispatch],
  );

  const onMouseMove = useCallback(
    (e: EventPayload) => {
      const drag = live.drag;
      if (!drag || e.pressedButton !== 0) return;
      // Past the top or bottom edge, the view follows the drag.
      const y = e.localY ?? 0;
      const step = metrics.current.lineHeight;
      if (y < 0) live.vp = { ...live.vp, top: Math.max(0, live.vp.top - step) };
      else if (y > live.vp.height) live.vp = { ...live.vp, top: Math.min(maxTop(stateRef.current, metrics.current), live.vp.top + step) };
      const s = stateRef.current;
      const range = dragRange(s, drag.start, pointAt(e), drag.clicks);
      const selection = drag.add ? s.selection.replaceRange(range) : EditorSelection.create([range]);
      if (selection.eq(s.selection)) return redraw();
      dispatch({ selection, userEvent: "select.pointer" });
    },
    [dispatch],
  );

  const onMouseUp = useCallback(() => {
    live.drag = null;
  }, []);

  /** A press in the gutter selects its line; a drag from there, lines. */
  const onGutterDown = useCallback(
    (e: PressEvent) => {
      if (e.button !== 0) return;
      const s = stateRef.current;
      const unit = unitAt(s, posAt(s, 0, e.localY ?? 0, live.vp, metrics.current), 3);
      live.drag = { start: unit, clicks: 3, add: false };
      dispatch({ selection: EditorSelection.create([unit]), userEvent: "select.pointer" });
    },
    [dispatch],
  );

  const onScroll = useCallback((e: EventPayload) => {
    const s = stateRef.current;
    let dx = e.deltaX ?? 0;
    let dy = e.deltaY ?? 0;
    // A mouse wheel with shift held scrolls sideways.
    if (!e.precise && e.modifiers?.shift && dx === 0) [dx, dy] = [dy, 0];
    const top = Math.min(maxTop(s, metrics.current), Math.max(0, live.vp.top - dy));
    let left = live.vp.left;
    if (dx !== 0) {
      if (!live.widest || live.widest.doc !== s.doc) {
        let width = 0;
        for (let i = 1; i <= s.doc.lines; i++) width = Math.max(width, widthOf(s.doc.line(i).text, s.tabSize));
        live.widest = { doc: s.doc, width: width * metrics.current.charWidth };
      }
      const most = Math.max(0, live.widest.width + 2 * PADDING - live.vp.width + metrics.current.charWidth);
      left = Math.min(most, Math.max(0, left - dx));
    }
    if (top === live.vp.top && left === live.vp.left) return;
    live.vp = { ...live.vp, top, left };
    redraw();
  }, []);

  const onLayout = useCallback((e: EventPayload) => {
    const first = live.vp.height <= 0;
    live.vp = { ...live.vp, width: e.width ?? live.vp.width, height: e.height ?? live.vp.height };
    // A file opened at a line shows it once there is a view to show it in.
    if (first) live.vp = reveal(stateRef.current, live.vp, metrics.current);
    redraw();
  }, []);

  const onMeasure = useCallback((e: EventPayload) => {
    const width = (e.width ?? 0) / MEASURE.length;
    if (width > 0 && Math.abs(width - live.charWidth) > 0.01) {
      live.charWidth = width;
      redraw();
    }
  }, []);

  const onFocus = useCallback(() => {
    live.focused = true;
    redraw();
  }, []);
  const onBlur = useCallback(() => {
    live.focused = false;
    live.drag = null;
    redraw();
  }, []);

  // ── What is drawn ─────────────────────────────────────────────

  const s = stateRef.current;
  const vp = live.vp;
  const input = (live.input = windowFor(s, live.input));
  const { first, last } = visibleLines(s, vp, m);
  const { tree, complete } = treeUpTo(s, s.doc.line(last).to, PARSE_BUDGET);
  const runs = lineRuns(s, tree, first, last);
  const composition = live.composition;
  // An input method's text, drawn in its line where it will go.
  const composing = composition ? s.doc.lineAt(composition.from) : null;
  if (composition && composing && composing.number >= first && composing.number <= last) {
    const at = composing.number - first;
    runs[at] = withComposition(runs[at], composition.from - composing.from, Math.min(composition.to, composing.to) - composing.from, composition.text);
  }
  // Not parsed this far yet: drawn plain now, coloured when the parse catches up.
  useEffect(() => {
    if (complete) return;
    const timer = setTimeout(redraw, 30);
    return () => clearTimeout(timer);
  });

  const mainLine = s.doc.lineAt(s.selection.main.head).number;
  const gutterWidth = Math.max(3, String(s.doc.lines).length) * m.charWidth + 2 * PADDING;
  const offsetY = (first - 1) * lineHeight - vp.top;
  const contentX = PADDING - vp.left;
  const carets = caretBoxes(s, first, last, m);
  // While composing, the main caret is the input method's, in its text.
  if (composition && composing) {
    const line = composing.text;
    const from = composition.from - composing.from;
    const drawn = line.slice(0, from) + composition.text + line.slice(Math.min(composition.to, composing.to) - composing.from);
    const main = carets.find((c) => c.main);
    if (main) main.x = columnAt(drawn, from + composition.caret, s.tabSize) * m.charWidth;
  }
  const mainCaret = carets.find((c) => c.main);

  // Where the platform's input method puts its window: the main caret, in the element's own box.
  const caret = mainCaret ? { x: gutterWidth + contentX + mainCaret.x, y: offsetY + mainCaret.y, width: 2, height: lineHeight } : { x: gutterWidth, y: 0, width: 2, height: lineHeight };

  const rows: ReactNode[] = [];
  const numbers: ReactNode[] = [];
  for (let n = first; n <= last; n++) {
    const line = runs[n - first];
    rows.push(<Row key={n} runs={line} sig={signature(line)} tabSize={s.tabSize} height={lineHeight} colors={colors} />);
    numbers.push(
      <text key={n} style={{ height: lineHeight, color: n === mainLine ? colors.gutterCurrent : colors.gutter }}>
        {String(n)}
      </text>,
    );
  }

  return (
    <text-input
      autoFocus={focused}
      caret={caret}
      {...inputProps(s, input)}
      onKeyDown={onKeyDown}
      onTextInput={onTextInput}
      onComposition={onComposition}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label="Code editor"
      style={{ display: "flex", flexDirection: "row", flexGrow: 1, width: "100%", height: "100%", overflow: "hidden", backgroundColor: colors.background, fontFamily: font.family, fontSize: font.size, lineHeight, color: colors.text, userSelect: "none" }}
    >
      <div onScroll={onScroll} style={{ display: "flex", flexDirection: "row", flexGrow: 1, height: "100%", overflow: "hidden" }}>
        <div onMouseDown={onGutterDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} style={{ width: gutterWidth, flexShrink: 0, height: "100%", overflow: "hidden", position: "relative", cursor: "default" }}>
          <div style={{ position: "absolute", top: offsetY, left: 0, right: PADDING, display: "flex", flexDirection: "column", alignItems: "flex-end", pointerEvents: "none" }}>{numbers}</div>
        </div>
        <div onLayout={onLayout} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} style={{ flexGrow: 1, height: "100%", overflow: "hidden", position: "relative", cursor: "text" }}>
          {/* What is drawn takes no presses: they all reach the surface, which places the caret. */}
          <div style={{ position: "absolute", top: offsetY, left: contentX, display: "flex", flexDirection: "column", pointerEvents: "none" }}>
            {mainCaret && <div style={{ position: "absolute", left: -contentX, top: mainCaret.y, width: Math.max(vp.width, 1), height: lineHeight, backgroundColor: colors.currentLine }} />}
            {selectionBoxes(s, first, last, m).map((b, i) => (
              <div key={`s${i}`} style={{ position: "absolute", left: b.x, top: b.y, width: b.width, height: b.height, backgroundColor: colors.selection }} />
            ))}
            {bracketBoxes(s, first, last, m).map((b, i) => (
              <div key={`b${i}`} style={{ position: "absolute", left: b.x, top: b.y, width: b.width, height: b.height, backgroundColor: colors.bracket, borderRadius: 2 }} />
            ))}
            {rows}
            {live.focused &&
              carets.map((c) => (
                // Keyed by where it is, so a caret that moves starts its blink lit.
                <div key={`c${c.x}:${c.y}:${s.selection.main.head}`} motion={BLINK} style={{ position: "absolute", left: c.x, top: c.y, width: c.width, height: c.height, backgroundColor: colors.caret }} />
              ))}
          </div>
        </div>
      </div>
      {/* The font's advance, measured on a row of one character drawn clear. */}
      <div style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
        <text onLayout={onMeasure} style={{ whiteSpace: "nowrap", color: "#00000000" }}>
          {MEASURE}
        </text>
      </div>
    </text-input>
  );
}

interface RowProps {
  runs: Run[];
  /** The runs as one string: the row draws again only when it changes. */
  sig: string;
  tabSize: number;
  height: number;
  colors: Colors;
}

/** One line: its runs in their colours, its tabs drawn as the spaces they reach. */
const Row = memo(
  function Row({ runs, tabSize, height, colors }: RowProps) {
    let column = 0;
    const parts: ReactNode[] = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const text = expandTabs(run.text, column, tabSize);
      column += widthOf(text, tabSize);
      parts.push(
        <text key={i} style={{ color: colors.tokens[run.cls] ?? colors.text, fontStyle: run.cls === "comment" ? "italic" : undefined, fontWeight: run.cls === "heading" ? 700 : undefined, textDecoration: run.composing ? "underline" : undefined }}>
          {text}
        </text>,
      );
    }
    return <div style={{ height, display: "flex", flexDirection: "row", whiteSpace: "nowrap", flexShrink: 0 }}>{parts}</div>;
  },
  (a, b) => a.sig === b.sig && a.tabSize === b.tabSize && a.height === b.height && a.colors === b.colors,
);
