// Where the user writes: a textarea (Enter sends, Shift+Enter is a new line), the prompts queued
// behind the running turn, and Stop while the agent works. Above it, a list to pick from while the
// draft asks for one: the slash commands while it is `/name`, the files while the caret is after an
// `@`. Up/Down (or Ctrl+P/Ctrl+N) move in it, Tab or Enter takes the one marked, Escape closes it.
// Files dropped on it are mentioned (`@path`); pictures are attached and shown above the field.
import { useEffect, useRef, useState } from "react";
import { Icon, useMetrics, useTheme } from "pumi";

import type { Image, Queued, SlashCommand, Status } from "../model.ts";
import { applyHint, applyMention, baseName, caretAfterEdit, imageSource, imageTypeOf, insertMentions, mentionAt, relativeTo, slashHints, type MentionHit } from "../view.ts";
import { Press } from "./press.tsx";
import { useTextTheme } from "./style.ts";

export interface ComposerProps {
  status: Status;
  commands?: SlashCommand[];
  queue?: Queued[];
  /** Send `text` (trimmed) and the pictures attached; one of them is never empty. */
  onSend(text: string, images: Image[]): void;
  /** Stop the running turn. */
  onStop?(): void;
  /** Take back a queued prompt. */
  onUnqueue?(id: string): void;
  /** The files an `@` query finds, best first, as the draft names them. Without it `@` is plain text. */
  onMentions?(query: string): Promise<MentionHit[]>;
  /** The directory a dropped file's mention is written from (the agent's). Absolute paths without it. */
  cwd?: string;
  /** Pictures can be attached (dropped). True by default; false mentions them like any file. */
  images?: boolean;
  /** Paths dropped elsewhere on the chat, to take in as if dropped here; `n` changes with each drop. */
  dropped?: { paths: string[]; n: number };
  placeholder?: string;
  autoFocus?: boolean;
  /** Whether it takes prompts now (false: drawn but read-only). */
  disabled?: boolean;
}

/** One row of the list over the field. */
interface Pick {
  key: string;
  label: string;
  hint?: string;
  detail?: string;
  icon: string;
  /** Taken with Tab (or a click): the draft it leaves. */
  fill(): void;
  /** Taken with Enter: a command that takes nothing is sent at once. */
  enter(): void;
}

const MAX_SLASH = 50;
const MAX_MENTIONS = 30;
/** The keys the field hands to the list while it shows, rather than moving its caret or sending. */
const LIST_KEYS = ["up", "down", "enter"];

export function Composer({
  status,
  commands = [],
  queue = [],
  onSend,
  onStop,
  onUnqueue,
  onMentions,
  cwd,
  images: takesImages = true,
  dropped,
  placeholder,
  autoFocus = false,
  disabled = false,
}: ComposerProps) {
  const t = useTheme();
  const m = useMetrics();
  const text = useTextTheme();
  const [draft, setDraftState] = useState("");
  const [attached, setAttached] = useState<Image[]>([]);
  // Where the caret is, as the last edit showed it (the field does not say), and the list's state.
  const caret = useRef(0);
  const [at, setAt] = useState(0);
  const [marked, setMarked] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  const [found, setFound] = useState<{ query: string; hits: MentionHit[] }>({ query: "", hits: [] });
  const asked = useRef(0);
  const working = status === "working" || status === "blocked";

  /** The draft set from here: the field's caret goes to its end, so that is where it is. */
  const setDraft = (value: string) => {
    caret.current = value.length;
    setAt(value.length);
    setDraftState(value);
  };

  const mention = onMentions ? mentionAt(draft, Math.min(at, draft.length)) : undefined;
  const slash = slashHints(draft, commands, MAX_SLASH);

  // The files for the `@` being typed, asked once per query; an answer to an older query is dropped.
  const query = mention?.query;
  useEffect(() => {
    if (query === undefined || !onMentions) return;
    const ask = ++asked.current;
    onMentions(query).then(
      (hits) => ask === asked.current && setFound({ query, hits: hits.slice(0, MAX_MENTIONS) }),
      () => ask === asked.current && setFound({ query, hits: [] }),
    );
  }, [query, onMentions]);

  const send = (value: string, images = attached) => {
    const prompt = value.trim();
    if (disabled || (prompt === "" && images.length === 0)) return;
    onSend(prompt, images);
    setDraft("");
    setAttached([]);
    setClosed(null);
  };

  const picks: Pick[] = mention
    ? (found.query === mention.query ? found.hits : []).map((hit) => ({
        key: `@${hit.path}`,
        label: hit.dir ? `${baseName(hit.path)}/` : baseName(hit.path),
        detail: hit.path,
        icon: hit.dir ? "folder" : imageTypeOf(hit.path) ? "image" : "code",
        fill: () => setDraft(applyMention(draft, mention, hit).draft),
        enter: () => setDraft(applyMention(draft, mention, hit).draft),
      }))
    : slash.map((command) => {
        const name = command.name.replace(/^\//, "");
        return {
          key: `/${name}`,
          label: `/${name}`,
          hint: command.hint,
          detail: command.terminal ? `${command.description ?? ""}${command.description ? " · " : ""}opens in the terminal` : command.description,
          icon: command.terminal ? "terminal" : "keyboard",
          fill: () => setDraft(applyHint(command)),
          enter: () => (command.hint ? setDraft(applyHint(command)) : send(`/${name}`, [])),
        };
      });
  // The list shows unless Escape closed it for this very draft.
  const listKey = mention ? `@${mention.start}:${draft}` : `/${draft}`;
  const shown = picks.length > 0 && closed !== listKey;
  const current = shown ? Math.min(marked, picks.length - 1) : 0;
  useEffect(() => setMarked(0), [listKey]);

  // ── Taking files in ──────────────────────────────────────────────────────────────────────────
  const take = (paths: string[]) => {
    if (disabled || paths.length === 0) return;
    const pictures: Image[] = [];
    const files: string[] = [];
    for (const path of paths) {
      const mimeType = takesImages ? imageTypeOf(path) : undefined;
      if (mimeType) pictures.push({ mimeType, uri: path });
      else files.push(cwd ? relativeTo(cwd, path) : path);
    }
    if (pictures.length > 0) setAttached((now) => [...now, ...pictures.filter((each) => !now.some((had) => had.uri === each.uri))]);
    if (files.length > 0) {
      const next = insertMentions(draft, Math.min(caret.current, draft.length), files);
      setDraft(next.draft);
    }
  };
  const lastDrop = useRef(dropped?.n);
  useEffect(() => {
    if (!dropped || dropped.n === lastDrop.current) return;
    lastDrop.current = dropped.n;
    take(dropped.paths);
  });

  const onKey = (e: any) => {
    const key = e?.key ?? "";
    const ctrl = e?.modifiers?.ctrl === true;
    // Moving the caret by one, while the list shows: the field does not say where it went, and the
    // list follows the caret (`@` before the caret is the query). An edit corrects it by itself.
    if (key === "left" || key === "right") {
      const at = Math.max(0, Math.min(draft.length, caret.current + (key === "left" ? -1 : 1)));
      caret.current = at;
      setAt(at);
      return;
    }
    if (!shown) return;
    const move = (by: number) => setMarked((current + by + picks.length) % picks.length);
    let handled = true;
    if (key === "up" || (ctrl && key === "p")) move(-1);
    else if (key === "down" || (ctrl && key === "n")) move(1);
    else if (key === "tab") picks[current]?.fill();
    else if (key === "enter") picks[current]?.enter();
    else if (key === "escape") setClosed(listKey);
    else handled = false;
    if (handled) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
    }
  };

  const canSend = !disabled && (draft.trim() !== "" || attached.length > 0);
  return (
    <div
      // Dropped here unless the chat around takes drops for it (`dropped`): one drop, taken once.
      onFileDrop={dropped ? undefined : (e: any) => take(e?.paths ?? [])}
      style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, padding: 8, borderTopWidth: 1, borderColor: t.border }}
    >
      {queue.length > 0 ? (
        <div role="list" aria-label="Queued prompts" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {queue.map((each) => (
            <div key={each.id} role="listitem" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 6, paddingRight: 4, height: 22, borderRadius: m.radiusSmall, backgroundColor: t.surface }}>
              <Icon name="status_ring" size={11} color={t.faint} />
              <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{each.text || `${each.images?.length ?? 0} image(s)`}</text>
              </div>
              {onUnqueue ? (
                <Press aria-label={`Take back the queued prompt: ${each.text}`} onClick={() => onUnqueue(each.id)} style={{ display: "flex", padding: 2, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
                  <Icon name="close" size={11} color={t.faint} />
                </Press>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {shown ? (
        <div
          role="listbox"
          aria-label={mention ? "Files" : "Slash commands"}
          style={{ display: "flex", flexDirection: "column", maxHeight: 22 * 8 + 4, overflowY: "scroll", paddingTop: 2, paddingBottom: 2, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}
        >
          {picks.map((pick, index) => (
            <Press
              key={pick.key}
              role="option"
              aria-selected={index === current}
              aria-label={`${pick.label}${pick.detail ? `: ${pick.detail}` : ""}`}
              onClick={() => pick.fill()}
              onMouseEnter={() => setMarked(index)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                height: 22,
                flexShrink: 0,
                paddingLeft: 8,
                paddingRight: 8,
                cursor: "pointer",
                backgroundColor: index === current ? t.selected : undefined,
                focusVisible: { backgroundColor: t.selected },
              }}
            >
              <Icon name={pick.icon} size={11} color={index === current ? t.text : t.faint} />
              <text style={{ fontSize: 12, color: t.text, whiteSpace: "nowrap", flexShrink: 0 }}>{pick.label}</text>
              {pick.hint ? <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{pick.hint}</text> : null}
              <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{pick.detail ?? ""}</text>
              </div>
            </Press>
          ))}
        </div>
      ) : null}
      {attached.length > 0 ? (
        <div role="list" aria-label="Attached images" style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {attached.map((image) => (
            <div key={image.uri ?? image.data} role="listitem" title={image.uri} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingLeft: 3, paddingRight: 4, maxWidth: 220, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
              <img src={imageSource(image)} alt="" objectFit="cover" style={{ width: 26, height: 26, flexShrink: 0, borderRadius: m.radiusSmall }} />
              <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{baseName(image.uri ?? "image")}</text>
              </div>
              <Press
                aria-label={`Remove ${baseName(image.uri ?? "the image")}`}
                onClick={() => setAttached((now) => now.filter((each) => each !== image))}
                style={{ display: "flex", padding: 2, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
              >
                <Icon name="close" size={11} color={t.faint} />
              </Press>
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 6, padding: 6, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.editor }}>
        <textarea
          aria-label="Message the agent"
          value={draft}
          placeholder={placeholder ?? (working ? "Queue a message…" : `Message the agent… (/ for commands${onMentions ? ", @ for files" : ""})`)}
          readOnly={disabled}
          autoFocus={autoFocus}
          minRows={1}
          maxRows={10}
          theme={text}
          interceptKeys={shown ? LIST_KEYS : undefined}
          onChange={(e) => {
            const value = e.value ?? "";
            caret.current = caretAfterEdit(draft, value);
            setAt(caret.current);
            setDraftState(value);
          }}
          onKeyDown={onKey}
          onSubmit={(e) => (shown ? picks[current]?.enter() : send(e.value ?? draft))}
          style={{ flexGrow: 1, minWidth: 0, fontSize: m.fontSize, color: t.text, backgroundColor: t.editor }}
        />
        {working && onStop ? (
          <Press aria-label="Stop the agent" onClick={onStop} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: t.active, hover: { backgroundColor: t.hover } }}>
            <Icon name="square_dot" size={12} color={t.error} />
          </Press>
        ) : null}
        <Press
          aria-label="Send"
          disabled={!canSend}
          onClick={() => send(draft)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: canSend ? t.accent : t.active, hover: { opacity: 0.9 } }}
        >
          <Icon name="arrow_up" size={12} color={canSend ? t.accentText : t.faint} />
        </Press>
      </div>
    </div>
  );
}
