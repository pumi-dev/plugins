// The composer's bar, as Zed's agent panel draws it: on the left what goes into the prompt (`+`),
// following the agent, and how it thinks (the thinking toggle, its effort); on the right how full
// the context is, the mode, the model and Send. Each piece is one of the session's options
// (`ConfigOption`) drawn as Zed draws its kind: a button 22 high, its icon 14, a menu that opens
// above it with a check on the choice in use.
import { Select, SelectContent, SelectItem, SelectTrigger, useMetrics, useTheme } from "pumi";
import { useRef, type ReactNode } from "react";

import type { Choice, ConfigOption, Usage } from "../model.ts";
import { contextTooltip, currentName, ringArc, thinkingOf } from "../view.ts";
import { ZED_ICONS, type ZedIcon } from "./icons.ts";
import { Press } from "./press.tsx";
import { tint, useType } from "./style.ts";

/** One of Zed's icons, tinted. */
export function ZIcon({ name, size = 14, color, opacity }: { name: ZedIcon; size?: number; color?: string; opacity?: number }) {
  return <svg source={ZED_ICONS[name]} style={{ width: size, height: size, flexShrink: 0, ...(color ? { color } : {}), ...(opacity !== undefined ? { opacity } : {}) }} />;
}

/** An icon button of the bar's: 22 square, its hover a wash. */
export function BarButton({ icon, title, label, onPress, color, opacity, disabled = false, selected = false, style }: { icon: ZedIcon; title: string; label?: string; onPress(): void; color?: string; opacity?: number; disabled?: boolean; selected?: boolean; style?: Record<string, unknown> }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <Press
      aria-label={label ?? title}
      aria-selected={selected}
      title={title}
      disabled={disabled}
      onClick={onPress}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, flexShrink: 0, borderRadius: m.radiusSmall, cursor: disabled ? "default" : "pointer", backgroundColor: selected ? t.selected : undefined, hover: disabled ? {} : { backgroundColor: t.hover }, ...style }}
    >
      <ZIcon name={icon} size={14} color={color ?? t.muted} opacity={opacity} />
    </Press>
  );
}

export interface PickerProps {
  /** What it is, for its tooltip and its menu's heading. */
  title: string;
  /** The menu's heading (Zed's "Change Thinking Effort"); none without. */
  heading?: string;
  value: string;
  choices: Choice[];
  onChange?(value: string): void;
  /** What the trigger shows before its label: an icon, a toggle. */
  leading?: ReactNode;
  /** The trigger's label; the current choice's name without. */
  label?: string;
  /** Its corners: a split button's right half is square on its left. */
  rounded?: "all" | "right";
  align?: "start" | "end";
}

/** A choice, as Zed's selectors are: a label and a chevron that open a menu above it, the current choice checked. */
export function Picker({ title, heading, value, choices, onChange, leading, label, rounded = "all", align = "end" }: PickerProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const shown = label ?? choices.find((c) => c.id === value)?.name ?? value;
  const radius = m.radiusSmall;
  return (
    <Select value={value} disabled={!onChange} onValueChange={(next) => onChange?.(next)} items={choices.map((choice) => ({ value: choice.id, textValue: choice.name }))}>
      <SelectTrigger
        aria-label={`${title}: ${shown}`}
        title={title}
        style={(state) => ({
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 22,
          paddingLeft: 4,
          paddingRight: 4,
          flexShrink: 1,
          minWidth: 0,
          borderTopLeftRadius: rounded === "all" ? radius : 0,
          borderBottomLeftRadius: rounded === "all" ? radius : 0,
          borderTopRightRadius: radius,
          borderBottomRightRadius: radius,
          cursor: onChange ? "pointer" : "default",
          backgroundColor: state.open ? tint(t.accent, 0.12) : undefined,
          hover: { backgroundColor: state.open ? tint(t.accent, 0.12) : t.hover },
        })}
      >
        {leading}
        <text style={{ fontSize: type.small, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{shown}</text>
        <ZIcon name="chevron_down" size={12} color={t.muted} />
      </SelectTrigger>
      <SelectContent side="top" align={align} sideOffset={2} style={{ display: "flex", flexDirection: "column", minWidth: 200, maxWidth: 360, maxHeight: 360, overflowY: "scroll", paddingTop: 4, paddingBottom: 4, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.overlay }}>
        {heading ? <text style={{ fontSize: type.tiny, fontWeight: 600, color: t.faint, paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4 }}>{heading}</text> : null}
        {choices.map((choice, at) => (
          <div key={choice.id} style={{ display: "flex", flexDirection: "column" }}>
            {choice.group && choice.group !== choices[at - 1]?.group ? <text style={{ fontSize: type.tiny, fontWeight: 600, color: t.faint, paddingLeft: 10, paddingTop: 6, paddingBottom: 2 }}>{choice.group}</text> : null}
            <SelectItem
              value={choice.id}
              aria-label={choice.name}
              style={(state) => ({ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 4, marginRight: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: state.highlighted ? t.hover : undefined })}
            >
              {(state) => (
                <>
                  <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                    <text style={{ fontSize: type.small, color: t.text }}>{choice.name}</text>
                    {choice.description ? <text style={{ fontSize: type.tiny, color: t.faint }}>{choice.description}</text> : null}
                  </div>
                  {state.selected ? <ZIcon name="check" size={12} color={t.accent} /> : <div style={{ width: 12, flexShrink: 0 }} />}
                </>
              )}
            </SelectItem>
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * How the agent thinks: Zed's lightbulb (accent while on, struck through while off) and, while
 * on, a menu of its effort levels beside it as one split button. A model that always thinks has
 * no toggle: the bulb leads the menu.
 */
export function ThinkingControl({ option, onChange }: { option: ConfigOption; onChange?(value: string): void }) {
  const t = useTheme();
  const state = thinkingOf(option);
  // The level the toggle turns back on: the last one in use, else the model's own.
  const last = useRef<string | undefined>(undefined);
  if (state.on && state.level) last.current = state.level;
  const turnOn = () => onChange?.(last.current && state.levels.some((l) => l.id === last.current) ? last.current : (state.fallback ?? state.levels[state.levels.length - 1]?.id ?? ""));
  const menu = state.on && state.levels.length > 1;
  if (!state.toggles) {
    return state.levels.length > 0 ? (
      <Picker title="Change Thinking Effort" heading="Change Thinking Effort" value={state.level ?? ""} choices={state.levels} onChange={onChange} leading={<ZIcon name="thinking_mode" size={14} color={t.accent} />} align="start" />
    ) : null;
  }
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, flexShrink: 1, minWidth: 0 }}>
      <BarButton
        icon={state.on ? "thinking_mode" : "thinking_mode_off"}
        title={state.on ? "Disable Thinking Mode" : "Enable Thinking Mode"}
        color={state.on ? t.accent : t.faint}
        opacity={state.on ? 1 : 0.8}
        disabled={!onChange}
        onPress={() => (state.on ? onChange?.(option.off!) : turnOn())}
        style={menu ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : {}}
      />
      {menu ? <Picker title="Change Thinking Effort" heading="Change Thinking Effort" value={state.level ?? ""} choices={state.levels} onChange={onChange} rounded="right" align="start" /> : null}
    </div>
  );
}

/** How full the context window is: Zed's ring, 16 across, filled clockwise from the top; its warning colour from 85%. */
export function ContextRing({ usage }: { usage: Usage }) {
  const t = useTheme();
  const ratio = usage.contextPct !== undefined ? usage.contextPct / 100 : usage.tokens !== undefined && usage.contextSize ? usage.tokens / usage.contextSize : undefined;
  if (ratio === undefined) return null;
  const tip = contextTooltip(usage);
  const arc = ringArc(ratio);
  return (
    <div role="status" aria-label={tip} title={tip} style={{ display: "flex", position: "relative", width: 16, height: 16, flexShrink: 0, marginRight: 4, marginTop: 1 }}>
      <svg source={ringArc(1)} style={{ position: "absolute", top: 0, left: 0, width: 16, height: 16, color: tint(t.text, 0.16) }} />
      {arc ? <svg source={arc} style={{ position: "absolute", top: 0, left: 0, width: 16, height: 16, color: ratio >= 0.85 ? t.warning : t.muted }} /> : null}
    </div>
  );
}

/** What `+` adds to the prompt. */
export interface ContextAction {
  id: string;
  label: string;
  icon: ZedIcon;
  run(): void;
}

/** Zed's `+`: a menu of what can go into the prompt. */
export function AddContext({ actions, disabled = false }: { actions: ContextAction[]; disabled?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  return (
    <Select value="" disabled={disabled} onValueChange={(id) => actions.find((a) => a.id === id)?.run()} items={actions.map((a) => ({ value: a.id, textValue: a.label }))}>
      <SelectTrigger aria-label="Add Context" title="Add Context" style={(state) => ({ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: state.open ? t.selected : undefined, hover: { backgroundColor: t.hover } })}>
        <ZIcon name="plus" size={14} color={t.muted} />
      </SelectTrigger>
      <SelectContent side="top" align="start" sideOffset={2} style={{ display: "flex", flexDirection: "column", minWidth: 200, paddingTop: 4, paddingBottom: 4, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.overlay }}>
        {actions.map((action) => (
          <SelectItem
            key={action.id}
            value={action.id}
            aria-label={action.label}
            style={(state) => ({ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 4, marginRight: 4, paddingLeft: 6, paddingRight: 6, height: 24, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: state.highlighted ? t.hover : undefined })}
          >
            <ZIcon name={action.icon} size={12} color={t.muted} />
            <text style={{ fontSize: type.small, color: t.text }}>{action.label}</text>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Send, as Zed's: filled, its icon the accent; Queue while the agent works; Stop while it works and nothing is written. */
export function SendButton({ working, canSend, onSend, onStop }: { working: boolean; canSend: boolean; onSend(): void; onStop?(): void }) {
  const t = useTheme();
  const m = useMetrics();
  if (working && !canSend && onStop) {
    return (
      <Press aria-label="Stop Generation" title="Stop Generation (Esc)" onClick={onStop} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: tint(t.error, 0.16), hover: { backgroundColor: tint(t.error, 0.26) } }}>
        <ZIcon name="stop" size={14} color={t.error} />
      </Press>
    );
  }
  const title = !canSend ? "Type to Send" : working ? "Queue and Send" : "Send Message";
  return (
    <Press aria-label={working ? "Queue and Send" : "Send Message"} title={`${title}${canSend ? " (↵)" : ""}`} disabled={!canSend} onClick={onSend} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, flexShrink: 0, borderRadius: m.radiusSmall, cursor: canSend ? "pointer" : "default", backgroundColor: t.active, hover: canSend ? { backgroundColor: t.hover } : {} }}>
      <ZIcon name={working ? "queue_message" : "send"} size={14} color={canSend ? t.accent : t.faint} />
    </Press>
  );
}

/** The model's name with its maker's mark, as Zed's model selector shows it. */
export function ModelPicker({ option, icon, onChange }: { option: ConfigOption; icon?: ZedIcon; onChange?(value: string): void }) {
  const t = useTheme();
  return (
    <Picker
      title="Change Model"
      value={typeof option.current === "string" ? option.current : ""}
      label={currentName(option)}
      choices={option.choices ?? []}
      onChange={onChange}
      leading={icon ? <ZIcon name={icon} size={12} color={t.muted} /> : undefined}
    />
  );
}
