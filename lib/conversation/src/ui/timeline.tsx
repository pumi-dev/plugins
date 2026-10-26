// The timeline: what was said, thought and run, newest at the foot. The last `pageSize` entries
// show; "Show earlier" brings the page before. Thoughts fold, tool cards fold (a change or a
// failure starts open), a plan is a checklist.
import { useState } from "react";
import { Icon, useFont, useMetrics, useTheme } from "pumi";

import type { Entry, PlanItem, Tool, ToolContent, Transcript } from "../model.ts";
import { imageSource, outputShown, patchOf, toolKindIcon, toolLine, toolOpensByDefault, toolStatusIcon, turnLine, visibleEntries } from "../view.ts";
import { Press } from "./press.tsx";
import { useTextTheme } from "./style.ts";

export interface TimelineProps {
  transcript: Transcript;
  /** How many entries show at first, and how many more each "Show earlier" adds. 60 by default. */
  pageSize?: number;
  /** A press on a link in the agent's text. */
  onLink?(url: string): void;
}

/** Every entry, the newest at the foot; it follows the foot while you are there. */
export function Timeline({ transcript, pageSize = 60, onLink }: TimelineProps) {
  const t = useTheme();
  const [count, setCount] = useState(pageSize);
  const { shown, hidden } = visibleEntries(transcript.entries, count);
  return (
    <virtual-list followTail alignment="top" aria-label="Conversation" role="log" style={{ flexGrow: 1, minHeight: 0, paddingLeft: 12, paddingRight: 12 }}>
      {hidden > 0 || transcript.truncated ? (
        <div key="earlier" style={{ display: "flex", flexDirection: "row", justifyContent: "center", paddingTop: 8, paddingBottom: 4 }}>
          {hidden > 0 ? (
            <Press
              aria-label={`Show ${Math.min(hidden, pageSize)} earlier entries`}
              onClick={() => setCount((n) => n + pageSize)}
              style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2, borderRadius: 4, cursor: "pointer", hover: { backgroundColor: t.hover } }}
            >
              <text style={{ fontSize: 11, color: t.muted }}>{`Show earlier (${hidden})`}</text>
            </Press>
          ) : (
            <text style={{ fontSize: 11, color: t.faint }}>Older entries were dropped</text>
          )}
        </div>
      ) : null}
      {shown.map((entry) => (
        // A row is laid out on its own (gpui's list), so without a width it grows to its widest
        // unwrapped line (a code block, a diff) and spills past a narrow pane: pin it to the list's.
        <div key={entry.id} style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, paddingTop: 4, paddingBottom: 4 }}>
          <EntryView entry={entry} onLink={onLink} />
        </div>
      ))}
      <div key="foot" style={{ height: 8 }} />
    </virtual-list>
  );
}

/**
 * Text as the chat draws it: a `<text>` a line, a plain paragraph's or a terminal's.
 *
 * TODO(api-server): `<markdown>`, `<diff>` and `<code>` are no longer elements the app draws
 * (`runtime/app/jsx-runtime.ts` lists `div`, `text`, `img`, `svg`, `terminal`, …), so an agent's
 * markdown, a tool's patch and a command's output are drawn as their plain text: no emphasis, no
 * links to press, no diff colours and no line numbers. `onLink` waits for the element to come back.
 */
function Prose({ text, muted = false, mono = false, style }: { text: string; muted?: boolean; mono?: boolean; style?: Record<string, unknown> }) {
  const t = useTheme();
  const m = useMetrics();
  const font = useFont();
  const line = {
    fontSize: mono ? m.fontSize - 1 : m.fontSize,
    color: muted ? t.muted : t.text,
    ...(mono ? { fontFamily: font.family, whiteSpace: "nowrap" as const } : {}),
    ...style,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {text.split("\n").map((each, at) => (
        <text key={at} style={line}>
          {each === "" ? " " : each}
        </text>
      ))}
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
  const m = useMetrics();
  switch (entry.kind) {
    case "user":
      return (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: "85%", paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: m.radius, backgroundColor: t.selected }}>
            <Prose text={entry.text ?? ""} />
          </div>
        </div>
      );
    case "agent":
      return (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Prose text={entry.text ?? ""} />
          {entry.clipped ? <Clipped /> : null}
        </div>
      );
    case "thought":
      return <Thought entry={entry} />;
    case "tool":
      return entry.tool ? <ToolCard tool={entry.tool} /> : null;
    case "plan":
      return <PlanList plan={entry.plan ?? []} />;
    case "notice": {
      const tone = entry.level === "error" ? t.error : entry.level === "warning" ? t.warning : t.muted;
      return (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={entry.level === "info" ? "status_dot" : "warning"} size={12} color={tone} />
          <text style={{ fontSize: 12, color: tone }}>{entry.text ?? ""}</text>
        </div>
      );
    }
    case "image": {
      const src = entry.image ? imageSource(entry.image) : undefined;
      if (!src) return null;
      return (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: entry.from === "user" ? "flex-end" : "flex-start" }}>
          <img src={src} alt={entry.from === "user" ? "An image you sent" : "An image from the agent"} objectFit="contain" style={{ maxWidth: 360, maxHeight: 240, borderRadius: m.radiusSmall }} />
        </div>
      );
    }
    case "turn":
      return entry.turn ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <div style={{ height: 1, flexGrow: 1, backgroundColor: t.border }} />
          <text style={{ fontSize: 11, color: t.faint }}>{turnLine(entry.turn)}</text>
          <div style={{ height: 1, flexGrow: 1, backgroundColor: t.border }} />
        </div>
      ) : null;
  }
}

function Clipped() {
  const t = useTheme();
  return <text style={{ fontSize: 11, color: t.faint }}>… cut here: it was too long to keep</text>;
}

/** The agent's reasoning, folded to one line until pressed. */
export function Thought({ entry }: { entry: Entry }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const first = (entry.text ?? "").trim().split("\n")[0] ?? "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Press
        aria-label={open ? "Hide the thinking" : "Show the thinking"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, cursor: "pointer", borderRadius: 4, hover: { backgroundColor: t.hover } }}
      >
        <Icon name={open ? "chevron_down" : "chevron_right"} size={11} color={t.faint} />
        <text style={{ fontSize: 12, fontStyle: "italic", color: t.muted, flexShrink: 0 }}>Thinking</text>
        {open ? null : (
          <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
            <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{first}</text>
          </div>
        )}
      </Press>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 15, borderLeftWidth: 1, borderColor: t.border }}>
          <Prose text={entry.text ?? ""} muted />
        </div>
      ) : null}
    </div>
  );
}

/** A tool call: its state, kind and title on one line, and what it said below when open. */
export function ToolCard({ tool }: { tool: Tool }) {
  const t = useTheme();
  const m = useMetrics();
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const shown = open ?? toolOpensByDefault(tool);
  const { title, detail } = toolLine(tool);
  const tone = tool.status === "failed" ? t.error : tool.status === "running" ? t["agent.working"] : tool.status === "completed" ? t.success : t.faint;
  const hasBody = tool.content.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
      <Press
        aria-label={`${title}, ${tool.status}${hasBody ? (shown ? ", press to fold" : ", press to open") : ""}`}
        aria-expanded={hasBody ? shown : undefined}
        disabled={!hasBody}
        focusableWhenDisabled
        onClick={() => setOpen(!shown)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingLeft: 8, paddingRight: 8, cursor: hasBody ? "pointer" : "default", borderRadius: m.radius, hover: hasBody ? { backgroundColor: t.hover } : {} }}
      >
        <Icon name={toolStatusIcon(tool.status)} size={12} color={tone} />
        <Icon name={toolKindIcon(tool.kind)} size={12} color={t.muted} />
        <div style={{ display: "flex", flexDirection: "row", gap: 6, flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: 12, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 0, maxWidth: "70%" }}>{title}</text>
          {detail ? <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{detail}</text> : null}
        </div>
        {hasBody ? <Icon name={shown ? "chevron_down" : "chevron_right"} size={11} color={t.faint} /> : null}
      </Press>
      {shown && hasBody ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 8, paddingRight: 8, paddingBottom: 8, borderTopWidth: 1, borderColor: t.border, paddingTop: 6 }}>
          {tool.content.map((part, at) => (
            <ToolPart key={at} part={part} running={tool.status === "running"} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One part of what a tool said: text, a change, a command's output, a picture. */
export function ToolPart({ part, running = false }: { part: ToolContent; running?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  switch (part.type) {
    case "text":
      return <Prose text={part.text} />;
    case "diff": {
      const patch = patchOf(part);
      return patch === "" ? <text style={{ fontSize: 12, color: t.faint }}>{`${part.path}: no change`}</text> : <Prose text={patch} mono style={{ maxHeight: 320 }} />;
    }
    case "terminal":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {part.output === "" ? (
            <text style={{ fontSize: 12, color: t.faint }}>No output yet</text>
          ) : (
            <div style={{ padding: 6, borderRadius: m.radiusSmall, backgroundColor: t.editor, maxHeight: 320, overflowY: "scroll" }}>
              <Prose text={outputShown(part.output, running)} mono />
            </div>
          )}
          {part.exitCode !== undefined ? <text style={{ fontSize: 11, color: part.exitCode === 0 ? t.faint : t.error }}>{`exit ${part.exitCode}`}</text> : null}
        </div>
      );
    case "image": {
      const src = imageSource(part.image);
      return src ? <img src={src} alt="An image from the tool" objectFit="contain" style={{ maxWidth: 360, maxHeight: 240, borderRadius: m.radiusSmall }} /> : null;
    }
  }
}

/** A plan, as a checklist. */
export function PlanList({ plan }: { plan: PlanItem[] }) {
  const t = useTheme();
  const m = useMetrics();
  if (plan.length === 0) return null;
  return (
    <div role="list" aria-label="Plan" style={{ display: "flex", flexDirection: "column", gap: 2, padding: 8, borderRadius: m.radius, borderWidth: 1, borderColor: t.border }}>
      <text style={{ fontSize: 11, fontWeight: 600, color: t.muted }}>Plan</text>
      {plan.map((item, at) => (
        <div key={at} role="listitem" aria-label={`${item.content}, ${item.status.replace("_", " ")}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={item.status === "completed" ? "status_check" : item.status === "in_progress" ? "status_spinner" : "circle"} size={12} color={item.status === "completed" ? t.success : item.status === "in_progress" ? t["agent.working"] : t.faint} />
          <text style={{ fontSize: 12, color: item.status === "completed" ? t.faint : t.text, textDecoration: item.status === "completed" ? "line-through" : "none" }}>{item.content}</text>
        </div>
      ))}
    </div>
  );
}
