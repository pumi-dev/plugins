// A request the agent waits on: what it is about, and a button per answer. The buttons are tab
// stops (Enter or Space presses one); allowing ones are drawn in the accent.
import { Icon, useMetrics, useTheme } from "pumi";

import { allows, type Permission, type PermissionOption } from "../model.ts";
import { Press } from "./press.tsx";

export interface PermissionCardProps {
  permission: Permission;
  /** An answer was picked. */
  onAnswer(permissionId: string, optionId: string): void;
  /** Take keyboard focus on the first answer when it appears. */
  autoFocus?: boolean;
}

export function PermissionCard({ permission, onAnswer, autoFocus = false }: PermissionCardProps) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      role="alertdialog"
      aria-label={`The agent asks: ${permission.title}`}
      style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: m.radius, borderWidth: 1, borderColor: t["agent.blocked"], backgroundColor: t.surface }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="lock" size={13} color={t["agent.blocked"]} />
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: m.fontSize, fontWeight: 600, color: t.text }}>{permission.title}</text>
        </div>
      </div>
      {permission.detail ? (
        <div style={{ display: "flex", padding: 6, borderRadius: m.radiusSmall, backgroundColor: t.editor }}>
          <text style={{ fontSize: m.fontSize - 1, fontFamily: "Menlo", color: t.muted, lineClamp: 6 }}>{permission.detail}</text>
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {permission.options.map((option, at) => (
          <AnswerButton key={option.id} option={option} autoFocus={autoFocus && at === 0} onPress={() => onAnswer(permission.id, option.id)} />
        ))}
      </div>
    </div>
  );
}

function AnswerButton({ option, autoFocus, onPress }: { option: PermissionOption; autoFocus: boolean; onPress(): void }) {
  const t = useTheme();
  const m = useMetrics();
  const primary = allows(option.kind);
  return (
    <Press
      aria-label={option.label}
      autoFocus={autoFocus}
      onClick={onPress}
      style={{
        display: "flex",
        alignItems: "center",
        height: 24,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: m.radiusSmall,
        cursor: "pointer",
        backgroundColor: primary ? t.accent : t.active,
        hover: { backgroundColor: primary ? t.accent : t.hover, opacity: 0.9 },
        focusVisible: { outlineWidth: 2, outlineColor: t.accent, outlineOffset: 1 },
      }}
    >
      <text style={{ fontSize: m.fontSize - 1, color: primary ? t.accentText : t.text }}>{option.label}</text>
    </Press>
  );
}
