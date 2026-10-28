// What a file tab draws when the editor draws it (the manifest's `renderers.file`): the page
// (`web/index.html`, Monaco) filling it, with no background of its own, so the tab's shows
// through. The page reads its files through `main.ts` itself; this tells it what changes of its
// tab: the file (the core's option `path`), the options, what the worker asks of it (`save`,
// `reveal`, `action`), and whether its tab is the window's current one. `Toolbar` puts the
// unsaved mark, and a save, in the tab's toolbar.
import { useEffect, useState } from "react";
import { IconButton, useChannelListener, useFont, useOption, usePlugin, useTab, useTheme, webview, WebView, type RendererProps, type TabId } from "pumi";
import { page, save } from "./main.ts";

/** The plugin's prefix, `pumi_dev.vscode_editor.`: its options'. A prefix has `-` as `_`. */
function usePrefix(): string {
  return `${(usePlugin() ?? "").replace("/", ".").replaceAll("-", "_")}.`;
}


/**
 * Chords Monaco binds that the app's keymap or its menu bar takes too, kept by the page while it
 * has the keyboard (spelled as the page's key script spells them: ctrl, alt, shift, cmd): the app
 * leaves them to it, and the menu bar drops them as key equivalents meanwhile. `cmd+s` is the
 * plugin's own key and Monaco's: in the page it saves without a trip through the app.
 */
const KEEP_KEYS = [
  "cmd+s",
  "cmd+d", // add the next match to the selection
  "cmd+k", // the start of Monaco's two-key chords
  "cmd+slash", // comment the line
  "cmd+[", // outdent
  "cmd+]", // indent
  "cmd+enter", // a line below
  "alt+cmd+up", // a cursor above
  "alt+cmd+down", // a cursor below
  "alt+shift+cmd+up", // a column selection, up
  "alt+shift+cmd+down", // … down
  "alt+shift+cmd+left", // … left
  "alt+shift+cmd+right", // … right
];

/** A throw the page cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`vscode-editor: ${err instanceof Error ? err.message : String(err)}`);
}

/** What the worker posts to a page: what the tab was asked to do (`save`, `action`, `pull`). */
interface Asked {
  tab: TabId;
  method: string;
  args?: { id?: unknown };
}

/** The renderer of the core's `file` block. */
export function Editor(props: RendererProps) {
  // The page is built the first time the plugin runs (a few seconds); until then, a line says so.
  const [ready, setReady] = useState<true | string | null>(null);
  const t = useTheme();
  useEffect(() => {
    void page().then((error) => setReady(error ?? true), (err) => setReady(String(err)));
  }, []);
  if (ready === true) return <Page {...props} />;
  return (
    <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <text style={{ fontSize: 12, color: ready === null ? t.faint : t.error }}>{ready === null ? "Preparing the editor…" : `The editor could not be built: ${ready}`}</text>
    </div>
  );
}

/** The page, once it is built. */
function Page({ tab: model, focused }: RendererProps) {
  const tab = model.id;
  const prefix = usePrefix();
  const handle = `monaco-${tab}`;
  const each = useTab(tab);
  const path = ((each?.options ?? {}).path as string | undefined) ?? "";
  // The terminals' font (Settings → Appearance: Font family, Font size, Line height).
  const font = useFont();
  // The page reads `args` once, as it is made; what changes after goes in through `__monaco`.
  const [args] = useState(() => ({
    tab,
    path,
    focused,
    font: { font_family: font.family, font_size: font.size, line_height: font.lineHeight },
  }));
  const tabSize = useOption<number>(`${prefix}tab_size`);
  const wordWrap = useOption<boolean>(`${prefix}word_wrap`);
  const minimap = useOption<boolean>(`${prefix}minimap`);

  /** Runs `code` against the page's `window.__monaco`. A page not made or loaded yet hears nothing,
   *  and reads where its tab stands when it loads. */
  const tell = (code: string) => {
    try {
      webview(handle, "eval", `window.__monaco&&__monaco.${code}`);
    } catch {}
  };

  useEffect(() => {
    if (path) tell(`show(${JSON.stringify(path)})`);
  }, [handle, path]);

  useEffect(() => {
    const config: Record<string, unknown> = {
      font_family: font.family,
      font_size: font.size,
      line_height: font.lineHeight,
    };
    if (typeof tabSize === "number") config.tab_size = tabSize;
    if (typeof wordWrap === "boolean") config.word_wrap = wordWrap;
    if (typeof minimap === "boolean") config.minimap = minimap;
    tell(`configure(${JSON.stringify(config)})`);
  }, [handle, font.family, font.size, font.lineHeight, tabSize, wordWrap, minimap]);

  // The tab coming forward gives the page the keyboard; the page, pressed while its tab is not
  // the current one, makes it so (`tabFocused`).
  useEffect(() => {
    tell(`tabFocused(${focused})`);
    if (!focused) return;
    try {
      webview(handle, "focus");
    } catch {}
    tell("focus()");
  }, [handle, focused]);

  // What the worker asks of this tab's page: `<prefix>save` and the editor's commands come
  // through it.
  useChannelListener("page", (asked: Asked) => {
    if (asked?.tab !== tab) return;
    if (asked.method === "save") tell("save()");
    else if (asked.method === "reveal") tell("pull()");
    else if (asked.method === "action" && typeof asked.args?.id === "string") tell(`action(${JSON.stringify(asked.args.id)})`);
  });

  return <WebView handle={handle} src="web/index.html" args={args} keepKeys={KEEP_KEYS} autoFocus={focused} style={{ flexGrow: 1, width: "100%", height: "100%" }} />;
}

/** The tab's toolbar, on a file tab the editor draws: a dot while its file has unsaved
 *  changes (the editor's own `dirty`, which only it sets), which saves. */
export function Toolbar({ tab }: { tab: TabId }) {
  const t = useTheme();
  const each = useTab(tab);
  const prefix = usePrefix();
  if (!each || each.block !== "file") return null;
  const options = each.options ?? {};
  if (options[`${prefix}dirty`] !== true) return null;
  const path = String(options.path ?? "");
  return <IconButton icon="circle" title={`Save ${path.slice(path.lastIndexOf("/") + 1)} (⌘S)`} color={t.accent} onClick={() => void save(tab).catch(swallow)} />;
}
