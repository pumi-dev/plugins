// Where the user writes: a textarea (Enter sends, Shift+Enter is a new line), the prompts queued
// behind the running turn, and Stop while the agent works. Above it, a list to pick from while the
// draft asks for one: the slash commands while it is `/name`, the files while the caret is after an
// `@`. Up/Down (or Ctrl+P/Ctrl+N) move in it, Tab or Enter takes the one marked, Escape closes it.
// With no list, Up in an empty draft brings back the prompts sent before (`keys.ts`), Down goes
// the other way. Files dropped on it are mentioned (`@path`); pictures are attached and shown above
// the field.
import { useEffect, useRef, useState, type RefObject } from "react";
import { call, Icon, useMetrics, useTheme, type ElementRef } from "pumi";

import type { ConfigOption, Image, Queued, SlashCommand, Status } from "../model.ts";
import { recallTakes, stepRecall, type RecallAt } from "../keys.ts";
import { applyHint, applyMention, baseName, caretAfterEdit, imageSource, imageTypeOf, insertMentions, mentionAt, relativeTo, slashHints, type MentionHit } from "../view.ts";
import { OptionPicker } from "./header.tsx";
import { keepTyping, OwnClicks, Press } from "./press.tsx";
import { SEND_ICON } from "./timeline.tsx";
import { swallow, useTextTheme, useType } from "./style.ts";

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
  /** What the draft should be now (an earlier prompt to edit); `n` changes with each. */
  draft?: { text: string; n: number };
  /** Who it writes to, for the placeholder. */
  agent?: string;
  /** Take the keyboard focus (unless it has it): each new number asks once. */
  focus?: number;
  /** Settings shown beside Send (the model), each a picker. */
  options?: ConfigOption[];
  /** One of them changed; without it they are shown but not changed. */
  onOption?(option: ConfigOption, value: string | boolean): void;
  /** The prompts sent before, oldest first, which Up brings back (`keys.ts` `sentPrompts`). */
  history?: string[];
  /** Set to what the chat around asks of the composer: the keyboard, a letter typed elsewhere. */
  handle?: RefObject<ComposerHandle | null>;
}

/** What the chat around a composer asks of it. */
export interface ComposerHandle {
  /** Take the keyboard focus. */
  focus(): void;
  /** Put `text` at the draft's end, and take the keyboard (a letter typed while a button had it). */
  type(text: string): void;
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
/** The keys it hands to bringing a prompt back. */
const RECALL_UP = ["up"];
const RECALL_BOTH = ["up", "down"];

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
  draft: given,
  agent,
  focus,
  options = [],
  onOption,
  history = [],
  handle,
}: ComposerProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const text = useTextTheme();
  const [draft, setDraftState] = useState("");
  // The draft as of the last render, for the handle (called from outside, between renders).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [attached, setAttached] = useState<Image[]>([]);
  // Where the caret is, as the last edit showed it (the field does not say), and the list's state.
  const caret = useRef(0);
  const [at, setAt] = useState(0);
  const [marked, setMarked] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  const [found, setFound] = useState<{ query: string; hits: MentionHit[] }>({ query: "", hits: [] });
  const asked = useRef(0);
  const working = status === "working" || status === "blocked";
  // Whether the field has the keyboard focus, and the mount that takes it: the field's ref gives it
  // the focus (`focus()`); in an app without that, a focus asked for builds the field again, its
  // draft kept, since a field is focused as it is built (`autoFocus`).
  const hasFocus = useRef(false);
  const [mount, setMount] = useState(0);
  const field = useRef<ElementRef | null>(null);
  /** The keyboard to the field: its ref's `focus()`, or (an app without it) the field built again. */
  const takeFocus = () => {
    if (field.current?.focus) return field.current.focus();
    if (hasFocus.current) return;
    caret.current = draftRef.current.length;
    setAt(draftRef.current.length);
    setMount((n) => n + 1);
  };
  const lastFocus = useRef(focus);
  useEffect(() => {
    if (focus === undefined || focus === lastFocus.current) return;
    lastFocus.current = focus;
    takeFocus();
  }, [focus]);
  // Where Up is among the prompts sent before (`keys.ts`).
  const [recall, setRecall] = useState<RecallAt>(null);
  if (handle) {
    handle.current = {
      focus: takeFocus,
      type: (text) => {
        setDraft(draftRef.current + text);
        takeFocus();
      },
    };
  }

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
    setRecall(null);
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
  // A draft handed in (an earlier prompt to edit) replaces what is written.
  const lastGiven = useRef(given?.text ? undefined : given?.n);
  useEffect(() => {
    if (!given || given.n === lastGiven.current) return;
    lastGiven.current = given.n;
    setDraft(given.text);
  });
  const pick = () => {
    void call("fs.pick", { kind: "file", multiple: true, title: "Attach" })
      .then((chosen: unknown) => take(Array.isArray(chosen) ? chosen.filter((p): p is string => typeof p === "string") : typeof chosen === "string" ? [chosen] : []))
      .catch(swallow);
  };
  const lastDrop = useRef(dropped?.n);
  useEffect(() => {
    if (!dropped || dropped.n === lastDrop.current) return;
    lastDrop.current = dropped.n;
    take(dropped.paths);
  });

  const onKey = (e: any) => {
    keepTyping(e);
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
    if (!shown) {
      // Up and Down, handed over while they bring a prompt back (`interceptKeys`).
      if (key !== "up" && key !== "down") return;
      const step = recallTakes(key, history, recall, draft) ? stepRecall(history, recall, draft, key) : undefined;
      if (!step) return;
      e?.preventDefault?.();
      e?.stopPropagation?.();
      setRecall(step.at);
      setDraft(step.draft);
      return;
    }
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
  const who = agent ?? "the agent";
  const hint = working ? `Queue a message for ${who}…` : `Message ${who}${onMentions ? ", @ to include files" : ""}, / for commands`;
  return (
    <div
      // Dropped here unless the chat around takes drops for it (`dropped`): one drop, taken once.
      onFileDrop={dropped ? undefined : (e: any) => take(e?.paths ?? [])}
      style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, paddingLeft: 12, paddingRight: 10, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.editor }}
    >
      {queue.length > 0 ? (
        <div role="list" aria-label="Queued prompts" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {queue.map((each) => (
            <div key={each.id} role="listitem" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 4, height: 24, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
              <Icon name="status_ring" size={11} color={t.faint} />
              <text style={{ fontSize: type.tiny, color: t.faint, flexShrink: 0 }}>Queued</text>
              <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: type.small, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{each.text || `${each.images?.length ?? 0} picture(s)`}</text>
              </div>
              {onUnqueue ? (
                <Press aria-label={`Take back the queued prompt: ${each.text}`} title="Take it back" onClick={() => onUnqueue(each.id)} style={{ display: "flex", padding: 3, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
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
          style={{ display: "flex", flexDirection: "column", maxHeight: 26 * 8 + 6, overflowY: "scroll", paddingTop: 3, paddingBottom: 3, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.overlay }}
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
                height: 26,
                flexShrink: 0,
                marginLeft: 3,
                marginRight: 3,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: m.radiusSmall,
                cursor: "pointer",
                backgroundColor: index === current ? t.selected : undefined,
                focusVisible: { backgroundColor: t.selected },
              }}
            >
              <Icon name={pick.icon} size={12} color={index === current ? t.text : t.faint} />
              <text style={{ fontSize: type.small, fontWeight: 600, fontFamily: mention ? undefined : type.mono, color: t.text, whiteSpace: "nowrap", flexShrink: 0 }}>{pick.label}</text>
              {pick.hint ? <text style={{ fontSize: type.small, color: t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{pick.hint}</text> : null}
              <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: type.small, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{pick.detail ?? ""}</text>
              </div>
            </Press>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {attached.length > 0 ? (
          <div role="list" aria-label="Attached pictures" style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 2 }}>
            {attached.map((image) => (
              <div key={image.uri ?? image.data} role="listitem" title={image.uri} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingLeft: 3, paddingRight: 4, maxWidth: 220, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
                <img src={imageSource(image)} alt="" objectFit="cover" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: m.radiusSmall }} />
                <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                  <text style={{ fontSize: type.small, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{baseName(image.uri ?? "picture")}</text>
                </div>
                <Press
                  aria-label={`Remove ${baseName(image.uri ?? "the picture")}`}
                  onClick={() => setAttached((now) => now.filter((each) => each !== image))}
                  style={{ display: "flex", padding: 3, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
                >
                  <Icon name="close" size={11} color={t.faint} />
                </Press>
              </div>
            ))}
          </div>
        ) : null}
        {/* A click in the field places its caret: not a tap of the chat's, which would build it again. */}
        <OwnClicks style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <textarea
            aria-label={`Message ${who}`}
            value={draft}
            placeholder={placeholder ?? hint}
            readOnly={disabled}
            ref={field}
            key={mount}
            autoFocus={autoFocus || mount > 0}
            minRows={3}
            maxRows={12}
            theme={text}
            interceptKeys={shown ? LIST_KEYS : recallTakes("down", history, recall, draft) ? RECALL_BOTH : recallTakes("up", history, recall, draft) ? RECALL_UP : undefined}
            onChange={(e) => {
              const value = e.value ?? "";
              caret.current = caretAfterEdit(draft, value);
              setAt(caret.current);
              setDraftState(value);
            }}
            onKeyDown={onKey}
            onFocus={() => (hasFocus.current = true)}
            onBlur={() => (hasFocus.current = false)}
            onSubmit={(e) => (shown ? picks[current]?.enter() : send(e.value ?? draft))}
            style={{ flexGrow: 1, minWidth: 0, fontSize: type.body, color: t.text, backgroundColor: "transparent" }}
          />
        </OwnClicks>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          {takesImages ? (
            <Press aria-label="Attach pictures or files" title="Attach pictures or files" onClick={pick} disabled={disabled} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
              <Icon name="plus" size={13} color={t.muted} />
            </Press>
          ) : null}
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }} />
          {options.map((option) => (
            <OptionPicker
              key={option.id}
              option={option}
              side="top"
              title={working ? `${option.name}: changed once the agent is done` : option.name}
              onChange={onOption && !working ? (value) => onOption(option, value) : undefined}
            />
          ))}
          {working && onStop ? (
            <Press aria-label="Stop the agent" title="Stop (Esc in the agent)" onClick={onStop} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingLeft: 8, paddingRight: 9, flexShrink: 0, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
              <Icon name="square_dot" size={11} color={t.error} />
              <text style={{ fontSize: type.small, color: t.text }}>Stop</text>
            </Press>
          ) : null}
          <Press
            aria-label={working ? "Queue it" : "Send"}
            title={working ? "Queue it for when the agent is done" : "Send (↵, ⇧↵ for a new line)"}
            disabled={!canSend}
            onClick={() => send(draft)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 26, flexShrink: 0, borderRadius: m.radiusSmall, cursor: canSend ? "pointer" : "default", backgroundColor: canSend ? t.accent : t.active, hover: canSend ? { opacity: 0.9 } : {} }}
          >
            <svg source={SEND_ICON} style={{ width: 13, height: 13, flexShrink: 0, color: canSend ? t.accentText : t.faint }} />
          </Press>
        </div>
      </div>
    </div>
  );
}
