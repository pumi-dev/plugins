// What a browser pane draws, in the window's React tree: the page, and the app browser's toolbar
// over it — back, forward, reload, an address, and the page's name. The window's webview keeps the
// page's state (`useWebview`), so this reads it rather than keeping its own, and mirrors it onto the
// pane's options so the package's functions (`url`, `title`) can answer with it.
import { useEffect, useRef, useState } from "react";
import { Icon, WebView, call, num, useMetrics, useOption, usePane, useTheme, useWebview, webview } from "pumi";

import { hostOf, normalize, resolve } from "./address.ts";

/** What the page there is when a pane has none: the app's browser's own. */
const BLANK = "about:blank";
/** Where a search goes when the app's `browser.search_url` cannot be read. */
const SEARCH = "https://duckduckgo.com/?q={query}";
/** The toolbar's height, and the address field's, in pixels: the app browser's own. */
const TOOLBAR = 32;
const FIELD = 24;

/** The pane option the package's `navigate` writes, and the one its `back`/`forward`/`reload` do. */
const GO = "@url";
const ACT = "@act";
/** What this mirrors of the page, for the package's `url` and `title`. */
const STATE = "@state";

/** A throw the page cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`browser: ${err instanceof Error ? err.message : String(err)}`);
}

/** The toolbar's button: an icon, quietened when it cannot be pressed. */
function Button({ icon, tip, on, enabled = true }: { icon: string; tip: string; on(): void; enabled?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      aria-label={tip}
      onClick={() => enabled && on()}
      style={{
        display: "flex",
        width: 22,
        height: 22,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: m.radiusSmall,
        cursor: enabled ? "pointer" : "default",
        color: enabled ? t.muted : t.faint,
        hover: enabled ? { backgroundColor: t.hover } : {},
      }}
    >
      <Icon name={icon} size={13} color={enabled ? t.muted : t.faint} />
    </div>
  );
}

/** The `page` view: a webview filling the pane, with the toolbar over it. */
export function Page({ pane }: { pane: string }) {
  const t = useTheme();
  const view = useWebview(pane);
  const each = usePane(pane);
  const home = useOption<string>("browser.home_url");
  const search = useOption<string>("browser.search_url") ?? SEARCH;
  const start = (each?.options ?? {})[`url`] as string | undefined;
  const [src, setSrc] = useState(start && start !== "" ? start : BLANK);
  /** What is being typed in the address: the address itself when the field is not being typed in. */
  const [draft, setDraft] = useState<string | null>(null);
  /** The go/act requests the package's functions wrote, last seen. */
  const go = (each?.options ?? {})[GO] as string | undefined;
  const act = (each?.options ?? {})[ACT] as { cmd?: string; at?: number } | undefined;
  const seenGo = useRef<string | undefined>(go);
  const seenAct = useRef<number | undefined>(act?.at);

  /** Goes to `text`, as an address bar would: a URL, or a search. */
  const goes = (text: string) => {
    const target = resolve(text, search);
    if (!target) return;
    if (target.kind === "system") {
      webview(pane, "load", target.url);
      return;
    }
    setSrc(normalize(target.url));
    setDraft(null);
  };

  // The package's `navigate`: the address it wrote on this pane.
  useEffect(() => {
    if (go === undefined || go === seenGo.current) return;
    seenGo.current = go;
    setSrc(normalize(resolve(go, search)?.url ?? go));
    // A webview is made again for a new `src`, so the page is read again even at the same address.
    setDraft(null);
  }, [go, search]);

  // The package's `back`, `forward` and `reload`.
  useEffect(() => {
    if (act?.at === undefined || act.at === seenAct.current) return;
    seenAct.current = act.at;
    if (act.cmd === "back" || act.cmd === "forward" || act.cmd === "reload") webview(pane, act.cmd);
  }, [act?.at, act?.cmd, pane]);

  // What the page says of itself, kept where the package's `url` and `title` can read it.
  useEffect(() => {
    if (!view) return;
    call("option.set", STATE, { url: view.url, title: view.title || (view.url ? hostOf(view.url) : "") }, { pane: num(pane) }).catch(swallow);
  }, [view?.url, view?.title, pane]);

  const title = view?.title || (view?.url ? hostOf(view.url) : "") || "Browser";
  const shown = draft ?? view?.url ?? "";
  return (
    <div
      autoFocus
      tabIndex={0}
      onKeyDown={(e: any) => {
        const chord = e?.key ?? "";
        if (chord === "r" && e?.modifiers?.cmd) {
          e?.preventDefault?.();
          webview(pane, "reload");
          return;
        }
        if (chord === "[" && e?.modifiers?.cmd) {
          e?.preventDefault?.();
          webview(pane, "back");
          return;
        }
        if (chord === "]" && e?.modifiers?.cmd) {
          e?.preventDefault?.();
          webview(pane, "forward");
          return;
        }
        if (chord === "l" && e?.modifiers?.cmd) {
          e?.preventDefault?.();
          // The field takes the keyboard by being made again with `autoFocus`.
          setDraft(view?.url ?? "");
        }
      }}
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, minHeight: 0, backgroundColor: t.editor, color: t.text }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: TOOLBAR, flexShrink: 0, paddingLeft: 6, paddingRight: 8, backgroundColor: t.surface, borderBottomWidth: 1, borderColor: t.border }}>
        <Button icon="arrow_left" tip="Back" on={() => webview(pane, "back")} enabled={view?.back !== false} />
        <Button icon="arrow_right" tip="Forward" on={() => webview(pane, "forward")} enabled={view?.forward !== false} />
        <Button icon={view?.loading ? "square_minus" : "rotate_ccw"} tip={view?.loading ? "Stop" : "Reload"} on={() => webview(pane, view?.loading ? "stop" : "reload")} />
        <input
          value={shown}
          placeholder={home ?? "Search or enter an address"}
          autoFocus={draft !== null}
          onChange={(e: any) => setDraft(e?.value ?? "")}
          onSubmit={(e: any) => goes(e?.value ?? shown)}
          onKeyDown={(e: any) => {
            if (e?.key === "escape") setDraft(null);
            else if (e?.key === "escape") e?.stopPropagation?.();
          }}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: FIELD, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: t.editor, color: t.text, fontSize: 12, borderWidth: 1, borderColor: t.border }}
        />
        <div style={{ display: "flex", flexShrink: 0, maxWidth: 220, minWidth: 0, paddingLeft: 6 }}>
          <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{title}</text>
        </div>
        <Button icon="tool_web" tip="Open devtools" on={() => webview(pane, "devtools")} enabled={view?.devtools !== true} />
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <WebView handle={pane} src={src} style={{ width: "100%", height: "100%" }} />
      </div>
      <div style={{ display: "flex", flexShrink: 0, height: 20, alignItems: "center", paddingLeft: 8, paddingRight: 8, backgroundColor: t.surface, borderTopWidth: 1, borderColor: t.border }}>
        <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {`${view?.url ?? src}${view?.loading ? ` · ${Math.round(view.progress * 100)}%` : ""}`}
        </text>
        <div style={{ flexGrow: 1 }} />
      </div>
    </div>
  );
}
