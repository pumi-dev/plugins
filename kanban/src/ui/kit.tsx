// The board's small parts: a colour token at an alpha, the press areas, the mark a lane and a card
// wear, and the trail a working card leaves. Styles only, from the theme — never a literal colour.
import { Icon, motion, useMetrics, useTheme, type Tokens } from "pumi";
import type { ReactNode } from "react";

import type { Placement } from "../flight.ts";

/** `#rrggbb` at `alpha` (0 to 1) as `#rrggbbaa`; anything else is left as it came. */
export function tint(color: string, alpha: number): string {
  const hex = color.startsWith("#") ? color.slice(1) : "";
  if (hex.length !== 6 || !/^[0-9a-f]+$/i.test(hex)) return color;
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${hex}${byte}`;
}

export type Tone = Placement["tone"];

/** The colour a lane and a card are drawn in, by what the agent reported. */
export function toneColor(t: Tokens, tone: Tone): string {
  switch (tone) {
    case "working":
      return t["agent.working"] ?? t.accent;
    case "blocked":
      return t["agent.blocked"] ?? t.warning;
    case "error":
      return t["agent.error"] ?? t.error;
    case "done":
    case "landed":
      return t["agent.done"] ?? t.success;
    case "idle":
      return t["agent.idle"] ?? t.muted;
    case "queued":
      return t.faint;
  }
}

/** A press area: it says it is one, and does nothing while it is disabled. */
export function Press({
  onClick,
  children,
  style,
  tip,
  disabled,
}: {
  onClick?(event?: unknown): void;
  children?: ReactNode;
  style?: Record<string, unknown>;
  tip?: string;
  disabled?: boolean;
}) {
  return (
    <div
      title={tip}
      onClick={(event: any) => {
        if (disabled) return;
        event?.stopPropagation?.();
        onClick?.(event);
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A dot, as a lane and the header mark a count. */
export function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        flexShrink: 0,
        backgroundColor: color,
      }}
    />
  );
}

/** The mark the app draws while an agent works: its own `status_spinner`, turning once a second. */
const SPINNER = `data:image/svg+xml,${encodeURIComponent(
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" stroke="black" stroke-opacity="0.25" stroke-width="1.75"/><path d="M14 8a6 6 0 0 0-6-6" stroke="black" stroke-width="1.75" stroke-linecap="round"/></svg>`,
)}`;

/** What a card is doing, as the app marks an agent's status: a check, a ring, or a spinner. */
export function StatusMark({ tone, size = 14 }: { tone: Tone; size?: number }) {
  const t = useTheme();
  const color = toneColor(t, tone);
  if (tone === "working") {
    return (
      <motion.svg
        src={SPINNER}
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear", fps: 24 }}
        style={{ width: size, height: size, flexShrink: 0, color }}
      />
    );
  }
  const icon =
    tone === "error" ? "status_x" : tone === "blocked" ? "status_alert" : tone === "done" || tone === "landed" ? "status_check" : tone === "queued" || tone === "idle" ? "status_ring" : "status_unknown";
  return <Icon name={icon} size={size} color={color} />;
}

/** A small label: a word of context on a card, in the theme's own fill and text. */
export function Chip({ children, color, background }: { children: ReactNode; color?: string; background?: string }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        flexShrink: 0,
        maxWidth: 150,
        paddingLeft: 5,
        paddingRight: 5,
        paddingTop: 1,
        paddingBottom: 1,
        borderRadius: m.radiusSmall,
        backgroundColor: background ?? t.hover,
      }}
    >
      <text style={{ fontSize: m.fontSize - 3, color: color ?? t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{children}</text>
    </div>
  );
}

/** A section heading in the inspector. */
export function Heading({ children }: { children: ReactNode }) {
  const t = useTheme();
  const m = useMetrics();
  return <text style={{ fontSize: m.fontSize - 3, fontWeight: 600, color: t.muted }}>{children}</text>;
}
