// The timeline, as Zed's agent thread draws it: what was said, thought and run, newest at the foot.
// The last `pageSize` entries show; "Show earlier" brings the page before. The user's messages are
// cards (a click edits one in place, "Restore Checkpoint" above one puts the files back); what the
// agent says is markdown; each thought is a "Thinking" block, open while it is written; each call
// is a line of its own, or a card for an edit, a command ("Run Command") or a subagent. After each
// turn, a row of its controls: its stats, Fork, Copy and the way back up. A call that asks the
// user is drawn as its questions, answered in place while the agent waits on them.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, iconSource, motion, useHover, useMetrics, useNow, useTheme, type ElementRef } from "pumi";

import type { Entry, PlanItem, Status, Tool, ToolContent, Transcript } from "../model.ts";
import { questionsOf, type Asking } from "../question.ts";
import { baseName, clipLines, formatDuration, imageSource, messageParts, outputShown, patchOf, restorable, statusLabel, toolDiffStats, toolHeadline, entriesFrom } from "../view.ts";
import { ZIcon } from "./bar.tsx";
import { DiffView, Stats } from "./diff.tsx";
import { ZED_ICONS, type ZedIcon } from "./icons.ts";
import { Thumb, useViewer } from "./image.tsx";
import { Mention, MentionText } from "./mention.tsx";
import { copyText, CopyButton, Inline, Markdown, Mono, MoreLines } from "./markdown.tsx";
import { keepTyping, OwnClicks, Press, useTap } from "./press.tsx";
import { Button, QuestionCard } from "./question.tsx";
import { tint, useBlockColor, useTextTheme, useType } from "./style.ts";

/** Something a message offers on hover, beside Copy (edit it, go back to it). */
export interface MessageAction {
  id: string;
  label: string;
  /** One of the app's icons by name, or an SVG's markup (`<svg …>`, tinted). */
  icon: string;
  onPress(): void;
}

/** A pencil, which the app's icons do not have. */
export const PENCIL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.3 12.8 2 13.9l1.1-3.3z"/><path d="M10 3.5l2.5 2.5"/></svg>';

/** The return key's arrow (send the edit), which the app's icons do not have. */
export const RETURN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v5a2 2 0 0 1-2 2H3"/><path d="M6 7l-3 3 3 3"/></svg>';

/** A paper plane (send), which the app's icons do not have. */
export const SEND_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2L7 9"/><path d="M14 2l-4.5 12L7 9 2 6.5z"/></svg>';

/** How far the agent's rows sit in from the user's cards (Zed's `px_5` against `px_2`). */
const INDENT = 12;
/** Zed's turn stats: a duration from 30 s, tokens from 250. */
const STOPWATCH_MS = 30_000;

export interface TimelineProps {
  transcript: Transcript;
  /** How many entries show at first, and how many more each "Show earlier" adds. 60 by default. */
  pageSize?: number;
  /** A press on a link in the agent's text. */
  onLink?(url: string): void;
  /** Where a question the agent asks in its own screen is answered (show that screen). */
  onAnswerElsewhere?(): void;
  /** What that button says. */
  elsewhereLabel?: string;
  /** The requests waiting that a question call's card answers, by the call's id (`askedInCards`). */
  asking?: Map<string, Asking>;
  /** One of those answered (`PermissionCardProps.onAnswer`). */
  onAnswer?(permissionId: string, optionId: string, text?: string): void;
  /** The request ⌃1 … ⌃9 answer: its card says the keys. */
  answerKeys?: string;
  /** What a message offers beside Copy. */
  messageActions?(entry: Entry): MessageAction[];
  /** The user's message being edited now: drawn as a field in its place, and what follows it faded. */
  editing?: string;
  /** Whether a message of the user's can be edited in place: a click on it starts. */
  editable?(entry: Entry): boolean;
  /** Start editing that message. */
  onEditStart?(entry: Entry): void;
  /** The edit, sent: it replaces the message and what came after. */
  onEditSubmit?(text: string): void;
  /** The edit, left: the message stays as it was. */
  onEditCancel?(): void;
  /** A new session with the conversation through the turn the user's message `entry` began; no Fork without. */
  onFork?(entry: Entry): void;
  /** The files put back as they were before the user's message `entry`; no Restore Checkpoint without. */
  onRestore?(entry: Entry): void;
  /** The agent goes on with a turn it left unfinished (stopped, failed, cut off); no Continue without. */
  onContinue?(): void;
}

/** A turn's end, as its controls need it: the message it began with, and what the agent said in it. */
interface TurnInfo {
  user?: Entry;
  text: string;
  tokens: number;
}

/** What the rows under the timeline share. */
interface TimelineContext {
  onLink?(url: string): void;
  status: Status;
  onAnswerElsewhere?(): void;
  elsewhereLabel?: string;
  asking?: Map<string, Asking>;
  onAnswer?(permissionId: string, optionId: string, text?: string): void;
  answerKeys?: string;
  messageActions?(entry: Entry): MessageAction[];
  editing?: string;
  editable?(entry: Entry): boolean;
  onEditStart?(entry: Entry): void;
  onEditSubmit?(text: string): void;
  onEditCancel?(): void;
  onFork?(entry: Entry): void;
  onRestore?(entry: Entry): void;
  onContinue?(): void;
  /** The newest entry: a Continue shows only on a turn nothing came after. */
  tail?: string;
  /** The user's messages a checkpoint can put the files back to. */
  restorable?: Set<string>;
  /** Each turn's end, by its entry's id. */
  turns?: Map<string, TurnInfo>;
  /** The entry being written now (a thought opens while it is). */
  streaming?: string;
  /** Scroll the timeline to an entry, or to its top. */
  scrollTo?(entryId: string | null): void;
  /** The last turn's end: its controls go to the top, not to itself. */
  lastTurn?: string;
  /** The agent's directory, which a relative path in a message is from. */
  cwd?: string;
}

const Context = createContext<TimelineContext>({ status: "idle" });

const isQuestion = (tool: Tool) => questionsOf(tool) !== undefined;

/** Every entry, the newest at the foot; it follows the foot while you are there. */
export function Timeline({ transcript, pageSize = 60, onLink, onAnswerElsewhere, elsewhereLabel, asking, onAnswer, answerKeys, messageActions, editing, editable, onEditStart, onEditSubmit, onEditCancel, onFork, onRestore, onContinue }: TimelineProps) {
  const t = useTheme();
  const type = useType();
  const list = useRef<ElementRef | null>(null);
  // The first entry shown: the timeline keeps it while entries come at the foot ("Show earlier"
  // moves it back), so what is on screen stays where it is (`entriesFrom`).
  const [from, setFrom] = useState<string>();
  const { shown, hidden } = entriesFrom(transcript.entries, from, pageSize);
  const head0 = shown[0]?.id;
  useEffect(() => {
    if (head0 !== undefined && head0 !== from) setFrom(head0);
  }, [head0]);
  // Whether the foot is in view, as the last scroll left it: off it, a button goes back down.
  const [atFoot, setAtFoot] = useState(true);
  const working = transcript.status === "working" || transcript.status === "blocked";
  // Plans show above the composer (`PlanBar`), as Zed's do: not in the timeline.
  // A picture the user sent shows as its chip in the message; the copy the agent was given after
  // it is left out (as many as the message names).
  const named = useMemo(() => picturesNamed(transcript.entries, transcript.session?.cwd), [transcript.entries, transcript.session?.cwd]);
  const rows = shown.filter((entry) => entry.kind !== "plan" && !named.has(entry.id));
  const entries = transcript.entries;
  const restorableIds = useMemo(() => new Set(entries.flatMap((entry, at) => (restorable(entries, at) ? [entry.id] : []))), [entries]);
  const turns = useMemo(() => turnsOf(entries), [entries]);
  const last = entries[entries.length - 1];
  const lastTurn = [...entries].reverse().find((entry) => entry.kind === "turn")?.id;
  // The row before the entries: "Show earlier".
  const head = hidden > 0 || transcript.truncated ? 1 : 0;
  const scrollTo = (entryId: string | null) => {
    const at = entryId === null ? 0 : rows.findIndex((entry) => entry.id === entryId);
    if (at >= 0) list.current?.scrollToItem?.(entryId === null ? 0 : head + at, 0);
  };
  const context: TimelineContext = {
    onLink,
    status: transcript.status,
    onAnswerElsewhere,
    elsewhereLabel,
    asking,
    onAnswer,
    answerKeys,
    messageActions,
    editing,
    editable,
    onEditStart,
    onEditSubmit,
    onEditCancel,
    onFork,
    onRestore,
    onContinue,
    tail: last?.id,
    restorable: restorableIds,
    turns,
    streaming: working && last ? last.id : undefined,
    scrollTo,
    lastTurn,
    cwd: transcript.session?.cwd,
  };
  // What an edit would leave behind: the message edited and everything after it.
  const editedAt = editing === undefined ? -1 : rows.findIndex((entry) => entry.id === editing);
  const total = head + rows.length + (working ? 1 : 0) + 1;
  // To the foot, following it again (an index past the last row is the list's end).
  const toFoot = () => {
    list.current?.scrollToItem?.(total + 1, 0);
    setAtFoot(true);
  };
  // A prompt the user sends takes the timeline back down, to follow its answer.
  const lastUser = useMemo(() => [...entries].reverse().find((entry) => entry.kind === "user")?.id, [entries]);
  const seenUser = useRef(lastUser);
  useEffect(() => {
    if (lastUser === seenUser.current) return;
    seenUser.current = lastUser;
    toFoot();
  }, [lastUser]);
  return (
    <Context.Provider value={context}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
      <virtual-list
        ref={list}
        followTail
        alignment="top"
        aria-label="Conversation"
        role="log"
        onVisibleRange={(e: any) => typeof e?.endIndex === "number" && setAtFoot(e.endIndex >= total)}
        style={{ flexGrow: 1, minHeight: 0, paddingLeft: 8, paddingRight: 8 }}
      >
        {hidden > 0 || transcript.truncated ? (
          <div key="earlier" style={{ display: "flex", flexDirection: "row", justifyContent: "center", paddingTop: 10, paddingBottom: 4 }}>
            {hidden > 0 ? (
              <Press
                aria-label={`Show ${Math.min(hidden, pageSize)} earlier entries`}
                onClick={() => setFrom(entries[Math.max(0, hidden - pageSize)]?.id)}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 10, height: 22, borderRadius: 11, borderWidth: 1, borderColor: t.border, cursor: "pointer", hover: { backgroundColor: t.hover } }}
              >
                <Icon name="chevron_up_down" size={10} color={t.faint} />
                <text style={{ fontSize: type.tiny, color: t.muted }}>{`Show earlier (${hidden})`}</text>
              </Press>
            ) : (
              <text style={{ fontSize: type.tiny, color: t.faint }}>Older entries were dropped</text>
            )}
          </div>
        ) : null}
        {rows.map((entry, at) => (
          // A row is laid out on its own (gpui's list), so without a width it grows to its widest
          // unwrapped line and spills past a narrow pane: pin it to the list's.
          <div key={entry.id} style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, paddingTop: gapBefore(entry, rows[at - 1]), paddingBottom: entry.kind === "user" ? 4 : 0, opacity: editedAt >= 0 && at > editedAt ? 0.45 : 1 }}>
            <EntryView entry={entry} onLink={onLink} />
          </div>
        ))}
        {working ? <Working key="working" status={transcript.status} since={turnStart(entries)} /> : null}
        <div key="foot" style={{ height: 12 }} />
      </virtual-list>
      {atFoot ? null : <ToFoot onPress={toFoot} />}
      </div>
    </Context.Provider>
  );
}

/** Over the timeline's foot while the reader is up the page: back down, following again. */
function ToFoot({ onPress }: { onPress(): void }) {
  const t = useTheme();
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 8, display: "flex", flexDirection: "row", justifyContent: "center", pointerEvents: "none" }}>
      <Press
        aria-label="Scroll to the latest"
        title="Scroll to the latest"
        onClick={onPress}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.overlay, cursor: "pointer", pointerEvents: "auto", hover: { backgroundColor: t.hover }, boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 8, spreadRadius: 0, color: "#00000040" } }}
      >
        <ZIcon name="arrow_down" size={14} color={t.muted} />
      </Press>
    </div>
  );
}

/** The user's pictures each message names inline, by entry id: the image entries just after it, as many as it names. */
function picturesNamed(entries: Entry[], cwd?: string): Set<string> {
  const out = new Set<string>();
  let left = 0;
  for (const entry of entries) {
    if (entry.kind === "user") left = messageParts(entry.text ?? "", cwd).filter((part) => part.type === "chip" && part.kind === "image").length;
    else if (entry.kind === "image" && entry.from === "user" && left > 0) {
      out.add(entry.id);
      left--;
    } else left = 0;
  }
  return out;
}

/** Each turn's end: the user's message that began it, and the agent's words in it. */
function turnsOf(entries: Entry[]): Map<string, TurnInfo> {
  const out = new Map<string, TurnInfo>();
  let user: Entry | undefined;
  let text: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "user") {
      user = entry;
      text = [];
    } else if (entry.kind === "agent" && entry.text?.trim()) text.push(entry.text.trim());
    else if (entry.kind === "turn") {
      out.set(entry.id, { ...(user ? { user } : {}), text: text.join("\n\n"), tokens: entry.turn?.tokens?.total ?? 0 });
      text = [];
    }
  }
  return out;
}

/** Zed's room between rows: more before a user's message, less between the parts of a turn. */
function gapBefore(entry: Entry, before: Entry | undefined): number {
  if (!before) return 10;
  if (entry.kind === "user") return before.kind === "turn" ? 2 : 14;
  if (before.kind === "user") return 8;
  if (entry.kind === "turn") return 2;
  return 6;
}

/** When the running turn began: its prompt's time. */
function turnStart(entries: Entry[]): number | undefined {
  for (let at = entries.length - 1; at >= 0; at--) if (entries[at]!.kind === "user") return entries[at]!.at;
  return undefined;
}

/** The app's spinner icon, found once. */
const SPINNER = iconSource("status_spinner")?.src;

/**
 * A spinning icon, for what is going on now. The renderer turns an `svg` itself (`rotate`), not a
 * box around one, so the motion is on the icon.
 */
export function Spinner({ size = 12, color }: { size?: number; color?: string }) {
  if (!SPINNER) return null;
  return <motion.svg src={SPINNER} animate={{ rotate: [0, 360] }} transition={{ duration: 1, repeat: Infinity, ease: "linear", fps: 24 }} style={{ width: size, height: size, flexShrink: 0, ...(color ? { color } : {}) }} />;
}

/** Zed's generating row: a spinner, "Awaiting Confirmation" while a request waits, the time from 30 s. */
function Working({ status, since }: { status: Status; since?: number }) {
  const t = useTheme();
  const type = useType();
  const now = useNow(1000);
  const blocked = status === "blocked";
  const took = since !== undefined ? Math.max(0, now - since) : 0;
  return (
    <div role="status" aria-label={blocked ? "Awaiting Confirmation" : "Working"} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 8, paddingLeft: INDENT + 2 }}>
      <Spinner size={12} color={blocked ? t["agent.blocked"] : t.muted} />
      {blocked ? <text style={{ fontSize: type.small, color: t.muted }}>Awaiting Confirmation</text> : null}
      {took >= STOPWATCH_MS ? <text style={{ fontSize: type.small, color: t.muted }}>{formatDuration(took)}</text> : null}
    </div>
  );
}

export interface EntryViewProps {
  entry: Entry;
  onLink?(url: string): void;
}

/** One entry, drawn as its kind is. */
export function EntryView({ entry, onLink }: EntryViewProps) {
  const t = useTheme();
  const type = useType();
  const context = useContext(Context);
  switch (entry.kind) {
    case "user":
      return <UserMessage entry={entry} />;
    case "agent":
      return <AgentMessage entry={entry} onLink={onLink ?? context.onLink} />;
    case "thought":
      return <Thought entry={entry} />;
    case "tool":
      if (!entry.tool) return null;
      if (isQuestion(entry.tool)) {
        const asking = context.asking?.get(entry.tool.id);
        return (
          <Indented>
            <QuestionCard
              tool={entry.tool}
              waiting={context.status === "blocked" || context.status === "working"}
              onAnswerElsewhere={context.onAnswerElsewhere}
              elsewhereLabel={context.elsewhereLabel}
              onLink={context.onLink}
              asking={asking}
              onAnswer={context.onAnswer}
              keys={asking !== undefined && asking.permission.id === context.answerKeys}
            />
          </Indented>
        );
      }
      return (
        <Indented>
          <ToolCard tool={entry.tool} />
        </Indented>
      );
    case "plan":
      return (
        <Indented>
          <PlanList plan={entry.plan ?? []} />
        </Indented>
      );
    case "notice": {
      const tone = entry.level === "error" ? t.error : entry.level === "warning" ? t.warning : t.faint;
      const loud = entry.level === "error" || entry.level === "warning";
      return (
        <Indented>
          <div role={loud ? "alert" : "note"} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: loud ? 10 : 0, paddingRight: loud ? 10 : 0, paddingTop: loud ? 6 : 0, paddingBottom: loud ? 6 : 0, borderRadius: 6, backgroundColor: loud ? tint(tone, 0.1) : undefined }}>
            <div style={{ display: "flex", height: type.smallLine, alignItems: "center" }}>
              <Icon name={entry.level === "info" ? "status_dot" : entry.level === "error" ? "status_x" : "warning"} size={11} color={tone} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, cursor: "text" }}>
              <Inline text={entry.text ?? ""} size={type.small} line={type.smallLine} color={loud ? t.text : t.muted} onLink={context.onLink} />
            </div>
          </div>
        </Indented>
      );
    }
    case "image":
      if (!entry.image) return null;
      if (entry.from === "user") return <SentPicture entry={entry} />;
      return (
        <Indented>
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-start" }}>
            <Thumb image={entry.image} alt="A picture from the agent" />
          </div>
        </Indented>
      );
    case "turn":
      return entry.turn ? <TurnControls entry={entry} /> : null;
  }
}

/** The agent's side of the thread, in from the user's cards. */
function Indented({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", minWidth: 0, paddingLeft: INDENT, paddingRight: INDENT }}>{children}</div>;
}

/**
 * Zed's row after a turn, faint until hovered and right-aligned: its tokens and time (when there
 * are enough to say), how it stopped when it did not finish, then Fork, Copy, and the way back to
 * its message (or, after the last, to the top).
 */
function TurnControls({ entry }: { entry: Entry }) {
  const t = useTheme();
  const type = useType();
  const context = useContext(Context);
  const [hovered, hover] = useHover();
  const turn = entry.turn!;
  const info = context.turns?.get(entry.id);
  const stopped = turn.stop === "cancelled" ? "Stopped" : turn.stop === "error" ? "Failed" : turn.stop === "max_tokens" ? "Hit the output limit" : turn.stop === "max_turn_requests" ? "Hit the turn limit" : turn.stop === "refusal" ? "Refused" : undefined;
  const stats = [info && info.tokens > 250 ? `${info.tokens.toLocaleString()} tokens` : undefined, turn.durationMs !== undefined && turn.durationMs >= STOPWATCH_MS ? formatDuration(turn.durationMs) : undefined].filter(Boolean) as string[];
  const working = context.status === "working" || context.status === "blocked";
  const fork = context.onFork && info?.user?.source ? () => context.onFork!(info.user!) : undefined;
  const last = context.lastTurn === entry.id;
  // A turn that did not finish, with nothing after it: the agent can go on from where it was.
  const goOn = !working && context.onContinue && context.tail === entry.id && UNFINISHED.has(turn.stop) ? context.onContinue : undefined;
  const row = (
    <div {...hover} style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, paddingTop: 2, paddingBottom: 2, paddingLeft: INDENT, paddingRight: 4, opacity: hovered ? 1 : 0.4, flexGrow: 1, minWidth: 0 }}>
      {stopped ? <text style={{ fontSize: type.small, color: turn.stop === "error" ? t.error : t.muted, flexGrow: 1 }}>{stopped}</text> : null}
      {stats.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 4, paddingRight: 4 }}>
          {stats.map((each, at) => (
            <div key={each} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
              {at > 0 ? <text style={{ fontSize: type.small, color: t.muted, opacity: 0.5 }}>•</text> : null}
              <text style={{ fontSize: type.small, color: t.muted }}>{each}</text>
            </div>
          ))}
        </div>
      ) : null}
      {fork && !working ? <RowButton icon="git_branch_plus" title="Fork From Here: this conversation, to the end of this turn, in a new tab" label="Fork From Here" onPress={fork} /> : null}
      {info?.text ? <RowButton icon="copy" title="Copy This Agent Response" onPress={() => copyText(info.text)} /> : null}
      {info?.user && !last ? <RowButton icon="user_arrow_up" title="Scroll to User Message" onPress={() => context.scrollTo?.(info.user!.id)} /> : null}
      {last ? <RowButton icon="user_arrow_up" title="Scroll to User Message" onPress={() => info?.user && context.scrollTo?.(info.user.id)} /> : null}
      {last ? <RowButton icon="arrow_up" title="Scroll to Top" onPress={() => context.scrollTo?.(null)} /> : null}
    </div>
  );
  if (!goOn) return row;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: INDENT }}>
      <Button label="Continue" icon="arrow_right" primary onPress={goOn} />
      {row}
    </div>
  );
}

/** How a turn stops before its work is done: Continue picks it up. */
const UNFINISHED = new Set(["cancelled", "error", "max_tokens", "max_turn_requests"]);

/** One of a turn row's buttons: Zed's 14 icon, muted. */
function RowButton({ icon, title, label, onPress }: { icon: ZedIcon; title: string; label?: string; onPress(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <Press aria-label={label ?? title} title={title} onClick={onPress} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
      <ZIcon name={icon} size={14} color={t.muted} />
    </Press>
  );
}

/**
 * What the user said: Zed's card (its text in the editor's code font), its actions on hover over
 * its top corner, and "Restore Checkpoint" above it once the agent changed files after it. A click
 * on one that can be edited turns it into the field that edits it.
 */
function UserMessage({ entry }: { entry: Entry }) {
  const t = useTheme();
  const m = useMetrics();
  const bg = useBlockColor();
  const type = useType();
  const context = useContext(Context);
  const [hovered, hover] = useHover();
  const text = entry.text ?? "";
  const actions = context.messageActions?.(entry) ?? [];
  const editable = context.editable?.(entry) === true && context.onEditStart !== undefined;
  const restore = context.onRestore && context.restorable?.has(entry.id) ? () => context.onRestore!(entry) : undefined;
  // A click, not a drag over its text: a selection is left alone.
  const tap = useTap((event) => {
    if (!editable) return;
    event.stopPropagation?.();
    context.onEditStart?.(entry);
  });
  if (context.editing === entry.id) return <EditMessage entry={entry} restore={restore} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {restore ? <RestoreCheckpoint onPress={restore} /> : null}
      <div {...hover} style={{ display: "flex", flexDirection: "column", gap: 6, position: "relative", minWidth: 0 }}>
        <div
          {...(editable ? tap : {})}
          title={editable ? "Click to edit" : undefined}
          style={{ display: "flex", flexDirection: "column", minWidth: 0, paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, borderRadius: 6, backgroundColor: bg, borderWidth: 1, borderColor: hovered && editable ? tint(t.accent, 0.8) : t.border, cursor: "text" }}
        >
          <MentionText text={text} cwd={context.cwd} size={type.code} line={type.codeLine} color={t.text} onLink={context.onLink} />
        </div>
        <div style={{ position: "absolute", top: -14, right: 12 }}>
          <Actions shown={hovered} text={text} actions={actions} floating />
        </div>
      </div>
    </div>
  );
}

/** A picture the user sent that its message does not name: its chip, which shows it on hover and opens it when pressed. */
function SentPicture({ entry }: { entry: Entry }) {
  const type = useType();
  const open = useViewer();
  const src = imageSource(entry.image!);
  if (!src) return null;
  const path = src.startsWith("/") ? src : undefined;
  const label = path ? baseName(path) : "Picture";
  return (
    <div style={{ display: "flex", flexDirection: "row", paddingLeft: 8 }}>
      <Mention label={label} kind="image" title={path} preview={src} line={type.codeLine} onPress={open ? () => open({ src, alt: label, path }) : undefined} />
    </div>
  );
}

/** Zed's "Restore Checkpoint": a faint button between two rules, above the message it goes back to. */
function RestoreCheckpoint({ onPress }: { onPress(): void }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12 }}>
      <div style={{ height: 1, flexGrow: 1, backgroundColor: t.border }} />
      <Press
        aria-label="Restore Checkpoint"
        title="Restores all files in the project to the content they had at this point in the conversation."
        onClick={onPress}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 20, paddingLeft: 6, paddingRight: 6, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
      >
        <ZIcon name="undo" size={12} color={t.muted} />
        <text style={{ fontSize: type.tiny, color: t.muted }}>Restore Checkpoint</text>
      </Press>
      <div style={{ height: 1, flexGrow: 1, backgroundColor: t.border }} />
    </div>
  );
}

/**
 * A message of the user's, edited where it was: its text in a field, sent by Enter or ↵ (in its
 * place: what came after it goes), left by Escape or ×.
 */
function EditMessage({ entry, restore }: { entry: Entry; restore?: () => void }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const textTheme = useTextTheme();
  const context = useContext(Context);
  const [value, setValue] = useState(entry.text ?? "");
  const canSend = value.trim() !== "";
  const submit = (text = value) => {
    if (text.trim() !== "") context.onEditSubmit?.(text.trim());
  };
  const cancel = () => context.onEditCancel?.();
  const button = { display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, cursor: "pointer", hover: { backgroundColor: t.hover } } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {restore ? <RestoreCheckpoint onPress={restore} /> : null}
      <OwnClicks style={{ display: "flex", flexDirection: "column", position: "relative", minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, borderRadius: 6, backgroundColor: t.editor, borderWidth: 1, borderColor: t.accent }}>
          <textarea
            aria-label="Edit the message"
            value={value}
            placeholder="Edit message — @ to include context"
            autoFocus
            minRows={1}
            maxRows={16}
            theme={textTheme}
            onChange={(e) => setValue(e.value ?? "")}
            onSubmit={(e) => submit(e.value ?? value)}
            onKeyDown={(e: any) => {
              keepTyping(e);
              if (e?.key !== "escape") return;
              e?.preventDefault?.();
              e?.stopPropagation?.();
              cancel();
            }}
            style={{ flexGrow: 1, minWidth: 0, fontSize: type.code, fontFamily: type.mono, color: t.text, backgroundColor: "transparent" }}
          />
        </div>
        <div style={{ position: "absolute", top: -14, right: 12, display: "flex", flexDirection: "row", alignItems: "center", gap: 4, overflow: "hidden", borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.editor }}>
          <Press aria-label="Cancel the edit" title="Cancel (Esc)" onClick={cancel} style={button}>
            <ZIcon name="close" size={12} color={t.error} />
          </Press>
          <Press aria-label="Send the edit" title="Editing will restart the thread from this point." disabled={!canSend} onClick={() => submit()} style={{ ...button, cursor: canSend ? "pointer" : "default" }}>
            <ZIcon name="return" size={12} color={canSend ? t.muted : t.faint} />
          </Press>
        </div>
      </OwnClicks>
    </div>
  );
}

/** What the agent said: its markdown, in from the user's cards. */
function AgentMessage({ entry, onLink }: { entry: Entry; onLink?(url: string): void }) {
  const [hovered, hover] = useHover();
  const context = useContext(Context);
  const text = entry.text ?? "";
  const actions = context.messageActions?.(entry) ?? [];
  if (text.trim() === "") return null;
  return (
    <div {...hover} style={{ display: "flex", flexDirection: "column", position: "relative", minWidth: 0, paddingLeft: INDENT, paddingRight: INDENT }}>
      <Markdown text={text} onLink={onLink} />
      {entry.clipped ? <Clipped /> : null}
      {actions.length > 0 ? (
        <div style={{ position: "absolute", top: -4, right: 4 }}>
          <Actions shown={hovered} text={text} actions={actions} floating />
        </div>
      ) : null}
    </div>
  );
}

/** Copy, and what else a message offers; drawn always (so nothing moves), seen on hover. */
function Actions({ shown, text, actions, floating = false }: { shown: boolean; text: string; actions: MessageAction[]; floating?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0, padding: floating ? 2 : 0, borderRadius: m.radiusSmall, opacity: shown ? 1 : 0, backgroundColor: floating ? t.editor : undefined, borderWidth: floating ? 1 : 0, borderColor: t.border }}>
      {actions.map((action) => (
        <Press key={action.id} aria-label={action.label} title={action.label} onClick={action.onPress} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 20, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
          {action.icon.startsWith("<svg") ? <svg source={action.icon} style={{ width: 12, height: 12, flexShrink: 0, color: t.muted }} /> : <Icon name={action.icon} size={12} color={t.muted} />}
        </Press>
      ))}
      <CopyButton text={text} label="Copy the message" />
    </div>
  );
}

function Clipped() {
  const t = useTheme();
  const type = useType();
  return <text style={{ fontSize: type.tiny, color: t.faint }}>… cut here: it was too long to keep</text>;
}

/**
 * The agent's reasoning, as Zed's "Thinking" block: the lightbulb and the word, the text under a
 * rule when open. It opens while it is being written and folds once the agent goes on, unless it
 * was opened or folded by hand.
 */
export function Thought({ entry }: { entry: Entry }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const context = useContext(Context);
  const [hovered, hover] = useHover();
  const [toggled, setToggled] = useState<boolean | undefined>(undefined);
  const open = toggled ?? context.streaming === entry.id;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, paddingLeft: INDENT, paddingRight: INDENT }}>
      <Press
        aria-label={open ? "Hide the thinking" : "Show the thinking"}
        aria-expanded={open}
        onClick={() => setToggled(!open)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 22, paddingRight: 4, cursor: "pointer", borderRadius: m.radiusSmall }}
      >
        <div {...hover} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
          <ZIcon name="tool_think" size={14} color={t.muted} />
          <text style={{ fontSize: type.small, color: t.muted, flexShrink: 0 }}>Thinking</text>
          <div style={{ display: "flex", flexGrow: 1 }} />
          <ZIcon name={open ? "chevron_up" : "chevron_down"} size={14} color={t.muted} opacity={hovered ? 1 : 0} />
        </div>
      </Press>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 6, paddingLeft: 14, borderLeftWidth: 1, borderColor: tint(t.border, 0.8), minWidth: 0 }}>
          <Markdown text={entry.text ?? ""} />
        </div>
      ) : null}
    </div>
  );
}

/** The icon Zed gives a call of each kind. */
function toolIcon(tool: Tool): ZedIcon {
  switch (tool.kind) {
    case "shell":
      return "tool_terminal";
    case "read":
    case "search":
      return "tool_search";
    case "edit":
    case "write":
      return "tool_pencil";
    case "fetch":
      return "tool_web";
    case "subagent":
      return "forward_arrow_up";
    default:
      return "tool_hammer";
  }
}

/**
 * A call, as Zed draws its kind: an edit, a command or a subagent as a card, anything else as a
 * line of its own (its icon and what it did), with what it said under a rule when opened.
 */
export function ToolCard({ tool }: { tool: Tool }) {
  if (tool.kind === "shell") return <CommandCard tool={tool} />;
  if (tool.kind === "edit" || tool.kind === "write") return <EditCard tool={tool} />;
  if (tool.kind === "subagent") return <SubagentCard tool={tool} />;
  return <InlineTool tool={tool} />;
}

/** The face every card has: a block's colour (a step off the page), a soft border (dashed in Zed when it failed: the error's tint here). */
function cardStyle(t: ReturnType<typeof useTheme>, failed: boolean, bg: string) {
  return { display: "flex", flexDirection: "column", minWidth: 0, borderRadius: 6, borderWidth: 1, borderColor: failed ? tint(t.error, 0.5) : tint(t.border, 0.8), backgroundColor: bg, overflow: "hidden" } as const;
}

/** A card's head: Zed's `tool_card_header_bg`, the element background with a wash of the text over it. */
const headerWash = (t: ReturnType<typeof useTheme>) => tint(t.text, 0.04);

/** An edit: the file's path behind the pencil; the change under it, opened by the chevron. */
function EditCard({ tool }: { tool: Tool }) {
  const t = useTheme();
  const bg = useBlockColor();
  const type = useType();
  const [hovered, hover] = useHover();
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const failed = tool.status === "failed";
  const running = tool.status === "running" || tool.status === "pending";
  const shown = open ?? failed;
  const { target } = toolHeadline(tool);
  const path = tool.locations?.[0]?.path ?? tool.content.find((part) => part.type === "diff")?.path ?? target ?? tool.title;
  const hasBody = tool.content.length > 0;
  const stats = toolDiffStats(tool);
  return (
    <div style={cardStyle(t, failed, bg)}>
      <Press
        aria-label={`Edit ${path}, ${tool.status}${hasBody ? (shown ? ", press to fold" : ", press to open") : ""}`}
        aria-expanded={hasBody ? shown : undefined}
        disabled={!hasBody}
        focusableWhenDisabled
        onClick={() => setOpen(!shown)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingLeft: 8, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: headerWash(t), cursor: hasBody ? "pointer" : "default" }}
      >
        <div {...hover} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
          {running ? <Spinner size={14} color={t.muted} /> : <ZIcon name="tool_pencil" size={14} color={t.muted} />}
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }} title={path}>
            <text style={{ fontSize: type.small, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{path}</text>
          </div>
          {stats ? <Stats added={stats.added} removed={stats.removed} /> : null}
          {failed ? <ZIcon name="close" size={14} color={t.error} /> : null}
          {hasBody ? <ZIcon name={shown ? "chevron_up" : "chevron_down"} size={14} color={t.muted} opacity={hovered || shown ? 1 : 0} /> : null}
        </div>
      </Press>
      {shown && hasBody ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderTopWidth: 1, borderColor: tint(t.border, 0.8), minWidth: 0 }}>
          {tool.content.map((part, at) => (
            <ToolPart key={at} part={part} running={running} bare={part.type === "diff" && tool.content.filter((each) => each.type === "diff").length === 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A command: "Run Command" and the command in the code font; its output under it, opened by the chevron (folded while it runs, as it comes: opening and closing by itself flashed the screen). */
function CommandCard({ tool }: { tool: Tool }) {
  const t = useTheme();
  const bg = useBlockColor();
  const type = useType();
  const [hovered, hover] = useHover();
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const running = tool.status === "running" || tool.status === "pending";
  const terminal = tool.content.find((part): part is Extract<ToolContent, { type: "terminal" }> => part.type === "terminal");
  const exit = terminal?.exitCode;
  const failed = tool.status === "failed" || (exit !== undefined && exit !== 0);
  const output = tool.content.filter((part) => part.type !== "terminal" || part.output !== "");
  const hasBody = output.length > 0;
  const shown = open ?? false;
  const { target } = toolHeadline(tool);
  const command = target ?? tool.title;
  return (
    <div {...hover} style={{ ...cardStyle(t, failed, bg), borderColor: failed ? tint(t.error, 0.5) : tint(t.border, 0.6) }}>
      <Press
        aria-label={`Run Command ${command}, ${tool.status}${hasBody ? (shown ? ", press to fold" : ", press to open") : ""}`}
        aria-expanded={hasBody ? shown : undefined}
        disabled={!hasBody}
        focusableWhenDisabled
        onClick={() => setOpen(!shown)}
        style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 8, paddingRight: 6, paddingTop: 6, paddingBottom: 8, backgroundColor: headerWash(t), cursor: hasBody ? "pointer" : "default" }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 18 }}>
          <text style={{ fontSize: type.tiny, fontFamily: type.mono, color: t.muted, flexGrow: 1 }}>Run Command</text>
          {running ? <Spinner size={14} color={t.muted} /> : null}
          {failed ? (
            <div title={exit !== undefined ? `Exited with code ${exit}` : "Failed"} style={{ display: "flex" }}>
              <ZIcon name="close" size={14} color={t.error} />
            </div>
          ) : null}
          {hasBody ? <ZIcon name={shown ? "chevron_up" : "chevron_down"} size={14} color={t.muted} opacity={hovered || shown ? 1 : 0} /> : null}
        </div>
        <text style={{ fontSize: type.code, lineHeight: type.codeLine, fontFamily: type.mono, color: t.text }}>{command}</text>
      </Press>
      {shown && hasBody ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, borderTopWidth: 1, borderColor: tint(t.border, 0.6), minWidth: 0 }}>
          {output.map((part, at) =>
            part.type === "terminal" ? (
              <div key={at} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <Output text={running ? outputShown(part.output, true) : part.output} live={running} bare />
              </div>
            ) : (
              <div key={at} style={{ display: "flex", flexDirection: "column", padding: 8, minWidth: 0 }}>
                <ToolPart part={part} running={running} />
              </div>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A subagent: its status (a check once done) and what it was sent to do; its report under it when opened. */
function SubagentCard({ tool }: { tool: Tool }) {
  const t = useTheme();
  const bg = useBlockColor();
  const type = useType();
  const [hovered, hover] = useHover();
  const [open, setOpen] = useState(false);
  const running = tool.status === "running" || tool.status === "pending";
  const failed = tool.status === "failed";
  const { target } = toolHeadline(tool);
  const title = target ?? tool.title;
  const hasBody = tool.content.length > 0;
  return (
    <div {...hover} style={cardStyle(t, failed, bg)}>
      <Press
        aria-label={`Subagent: ${title}, ${tool.status}`}
        aria-expanded={hasBody ? open : undefined}
        disabled={!hasBody}
        focusableWhenDisabled
        onClick={() => setOpen(!open)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 8, paddingRight: 6, backgroundColor: headerWash(t), cursor: hasBody ? "pointer" : "default", hover: hasBody ? { backgroundColor: t.hover } : {} }}
      >
        <div style={{ display: "flex", width: 16, justifyContent: "center", flexShrink: 0 }}>
          {running ? <Spinner size={12} color={t.muted} /> : failed ? <ZIcon name="close" size={14} color={t.error} /> : tool.status === "canceled" ? <Icon name="circle" size={12} color={t.faint} /> : <ZIcon name="check" size={14} color={t.success} />}
        </div>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }} title={title}>
          <text style={{ fontSize: type.small, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
        </div>
        {hasBody ? <ZIcon name={open ? "chevron_up" : "chevron_down"} size={14} color={t.muted} opacity={hovered || open ? 1 : 0} /> : null}
      </Press>
      {open && hasBody ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderTopWidth: 1, borderColor: tint(t.border, 0.8), minWidth: 0 }}>
          {tool.content.map((part, at) => (
            <ToolPart key={at} part={part} running={running} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A read, a search, a fetch, a tool of another's: Zed's line (its icon, what it did, muted); what it said under a rule when opened. */
function InlineTool({ tool }: { tool: Tool }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [hovered, hover] = useHover();
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const failed = tool.status === "failed";
  const running = tool.status === "running" || tool.status === "pending";
  const shown = open ?? failed;
  const { verb, target, mono } = toolHeadline(tool);
  const hasBody = tool.content.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, marginTop: 2, marginBottom: 2 }}>
      <Press
        aria-label={`${verb} ${target ?? ""}, ${tool.status}${hasBody ? (shown ? ", press to fold" : ", press to open") : ""}`}
        aria-expanded={hasBody ? shown : undefined}
        disabled={!hasBody}
        focusableWhenDisabled
        onClick={() => setOpen(!shown)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 22, paddingLeft: 4, paddingRight: 4, marginLeft: -4, marginRight: -4, borderRadius: m.radiusSmall, cursor: hasBody ? "pointer" : "default", hover: hasBody ? { backgroundColor: tint(t.hover, 0.5) } : {} }}
      >
        <div {...hover} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }}>
          {running ? <Spinner size={14} color={t.muted} /> : <ZIcon name={toolIcon(tool)} size={14} color={t.muted} />}
          <text style={{ fontSize: type.small, color: failed ? t.error : t.muted, whiteSpace: "nowrap", flexShrink: 0 }}>{verb}</text>
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }} title={target}>
            {target ? <text style={{ fontSize: mono ? type.code - 1 : type.small, fontFamily: mono ? type.mono : undefined, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{target}</text> : null}
          </div>
          {failed ? <ZIcon name="close" size={14} color={t.error} /> : null}
          {hasBody ? <ZIcon name={shown ? "chevron_up" : "chevron_down"} size={14} color={t.muted} opacity={hovered || shown ? 1 : 0} /> : null}
        </div>
      </Press>
      {shown && hasBody ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: 6, paddingLeft: 14, paddingBottom: 4, borderLeftWidth: 1, borderColor: tint(t.border, 0.8), minWidth: 0 }}>
          {tool.content.map((part, at) => (
            <ToolPart key={at} part={part} running={running} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** How many lines of a call's text or output show before "Show all". */
const OUTPUT_LINES = 24;

/** One part of what a tool said: text, a change, a command's output, a picture. */
export function ToolPart({ part, running = false, bare = false }: { part: ToolContent; running?: boolean; /** A diff of the file the card names already. */ bare?: boolean }) {
  const t = useTheme();
  const type = useType();
  switch (part.type) {
    case "text":
      return <Output text={part.text} />;
    case "diff": {
      const patch = patchOf(part);
      return patch === "" ? <text style={{ fontSize: type.small, color: t.faint }}>{`${part.path}: no change`}</text> : <DiffView patch={patch} bare={bare} />;
    }
    case "terminal":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          {part.output === "" ? <text style={{ fontSize: type.small, color: t.faint }}>{running ? "No output yet" : "No output"}</text> : <Output text={running ? outputShown(part.output, true) : part.output} live={running} />}
          {part.exitCode !== undefined && part.exitCode !== 0 ? <text style={{ fontSize: type.tiny, fontFamily: type.mono, color: t.error }}>{`exit ${part.exitCode}`}</text> : null}
        </div>
      );
    case "image":
      return <Thumb image={part.image} alt="A picture from the tool" />;
  }
}

/** A call's text or output, in the code font, clipped until asked for all of it; `bare` inside a card that frames it. */
function Output({ text, live = false, bare = false }: { text: string; live?: boolean; bare?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  const [all, setAll] = useState(false);
  const body = text.replace(/\n+$/, "");
  const { text: shown, more } = all || live ? { text: body, more: 0 } : clipLines(body, OUTPUT_LINES);
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRadius: bare ? 0 : m.radiusSmall, backgroundColor: t.editor, borderWidth: bare ? 0 : 1, borderColor: t.border, overflow: "hidden" }}>
      <Mono text={shown} color={t.muted} padding={8} />
      {more > 0 ? <MoreLines more={more} onPress={() => setAll(true)} /> : null}
    </div>
  );
}

/** A plan, as Zed's list of todos: a spinning one in progress, a check once done (struck through), a ring before. */
export function PlanList({ plan }: { plan: PlanItem[] }) {
  const t = useTheme();
  const type = useType();
  if (plan.length === 0) return null;
  return (
    <div role="list" aria-label="Plan" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {plan.map((item, at) => (
        <div
          key={at}
          role="listitem"
          aria-label={`${item.content}, ${item.status.replace("_", " ")}`}
          style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: t.editor, borderBottomWidth: at < plan.length - 1 ? 1 : 0, borderColor: t.border }}
        >
          <div style={{ display: "flex", height: type.smallLine, alignItems: "center" }}>
            {item.status === "in_progress" ? (
              <motion.svg source={ZED_ICONS.todo_progress} animate={{ rotate: [0, 360] }} transition={{ duration: 2, repeat: Infinity, ease: "linear", fps: 24 }} style={{ width: 14, height: 14, flexShrink: 0, color: t.accent }} />
            ) : (
              <ZIcon name={item.status === "completed" ? "todo_complete" : "todo_pending"} size={14} color={item.status === "completed" ? t.success : t.muted} />
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
            <Inline text={item.content} size={type.small} line={type.smallLine} color={t.muted} strike={item.status === "completed"} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Zed's plan, docked on the composer: "Plan" and how far along it is (or "Current:" and the step
 * in progress) on one line, the steps under it when opened; × clears it from view.
 */
export function PlanBar({ plan }: { plan: PlanItem[] }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState<string | undefined>(undefined);
  const key = JSON.stringify(plan);
  if (plan.length === 0 || cleared === key) return null;
  const done = plan.filter((item) => item.status === "completed").length;
  const pending = plan.length - done;
  const current = plan.find((item) => item.status === "in_progress");
  const status = pending === 0 ? "All Done" : done === 0 ? `${plan.length} Tasks` : `${done}/${plan.length}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, marginLeft: 8, marginRight: 8, borderWidth: 1, borderBottomWidth: 0, borderColor: t.border, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: headerWash(t), overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, padding: 4, borderBottomWidth: open ? 1 : 0, borderColor: t.border }}>
        <Press aria-label={open ? "Hide the plan" : "Show the plan"} aria-expanded={open} onClick={() => setOpen(!open)} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexGrow: 1, minWidth: 0, height: 22, paddingLeft: 2, paddingRight: 4, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
          <ZIcon name={open ? "chevron_down" : "chevron_up"} size={14} color={t.muted} />
          {!open && current ? (
            <>
              <text style={{ fontSize: type.small, color: t.muted, flexShrink: 0 }}>Current:</text>
              <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: type.small, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{current.content}</text>
              </div>
              {pending > 0 ? <text style={{ fontSize: type.small, color: t.muted, flexShrink: 0 }}>{`${pending} left`}</text> : null}
            </>
          ) : (
            <>
              <text style={{ fontSize: type.small, color: t.muted, flexGrow: 1 }}>Plan</text>
              <text style={{ fontSize: type.small, color: t.muted, marginRight: 4 }}>{status}</text>
            </>
          )}
        </Press>
        <Press aria-label="Clear Plan" title="Clear Plan" onClick={() => setCleared(key)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
          <ZIcon name="close" size={12} color={t.muted} />
        </Press>
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 160, overflowY: "scroll" }}>
          <PlanList plan={plan} />
        </div>
      ) : null}
    </div>
  );
}
