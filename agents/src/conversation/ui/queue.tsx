// The prompts queued behind the running turn, as one card over the composer: a header that folds
// it ("2 Queued Messages") with Clear All, then a row per prompt, the next to go first. A row
// offers Delete, Edit (back into the composer), Steer (into the running turn, where the agent
// takes one) and Send Now (the turn stopped, this one next).
import { useState } from "react";
import { Icon, useMetrics, useTheme, type StyleDesc } from "pumi";

import type { Queued } from "../model.ts";
import { Press } from "./press.tsx";
import { useType } from "./style.ts";
import { PENCIL_ICON, RETURN_ICON } from "./timeline.tsx";

/** A bin (delete), which the app's icons do not have. */
export const TRASH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11"/><path d="M6 4V2.5h4V4"/><path d="M3.8 4l.7 9.5h7l.7-9.5"/><path d="M6.7 6.8v4"/><path d="M9.3 6.8v4"/></svg>';

/** The keys the queue takes, shown beside what they do. */
export const QUEUE_KEYS = { clear: "⌥⌘⌫", steer: "⌃⌘S" };

export interface QueueCardProps {
  queue: Queued[];
  /** Take one back. */
  onDelete?(id: string): void;
  /** Take one back into the composer, to change it. */
  onEdit?(queued: Queued): void;
  /** Give one to the agent now, into its running turn. */
  onSteer?(id: string): void;
  /** Stop the turn and send one next. */
  onSendNow?(id: string): void;
  /** Take them all back. */
  onClear?(): void;
}

export function QueueCard({ queue, onDelete, onEdit, onSteer, onSendNow, onClear }: QueueCardProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [folded, setFolded] = useState(false);
  const count = `${queue.length} Queued Message${queue.length === 1 ? "" : "s"}`;
  const hint = { fontSize: type.small, color: t.faint, whiteSpace: "nowrap" as const, flexShrink: 0 };
  const iconButton: StyleDesc = { display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } };
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingLeft: 4, paddingRight: 8 }}>
        <Press
          aria-label={count}
          aria-expanded={!folded}
          title={folded ? "Show them" : "Fold them"}
          onClick={() => setFolded((was) => !was)}
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingLeft: 4, paddingRight: 6, flexShrink: 1, minWidth: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
        >
          <Icon name={folded ? "chevron_right" : "chevron_down"} size={12} color={t.muted} />
          <text style={{ fontSize: type.small, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{count}</text>
        </Press>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }} />
        {onClear ? (
          <Press
            aria-label="Clear all queued messages"
            title={`Clear all (${QUEUE_KEYS.clear})`}
            onClick={onClear}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingLeft: 6, paddingRight: 6, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
          >
            <text style={{ fontSize: type.small, color: t.text, whiteSpace: "nowrap" }}>Clear All</text>
            <text style={hint}>{QUEUE_KEYS.clear}</text>
          </Press>
        ) : null}
      </div>
      {folded ? null : (
        <div role="list" aria-label="Queued messages" style={{ display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "scroll", borderTopWidth: 1, borderColor: t.border }}>
          {queue.map((each, index) => {
            const next = index === 0;
            const words = each.text || `${each.images?.length ?? 0} picture(s)`;
            return (
              <div
                key={each.id}
                role="listitem"
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0, paddingLeft: 12, paddingRight: 8, paddingTop: 8, paddingBottom: 8, borderTopWidth: index > 0 ? 1 : 0, borderColor: t.border }}
              >
                <div style={{ width: 7, height: 7, flexShrink: 0, borderRadius: 4, backgroundColor: next ? t.accent : t.faint }} />
                <div style={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                  <text style={{ fontFamily: type.mono, fontSize: type.code, lineHeight: type.codeLine, color: t.text, whiteSpace: "normal", lineClamp: 6 }}>{words}</text>
                </div>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
                  {onDelete ? (
                    <Press aria-label={`Delete the queued message: ${words}`} title="Delete" onClick={() => onDelete(each.id)} style={iconButton}>
                      <svg source={TRASH_ICON} style={{ width: 13, height: 13, flexShrink: 0, color: t.muted }} />
                    </Press>
                  ) : null}
                  {onEdit ? (
                    <Press aria-label={`Edit the queued message: ${words}`} title="Edit (back into the composer)" onClick={() => onEdit(each)} style={iconButton}>
                      <svg source={PENCIL_ICON} style={{ width: 13, height: 13, flexShrink: 0, color: t.muted }} />
                    </Press>
                  ) : null}
                  {onSteer ? (
                    <Press
                      aria-label={`Steer: give the agent this message now: ${words}`}
                      title={`Give it to the agent now, in its running turn${next ? ` (${QUEUE_KEYS.steer})` : ""}`}
                      onClick={() => onSteer(each.id)}
                      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingLeft: 6, paddingRight: 6, marginLeft: 2, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
                    >
                      <text style={{ fontSize: type.small, color: t.text, whiteSpace: "nowrap" }}>Steer</text>
                      {next ? <text style={hint}>{QUEUE_KEYS.steer}</text> : null}
                    </Press>
                  ) : null}
                  {onSendNow ? (
                    <Press
                      aria-label={`Send now: stop the agent and send this message: ${words}`}
                      title={`Stop the agent's turn and send it${next ? " (↵ with an empty message)" : ""}`}
                      onClick={() => onSendNow(each.id)}
                      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingLeft: 8, paddingRight: 7, marginLeft: 4, flexShrink: 0, borderRadius: m.radiusSmall, backgroundColor: t.active, cursor: "pointer", hover: { backgroundColor: t.hover } }}
                    >
                      <text style={{ fontSize: type.small, color: t.text, whiteSpace: "nowrap" }}>Send Now</text>
                      {next ? <svg source={RETURN_ICON} style={{ width: 12, height: 12, flexShrink: 0, color: t.faint }} /> : null}
                    </Press>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
