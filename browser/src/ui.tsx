// What a browser pane draws, in the window's React tree: the page, and the app browser's toolbar
// over it — back, forward, reload, an address, and the page's name. The window's webview keeps the
// page's state (`useWebview`), so this reads it rather than keeping its own; it follows its pane's
// `url` option and writes it back as it goes, and reports what the page says of itself, which is
// what the package's `url`, `title` and `read` answer with.
import { useEffect, useRef, useState } from "react";
import { Icon, WebView, call, useChannelListener, useMetrics, useOption, usePane, useTheme, useWebview, webview, type RendererProps } from "pumi";

import { hostOf, normalize, resolve } from "./address.ts";

/** What the page there is when a pane has none: the app's browser's own. */
const BLANK = "about:blank";
/** Where a search goes when the app's `browser.search_url` cannot be read. */
const SEARCH = "https://duckduckgo.com/?q={query}";
/** The toolbar's height, and the address field's, in pixels: the app browser's own. */
const TOOLBAR = 32;
const FIELD = 24;

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

/** What the page in a pane hears from its worker: its block's methods (`pane.call`), and the
 * protocol's `input`. */
interface Told {
  pane: string;
  method: string;
  args?: { url?: unknown; text?: unknown; paste?: unknown };
}

/** The `page` block's renderer: a webview filling the pane, with the toolbar over it. */
/** The view's own keys: macOS's (`cmd+l`, `cmd+r`, `cmd+[`, `cmd+]`), elsewhere a browser's on
 *  Windows and Linux (`ctrl+l`, `ctrl+r` and F5, `alt+left`, `alt+right`). */
const MAC = process.platform === "darwin";
function pageKey(e: any): "address" | "reload" | "back" | "forward" | null {
  const key = e?.key ?? "";
  const m = e?.modifiers ?? {};
  if (MAC) {
    if (!m.cmd) return null;
    return key === "l" ? "address" : key === "r" ? "reload" : key === "[" ? "back" : key === "]" ? "forward" : null;
  }
  if (key === "f5" && !m.ctrl && !m.alt) return "reload";
  if (m.ctrl && !m.alt) return key === "l" ? "address" : key === "r" ? "reload" : null;
  if (m.alt && !m.ctrl && !m.shift) return key === "left" ? "back" : key === "right" ? "forward" : null;
  return null;
}

export function Page({ pane, block }: RendererProps) {
  const t = useTheme();
  // Its block names its prefix (`amresyd.browser.page` is `amresyd.browser.`), which its own
  // options start with.
  const PAGE = `${block.slice(0, block.lastIndexOf(".") + 1)}url`;
  // The page itself: one in the app, named by the pane it is in.
  const id = pane.id;
  const handle = id;
  const view = useWebview(handle);
  const each = usePane(id);
  const [home] = useOption<string>("browser.home_url");
  const [chosen] = useOption<string>("browser.search_url");
  const search = chosen ?? SEARCH;
  const start = (each?.options ?? {})[PAGE] as string | undefined;
  /** The page the option names as the pane opens: what the webview loads first. */
  const opening = start ? resolve(start, search) : null;
  const [src, setSrc] = useState(opening?.kind === "web" ? normalize(opening.url) : BLANK);
  /** What is being typed in the address: the address itself when the field is not being typed in. */
  const [draft, setDraft] = useState<string | null>(null);
  /** The `url` option's last value either effect agreed on, so neither acts on its own write. */
  const agreed = useRef(start ?? src);

  /** Goes to `text`, as an address bar would: a URL, or a search. */
  const goes = (text: string) => {
    const target = resolve(text, search);
    if (!target) return;
    if (target.kind === "system") {
      webview(handle, "load", target.url);
      return;
    }
    setSrc(normalize(target.url));
    setDraft(null);
  };

  // The pane's `url` option, changed by whoever navigates it (the package's `navigate`, a pane
  // coming back): the page follows it.
  useEffect(() => {
    if (start === undefined || start === agreed.current) return;
    agreed.current = start;
    const target = start === "" ? null : resolve(start, search);
    if (target?.kind !== "web") return;
    setSrc(normalize(target.url));
    setDraft(null);
  }, [start, search]);

  // Where the page is goes on its pane's `url` option, so the pane comes back there, and `url`
  // answers with it.
  useEffect(() => {
    if (start === src) return;
    agreed.current = src;
    call("option.set", PAGE, src, { scope: "pane", id }).catch(swallow);
  }, [src, PAGE, id, start]);

  // Where the page went by itself — a step back, a redirect, a link followed inside it: the address
  // it is on is where the pane is, and `url` says so.
  useEffect(() => {
    if (view?.url) setSrc((was) => (view.url === was ? was : view.url));
  }, [view?.url]);

  // The block's methods (`navigate`, `back`, `forward`, `reload`), and the protocol's `input`:
  // what is typed into the address bar, and Enter with it. Its functions run in the worker
  // (`pane.call` reaches `amresyd.browser.page.<method>`), which posts them here.
  useChannelListener("page", (data: Told) => {
    if (data?.pane !== id) return;
    if (data.method === "navigate") goes(String(data.args?.url ?? ""));
    else if (data.method === "input") goes(String(data.args?.text ?? data.args?.paste ?? ""));
    else if (data.method === "back" || data.method === "forward" || data.method === "reload") webview(handle, data.method);
  });

  // What the page says of itself, reported to its pane: `read` answers the name and the address,
  // `selection` nothing of another site's document, and the pane's title is the page's name.
  useEffect(() => {
    if (!view) return;
    const title = view.title || (view.url ? hostOf(view.url) : "");
    call("pane.call", id, "describe", { title, text: `${title}\n${view.url}`, selection: null }).catch(swallow);
  }, [view?.url, view?.title, id]);

  const title = view?.title || (view?.url ? hostOf(view.url) : "") || "Browser";
  const shown = draft ?? view?.url ?? "";
  return (
    <div
      autoFocus
      tabIndex={0}
      onKeyDown={(e: any) => {
        const action = pageKey(e);
        if (!action) return;
        e?.preventDefault?.();
        // The field takes the keyboard by being made again with `autoFocus`.
        if (action === "address") setDraft(view?.url ?? "");
        else webview(handle, action);
      }}
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, minHeight: 0, backgroundColor: t.editor, color: t.text }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: TOOLBAR, flexShrink: 0, paddingLeft: 6, paddingRight: 8, backgroundColor: t.surface, borderBottomWidth: 1, borderColor: t.border }}>
        <Button icon="arrow_left" tip="Back" on={() => webview(handle, "back")} enabled={view?.back !== false} />
        <Button icon="arrow_right" tip="Forward" on={() => webview(handle, "forward")} enabled={view?.forward !== false} />
        <Button icon={view?.loading ? "square_minus" : "rotate_ccw"} tip={view?.loading ? "Stop" : "Reload"} on={() => webview(handle, view?.loading ? "stop" : "reload")} />
        <input
          value={shown}
          placeholder={home ?? "Search or enter an address"}
          autoFocus={draft !== null}
          onChange={(e: any) => setDraft(e?.value ?? "")}
          onSubmit={(e: any) => goes(e?.value ?? shown)}
          onKeyDown={(e: any) => {
            if (e?.key === "escape") setDraft(null);
          }}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: FIELD, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: t.editor, color: t.text, fontSize: 12, borderWidth: 1, borderColor: t.border }}
        />
        <div style={{ display: "flex", flexShrink: 0, maxWidth: 220, minWidth: 0, paddingLeft: 6 }}>
          <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{title}</text>
        </div>
        <Button icon="tool_web" tip="Open devtools" on={() => webview(handle, "devtools")} enabled={view?.devtools !== true} />
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <WebView handle={handle} src={src} style={{ width: "100%", height: "100%" }} />
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
