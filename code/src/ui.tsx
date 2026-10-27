// What a file tab draws when this plugin draws it (the manifest's `renderers.file`): the file in
// the code editor (`ui/view.tsx`), read and written through `main.ts`. `Toolbar` puts the unsaved
// mark, and a save, in the tab's toolbar.
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton, call, useChannelListener, useFont, useOption, usePalette, usePlugin, useTab, useTheme, type RendererProps } from "pumi";
import type { EditorState, Transaction } from "./vendor/codemirror.js";
import { colorsFrom } from "./editor/colors.ts";
import { createState, EditorSelection } from "./editor/state.ts";
import { read, setDirty, write } from "./main.ts";
import { CodeView } from "./ui/view.tsx";

/** The plugin's prefix, `amresyd.code.`: its options' and functions'. */
function usePrefix(): string {
  return `${(usePlugin() ?? "").replace("/", ".")}.`;
}

function swallow(err: unknown): void {
  console.error(`code: ${err instanceof Error ? err.message : String(err)}`);
}

/** What the worker posts to the views: what was asked of a tab (`save`). */
interface Asked {
  tab: string;
  method: string;
}

/** The renderer of the core's `file` block. */
export function Editor(props: RendererProps) {
  return (
    <Failure>
      <EditorBody {...props} />
    </Failure>
  );
}

function EditorBody({ tab, focused }: RendererProps) {
  const id = tab.id;
  const each = useTab(id);
  const options = (each?.options ?? {}) as Record<string, unknown>;
  const path = String(options.path ?? "");
  const line = typeof options.line === "number" ? options.line : undefined;
  const prefix = usePrefix();
  const [tabSize] = useOption<number>(`${prefix}tab_size`);
  const [spaces] = useOption<boolean>(`${prefix}insert_spaces`);
  const font = useFont();
  const t = useTheme();
  const palette = usePalette();
  const colors = useMemo(() => colorsFrom(palette, t), [palette, t]);

  const [loaded, setLoaded] = useState<{ path: string; state: EditorState } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** The newest state, and the text last read or saved: what a save writes, and what dirty is. */
  const current = useRef<EditorState | null>(null);
  const saved = useRef<EditorState["doc"] | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!path) return;
    let gone = false;
    setFailed(null);
    read(path)
      .then(({ text }) => {
        if (gone) return;
        let state = createState(text, path, { tabSize: typeof tabSize === "number" ? tabSize : 4, spaces: spaces !== false });
        if (line && line >= 1 && line <= state.doc.lines) state = state.update({ selection: EditorSelection.cursor(state.doc.line(line).from) }).state;
        current.current = state;
        saved.current = state.doc;
        dirty.current = false;
        setLoaded({ path, state });
      })
      .catch((err: unknown) => !gone && setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      gone = true;
    };
    // The file is read again only for another path: the options apply to the next one opened.
  }, [path]);

  const onState = useCallback(
    (state: EditorState, tr: Transaction) => {
      current.current = state;
      if (!tr.docChanged) return;
      const now = saved.current ? !state.doc.eq(saved.current) : true;
      if (now !== dirty.current) {
        dirty.current = now;
        void setDirty(id, now).catch(swallow);
      }
    },
    [id],
  );

  const save = useCallback(() => {
    const state = current.current;
    if (!state || !path) return;
    const doc = state.doc;
    void write(id, path, doc.toString())
      .then(() => {
        saved.current = doc;
        dirty.current = !current.current?.doc.eq(doc);
        if (dirty.current) void setDirty(id, true).catch(swallow);
      })
      .catch(swallow);
  }, [id, path]);

  useChannelListener("view", (asked: Asked) => {
    if (asked?.tab === id && asked.method === "save") save();
  });

  if (failed) return <Message color={t.error}>{`${path}: ${failed}`}</Message>;
  if (!loaded || loaded.path !== path) return <div style={{ flexGrow: 1, backgroundColor: colors.background }} />;
  return <CodeView key={loaded.path} initial={loaded.state} font={font} colors={colors} focused={focused} onState={onState} onSave={save} />;
}

function Message({ color, children }: { color: string; children: string }) {
  return (
    <div style={{ flexGrow: 1, padding: 12 }}>
      <text style={{ color, fontSize: 12 }}>{children}</text>
    </div>
  );
}

/** A throw below it draws its message in the tab and goes in the plugin's log, rather than
 *  leaving a blank tab. */
class Failure extends Component<{ children?: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    swallow(error);
  }
  override render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    return <Message color="#cc6666">{`The editor could not draw this file: ${error.message}`}</Message>;
  }
}

/** The tab's toolbar, on a file tab this editor draws: a dot while its file has unsaved changes,
 *  which saves it. */
export function Toolbar({ tab }: { tab: string }) {
  const t = useTheme();
  const each = useTab(tab);
  const prefix = usePrefix();
  const options = (each?.options ?? {}) as Record<string, unknown>;
  if (!each || each.block !== "file" || options[`${prefix}dirty`] !== true) return null;
  const path = String(options.path ?? "");
  return <IconButton icon="circle" title={`Save ${path.slice(path.lastIndexOf("/") + 1)} (⌘S)`} color={t.accent} onClick={() => void call(`${prefix}save`, tab).catch(swallow)} />;
}
