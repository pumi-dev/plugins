// What a browser tab draws, in the window's React tree: the app's webview, and a toolbar over it —
// back, forward, reload, an address, and the page's name. The window's webview keeps the
// page's state (`useWebview`), so this reads it rather than keeping its own; it follows its tab's
// `url` option and writes it back as it goes, and reports what the page says of itself, which is
// what the package's `url`, `title` and `read` answer with.
import { useEffect, useRef, useState } from "react";
import { COLOR, Icon, WebView, call, useChannelListener, useMetrics, useOption, useTab, useTheme, useWebview, webview, webviewRun, webviewSnapshot, type RendererProps } from "pumi";

import { hostOf, normalize, resolve } from "./address.ts";
import { kitCall } from "./kit.ts";
import { addNote, answered, dropNotes, notesOf } from "./main.ts";
import { label, type Described, type Note } from "./notes.ts";

/** What the page there is when a tab has none. */
const BLANK = "about:blank";
/** Where a search goes when `search_url` cannot be read. */
const SEARCH = "https://duckduckgo.com/?q={query}";
/** The toolbar's height, and the address field's, in pixels. */
const TOOLBAR = 32;
const FIELD = 24;

/** A throw the page cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`browser: ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * What the page is painted with, as `#rrggbb`: what it paints at the top of itself (what its tab
 * sits above), else the colour most of it is made of, else its body, its root or its
 * `theme-color`. Its tab and this page's own toolbar take it (`@color`), so a tab looks like the
 * site it holds, and the two meet with no seam.
 */
const MAIN_COLOR = `
  const hex = (colour) => {
    const rgba = /rgba?\\(([^)]+)\\)/i.exec(colour || "");
    if (!rgba) return /^#[0-9a-f]{3,8}$/i.test((colour || "").trim()) ? colour.trim() : null;
    const parts = rgba[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const alpha = parts.length > 3 ? parts[3] : 1;
    if (!alpha || [r, g, b].some((n) => !Number.isFinite(n))) return null;
    return "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
  };
  const behind = (element) => {
    for (let at = element; at; at = at.parentElement) {
      const colour = hex(getComputedStyle(at).backgroundColor);
      if (colour) return colour;
    }
    return null;
  };
  const w = innerWidth, h = innerHeight;
  for (const x of [4, Math.round(w / 2), w - 5]) {
    const top = behind(document.elementFromPoint(x, 2));
    if (top) return top;
  }
  const counted = new Map();
  const points = [[4, 4], [w / 2, 4], [w - 5, 4], [4, h / 3], [w / 2, h / 2], [w - 5, h / 3], [4, (2 * h) / 3], [w - 5, (2 * h) / 3]];
  for (const [x, y] of points) {
    const colour = behind(document.elementFromPoint(Math.round(x), Math.round(y)));
    if (colour) counted.set(colour, (counted.get(colour) || 0) + 1);
  }
  const main = [...counted].sort((a, b) => b[1] - a[1])[0];
  const said = document.querySelector('meta[name="theme-color"]');
  return main ? main[0] : behind(document.body) || behind(document.documentElement) || (said ? hex(said.content) : null);
`;

/** `#rrggbb` of what reads on `colour`: near-black on a light shade, near-white on a dark one. */
function inkOn(colour: string): string {
  const channel = (at: number) => {
    const value = Number.parseInt(colour.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.45 ? "#0b0c0e" : "#e9ecf1";
}

/** What a tab's `@color` says, as the tab and this toolbar are painted: its background, and the
 *  ink that reads on it. `null` while it names none the app takes. */
function shadeOf(value: unknown): { background: string; ink: string } | null {
  const said = value && typeof value === "object" ? (value as { background?: unknown }).background : value;
  if (typeof said !== "string" || !/^#[0-9a-f]{3,8}$/i.test(said)) return null;
  const digits = said.slice(1);
  const background = digits.length <= 4 ? `#${[...digits].map((d) => d + d).join("")}` : said;
  return { background, ink: inkOn(background) };
}

/** The toolbar's button: an icon, quietened when it cannot be pressed, lit while `active`. `ink`
 *  is what it is drawn in when the page has given the toolbar a colour of its own. */
function Button({ icon, tip, on, enabled = true, active = false, ink }: { icon: string; tip: string; on(): void; enabled?: boolean; active?: boolean; ink?: string }) {
  const t = useTheme();
  const m = useMetrics();
  const color = active ? t.accent : ink ? (enabled ? ink : `${ink}88`) : enabled ? t.muted : t.faint;
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
        color,
        backgroundColor: active ? t.hover : "transparent",
        hover: enabled ? { backgroundColor: t.hover } : {},
      }}
    >
      <Icon name={icon} size={13} color={color} />
    </div>
  );
}

/** A word-button of the note bar. */
function Word({ text, on, strong = false }: { text: string; on(): void; strong?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      onClick={on}
      style={{ display: "flex", flexShrink: 0, alignItems: "center", height: 22, paddingLeft: 8, paddingRight: 8, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: strong ? t.accent : "transparent", hover: { backgroundColor: strong ? t.accent : t.hover } }}
    >
      <text style={{ fontSize: 12, color: strong ? t.accentText : t.muted, whiteSpace: "nowrap" }}>{text}</text>
    </div>
  );
}

/** What the worker asks a page for (`ask` in main.ts): one of the kit's calls, a script, a picture, a load. */
interface Run {
  id: string;
  what: "kit" | "eval" | "snapshot" | "loaded";
  call?: string;
  call_args?: unknown;
  script?: string;
  path?: string;
  timeout?: number;
}

/** Answers once the page in `handle` has stopped loading (and stayed stopped a moment). */
async function loadedIn(handle: string, ms: number): Promise<{ url: string; title: string }> {
  const until = Date.now() + ms;
  let still = 0;
  for (;;) {
    const state = webview(handle, "state");
    still = state.loading ? 0 : still + 1;
    if (still >= 3) return { url: state.url, title: state.title };
    if (Date.now() > until) throw new Error(`still loading after ${ms} ms`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

/** Does what the worker asked of the page in `handle`, and answers it. */
async function run(handle: string, asked: Run): Promise<void> {
  const ms = asked.timeout ?? 15_000;
  try {
    const value =
      asked.what === "kit"
        ? await webviewRun(handle, kitCall(String(asked.call), asked.call_args), { timeout: ms })
        : asked.what === "eval"
          ? await webviewRun(handle, String(asked.script), { timeout: ms })
          : asked.what === "snapshot"
            ? await webviewSnapshot(handle, String(asked.path))
            : await loadedIn(handle, ms);
    await answered(asked.id, true, value ?? null);
  } catch (err) {
    await answered(asked.id, false, err instanceof Error ? err.message : String(err)).catch(swallow);
  }
}

/** What the page in a tab hears from its worker: its block's methods (`tab.call`), and the
 * protocol's `input`. */
interface Told {
  tab: string;
  method: string;
  args?: { url?: unknown; text?: unknown; paste?: unknown } & Partial<Run>;
}

/** The `page` block's renderer: a webview filling the tab, with the toolbar over it. */
export function Page({ tab, block }: RendererProps) {
  const t = useTheme();
  // Its block names its prefix (`pumi_dev.browser.page` is `pumi_dev.browser.`), which its own
  // options start with.
  const prefix = block.slice(0, block.lastIndexOf(".") + 1);
  const PAGE = `${prefix}url`;
  // The page itself: one in the app, named by the tab it is in.
  const id = tab.id;
  const handle = id;
  const view = useWebview(handle);
  const each = useTab(id);
  /** What the page gave this tab (`@color`, below): the tab and this toolbar are painted with it. */
  const shade = shadeOf((each?.options ?? {})[COLOR]);
  const [home] = useOption<string>(`${prefix}home_url`);
  const [chosen] = useOption<string>(`${prefix}search_url`);
  const search = chosen ?? SEARCH;
  const start = (each?.options ?? {})[PAGE] as string | undefined;
  /** Whether the tab opened without its option: `tab.open` given a bare `{ url }`, read below. */
  const bare = useRef(start === undefined);
  /** The page the option names as the tab opens: what the webview loads first. */
  const opening = start ? resolve(start, search) : null;
  const [src, setSrc] = useState(opening?.kind === "web" ? normalize(opening.url) : BLANK);
  /** What is being typed in the address: the address itself when the field is not being typed in. */
  const [draft, setDraft] = useState<string | null>(null);
  /** The `url` option's last value either effect agreed on, so neither acts on its own write. */
  const agreed = useRef(start ?? src);
  /** Whether the picker is on in the page; the element it gave, while its note is being written. */
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Described | null>(null);
  const [writing, setWriting] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    notesOf(id).then(setNotes).catch(swallow);
  }, [id]);
  useChannelListener("notes", (data: { tab: string; notes: Note[] }) => {
    if (data?.tab === id) setNotes(data.notes);
  });

  /** The picker: on, the next element clicked in the page is the note's; on again, it stops. */
  const pick = () => {
    if (picking) {
      webviewRun(handle, kitCall("cancelPick", null)).catch(swallow);
      return;
    }
    setPicking(true);
    webview(handle, "focus");
    webviewRun<Described | null>(handle, kitCall("pick", null), { timeout: 120_000 })
      .then((el) => {
        if (el) {
          setPicked(el);
          setWriting("");
        }
      })
      .catch((err) => {
        webviewRun(handle, kitCall("cancelPick", null)).catch(() => {});
        swallow(err);
      })
      .finally(() => setPicking(false));
  };
  const keepNote = (text: string) => {
    if (!picked) return;
    const state = webview(handle, "state");
    addNote(id, text, picked, { url: state.url, title: state.title }).catch(swallow);
    setPicked(null);
    setWriting("");
  };

  // The elements the notes are about, outlined and numbered on the page, again as it loads.
  const here = view?.url ?? "";
  useEffect(() => {
    if (view?.loading) return;
    const items = notes.filter((n) => n.url === here).map((n) => ({ ref: n.element.ref, selector: n.element.selector, label: n.id }));
    if (!items.length && !notes.length) return;
    webviewRun(handle, kitCall("mark", { items })).catch(() => {});
  }, [notes, here, view?.loading, handle]);

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

  // The tab's `url` option, changed by whoever navigates it (the package's `navigate`, a tab
  // coming back): the page follows it.
  useEffect(() => {
    if (start === undefined || start === agreed.current) return;
    agreed.current = start;
    const target = start === "" ? null : resolve(start, search);
    if (target?.kind !== "web") return;
    setSrc(normalize(target.url));
    setDraft(null);
  }, [start, search]);

  // A tab opened with a bare `{ url }` (`pumi tab open pumi_dev.browser.page '{"url": …}'`) rather
  // than the option: its arguments say where it starts. One that comes back has its option.
  useEffect(() => {
    if (!bare.current) return;
    bare.current = false;
    call("tab.call", id, "args")
      .then((given: unknown) => {
        const args = given as { url?: unknown } | null;
        if (typeof args?.url === "string" && args.url !== "") goes(args.url);
      })
      .catch(swallow);
    // Once, as the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Where the page is goes on its tab's `url` option, so the tab comes back there, and `url`
  // answers with it.
  useEffect(() => {
    if (start === src) return;
    agreed.current = src;
    call("option.set", PAGE, src, { scope: "tab", id }).catch(swallow);
  }, [src, PAGE, id, start]);

  // Where the page went by itself — a step back, a redirect, a link followed inside it: the address
  // it is on is where the tab is, and `url` says so.
  useEffect(() => {
    if (view?.url) setSrc((was) => (view.url === was ? was : view.url));
  }, [view?.url]);

  // The page's own colour on its tab (`@color`), each time it lands somewhere: a site is dark or
  // light, and the tab above it says which. A page that says nothing of it keeps the theme's.
  // Asked again if it does not answer: at its first paint it may not be ready to.
  useEffect(() => {
    if (!view?.url || view.loading) return;
    let live = true;
    const ask = (tries: number): Promise<void> =>
      webviewRun<string | null>(handle, MAIN_COLOR)
        .then((colour) => {
          // The tab takes it (`@color`), and so does this page's own toolbar: the two meet.
          if (live) call("option.set", COLOR, colour, { scope: "tab", id }).catch(swallow);
          return undefined;
        })
        .catch(() => (live && tries > 0 ? new Promise<void>((ok) => setTimeout(ok, 400)).then(() => ask(tries - 1)) : undefined));
    void ask(2);
    return () => {
      live = false;
    };
  }, [handle, id, view?.url, view?.loading]);

  // The block's methods (`navigate`, `back`, `forward`, `reload`), and the protocol's `input`:
  // what is typed into the address bar, and Enter with it. Its functions run in the worker
  // (`tab.call` reaches `pumi_dev.browser.page.<method>`), which posts them here.
  useChannelListener("page", (data: Told) => {
    if (data?.tab !== id) return;
    if (data.method === "run" && data.args?.id) void run(handle, data.args as Run);
    else if (data.method === "navigate") goes(String(data.args?.url ?? ""));
    else if (data.method === "input") goes(String(data.args?.text ?? data.args?.paste ?? ""));
    else if (data.method === "back" || data.method === "forward" || data.method === "reload") webview(handle, data.method);
  });

  // What the page says of itself, reported to its tab: `read` answers the name and the address,
  // `selection` nothing of another site's document, and the tab's title is the page's name.
  useEffect(() => {
    if (!view) return;
    const title = view.title || (view.url ? hostOf(view.url) : "");
    call("tab.call", id, "describe", { title, text: `${title}\n${view.url}`, selection: null }).catch(swallow);
  }, [view?.url, view?.title, id]);

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
          webview(handle, "reload");
          return;
        }
        if (chord === "[" && e?.modifiers?.cmd) {
          e?.preventDefault?.();
          webview(handle, "back");
          return;
        }
        if (chord === "]" && e?.modifiers?.cmd) {
          e?.preventDefault?.();
          webview(handle, "forward");
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
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: TOOLBAR, flexShrink: 0, paddingLeft: 6, paddingRight: 8, backgroundColor: shade?.background ?? t.surface, borderBottomWidth: 1, borderColor: shade ? `${shade.ink}26` : t.border }}>
        <Button icon="arrow_left" tip="Back" on={() => webview(handle, "back")} enabled={view?.back !== false} ink={shade?.ink} />
        <Button icon="arrow_right" tip="Forward" on={() => webview(handle, "forward")} enabled={view?.forward !== false} ink={shade?.ink} />
        <Button icon={view?.loading ? "square_minus" : "rotate_ccw"} tip={view?.loading ? "Stop" : "Reload"} on={() => webview(handle, view?.loading ? "stop" : "reload")} ink={shade?.ink} />
        <input
          value={shown}
          placeholder={home ?? "Search or enter an address"}
          autoFocus={draft !== null}
          onChange={(e: any) => setDraft(e?.value ?? "")}
          onSubmit={(e: any) => goes(e?.value ?? shown)}
          onKeyDown={(e: any) => {
            if (e?.key === "escape") setDraft(null);
          }}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: FIELD, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: shade ? `${shade.ink}1f` : t.editor, color: shade?.ink ?? t.text, fontSize: 12, borderWidth: 1, borderColor: shade ? `${shade.ink}33` : t.border }}
        />
        {/* The name gives way before the address does: it shrinks to nothing, cut with an ellipsis,
            and never runs under the buttons after it. */}
        <div style={{ display: "flex", flexShrink: 1, maxWidth: 220, minWidth: 0, overflow: "hidden", paddingLeft: 6 }}>
          <text style={{ fontSize: 12, color: shade?.ink ?? t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
        </div>
        <Button icon="square_dot" tip={picking ? "Stop picking (Esc)" : "Pick an element and leave a note for the agent"} on={pick} active={picking} ink={shade?.ink} />
        <Button icon="tool_web" tip="Open devtools" on={() => webview(handle, "devtools")} enabled={view?.devtools !== true} ink={shade?.ink} />
      </div>
      {picked ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: TOOLBAR, flexShrink: 0, paddingLeft: 8, paddingRight: 8, backgroundColor: t.surface, borderBottomWidth: 1, borderColor: t.border }}>
          <Icon name="square_dot" size={12} color={t.accent} />
          <div style={{ display: "flex", flexShrink: 0, minWidth: 0, maxWidth: 260, overflow: "hidden" }}>
            <text style={{ fontSize: 12, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{label(picked)}</text>
          </div>
          <input
            value={writing}
            placeholder="What should the agent change here?"
            autoFocus
            onChange={(e: any) => setWriting(e?.value ?? "")}
            onSubmit={(e: any) => keepNote(e?.value ?? writing)}
            onKeyDown={(e: any) => {
              if (e?.key === "escape") setPicked(null);
            }}
            style={{ display: "flex", flexGrow: 1, minWidth: 60, height: FIELD, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: t.editor, color: t.text, fontSize: 12, borderWidth: 1, borderColor: t.accent }}
          />
          <Word text="Add note" strong on={() => keepNote(writing)} />
          <Word text="Cancel" on={() => setPicked(null)} />
        </div>
      ) : null}
      {notes.length ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 26, flexShrink: 0, paddingLeft: 8, paddingRight: 6, backgroundColor: t.surface, borderBottomWidth: 1, borderColor: t.border, overflow: "hidden" }}>
          <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>
            {notes.some((n) => !n.read) ? "Notes for your next agent message:" : "Notes the agent has read:"}
          </text>
          <div style={{ display: "flex", flexDirection: "row", gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: "hidden" }}>
            {notes.map((n) => (
              <div
                key={n.id}
                title={n.note}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 20, flexShrink: 1, minWidth: 40, maxWidth: 240, paddingLeft: 6, paddingRight: 2, borderRadius: 5, borderWidth: 1, borderColor: n.read ? t.border : t.accent, overflow: "hidden" }}
              >
                <text style={{ fontSize: 11, color: n.read ? t.faint : t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{`${n.id} · ${n.note || label(n.element)}`}</text>
                <div onClick={() => dropNotes(id, [n.id]).catch(swallow)} style={{ display: "flex", width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 4, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
                  <Icon name="close" size={9} color={t.faint} />
                </div>
              </div>
            ))}
          </div>
          <Word text="Clear" on={() => dropNotes(id, null).catch(swallow)} />
        </div>
      ) : null}
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
