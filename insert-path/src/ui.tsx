// What the picker draws, in the window's React tree: a float over the tab that lists the terminal's
// directory, filters it as you type, and on Enter (or a click) types the path into the terminal's
// program and closes. The walk, the matching and the quoting are pure modules; what it was opened
// with, and what typing into the terminal does, is the worker's (`main.ts`).
import { useEffect, useState } from "react";
import { Icon, call, useMetrics, useTheme, type PaneId } from "pumi";

import type { PickerArgs } from "./main.ts";
import { args as opened } from "./main.ts";
import { type Entry, walk } from "./entries.ts";
import { type Hit, hits } from "./match.ts";
import { quote, tilde } from "./path.ts";

const PLACEHOLDER = "Filter files…";
/** A row's height, and an icon's size. */
const ROW = 26;
const ICON = 14;
/** How many matches are drawn: a float shows a screenful, and the walk can find thousands. */
const SHOWN = 200;

/** What a row's icon is by the file's extension. */
const CODE = new Set([
  "rs", "py", "js", "jsx", "ts", "tsx", "go", "lua", "c", "h", "cc", "cpp", "hpp", "swift", "kt",
  "java", "rb", "php", "sh", "bash", "zsh", "fish", "css", "scss", "html", "json", "toml", "yaml",
  "yml", "sql",
]);
const PICTURE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff"]);
const PAGE = new Set(["url", "webloc"]);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Types `text` into pane `id`. `say` tells the user when it cannot: an insert does, a cancel does
 * not (the terminal it was opened from may be gone by then). */
function type(id: PaneId, text: string, say = true): void {
  call("pane.call", [id, "input", { text }]).catch((err: unknown) => {
    if (say) console.error(`insert-path: ${message(err)}`);
  });
}

/** The app's icon for a file's extension, when it has one. */
function iconName(extension: string | null): string | null {
  if (extension === null) return null;
  if (CODE.has(extension)) return "code";
  if (PICTURE.has(extension)) return "image";
  if (PAGE.has(extension)) return "tool_web";
  return null;
}

/** The picker's own view: the header, the matches, and the field. */
export function Picker({ pane }: { pane: PaneId }) {
  const t = useTheme();
  const m = useMetrics();
  const [config, setConfig] = useState<PickerArgs | undefined>(undefined);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [label, setLabel] = useState("");
  const [found, setFound] = useState<Hit[]>([]);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  /** It was picked or cancelled: what closes it types nothing more. */
  const [done, setDone] = useState(false);

  // What this picker was opened with is the worker's (`main.ts`'s `args`), so it comes back a
  // promise; the walk is the window's, in the process the files are read in.
  useEffect(() => {
    let live = true;
    void opened().then((read: PickerArgs) => {
      if (!live) return;
      setConfig(read);
      const cwd = read.cwd ?? "/";
      setLabel(tilde(cwd));
      const walked = walk(cwd);
      setEntries(walked);
      setFound(hits(walked, ""));
    });
    return () => {
      live = false;
    };
  }, []);

  const term = config?.pane;
  const quoting = config?.quote !== false;
  const cancel = config?.cancel ?? null;

  /** Types `text` into the terminal and closes. */
  const insert = (text: string) => {
    setDone(true);
    if (term !== undefined) type(term, quoting ? quote(text) : text);
    call("pane.close", [pane]).catch(() => {});
  };

  /** Closes without picking; a bare trigger key is typed back so what was typed still lands. */
  const dismiss = () => {
    setDone(true);
    if (term !== undefined && query === "" && cancel !== null) type(term, cancel, false);
    call("pane.close", [pane]).catch(() => {});
  };

  const refilter = (text: string) => {
    setQuery(text);
    setFound(hits(entries, text));
    setAt(0);
  };

  /** The match under the highlight. */
  const selected = (): Entry | undefined => {
    const hit = found[at];
    return hit === undefined ? undefined : entries[hit.index];
  };

  /** Moves the highlight `by` rows, around the ends. */
  const step = (by: number) => {
    if (found.length === 0) return;
    setAt((now) => (((now + by) % found.length) + found.length) % found.length);
  };

  /** A key pressed while the field has it: the picker's own, and nothing behind it. */
  const pressed = (typed: string) => {
    if (done) return true;
    switch (typed) {
      case "escape":
        dismiss();
        return true;
      case "enter": {
        const entry = selected();
        if (entry) insert(entry.dir ? `${entry.rel}/` : entry.rel);
        return true;
      }
      case "tab": {
        const entry = selected();
        if (entry?.dir) refilter(`${entry.rel}/`);
        return true;
      }
      case "backspace":
        if (query !== "") return false;
        dismiss();
        return true;
      case "up":
        step(-1);
        return true;
      case "down":
        step(1);
        return true;
      case "pageup":
        step(-8);
        return true;
      case "pagedown":
        step(8);
        return true;
      default:
        return false;
    }
  };

  const rows = found.slice(0, SHOWN);
  const lit = Math.min(at, Math.max(0, found.length - 1));
  return (
    <div
      autoFocus
      tabIndex={0}
      onKeyDown={(e: any) => {
        if (pressed(e?.key ?? "")) {
          e?.preventDefault?.();
          e?.stopPropagation?.();
        }
      }}
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: t.surface, color: t.text, fontSize: 13 }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 4, flexShrink: 0 }}>
        <Icon name="search" size={12} color={t.faint} />
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</text>
        </div>
        <text style={{ fontSize: 12, color: t.faint }}>{String(found.length)}</text>
      </div>
      {found.length === 0 ? (
        <div style={{ display: "flex", flexGrow: 1, flexDirection: "column", paddingLeft: 6, paddingRight: 6, paddingTop: 2 }}>
          <div style={{ display: "flex", alignItems: "center", height: ROW, paddingLeft: 8, paddingRight: 8 }}>
            <text style={{ fontSize: 13, color: t.faint }}>No files match</text>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingLeft: 6, paddingRight: 6, paddingTop: 2 }}>
          {rows.map((hit, i) => {
            const entry = entries[hit.index]!;
            const chosen = i === lit;
            const icon = entry.dir ? "folder" : iconName(entry.extension);
            return (
              <div
                key={`${entry.rel}:${i}`}
                onClick={() => insert(entry.dir ? `${entry.rel}/` : entry.rel)}
                onMouseEnter={() => setAt(i)}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  height: ROW,
                  flexShrink: 0,
                  paddingLeft: 8,
                  paddingRight: 8,
                  borderRadius: m.radiusSmall,
                  cursor: "pointer",
                  backgroundColor: chosen ? t.accent : undefined,
                  color: chosen ? t.accentText : t.text,
                  hover: { backgroundColor: chosen ? t.accent : t.hover },
                }}
              >
                {icon ? <Icon name={icon} size={ICON} color={chosen ? t.accentText : t.muted} /> : <Icon name="code" size={ICON} color={chosen ? t.accentText : t.muted} />}
                <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                  <text style={{ fontSize: 13, fontWeight: 500, color: chosen ? t.accentText : t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{entry.name}</text>
                </div>
                {entry.parent !== "" ? (
                  <div style={{ display: "flex", flexShrink: 0, maxWidth: "45%", minWidth: 0 }}>
                    <text style={{ fontSize: 12, color: chosen ? t.accentText : t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{entry.parent}</text>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ height: 1, flexShrink: 0, backgroundColor: t.border }} />
      <div style={{ display: "flex", flexShrink: 0, padding: 8 }}>
        <input
          value={query}
          autoFocus
          placeholder={PLACEHOLDER}
          onChange={(e: any) => refilter(e?.value ?? "")}
          style={{ display: "flex", flexGrow: 1, minWidth: 0, height: 24, fontSize: 13, color: t.text }}
        />
      </div>
    </div>
  );
}

/** The float's own argument: what the picker open now was opened with. */
export type { PickerArgs };
