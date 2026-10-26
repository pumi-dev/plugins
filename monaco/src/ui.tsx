// What a file pane draws when the editor draws it (the manifest's `renderers.file`): the page
// (`web/index.html`, Monaco) filling it, with no background of its own, so the pane's shows
// through. The page reads its files through `main.ts` itself; this tells it what changes of its
// pane: the file (the core's option `path`), the options, what the worker asks of it (`save`,
// `reveal`, `action`), and whether its pane is the window's current one. `Toolbar` puts the
// unsaved mark, and a save, in the pane's title bar.
import { useEffect, useState } from "react";
import { IconButton, useChannelListener, useOption, usePane, usePlugin, useTheme, webview, WebView, type PaneId } from "pumi";
import { save } from "./main.ts";

/** The plugin's prefix, `amresyd.monaco.`: its options'. */
function usePrefix(): string {
  return `${(usePlugin() ?? "").replace("/", ".")}.`;
}


/**
 * Chords Monaco binds that the app's keymap takes too, kept by the page while it has the keyboard
 * (spelled as the page's key script spells them: ctrl, alt, shift, cmd). `cmd+s` is the plugin's
 * own key and Monaco's: in the page it saves without a trip through the app.
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
];

/** A throw the page cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`monaco: ${err instanceof Error ? err.message : String(err)}`);
}

/** What the worker posts to a page: what the pane was asked to do (`save`, `action`, `pull`). */
interface Asked {
  pane: PaneId;
  method: string;
  args?: { id?: unknown };
}

/** The renderer of the core's `file` block. */
export function Editor({ pane, focused }: { pane: PaneId; focused: boolean }) {
  const prefix = usePrefix();
  const handle = `monaco-${pane}`;
  const each = usePane(pane);
  const path = ((each?.options ?? {}).path as string | undefined) ?? "";
  // The page reads `args` once, as it is made; what changes after goes in through `__monaco`.
  const [args] = useState(() => ({ pane, path, focused }));
  const fontSize = useOption<number>(`${prefix}font_size`);
  const tabSize = useOption<number>(`${prefix}tab_size`);
  const wordWrap = useOption<boolean>(`${prefix}word_wrap`);
  const minimap = useOption<boolean>(`${prefix}minimap`);

  /** Runs `code` against the page's `window.__monaco`. A page not made or loaded yet hears nothing,
   *  and reads where its pane stands when it loads. */
  const tell = (code: string) => {
    try {
      webview(handle, "eval", `window.__monaco&&__monaco.${code}`);
    } catch {}
  };

  useEffect(() => {
    if (path) tell(`show(${JSON.stringify(path)})`);
  }, [handle, path]);

  useEffect(() => {
    const config: Record<string, unknown> = {};
    if (typeof fontSize === "number") config.font_size = fontSize;
    if (typeof tabSize === "number") config.tab_size = tabSize;
    if (typeof wordWrap === "boolean") config.word_wrap = wordWrap;
    if (typeof minimap === "boolean") config.minimap = minimap;
    tell(`configure(${JSON.stringify(config)})`);
  }, [handle, fontSize, tabSize, wordWrap, minimap]);

  // The pane coming forward gives the page the keyboard; the page, pressed while its pane is not
  // the current one, makes it so (`paneFocused`).
  useEffect(() => {
    tell(`paneFocused(${focused})`);
    if (!focused) return;
    try {
      webview(handle, "focus");
    } catch {}
    tell("focus()");
  }, [handle, focused]);

  // What the worker asks of this pane's page: `amresyd.monaco.save` and the editor's commands come
  // through it, since a block's methods are functions now.
  useChannelListener("page", (asked: Asked) => {
    if (asked?.pane !== pane) return;
    if (asked.method === "save") tell("save()");
    else if (asked.method === "reveal") tell("pull()");
    else if (asked.method === "action" && typeof asked.args?.id === "string") tell(`action(${JSON.stringify(asked.args.id)})`);
  });

  return <WebView handle={handle} src="web/index.html" args={args} keepKeys={KEEP_KEYS} autoFocus={focused} style={{ flexGrow: 1, width: "100%", height: "100%" }} />;
}

/** The pane's title bar, on a file pane the editor draws: a dot while its file has unsaved
 *  changes (the editor's own `dirty`, which only it sets), which saves. */
export function Toolbar({ pane }: { pane: PaneId }) {
  const t = useTheme();
  const each = usePane(pane);
  const prefix = usePrefix();
  if (!each || each.block !== "file") return null;
  const options = each.options ?? {};
  if (options[`${prefix}dirty`] !== true) return null;
  const path = String(options.path ?? "");
  return <IconButton icon="circle" title={`Save ${path.slice(path.lastIndexOf("/") + 1)} (⌘S)`} color={t.accent} onClick={() => void save(pane).catch(swallow)} />;
}
