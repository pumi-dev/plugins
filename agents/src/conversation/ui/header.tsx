// The conversation's head: who it is with and how it is doing, the session's settings (mode, model,
// thought level, …) as pickers, and how full the context is.
import { Icon, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useMetrics, useTheme } from "pumi";

import type { ConfigOption, OptionCategory, Transcript } from "../model.ts";
import type { ReactNode } from "react";

import { conversationTitle, currentName, formatCount, headerOptions, shortModel, statusLabel, usageLine } from "../view.ts";
import { Press } from "./press.tsx";
import { useType } from "./style.ts";
import { Spinner } from "./timeline.tsx";

export interface HeaderProps {
  transcript: Transcript;
  /** A setting was changed. */
  onOption?(option: ConfigOption, value: string | boolean): void;
  /** Drawn at its end (a renderer's own buttons). */
  children?: ReactNode;
  /** The settings it leaves out: the ones the composer shows (the model). */
  except?: OptionCategory[];
}

/** An agent's state as the app draws it: an icon of its set, and the theme's colour for that state. */
const STATUS_ICON: Record<string, string> = {
  done: "status_check",
  blocked: "status_alert",
  error: "status_x",
  idle: "status_ring",
  working: "status_spinner",
};

export function Header({ transcript, onOption, children, except = [] }: HeaderProps) {
  const t = useTheme();
  const type = useType();
  const status = t[`agent.${transcript.status}`] ?? t["agent.unknown"];
  const icon = STATUS_ICON[transcript.status] ?? "status_unknown";
  const usage = usageLine(transcript.usage);
  const agent = transcript.session?.agent;
  const model = shortModel(transcript.session?.model);
  const title = conversationTitle(transcript);
  const about = [agent && agent !== title ? agent : undefined, model].filter(Boolean).join(" · ");
  const pct = transcript.usage.contextPct;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 36, flexShrink: 0, paddingLeft: 12, paddingRight: 8, borderBottomWidth: 1, borderColor: t.border }}>
      <div title={statusLabel(transcript.status)} aria-label={statusLabel(transcript.status)} role="status" style={{ display: "flex", flexShrink: 0 }}>
        {transcript.status === "working" ? <Spinner size={12} color={status} /> : <Icon name={icon} size={12} color={status} />}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }} title={[title, about].filter(Boolean).join(" — ")}>
        <text style={{ fontSize: type.body, fontWeight: 600, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
        {about ? <text style={{ fontSize: type.tiny, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 100, minWidth: 0 }}>{about}</text> : null}
      </div>
      {headerOptions(transcript).filter((option) => !except.includes(option.category)).map((option) => (
        <OptionPicker key={option.id} option={option} onChange={onOption ? (value) => onOption(option, value) : undefined} />
      ))}
      {usage !== "" ? (
        <div title={`Context: ${usage}`} aria-label={`Context: ${usage}`} role="status" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <Icon name="status_ring" size={11} color={(pct ?? 0) >= 80 ? t.warning : t.faint} />
          <text style={{ fontSize: type.tiny, color: (pct ?? 0) >= 80 ? t.warning : t.muted, whiteSpace: "nowrap" }}>{pct !== undefined ? `${pct}%` : transcript.usage.tokens !== undefined ? formatCount(transcript.usage.tokens) : usage}</text>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** One setting: a toggle when it is on/off, else a select of its choices. */
export function OptionPicker({ option, onChange, side = "bottom", title }: { option: ConfigOption; onChange?(value: string | boolean): void; /** Where its list opens. */ side?: "top" | "bottom"; /** Its tooltip (its description, else its name). */ title?: string }) {
  const t = useTheme();
  const m = useMetrics();
  const trigger = { display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingLeft: 6, paddingRight: 6, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } } as const;
  if (typeof option.current === "boolean") {
    const on = option.current;
    return (
      <Press aria-label={`${option.name}: ${on ? "on" : "off"}`} aria-selected={on} disabled={!onChange} onClick={() => onChange?.(!on)} style={trigger}>
        <Icon name={on ? "status_check" : "circle"} size={11} color={on ? t.accent : t.faint} />
        <text style={{ fontSize: 12, color: t.muted }}>{option.name}</text>
      </Press>
    );
  }
  const choices = option.choices ?? [];
  return (
    <Select value={option.current} disabled={!onChange} onValueChange={(value) => onChange?.(value)} items={choices.map((choice) => ({ value: choice.id, textValue: choice.name }))}>
      <SelectTrigger aria-label={`${option.name}: ${currentName(option)}`} title={title ?? option.description ?? option.name} style={trigger}>
        <SelectValue>
          <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap" }}>{currentName(option)}</text>
        </SelectValue>
        <Icon name="chevron_down" size={10} color={t.faint} />
      </SelectTrigger>
      <SelectContent side={side} align="end" sideOffset={4} style={{ display: "flex", flexDirection: "column", minWidth: 180, maxHeight: 320, overflowY: "scroll", paddingTop: 4, paddingBottom: 4, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.overlay }}>
        {choices.map((choice, at) => (
          <div key={choice.id} style={{ display: "flex", flexDirection: "column" }}>
            {choice.group && choice.group !== choices[at - 1]?.group ? (
              <text style={{ fontSize: 11, fontWeight: 600, color: t.faint, paddingLeft: 10, paddingTop: 4, paddingBottom: 2 }}>{choice.group}</text>
            ) : null}
            <SelectItem
              value={choice.id}
              aria-label={choice.name}
              style={(state) => ({ display: "flex", flexDirection: "column", paddingLeft: 10, paddingRight: 10, paddingTop: 3, paddingBottom: 3, cursor: "pointer", backgroundColor: state.highlighted ? t.hover : state.selected ? t.selected : undefined })}
            >
              <text style={{ fontSize: 12, color: t.text }}>{choice.name}</text>
              {choice.description ? <text style={{ fontSize: 11, color: t.faint }}>{choice.description}</text> : null}
            </SelectItem>
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}
