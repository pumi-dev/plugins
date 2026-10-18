// The conversation's head: who it is with and how it is doing, the session's settings (mode, model,
// thought level, …) as pickers, and how full the context is.
import { Icon, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useMetrics, useTheme } from "pumi";

import type { ConfigOption, Transcript } from "../model.ts";
import { conversationTitle, currentName, headerOptions, statusLabel, usageLine } from "../view.ts";
import { Press } from "./press.tsx";

export interface HeaderProps {
  transcript: Transcript;
  /** A setting was changed. */
  onOption?(option: ConfigOption, value: string | boolean): void;
}

/** An agent's state as the app draws it: an icon of its set, and the theme's colour for that state. */
const STATUS_ICON: Record<string, string> = {
  done: "status_check",
  blocked: "status_alert",
  error: "status_x",
  idle: "status_ring",
  working: "status_spinner",
};

export function Header({ transcript, onOption }: HeaderProps) {
  const t = useTheme();
  const m = useMetrics();
  const status = t[`agent.${transcript.status}`] ?? t["agent.unknown"];
  const icon = STATUS_ICON[transcript.status] ?? "status_unknown";
  const usage = usageLine(transcript.usage);
  const agent = transcript.session?.agent;
  const title = conversationTitle(transcript);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 32, flexShrink: 0, paddingLeft: 10, paddingRight: 8, borderBottomWidth: 1, borderColor: t.border }}>
      <Icon name={icon} size={12} color={status} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1, minWidth: 0 }} title={statusLabel(transcript.status)}>
        <text style={{ fontSize: m.fontSize, fontWeight: 600, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{title}</text>
        {agent && agent !== title ? <text style={{ fontSize: 12, color: t.faint, flexShrink: 0 }}>{agent}</text> : null}
      </div>
      {headerOptions(transcript).map((option) => (
        <OptionPicker key={option.id} option={option} onChange={onOption ? (value) => onOption(option, value) : undefined} />
      ))}
      {usage !== "" ? (
        <div title={`Context used: ${usage}`} aria-label={`Context used: ${usage}`} role="status" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <Icon name="status_ring" size={11} color={(transcript.usage.contextPct ?? 0) >= 80 ? t.warning : t.faint} />
          <text style={{ fontSize: 11, color: t.muted }}>{transcript.usage.contextPct !== undefined ? `${transcript.usage.contextPct}%` : usage}</text>
        </div>
      ) : null}
    </div>
  );
}

/** One setting: a toggle when it is on/off, else a select of its choices. */
export function OptionPicker({ option, onChange }: { option: ConfigOption; onChange?(value: string | boolean): void }) {
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
      <SelectTrigger aria-label={`${option.name}: ${currentName(option)}`} title={option.description ?? option.name} style={trigger}>
        <SelectValue>
          <text style={{ fontSize: 12, color: t.muted, whiteSpace: "nowrap" }}>{currentName(option)}</text>
        </SelectValue>
        <Icon name="chevron_down" size={10} color={t.faint} />
      </SelectTrigger>
      <SelectContent side="bottom" align="end" sideOffset={4} style={{ display: "flex", flexDirection: "column", minWidth: 180, maxHeight: 320, overflowY: "scroll", paddingTop: 4, paddingBottom: 4, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
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
