// Where the user writes, as Zed's message editor is: a textarea in the code font (Enter sends,
// Shift+Enter is a new line) with its expand button, and under it Zed's bar (`bar.tsx`): `+`,
// thinking and its effort; the context ring, the mode, the model, and Send
// (Stop while the agent works and nothing is written). The prompts queued behind the running turn
// show above it. Over it all floats a list to pick from while the draft asks for one (`<anchored>`,
// drawn over the chat rather than pushing it up): the slash commands while it is `/name`, the
// skills while the caret is after a `/` anywhere else, the files while the caret is after an `@`,
// which opens it at once (saying it searches, or found nothing).
// Up/Down (or Ctrl+P/Ctrl+N) move in it, Tab or Enter takes the one marked, Escape closes it. With
// no list, Up in an empty draft brings back the prompts sent before (`keys.ts`), Down goes the
// other way. A file taken in (dropped, picked, or chosen after `@`) is written as its mention
// (`@path`), and a skill as `/skill:name`; each is drawn in the line by `Mention` (the textarea's
// `inlines`, its children): one character to the caret, taken whole by any edit that reaches into
// it, a picture's showing itself on hover. A picture's mention stays in the text where it was
// written, and the picture is attached to the prompt too.
import { useEffect, useRef, useState, type RefObject } from "react";
import { call, Icon, motion, useMetrics, useTheme, type ElementRef } from "pumi";

import type { ConfigOption, Image, Queued, SlashCommand, Status, Usage } from "../model.ts";
import { recallTakes, stepRecall, type RecallAt } from "../keys.ts";
import { applyHint, applyMention, applySlash, baseName, caretAfterEdit, imageTypeOf, insertMentions, mentionAt, mentionText, relativeTo, skillHints, skillToken, slashAt, slashHints, spaceTokens, tokenSpans, type MentionHit, type MentionQuery } from "../view.ts";
import { AddContext, BarButton, ContextRing, ModelPicker, Picker, SendButton, ThinkingControl, type ContextAction } from "./bar.tsx";
import type { ZedIcon } from "./icons.ts";
import { Mention, type MentionKind } from "./mention.tsx";
import { keepTyping, OwnClicks, Press } from "./press.tsx";
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
  /** The session's settings: the bar draws its thought level, mode and model. */
  options?: ConfigOption[];
  /** The model's maker's mark, beside its name. */
  modelIcon?: ZedIcon;
  /** How full the context is: the ring. */
  usage?: Usage;
  /** The conversation has begun: the editor can be expanded. */
  expandable?: boolean;
  /**
   * Nothing is said yet: the composer takes the whole chat, its field as tall as there is room.
   * When it turns false (a prompt sent) the composer shrinks back to its own height.
   */
  fill?: boolean;
  /** One of them changed; without it they are shown but not changed. */
  onOption?(option: ConfigOption, value: string | boolean): void;
  /** The prompts sent before, oldest first, which Up brings back (`keys.ts` `sentPrompts`). */
  history?: string[];
  /** Set to what the chat around asks of the composer: the keyboard, a letter typed elsewhere. */
  handle?: RefObject<ComposerHandle | null>;
  /**
   * Where the draft is kept while no composer draws it (its tab flipped to the terminal): a
   * composer built again with the same key starts from it. Without one it starts empty.
   */
  draftKey?: string;
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

/** A file or a skill in the draft, drawn by `Mention`: the text it is written as, the picture it attaches, and the one it shows on hover. */
interface Chip {
  token: string;
  label: string;
  kind: MentionKind;
  image?: Image;
  preview?: string;
}

/** The drafts of composers not drawn now, by `draftKey`: kept for as long as the window is. */
const kept = new Map<string, { draft: string; chips: Chip[] }>();

const MAX_SLASH = 50;
const MAX_MENTIONS = 30;
const ROW = 26;
/** The field's own rows, when it is not filling the chat. */
const MIN_ROWS = 4;
/** The space above the field, in its box. */
const FIELD_TOP = 4;
/** The list's width, as Zed's completion menu's. */
const LIST_WIDTH = 520;
/** A character's width in the code font, in ems (a monospace face's advance). */
const CHAR_EM = 0.6;

/**
 * Where the caret is in the field as it wraps at `columns`: its row and column, and how many rows
 * the draft takes. A chip counts as wide as its label and icon, not its text.
 */
function caretSpot(draft: string, caret: number, chips: Chip[], columns: number): { row: number; column: number; lines: number } {
  const narrow = (text: string) => {
    let out = text;
    for (const span of tokenSpans(text, chips.map((chip) => chip.token)).reverse()) {
      const chip = chips.find((each) => each.token === span.token);
      out = out.slice(0, span.start) + "x".repeat((chip?.label.length ?? 1) + 3) + out.slice(span.end);
    }
    return out;
  };
  const rowsOf = (line: string) => Math.max(1, Math.ceil(line.length / columns));
  const before = narrow(draft.slice(0, caret)).split("\n");
  const last = before.pop()!;
  const row = before.reduce((sum, line) => sum + rowsOf(line), 0) + Math.floor(last.length / columns);
  const lines = narrow(draft).split("\n").reduce((sum, line) => sum + rowsOf(line), 0);
  return { row, column: last.length % columns, lines };
}

/** How long the composer takes to shrink from filling the chat, in seconds. */
const SHRINK_SECONDS = 0.28;
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
  modelIcon,
  usage,
  expandable = false,
  fill = false,
  history = [],
  handle,
  draftKey,
}: ComposerProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const text = useTextTheme();
  // The draft left by the last composer of this key, if any (`kept`).
  const [start] = useState(() => (draftKey ? kept.get(draftKey) : undefined));
  const [draft, setDraftState] = useState(start?.draft ?? "");
  // The draft as of the last render, for the handle (called from outside, between renders).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [chips, setChips] = useState<Chip[]>(start?.chips ?? []);
  useEffect(() => {
    if (!draftKey) return;
    if (draft === "") kept.delete(draftKey);
    else kept.set(draftKey, { draft, chips });
  }, [draftKey, draft, chips]);
  // Where the caret is: as the field says (`selectionEnd` on its change and select events), or, in
  // an app whose field does not say, as the last edit showed it. `place` is where the field puts
  // its caret when the draft is set from here (`caret`).
  const caret = useRef(draft.length);
  const [at, setAt] = useState(draft.length);
  const [place, setPlace] = useState(draft.length);
  const toldCaret = useRef(false);
  const [marked, setMarked] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  const [found, setFound] = useState<{ query: string; hits: MentionHit[] } | null>(null);
  const asked = useRef(0);
  const working = status === "working" || status === "blocked";
  // Zed's maximized editor: taller, most of the pane.
  const [expanded, setExpanded] = useState(false);
  // How wide the editor is: the list over it is as wide.
  const [width, setWidth] = useState(0);
  // How tall the field's box is while it fills the chat, and the rows that fit in it.
  const [area, setArea] = useState(0);
  const fillRows = Math.max(MIN_ROWS, Math.floor((area - FIELD_TOP) / type.codeLine));
  // Filling the chat no more: the room it gave back, drawn as the composer's colour above it and
  // shrunk to nothing, so the composer seems to shrink to its height.
  const [shrink, setShrink] = useState<number | null>(null);
  const [filled, setFilled] = useState(fill);
  if (filled !== fill) {
    setFilled(fill);
    const room = area - (FIELD_TOP + MIN_ROWS * type.codeLine);
    setShrink(!fill && room > 0 ? room : null);
  }
  const markedRow = useRef<ElementRef | null>(null);
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

  /** The draft set from here, its caret at `to` (its end without). */
  const setDraft = (value: string, to = value.length) => {
    caret.current = to;
    setAt(to);
    setPlace(to);
    setDraftState(value);
  };
  /** The caret where the field says it is, if it says. */
  const told = (e: any): number | undefined => {
    const end = e?.selectionEnd;
    if (typeof end !== "number") return undefined;
    toldCaret.current = true;
    return end;
  };

  const mention = onMentions ? mentionAt(draft, Math.min(at, draft.length)) : undefined;
  const slash = slashHints(draft, commands, MAX_SLASH);
  // A `/` typed after a space (or one the commands do not take): the skills, to put in as chips.
  const slashing = !mention && slash.length === 0 ? slashAt(draft, Math.min(at, draft.length)) : undefined;
  const skills = slashing ? skillHints(slashing.query, commands, MAX_SLASH) : [];

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

  /** Chips added for mentions about to be written; one already known keeps its first form. */
  const addChips = (more: Chip[]) => setChips((now) => [...now, ...more.filter((each) => !now.some((had) => had.token === each.token))]);

  const send = (value: string) => {
    // Text typed against a chip is kept apart from it, as the field showed it; a picture's chip
    // stays in the text where it was written, and the picture goes with the prompt.
    const spaced = spaceTokens(value, chips.map((chip) => chip.token));
    const present = new Set(tokenSpans(spaced, chips.map((chip) => chip.token)).map((span) => span.token));
    const pictures = chips.filter((chip) => chip.image && present.has(chip.token));
    const prompt = spaced.trim();
    const images = pictures.map((chip) => chip.image!);
    if (disabled || (prompt === "" && images.length === 0)) return;
    onSend(prompt, images);
    setDraft("");
    setChips([]);
    setClosed(null);
    setRecall(null);
  };

  /** `hit` written for the `@` being typed, as a chip. */
  const takeHit = (hit: MentionHit) => {
    if (!mention) return;
    const next = applyMention(draft, mention, hit);
    const path = hit.dir && !hit.path.endsWith("/") ? `${hit.path}/` : hit.path;
    const picture = !hit.dir && imageTypeOf(path) !== undefined;
    const absolute = path.startsWith("/") || !cwd ? path : `${cwd.replace(/\/+$/, "")}/${path}`;
    addChips([{ token: mentionText(path), label: hit.dir ? `${baseName(path)}/` : baseName(path), kind: hit.dir ? "folder" : picture ? "image" : "file", ...(picture ? { preview: absolute } : {}) }]);
    setDraft(next.draft, next.caret);
  };
  /** Skill `command` written as its chip for the `/` at `at` (the draft's start without). */
  const takeSkill = (command: SlashCommand, at: MentionQuery = { start: 0, end: draft.length, query: "" }) => {
    const token = skillToken(command);
    const next = applySlash(draft, at, token);
    addChips([{ token, label: token.slice("/skill:".length), kind: "skill" }]);
    setDraft(next.draft, next.caret);
  };
  const skillPick = (command: SlashCommand, at?: MentionQuery): Pick => ({
    key: `/${command.name.replace(/^\//, "")}`,
    label: skillToken(command).slice("/skill:".length),
    detail: command.description,
    icon: "sparkle",
    fill: () => takeSkill(command, at),
    enter: () => takeSkill(command, at),
  });
  // What the list shows for the `@`: this query's files, or the last query's while this one is
  // asked (none yet: it says it searches).
  const hits = !mention ? [] : found?.query === mention.query ? found.hits : (found?.hits ?? []);
  const searching = !!mention && found?.query !== mention.query;
  const picks: Pick[] = mention
    ? hits.map((hit) => ({
        key: `@${hit.path}`,
        label: hit.dir ? `${baseName(hit.path)}/` : baseName(hit.path),
        detail: hit.path,
        icon: hit.dir ? "folder" : imageTypeOf(hit.path) ? "image" : "code",
        fill: () => takeHit(hit),
        enter: () => takeHit(hit),
      }))
    : slashing
      ? skills.map((command) => skillPick(command, slashing))
      : slash.map((command) => {
        if (command.skill) return skillPick(command);
        const name = command.name.replace(/^\//, "");
        return {
          key: `/${name}`,
          label: `/${name}`,
          hint: command.hint,
          detail: command.terminal ? `${command.description ?? ""}${command.description ? " · " : ""}opens in the terminal` : command.description,
          icon: command.terminal ? "terminal" : "keyboard",
          fill: () => setDraft(applyHint(command)),
          enter: () => (command.hint ? setDraft(applyHint(command)) : send(`/${name}`)),
        };
      });
  // The list shows while the draft asks for it, unless Escape closed it for this very draft. An `@`
  // shows it even before (or without) files; only a list with rows takes the keys.
  const listKey = mention ? `@${mention.start}:${draft}` : slashing ? `/${slashing.start}:${draft}` : `/${draft}`;
  const shown = (!!mention || picks.length > 0) && closed !== listKey && !disabled;
  const live = shown && picks.length > 0;
  const current = live ? Math.min(marked, picks.length - 1) : 0;
  useEffect(() => setMarked(0), [listKey]);
  useEffect(() => {
    if (live) markedRow.current?.scrollIntoView?.();
  }, [live, current]);

  // ── Taking files in ──────────────────────────────────────────────────────────────────────────
  const take = (paths: string[]) => {
    if (disabled || paths.length === 0) return;
    const written: string[] = [];
    const more: Chip[] = [];
    for (const path of paths) {
      const mimeType = takesImages ? imageTypeOf(path) : undefined;
      const name = cwd ? relativeTo(cwd, path) : path;
      written.push(name);
      const picture = imageTypeOf(path) !== undefined;
      more.push({ token: mentionText(name), label: baseName(path), kind: picture ? "image" : "file", ...(mimeType ? { image: { mimeType, uri: path } } : {}), ...(picture ? { preview: path } : {}) });
    }
    const now = draftRef.current;
    const next = insertMentions(now, Math.min(caret.current, now.length), written);
    addChips(more);
    setDraft(next.draft, next.caret);
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
    // Moving the caret by one, in an app whose field does not say where its caret went: the list
    // follows the caret (`@` before the caret is the query). An edit corrects it by itself.
    if ((key === "left" || key === "right") && !toldCaret.current) {
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
    const move = (by: number) => live && setMarked((current + by + picks.length) % picks.length);
    let handled = true;
    if (key === "escape") setClosed(listKey);
    else if (!live) handled = false;
    else if (key === "up" || (ctrl && key === "p")) move(-1);
    else if (key === "down" || (ctrl && key === "n")) move(1);
    else if (key === "tab") picks[current]?.fill();
    else if (key === "enter") picks[current]?.enter();
    else handled = false;
    if (handled) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
    }
  };

  const canSend = !disabled && draft.trim() !== "";
  const who = agent ?? "the agent";
  const hint = `Message ${who} — ${[onMentions ? "@ to include context" : undefined, commands.length > 0 ? (commands.some((each) => each.skill) ? "/ for commands and skills" : "/ for commands") : undefined].filter(Boolean).join(", ") || "Enter to send"}`;
  const option = (category: ConfigOption["category"]) => options.find((each) => each.category === category && ((each.choices?.length ?? 0) > 0 || typeof each.current === "boolean"));
  const thought = option("thought_level");
  const mode = option("mode");
  const model = option("model");
  // A setting changes between turns, as Zed's does: while the agent works it is shown, not changed.
  const change = (each: ConfigOption | undefined) => (each && onOption && !working ? (value: string | boolean) => onOption(each, value) : undefined);
  const startMention = () => {
    const spaced = draft === "" || /\s$/.test(draft) ? draft : `${draft} `;
    setDraft(`${spaced}@`);
    takeFocus();
  };
  const contextActions: ContextAction[] = [
    ...(onMentions ? [{ id: "files", label: "Files & Directories", icon: "file" as const, run: startMention }] : []),
    ...(takesImages ? [{ id: "image", label: "Image", icon: "image" as const, run: pick }] : []),
    ...(!takesImages ? [{ id: "attach", label: "Attach Files…", icon: "paperclip" as const, run: pick }] : []),
  ];
  // Where the list opens: under the caret's line, from its column (`caretSpot`), as wide as Zed's.
  const fieldWidth = Math.max(0, width - (expandable ? 22 : 0));
  const listWidth = Math.max(240, Math.min(fieldWidth || LIST_WIDTH, LIST_WIDTH));
  const rows = fill ? fillRows : expanded ? [24, 48] : [MIN_ROWS, 8];
  const caretAt = caretSpot(draft, Math.min(at, draft.length), chips, Math.max(1, Math.floor(fieldWidth / (type.code * CHAR_EM))));
  const shownRows = typeof rows === "number" ? rows : Math.min(rows[1]!, Math.max(rows[0]!, caretAt.lines));
  const spot = {
    top: FIELD_TOP + Math.min(caretAt.row, shownRows - 1) * type.codeLine,
    left: Math.max(0, Math.min(caretAt.column * type.code * CHAR_EM, fieldWidth - listWidth)),
    listWidth,
  };
  // The field's inline nodes, each drawn by the child of its index.
  const inlines = chips.map((chip) => ({ text: chip.token, label: chip.label }));
  const note = (words: string) => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: ROW, paddingLeft: 11, paddingRight: 8 }}>
      <text style={{ fontSize: type.small, color: t.faint, whiteSpace: "nowrap" }}>{words}</text>
    </div>
  );
  return (
    <>
    {shrink !== null ? (
      <motion.div
        key="shrink"
        initial={{ height: shrink }}
        animate={{ height: 0 }}
        transition={{ duration: SHRINK_SECONDS, ease: "easeOut" }}
        onMotionComplete={() => setShrink(null)}
        style={{ flexShrink: 0, backgroundColor: t.editor, borderTopWidth: 1, borderColor: t.border }}
      />
    ) : null}
    <div
      key="composer"
      // Dropped here unless the chat around takes drops for it (`dropped`): one drop, taken once.
      onFileDrop={dropped ? undefined : (e: any) => take(e?.paths ?? [])}
      style={{ display: "flex", flexDirection: "column", gap: 8, flexGrow: fill ? 1 : 0, flexShrink: fill ? 1 : 0, minHeight: 0, paddingLeft: 10, paddingRight: 8, paddingTop: 8, paddingBottom: 8, borderTopWidth: fill || shrink !== null ? 0 : 1, borderColor: t.border, backgroundColor: t.editor }}
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
      <div onLayout={(e: any) => typeof e?.width === "number" && e.width !== width && setWidth(e.width)} style={{ display: "flex", flexDirection: "column", gap: 8, position: "relative", flexGrow: fill ? 1 : 0, minHeight: 0 }}>
        {/* A click in the field places its caret: not a tap of the chat's, which would build it again. */}
        <OwnClicks
          onLayout={fill ? (e: any) => typeof e?.height === "number" && e.height !== area && setArea(e.height) : undefined}
          style={{ display: "flex", flexDirection: "column", position: "relative", minWidth: 0, flexGrow: fill ? 1 : 0, minHeight: 0, overflow: fill ? "hidden" : undefined, paddingTop: FIELD_TOP, paddingRight: expandable ? 22 : 0 }}
        >
          <textarea
            aria-label={`Message ${who}`}
            value={draft}
            caret={place}
            inlines={inlines}
            placeholder={placeholder ?? hint}
            readOnly={disabled}
            ref={field}
            key={mount}
            autoFocus={autoFocus || mount > 0}
            minRows={fill ? fillRows : expanded ? 24 : MIN_ROWS}
            maxRows={fill ? fillRows : expanded ? 48 : 8}
            theme={text}
            interceptKeys={live ? LIST_KEYS : recallTakes("down", history, recall, draft) ? RECALL_BOTH : recallTakes("up", history, recall, draft) ? RECALL_UP : undefined}
            onChange={(e) => {
              const value = e.value ?? "";
              caret.current = told(e) ?? caretAfterEdit(draft, value);
              setAt(caret.current);
              setPlace(caret.current);
              setDraftState(value);
            }}
            onSelect={(e) => {
              const end = told(e);
              if (end === undefined || end === caret.current) return;
              caret.current = end;
              setAt(end);
              setPlace(end);
            }}
            onKeyDown={onKey}
            onFocus={() => (hasFocus.current = true)}
            onBlur={() => (hasFocus.current = false)}
            onSubmit={(e) => (live ? picks[current]?.enter() : send(e.value ?? draft))}
            // A file dropped on the field itself: the chat's drop around it may not hear it.
            onFileDrop={(e: any) => take(Array.isArray(e?.paths) ? e.paths : [])}
            style={{ flexGrow: 1, minWidth: 0, fontSize: type.code, lineHeight: type.codeLine, fontFamily: type.mono, color: t.text, backgroundColor: "transparent" }}
          >
            {chips.map((chip) => (
              <Mention key={chip.token} label={chip.label} kind={chip.kind} preview={chip.preview} line={type.codeLine} />
            ))}
          </textarea>
          {shown ? (
            // Under the line the caret is on, as Zed's completions are (above it when there is no
            // room below): over the chat, not pushing it.
            <div style={{ position: "absolute", top: spot.top, left: spot.left, width: 1, height: type.codeLine }}>
              <anchored side="bottom" align="start" gap={4} fit="switch" deferred occlude priority={1} style={{ backgroundColor: "transparent" }}>
                <div
                  role="listbox"
                  aria-label={mention ? "Files" : slashing ? "Skills" : "Slash commands"}
                  style={{ display: "flex", flexDirection: "column", width: spot.listWidth, minWidth: 240, maxHeight: ROW * 8 + 8, overflowY: "scroll", paddingTop: 4, paddingBottom: 4, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.overlay, boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: "#00000066" } }}
                >
                  {picks.length === 0 ? note(searching ? "Searching…" : "No matching files or folders") : null}
                  {picks.map((pick, index) => (
                    <div key={pick.key} ref={index === current ? markedRow : undefined} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                      <Press
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
                          height: ROW,
                          flexShrink: 0,
                          marginLeft: 4,
                          marginRight: 4,
                          paddingLeft: 7,
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
                    </div>
                  ))}
                </div>
              </anchored>
            </div>
          ) : null}
          {expandable ? (
            <div style={{ position: "absolute", top: 0, right: 0, opacity: 0.5, hover: { opacity: 1 } }}>
              <BarButton icon={expanded ? "minimize" : "maximize"} title={expanded ? "Minimize Message Editor" : "Expand Message Editor"} onPress={() => setExpanded(!expanded)} />
            </div>
          ) : null}
        </OwnClicks>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 4, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1, minWidth: 0 }}>
            {contextActions.length > 0 ? <AddContext actions={contextActions} disabled={disabled} /> : null}
            {thought ? <ThinkingControl option={thought} onChange={change(thought)} /> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0 }}>
            {usage ? <ContextRing usage={usage} /> : null}
            {mode ? <Picker title={working ? "Change Mode: once the agent is done" : "Change Mode"} value={String(mode.current)} choices={mode.choices ?? []} onChange={change(mode) as ((value: string) => void) | undefined} /> : null}
            {model ? <ModelPicker option={model} icon={modelIcon} onChange={change(model) as ((value: string) => void) | undefined} /> : null}
            <SendButton working={working} canSend={canSend} onSend={() => send(draft)} onStop={onStop} />
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
