// The editor's page: Monaco in `web/index.html`, one editor holding a model per file the tab has
// opened (its undo, its view, its unsaved edits kept while another shows). What it knows of the app
// is `window.pumi`: its tab and first file (`pumi.args`), the theme (`pumi.onTheme`), the options,
// the app's menu (`pumi.menu`) and clipboard, and the plugin's `main.ts` through `<prefix>rpc`,
// which reads and writes the files. `ui.tsx` drives it with `__monaco.*` (`webview(…, "eval")`):
// the file to show, a save, an action, the options as they change.
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco:contribs";
import "./languages.ts";
import { WORKERS } from "./workers.ts";
import { droppedPaths, takesDrag } from "./drop.ts";
import { monacoTheme } from "./theme.ts";

/** What `window.pumi` is, as much of it as the page uses (`src/ui/webview_bridge.js`). */
interface Bridge {
  plugin: string;
  args: unknown;
  theme: Record<string, string>;
  onTheme(f: (tokens: Record<string, string>) => void): () => void;
  call(name: string, ...args: unknown[]): Promise<any>;
  menu(items: MenuItem[], at?: { x: number; y: number }): Promise<number | null>;
}

interface MenuItem {
  title?: string;
  detail?: string;
  disabled?: boolean;
  separator?: boolean;
  run?: () => void;
}

/** What `main.ts`'s `read` answers. */
interface Read {
  text: string;
  mtime: number;
  missing: boolean;
}

/** The options the editor follows, as `ui.tsx` hands them over. */
export interface Config {
  /** The terminals' font (`guifont`, `linespace`, as the SDK's `useFont` reads them). */
  font_family: string;
  font_size: number;
  line_height: number;
  tab_size: number;
  word_wrap: boolean;
  minimap: boolean;
}

/** One open file: its model, and where it stood when it was last saved or read. */
interface File {
  path: string;
  model: monaco.editor.ITextModel;
  /** The model's alternative version when it matched the disk: unsaved is any other. */
  saved: number;
  mtime: number;
  view: monaco.editor.ICodeEditorViewState | null;
}

declare global {
  interface Window {
    pumi?: Bridge;
    MonacoEnvironment?: monaco.Environment;
    __monaco?: unknown;
  }
}

const root = document.getElementById("editor") as HTMLElement;
const notice = document.getElementById("notice") as HTMLElement;

/** Says `text` over the editor (no file, a file that can't be read), or nothing. */
function say(text: string | null): void {
  notice.textContent = text ?? "";
  notice.hidden = text === null;
}

const pumi = window.pumi;
if (!pumi) {
  say("This page has no window.pumi: the app did not give it its bridge, so it can't read files.");
  throw new Error("vscode-editor: no window.pumi");
}

const args = (pumi.args ?? {}) as { tab?: unknown; path?: unknown; focused?: unknown; font?: Partial<Config> };
const tab = typeof args.tab === "string" ? args.tab : "";
/** Whether the tab is the window's current one, as `ui.tsx` last said. */
let tabFocused = args.focused !== false;
/** `pumi_dev/vscode-editor` is `pumi_dev.vscode_editor.`: its options, its functions. */
const prefix = `${pumi.plugin.replace("/", ".").replaceAll("-", "_")}.`;

/** An export of `main.ts`, by name: `<prefix>rpc` starts its worker if it has to. */
function rpc<T>(name: string, ...rest: unknown[]): Promise<T> {
  return pumi!.call(`${prefix}rpc`, { name, args: rest });
}

/** A failure the user should not see drawn over the page: the console has it. */
function swallow(err: unknown): void {
  console.error(`vscode-editor: ${err instanceof Error ? err.message : String(err)}`);
}

// ---- workers

/** Monaco's workers, built whole (`web/workers/<name>.js`) and started from a blob of their text:
 *  that works where a worker from the plugin's own scheme may not. */
const sources = new Map<string, Promise<string>>();
window.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    const name = WORKERS[label] ?? "editor";
    const url = new URL(`workers/${name}.js`, location.href).href;
    if (!sources.has(url)) sources.set(url, fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${url}: ${r.status}`)))));
    return sources.get(url)!.then(
      (text) => new Worker(URL.createObjectURL(new Blob([text], { type: "text/javascript" })), { name: label }),
      () => new Worker(url, { name: label }),
    );
  },
};

// ---- the theme

const canvas = document.createElement("canvas").getContext("2d");
/** A CSS colour as hex, as the page's canvas reads it; null for what it can't. */
function normalize(color: string): string | null {
  if (!canvas) return null;
  canvas.fillStyle = "#000000";
  canvas.fillStyle = color;
  const read = String(canvas.fillStyle);
  if (/^#[0-9a-f]{6}$/i.test(read)) return read;
  const rgba = read.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (!rgba) return null;
  const byte = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${byte(+rgba[1])}${byte(+rgba[2])}${byte(+rgba[3])}${byte((rgba[4] === undefined ? 1 : +rgba[4]) * 255)}`;
}

/** One of the `--pumi-*` variables the app's sheet puts on the page. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyTheme(tokens: Record<string, string>): void {
  monaco.editor.defineTheme("pumi", monacoTheme(tokens, normalize));
  monaco.editor.setTheme("pumi");
  configure(config);
}

// ---- the editor

let config: Config = {
  font_family: "Menlo",
  font_size: 12,
  line_height: 1.25,
  tab_size: 4,
  word_wrap: true,
  minimap: false,
  ...args.font,
};

const editor = monaco.editor.create(root, {
  model: null,
  theme: "vs-dark",
  automaticLayout: true,
  // Its menu is the app's (`pumi.menu`), drawn over the page.
  contextmenu: false,
  // Its popups (hovers, suggestions) use the whole page, not the editor's box.
  fixedOverflowWidgets: true,
  // A drop opens a file; the editor's own would type the path.
  dropIntoEditor: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  overviewRulerBorder: false,
  renderLineHighlight: "line",
  padding: { top: 4 },
  scrollbar: { useShadows: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  detectIndentation: true,
});

/** The options as the editor takes them: the terminals' font, with the theme's monospace one
 *  behind it for a family the page can't find. */
function configure(next: Partial<Config>): void {
  config = { ...config, ...next };
  const fallback = cssVar("--pumi-font-mono") || "monospace";
  editor.updateOptions({
    fontFamily: config.font_family ? `${JSON.stringify(config.font_family)}, ${fallback}` : fallback,
    fontSize: config.font_size,
    // Monaco takes a line height under 8 as a multiple of the font size, as `linespace` is.
    lineHeight: config.line_height,
    wordWrap: config.word_wrap ? "on" : "off",
    minimap: { enabled: config.minimap },
  });
  for (const file of files.values()) file.model.updateOptions({ tabSize: config.tab_size });
}

/** The files open in this page, by path, and the one it shows. */
const files = new Map<string, File>();
let current: File | null = null;
/** The file the latest `show` asked for: an older one for another file that reads it later does
 *  not show it, and one for the same file goes on (it may carry the line to go to). */
let latest = "";

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function isDirty(file: File | null): boolean {
  return !!file && file.model.getAlternativeVersionId() !== file.saved;
}

/** Opens `path` (read once, then kept), and shows it at `at` if given. */
async function show(path: string, at?: { line?: number; column?: number }): Promise<void> {
  latest = path;
  if (!path) {
    say("No file. Drop one here from the project tree, or run “Editor: open a file”.");
    return;
  }
  let file = files.get(path);
  if (!file) {
    let read: Read;
    try {
      read = await rpc<Read>("read", path);
    } catch (err) {
      if (latest === path) say(`${path}\n\n${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    file = files.get(path) ?? open(path, read);
  } else void refresh(file);
  if (latest !== path) return;
  say(null);
  if (current !== file) {
    if (current) current.view = editor.saveViewState();
    editor.setModel(file.model);
    if (file.view) editor.restoreViewState(file.view);
    current = file;
  }
  if (at?.line) {
    const position = { lineNumber: Math.max(1, Math.floor(at.line)), column: Math.max(1, Math.floor(at.column ?? 1)) };
    editor.setPosition(position);
    editor.revealPositionInCenterIfOutsideViewport(position);
  }
  if (tabFocused) editor.focus();
  report({ dirty: true, text: true, title: true });
}

/** A model for a file just read. */
function open(path: string, read: Read): File {
  const model = monaco.editor.createModel(read.text, undefined, monaco.Uri.file(path));
  model.updateOptions({ tabSize: config.tab_size });
  const file: File = { path, model, saved: model.getAlternativeVersionId(), mtime: read.mtime, view: null };
  files.set(path, file);
  model.onDidChangeContent(() => {
    if (file !== current) return;
    report({ dirty: true, text: true });
  });
  return file;
}

/** Reads a file again if it changed on disk and has no unsaved edits here; its undo keeps the step. */
async function refresh(file: File): Promise<void> {
  if (isDirty(file)) return;
  const read = await rpc<Read>("read", file.path).catch(() => null);
  if (!read || read.missing || read.mtime === file.mtime || isDirty(file)) return;
  file.mtime = read.mtime;
  if (read.text === file.model.getValue()) return;
  file.model.pushEditOperations([], [{ range: file.model.getFullModelRange(), text: read.text }], () => null);
  file.saved = file.model.getAlternativeVersionId();
  if (file === current) report({ dirty: true, text: true });
}

/** Writes the file shown, through `main.ts`, which answers whoever asked for the save. */
async function save(): Promise<void> {
  const file = current;
  if (!file) {
    await rpc("unsaved", tab, "the tab shows no file").catch(swallow);
    return;
  }
  const version = file.model.getAlternativeVersionId();
  try {
    const wrote = await rpc<{ mtime: number }>("write", tab, file.path, file.model.getValue());
    file.saved = version;
    file.mtime = wrote.mtime;
  } catch (err) {
    swallow(err);
  }
  if (file === current) report({ dirty: true });
}

// ---- what the app is told

let toldDirty: boolean | null = null;
let textTimer: ReturnType<typeof setTimeout> | undefined;
let selectionTimer: ReturnType<typeof setTimeout> | undefined;
/** What `read` answers of the tab: the file, up to this much of it. */
const TEXT_LIMIT = 256 * 1024;

/** Tells the app what changed of the file shown: its unsaved state (the tab's `dirty` option),
 *  its name (the tab's title) and its text (what `tab.call(tab, "read")` answers). */
function report(what: { dirty?: boolean; text?: boolean; title?: boolean }): void {
  const dirty = isDirty(current);
  if (what.dirty && dirty !== toldDirty) {
    toldDirty = dirty;
    pumi!.call("option.set", [`${prefix}dirty`, dirty, { scope: "tab", id: tab }]).catch(swallow);
  }
  if (what.title && current) {
    pumi!.call("tab.call", [tab, "report", { body: { title: basename(current.path) } }]).catch(swallow);
  }
  if (what.text) {
    clearTimeout(textTimer);
    textTimer = setTimeout(() => {
      const value = current?.model.getValue() ?? "";
      pumi!.call("tab.call", [tab, "report", { body: { text: value.slice(0, TEXT_LIMIT) } }]).catch(swallow);
    }, 800);
  }
}

editor.onDidChangeCursorSelection(() => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    const model = editor.getModel();
    const parts = (editor.getSelections() ?? []).filter((s) => !s.isEmpty()).map((s) => model?.getValueInRange(s) ?? "");
    const selection = parts.length ? parts.join(model?.getEOL() ?? "\n").slice(0, TEXT_LIMIT) : null;
    pumi!.call("tab.call", [tab, "report", { body: { selection } }]).catch(swallow);
  }, 300);
});

// ---- the clipboard: the app's, so it works with or without an Edit menu in the app

/** What the last copy of a whole line put there: pasting it goes on a line of its own. */
let copiedLine: string | null = null;

function selectedText(): { text: string; whole: boolean } {
  const model = editor.getModel();
  const selections = editor.getSelections() ?? [];
  if (!model || !selections.length) return { text: "", whole: false };
  if (selections.every((s) => s.isEmpty())) {
    const lines = [...new Set(selections.map((s) => s.positionLineNumber))];
    return { text: lines.map((n) => model.getLineContent(n) + model.getEOL()).join(""), whole: true };
  }
  const text = selections
    .filter((s) => !s.isEmpty())
    .map((s) => model.getValueInRange(s))
    .join(model.getEOL());
  return { text, whole: false };
}

async function copy(): Promise<void> {
  const { text, whole } = selectedText();
  if (!text) return;
  copiedLine = whole ? text : null;
  await pumi!.call("clipboard.set", text).catch(swallow);
}

async function cut(): Promise<void> {
  const { whole } = selectedText();
  await copy();
  if (whole) editor.trigger("menu", "editor.action.deleteLines", null);
  else editor.trigger("menu", "cut", null);
}

async function paste(): Promise<void> {
  const text = await pumi!.call("clipboard.get").catch(() => null);
  if (typeof text !== "string" || text === "") return;
  editor.focus();
  editor.trigger("menu", "paste", { text, pasteOnNewLine: text === copiedLine });
}

// In the text only: the find widget's field keeps the system's own.
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => void copy(), "editorTextFocus");
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => void cut(), "editorTextFocus && !editorReadonly");
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => void paste(), "editorTextFocus && !editorReadonly");
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());

// ---- the menu: the app's, with the editor's actions

/** Runs one of the editor's actions (`editor.action.rename`), as its key would. */
function action(id: string): void {
  editor.focus();
  const found = editor.getAction(id);
  if (found) void found.run().catch(swallow);
  else editor.trigger("pumi", id, null);
}

function supported(id: string): boolean {
  const found = editor.getAction(id);
  return !!found && found.isSupported();
}

function menuItems(): MenuItem[] {
  const item = (title: string, id: string, detail?: string): MenuItem => ({ title, detail, disabled: !supported(id), run: () => action(id) });
  const selected = (editor.getSelections() ?? []).some((s) => !s.isEmpty());
  return [
    item("Go to Definition", "editor.action.revealDefinition", "F12"),
    item("Go to References", "editor.action.goToReferences", "Shift+F12"),
    item("Peek Definition", "editor.action.peekDefinition", "Alt+F12"),
    { separator: true },
    item("Rename Symbol", "editor.action.rename", "F2"),
    item("Change All Occurrences", "editor.action.changeAll", "Cmd+F2"),
    item("Format Document", "editor.action.formatDocument", "Shift+Alt+F"),
    { separator: true },
    { title: "Cut", run: () => void cut(), detail: selected ? "Cmd+X" : "Cmd+X: the line" },
    { title: "Copy", run: () => void copy(), detail: selected ? "Cmd+C" : "Cmd+C: the line" },
    { title: "Paste", run: () => void paste(), detail: "Cmd+V" },
    { separator: true },
    item("Command Palette", "editor.action.quickCommand", "F1"),
  ];
}

// Before the bridge's own right-click (Cut/Copy/Paste of a field), which a prevented one skips.
root.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
    void pumi.menu(menuItems(), { x: e.clientX, y: e.clientY }).catch(swallow);
  },
  true,
);

// ---- drops: a file from the project tree, or a file:// URL

window.addEventListener(
  "dragover",
  (e: DragEvent) => {
    const dt = e.dataTransfer;
    if (!dt || !takesDrag([...dt.types], (type) => dt.getData(type))) return;
    e.preventDefault();
    dt.dropEffect = "copy";
    document.body.classList.add("dropping");
  },
  true,
);
window.addEventListener("dragleave", (e: DragEvent) => {
  if (e.relatedTarget === null) document.body.classList.remove("dropping");
});
window.addEventListener(
  "drop",
  (e: DragEvent) => {
    document.body.classList.remove("dropping");
    const dt = e.dataTransfer;
    if (!dt) return;
    const paths = droppedPaths((type) => dt.getData(type));
    if (!paths.length) return;
    e.preventDefault();
    e.stopPropagation();
    void dropped(paths);
  },
  true,
);

/** Every dropped file opened, the last one shown, and the tab's `path` saying so. */
async function dropped(paths: string[]): Promise<void> {
  for (const path of paths.slice(0, -1)) if (!files.has(path)) await show(path).catch(swallow);
  const last = paths[paths.length - 1];
  await show(last);
  pumi!.call("option.set", ["path", last, { scope: "tab", id: tab }]).catch(swallow);
}

// ---- focus: a press in the page makes its tab the window's current one

editor.onDidFocusEditorText(() => {
  if (!tabFocused) pumi.call("tab.focus", [tab]).catch(swallow);
});
// The disk may have moved while the app was elsewhere.
window.addEventListener("focus", () => {
  if (current) void refresh(current);
});

// ---- what `ui.tsx` reaches

/** Where in its file the tab is to be (the core's `at`: `tab.open`'s line, a `reveal`). */
function at(): Promise<{ path: string; line?: number; column?: number } | null> {
  return pumi!.call("tab.call", [tab, "at"]).catch(() => null);
}

/** What the tab was asked to show (`tab.open`, `reveal`): a file, a line. */
async function pull(): Promise<void> {
  const wanted = await at();
  if (wanted?.path) await show(wanted.path, wanted);
}

window.__monaco = Object.freeze({
  show: (path: string) => (current?.path === path ? undefined : void show(path)),
  pull: () => void pull(),
  save: () => void save(),
  action,
  configure: (next: Partial<Config>) => configure(next),
  focus: () => editor.focus(),
  tabFocused: (focused: boolean) => void (tabFocused = focused),
});

// ---- start: the theme, the options, then the file

applyTheme(pumi.theme ?? {});
pumi.onTheme(applyTheme);
// The plugin's own options; the font came in `args` and follows through `configure`.
const names: (keyof Config)[] = ["tab_size", "word_wrap", "minimap"];
void Promise.all(names.map((name) => pumi.call("option.get", [`${prefix}${name}`, { scope: "plugin", plugin: pumi.plugin }]).catch(() => undefined))).then((values) => {
  const read: Partial<Config> = {};
  names.forEach((name, i) => {
    if (values[i] !== undefined && values[i] !== null) (read as Record<string, unknown>)[name] = values[i];
  });
  configure(read);
});
const first = typeof args.path === "string" ? args.path : "";
void (async () => {
  const wanted = await at();
  const path = wanted?.path || ((await pumi.call("option.get", ["path", { scope: "tab", id: tab }]).catch(() => null)) as string | null) || first;
  await show(path ?? "", wanted?.path === path ? wanted : undefined);
})();
