// The timeline: what was said, thought and run, newest at the foot. The last `pageSize` entries
// show; "Show earlier" brings the page before. What the agent says is markdown; its work between
// (its calls and thoughts) is folded into one line per run once the run is over ("Ran 4 commands,
// edited 2 files"), open while it goes on. A call that asks the user is drawn as its questions.
import { createContext, useContext, useState } from "react";
import { Icon, motion, useHover, useMetrics, useNow, useTheme } from "pumi";

import type { Entry, PlanItem, Status, Tool, ToolContent, Transcript } from "../model.ts";
import { questionsOf } from "../question.ts";
import { activitySummary, clipLines, formatDuration, imagePathsIn, outputShown, patchOf, statusLabel, timelineRows, toolDiffStats, toolHeadline, toolKindIcon, toolOpensByDefault, turnLine, visibleEntries, type TimelineRow } from "../view.ts";
import { DiffView, Stats } from "./diff.tsx";
import { Thumb } from "./image.tsx";
import { CopyButton, Inline, Markdown, Mono, MoreLines } from "./markdown.tsx";
import { keepTyping, OwnClicks, Press, useTap } from "./press.tsx";
import { QuestionCard } from "./question.tsx";
import { tint, useTextTheme, useType } from "./style.ts";

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
}

/** What the rows under the timeline share. */
interface TimelineContext {
  onLink?(url: string): void;
  status: Status;
  onAnswerElsewhere?(): void;
  elsewhereLabel?: string;
  messageActions?(entry: Entry): MessageAction[];
  editing?: string;
  editable?(entry: Entry): boolean;
  onEditStart?(entry: Entry): void;
  onEditSubmit?(text: string): void;
  onEditCancel?(): void;
}

const Context = createContext<TimelineContext>({ status: "idle" });

const isQuestion = (tool: Tool) => questionsOf(tool) !== undefined;

/** Every entry, the newest at the foot; it follows the foot while you are there. */
export function Timeline({ transcript, pageSize = 60, onLink, onAnswerElsewhere, elsewhereLabel, messageActions, editing, editable, onEditStart, onEditSubmit, onEditCancel }: TimelineProps) {
  const t = useTheme();
  const type = useType();
  const [count, setCount] = useState(pageSize);
  const { shown, hidden } = visibleEntries(transcript.entries, count);
  const working = transcript.status === "working" || transcript.status === "blocked";
  const rows = timelineRows(shown, working, isQuestion);
  const context: TimelineContext = { onLink, status: transcript.status, onAnswerElsewhere, elsewhereLabel, messageActions, editing, editable, onEditStart, onEditSubmit, onEditCancel };
  // What an edit would leave behind: the message edited and everything after it.
  const editedAt = editing === undefined ? -1 : rows.findIndex((row) => row.type === "entry" && row.entry.id === editing);
  return (
    <Context.Provider value={context}>
      <virtual-list followTail alignment="top" aria-label="Conversation" role="log" style={{ flexGrow: 1, minHeight: 0, paddingLeft: 14, paddingRight: 14 }}>
        {hidden > 0 || transcript.truncated ? (
          <div key="earlier" style={{ display: "flex", flexDirection: "row", justifyContent: "center", paddingTop: 10, paddingBottom: 4 }}>
            {hidden > 0 ? (
              <Press
                aria-label={`Show ${Math.min(hidden, pageSize)} earlier entries`}
                onClick={() => setCount((n) => n + pageSize)}
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
        {shown.length === 0 ? <Empty key="empty" agent={transcript.session?.agent} /> : null}
        {rows.map((row, at) => (
          // A row is laid out on its own (gpui's list), so without a width it grows to its widest
          // unwrapped line and spills past a narrow pane: pin it to the list's.
          <div key={row.type === "entry" ? row.entry.id : row.id} style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, paddingTop: gapBefore(row, rows[at - 1]), paddingBottom: 2, opacity: editedAt >= 0 && at > editedAt ? 0.45 : 1 }}>
            {row.type === "entry" ? <EntryView entry={row.entry} onLink={onLink} /> : <Activity row={row} />}
          </div>
        ))}
        {working ? <Working key="working" status={transcript.status} since={turnStart(transcript.entries)} /> : null}
        <div key="foot" style={{ height: 12 }} />
      </virtual-list>
    </Context.Provider>
  );
}

/** More room before a new speaker than between the parts of one turn. */
function gapBefore(row: TimelineRow, before: TimelineRow | undefined): number {
  if (!before) return 12;
  const kind = (r: TimelineRow) => (r.type === "activity" ? "work" : r.entry.kind === "thought" || r.entry.kind === "tool" ? "work" : r.entry.kind);
  const now = kind(row);
  const was = kind(before);
  if (now === "user") return 18;
  if (was === "user") return 14;
  if (now === "turn") return 10;
  return now === was && now === "work" ? 4 : 10;
}

/** When the running turn began: its prompt's time. */
function turnStart(entries: Entry[]): number | undefined {
  for (let at = entries.length - 1; at >= 0; at--) if (entries[at]!.kind === "user") return entries[at]!.at;
  return undefined;
}

function Empty({ agent }: { agent?: string }) {
  const t = useTheme();
  const type = useType();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 48, paddingBottom: 24 }}>
      <Icon name="sparkle" size={22} color={t.faint} />
      <text style={{ fontSize: type.body, color: t.muted }}>{agent ? `Nothing said to ${agent} yet` : "Nothing said yet"}</text>
      <text style={{ fontSize: type.small, color: t.faint, textAlign: "center" }}>Write below to start. / lists commands, @ names files.</text>
    </div>
  );
}

/** A spinning icon, for what is going on now. */
export function Spinner({ size = 12, color }: { size?: number; color?: string }) {
  return (
    <motion.div animate={{ rotate: [0, 360] }} transition={{ duration: 1, repeat: Infinity, ease: "linear", fps: 24 }} style={{ display: "flex", width: size, height: size, flexShrink: 0 }}>
      <Icon name="status_spinner" size={size} color={color} />
    </motion.div>
  );
}

/** The foot while the agent works: what it is doing, and for how long. */
function Working({ status, since }: { status: Status; since?: number }) {
  const t = useTheme();
  const type = useType();
  const now = useNow(1000);
  const tone = t[`agent.${status}`] ?? t["agent.working"];
  const blocked = status === "blocked";
  return (
    <div role="status" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, paddingBottom: 2 }}>
      {blocked ? <Icon name="status_alert" size={12} color={tone} /> : <Spinner size={12} color={tone} />}
      <text style={{ fontSize: type.small, color: blocked ? tone : t.muted }}>{blocked ? statusLabel(status) : "Working…"}</text>
      {since !== undefined && !blocked ? <text style={{ fontSize: type.tiny, color: t.faint }}>{formatDuration(Math.max(0, now - since))}</text> : null}
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
        return <QuestionCard tool={entry.tool} waiting={context.status === "blocked" || context.status === "working"} onAnswerElsewhere={context.onAnswerElsewhere} elsewhereLabel={context.elsewhereLabel} onLink={context.onLink} />;
      }
      return <ToolCard tool={entry.tool} />;
    case "plan":
      return <PlanList plan={entry.plan ?? []} />;
    case "notice": {
      const tone = entry.level === "error" ? t.error : entry.level === "warning" ? t.warning : t.faint;
      const loud = entry.level === "error" || entry.level === "warning";
      return (
        <div role={loud ? "alert" : "note"} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: loud ? 10 : 0, paddingRight: loud ? 10 : 0, paddingTop: loud ? 6 : 0, paddingBottom: loud ? 6 : 0, borderRadius: 6, backgroundColor: loud ? tint(tone, 0.1) : undefined }}>
          <div style={{ display: "flex", height: type.smallLine, alignItems: "center" }}>
            <Icon name={entry.level === "info" ? "status_dot" : entry.level === "error" ? "status_x" : "warning"} size={11} color={tone} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
            <Inline text={entry.text ?? ""} size={type.small} line={type.smallLine} color={loud ? t.text : t.muted} onLink={context.onLink} />
          </div>
        </div>
      );
    }
    case "image":
      if (!entry.image) return null;
      return (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-start" }}>
          <Thumb image={entry.image} alt={entry.from === "user" ? "A picture you sent" : "A picture from the agent"} />
        </div>
      );
    case "turn":
      return entry.turn ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 }}>
          <div style={{ height: 1, flexGrow: 1, backgroundColor: t.border }} />
          <text style={{ fontSize: type.tiny, color: entry.turn.stop === "error" ? t.error : t.faint }}>{turnLine(entry.turn)}</text>
          <div style={{ height: 1, flexGrow: 1, backgroundColor: t.border }} />
        </div>
      ) : null;
  }
}

/**
 * What the user said: a box the timeline's width, the pictures it names under it, its actions on
 * hover over its top corner. A click on one that can be edited turns it into the field that edits it.
 */
function UserMessage({ entry }: { entry: Entry }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const context = useContext(Context);
  const [hovered, hover] = useHover();
  const text = entry.text ?? "";
  const pictures = imagePathsIn(text);
  const actions = context.messageActions?.(entry) ?? [];
  const editable = context.editable?.(entry) === true && context.onEditStart !== undefined;
  // A click, not a drag over its text: a selection is left alone.
  const tap = useTap((event) => {
    if (!editable) return;
    event.stopPropagation?.();
    context.onEditStart?.(entry);
  });
  if (context.editing === entry.id) return <EditMessage entry={entry} />;
  return (
    <div {...hover} style={{ display: "flex", flexDirection: "column", gap: 6, position: "relative", minWidth: 0 }}>
      <div
        {...(editable ? tap : {})}
        title={editable ? "Click to edit" : undefined}
        style={{ display: "flex", flexDirection: "column", minWidth: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 9, paddingBottom: 9, borderRadius: m.radius + 2, backgroundColor: t.editor, borderWidth: 1, borderColor: hovered && editable ? tint(t.text, 0.25) : t.border, cursor: editable ? "text" : undefined }}
      >
        <Inline text={text} size={type.body} line={type.bodyLine} color={t.text} onLink={context.onLink} />
      </div>
      {pictures.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {pictures.map((path) => (
            <Thumb key={path} image={{ mimeType: "image/png", uri: path }} alt="A picture you sent" maxWidth={200} maxHeight={140} />
          ))}
        </div>
      ) : null}
      <div style={{ position: "absolute", top: -13, right: 8 }}>
        <Actions shown={hovered} text={text} actions={actions} floating />
      </div>
    </div>
  );
}

/**
 * A message of the user's, edited where it was: its text in a field, sent by Enter or ↵ (in its
 * place: what came after it goes), left by Escape or ×.
 */
function EditMessage({ entry }: { entry: Entry }) {
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
  const button = { display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 22, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } } as const;
  return (
    <OwnClicks style={{ display: "flex", flexDirection: "column", position: "relative", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 9, paddingBottom: 9, borderRadius: m.radius + 2, backgroundColor: t.editor, borderWidth: 1, borderColor: t.accent }}>
        <textarea
          aria-label="Edit the message"
          value={value}
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
          style={{ flexGrow: 1, minWidth: 0, fontSize: type.body, color: t.text, backgroundColor: "transparent" }}
        />
      </div>
      <div style={{ position: "absolute", top: -13, right: 8, display: "flex", flexDirection: "row", alignItems: "center", gap: 1, padding: 2, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
        <Press aria-label="Cancel the edit" title="Cancel (Esc)" onClick={cancel} style={button}>
          <Icon name="close" size={11} color={t.error} />
        </Press>
        <Press aria-label="Send the edit" title="Editing will restart the thread from this point." disabled={!canSend} onClick={() => submit()} style={{ ...button, backgroundColor: t.active, cursor: canSend ? "pointer" : "default" }}>
          <svg source={RETURN_ICON} style={{ width: 12, height: 12, flexShrink: 0, color: canSend ? t.text : t.faint }} />
        </Press>
      </div>
    </OwnClicks>
  );
}

/** What the agent said: its markdown, with Copy on hover. */
function AgentMessage({ entry, onLink }: { entry: Entry; onLink?(url: string): void }) {
  const [hovered, hover] = useHover();
  const context = useContext(Context);
  const text = entry.text ?? "";
  if (text.trim() === "") return null;
  return (
    <div {...hover} style={{ display: "flex", flexDirection: "column", position: "relative", minWidth: 0 }}>
      <Markdown text={text} onLink={onLink} />
      {entry.clipped ? <Clipped /> : null}
      <div style={{ position: "absolute", top: -4, right: -6 }}>
        <Actions shown={hovered} text={text} actions={context.messageActions?.(entry) ?? []} floating />
      </div>
    </div>
  );
}

/** Copy, and what else a message offers; drawn always (so nothing moves), seen on hover. */
function Actions({ shown, text, actions, floating = false }: { shown: boolean; text: string; actions: MessageAction[]; floating?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 0, padding: floating ? 2 : 0, borderRadius: m.radiusSmall, opacity: shown ? 1 : 0, backgroundColor: floating ? t.surface : undefined, borderWidth: floating ? 1 : 0, borderColor: t.border }}>
      {actions.map((action) => (
        <Press key={action.id} aria-label={action.label} title={action.label} onClick={action.onPress} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 20, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
          {action.icon.startsWith("<svg") ? <svg source={action.icon} style={{ width: 11, height: 11, flexShrink: 0, color: t.faint }} /> : <Icon name={action.icon} size={11} color={t.faint} />}
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

/** A run of the agent's work: one line once it is over, the calls themselves while it goes on. */
function Activity({ row }: { row: Extract<TimelineRow, { type: "activity" }> }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const failed = row.entries.some((entry) => entry.tool?.status === "failed");
  const shown = open ?? row.live;
  const first = row.entries[0]!.at;
  const last = row.entries[row.entries.length - 1]!.at;
  const took = last - first > 1000 ? formatDuration(last - first) : undefined;
  const stats = row.entries.reduce(
    (sum, entry) => {
      const each = entry.tool ? toolDiffStats(entry.tool) : undefined;
      return each ? { added: sum.added + each.added, removed: sum.removed + each.removed } : sum;
    },
    { added: 0, removed: 0 },
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <Press
        aria-label={`${activitySummary(row.entries)}${shown ? ", press to fold" : ", press to open"}`}
        aria-expanded={shown}
        onClick={() => setOpen(!shown)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingLeft: 6, paddingRight: 6, marginLeft: -6, marginRight: -6, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
      >
        {row.live ? <Spinner size={12} color={t["agent.working"]} /> : <Icon name={failed ? "status_alert" : "blocks"} size={12} color={failed ? t.warning : t.faint} />}
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: type.small, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{activitySummary(row.entries)}</text>
        </div>
        <Stats added={stats.added} removed={stats.removed} />
        {took ? <text style={{ fontSize: type.tiny, color: t.faint, flexShrink: 0 }}>{took}</text> : null}
        <Icon name={shown ? "chevron_down" : "chevron_right"} size={10} color={t.faint} />
      </Press>
      {shown ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 10, marginLeft: 0, borderLeftWidth: 1, borderColor: t.border, minWidth: 0 }}>
          {row.entries.map((entry) => (
            <div key={entry.id} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <EntryView entry={entry} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The agent's reasoning, folded to one line until pressed. */
export function Thought({ entry }: { entry: Entry }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [open, setOpen] = useState(false);
  const first = (entry.text ?? "").trim().split("\n")[0]?.replace(/[*_`#]/g, "") ?? "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <Press
        aria-label={open ? "Hide the thinking" : "Show the thinking"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 22, paddingLeft: 6, paddingRight: 6, marginLeft: -6, marginRight: -6, cursor: "pointer", borderRadius: m.radiusSmall, hover: { backgroundColor: t.hover } }}
      >
        <Icon name="sparkle" size={11} color={t.faint} />
        <text style={{ fontSize: type.small, fontStyle: "italic", color: t.muted, flexShrink: 0 }}>Thought</text>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>{open ? null : <text style={{ fontSize: type.small, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{first}</text>}</div>
        <Icon name={open ? "chevron_down" : "chevron_right"} size={10} color={t.faint} />
      </Press>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 10, marginLeft: 0, borderLeftWidth: 2, borderColor: t.border }}>
          <Markdown text={entry.text ?? ""} muted small />
        </div>
      ) : null}
    </div>
  );
}

/** A call: what it did on one line, and what it said below when open. */
export function ToolCard({ tool }: { tool: Tool }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const shown = open ?? toolOpensByDefault(tool);
  const { verb, target, mono } = toolHeadline(tool);
  const running = tool.status === "running" || tool.status === "pending";
  const failed = tool.status === "failed";
  const hasBody = tool.content.length > 0;
  const stats = toolDiffStats(tool);
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRadius: m.radius, borderWidth: 1, borderColor: failed ? tint(t.error, 0.5) : shown && hasBody ? t.border : tint(t.border, 0.6), backgroundColor: shown && hasBody ? t.surface : undefined }}>
      <Press
        aria-label={`${verb} ${target ?? ""}, ${tool.status}${hasBody ? (shown ? ", press to fold" : ", press to open") : ""}`}
        aria-expanded={hasBody ? shown : undefined}
        disabled={!hasBody}
        focusableWhenDisabled
        onClick={() => setOpen(!shown)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, height: 26, paddingLeft: 8, paddingRight: 8, cursor: hasBody ? "pointer" : "default", borderRadius: m.radius, hover: hasBody ? { backgroundColor: t.hover } : {} }}
      >
        {running ? <Spinner size={12} color={t["agent.working"]} /> : <Icon name={failed ? "status_x" : tool.status === "canceled" ? "dash" : toolKindIcon(tool.kind)} size={12} color={failed ? t.error : t.faint} />}
        <text style={{ fontSize: type.small, fontWeight: 600, color: failed ? t.error : t.text, whiteSpace: "nowrap", flexShrink: 0 }}>{verb}</text>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }} title={target}>
          {target ? <text style={{ fontSize: mono ? type.code - 1 : type.small, fontFamily: mono ? type.mono : undefined, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{target}</text> : null}
        </div>
        {stats ? <Stats added={stats.added} removed={stats.removed} /> : null}
        {hasBody ? <Icon name={shown ? "chevron_down" : "chevron_right"} size={10} color={t.faint} /> : null}
      </Press>
      {shown && hasBody ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 8, paddingRight: 8, paddingBottom: 8, paddingTop: 2, minWidth: 0 }}>
          {tool.content.map((part, at) => (
            <ToolPart key={at} part={part} running={running} bare={part.type === "diff" && tool.content.filter((each) => each.type === "diff").length === 1 && tool.locations?.[0]?.path === part.path} />
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

/** A call's text or output, in the code font, clipped until asked for all of it. */
function Output({ text, live = false }: { text: string; live?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  const [all, setAll] = useState(false);
  const body = text.replace(/\n+$/, "");
  const { text: shown, more } = all || live ? { text: body, more: 0 } : clipLines(body, OUTPUT_LINES);
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRadius: m.radiusSmall, backgroundColor: t.editor, borderWidth: 1, borderColor: t.border, overflow: "hidden" }}>
      <Mono text={shown} color={t.muted} padding={8} />
      {more > 0 ? <MoreLines more={more} onPress={() => setAll(true)} /> : null}
    </div>
  );
}

/** A plan, as a checklist. */
export function PlanList({ plan }: { plan: PlanItem[] }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  if (plan.length === 0) return null;
  const done = plan.filter((item) => item.status === "completed").length;
  return (
    <div role="list" aria-label="Plan" style={{ display: "flex", flexDirection: "column", gap: 4, padding: 10, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="list" size={12} color={t.muted} />
        <text style={{ fontSize: type.small, fontWeight: 600, color: t.text, flexGrow: 1 }}>Plan</text>
        <text style={{ fontSize: type.tiny, color: t.faint }}>{`${done} of ${plan.length}`}</text>
      </div>
      {plan.map((item, at) => (
        <div key={at} role="listitem" aria-label={`${item.content}, ${item.status.replace("_", " ")}`} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", height: type.smallLine, alignItems: "center" }}>
            {item.status === "in_progress" ? <Spinner size={12} color={t["agent.working"]} /> : <Icon name={item.status === "completed" ? "status_check" : "status_ring"} size={12} color={item.status === "completed" ? t.success : t.faint} />}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
            <Inline text={item.content} size={type.small} line={type.smallLine} color={item.status === "completed" ? t.faint : t.text} strike={item.status === "completed"} />
          </div>
        </div>
      ))}
    </div>
  );
}

