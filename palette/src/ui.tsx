// What the palette draws, in the window's React tree: the input, and the rows a query keeps — a
// command with the keys it answers to, or a file with the directory it is in, the letters a query
// matched marked. What is typed, what ↑ walks and what a row runs is the worker's (`model.ts`,
// `main.ts`); this sends it the keystrokes and draws what it answers.
import { useEffect, useState } from "react";
import { call, num, useInterval, useMetrics, useTheme } from "pumi";

import { pick, pressed, typed as onTyped, view as read, type PaletteView } from "./main.ts";

/** A row's height, in pixels. */
const ROW = 28;
/** The input's height. */
const FIELD = 44;

/** A throw the palette cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`palette: ${err instanceof Error ? err.message : String(err)}`);
}

/** The `main` view: a float over the window, the input, and the rows. */
export function Palette({ pane }: { pane: string }) {
  const t = useTheme();
  const m = useMetrics();
  const [state, setState] = useState<PaletteView | undefined>(undefined);

  const close = () => void call("pane.close", num(pane), true).catch(swallow);

  /** A key the input took: the palette's own, and the way out. */
  const press = (key: string) =>
    void pressed(key)
      .then((answer) => (answer.close ? close() : setState(answer.view)))
      .catch(swallow);

  useEffect(() => {
    void read().then(setState).catch(swallow);
  }, []);
  // The project is walked a step at a time, in the worker: the rows appear as it reads.
  useInterval(() => {
    void read().then(setState).catch(swallow);
  }, 200);

  if (!state) return null;
  return (
    <div onClick={(e: any) => e?.stopPropagation?.()} style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: "#00000080" }, overflow: "hidden" }}>
      <input
        value={state.query}
        autoFocus
        placeholder={state.placeholder}
        onChange={(e: any) => void onTyped(e?.value ?? "").then(setState).catch(swallow)}
        onKeyDown={(e: any) => {
          const key = e?.key ?? "";
          const mine = ["escape", "enter", "up", "down", "tab", "pageup", "pagedown"];
          if (!mine.includes(key)) return;
          e?.preventDefault?.();
          e?.stopPropagation?.();
          press(key);
        }}
        style={{ display: "flex", height: FIELD, flexShrink: 0, paddingLeft: 14, paddingRight: 14, fontSize: 14, color: t.text, borderBottomWidth: 1, borderColor: t.border }}
      />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", padding: 4 }}>
        {state.rows.map((row, i) => (
          <div
            key={`${row.id}:${i}`}
            onClick={() => void pick(i).then((answer) => (answer.close ? close() : setState(answer.view))).catch(swallow)}
            onMouseEnter={() => setState({ ...state, selected: i })}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: ROW, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: i === state.selected ? t.selected : undefined }}
          >
            <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
              <text style={{ fontSize: 13, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {row.parts.map(([text, marked], at) =>
                  marked ? <text key={at} style={{ fontSize: 13, color: t.accent }}>{text}</text> : <text key={at} style={{ fontSize: 13, color: t.text }}>{text}</text>,
                )}
              </text>
            </div>
            {row.detail !== "" ? (
              <div style={{ display: "flex", flexShrink: 0, maxWidth: 240, minWidth: 0 }}>
                <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.detail}</text>
              </div>
            ) : null}
          </div>
        ))}
        {state.said !== "" ? (
          <div style={{ display: "flex", flexShrink: 0, paddingLeft: 10, paddingTop: 8, paddingBottom: 8 }}>
            <text style={{ fontSize: 12, color: t.faint }}>{state.said}</text>
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 24, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderTopWidth: 1, borderColor: t.border }}>
        <text style={{ fontSize: 10, color: t.faint }}>{state.mode === "commands" ? "commands" : "files"}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 10, color: t.faint }}>{`${state.rows.length} rows${state.walking ? " · searching…" : ""}`}</text>
      </div>
    </div>
  );
}
