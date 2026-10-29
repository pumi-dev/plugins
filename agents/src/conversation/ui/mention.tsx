// A file mentioned in the draft, as the textarea's inline node draws it (`inlines`): its icon and
// name on inline code's wash, one character to the caret. A picture's shows itself on hover, above.
import { Icon, useHover, useMetrics, useTheme } from "pumi";

import { ZIcon } from "./bar.tsx";
import { tint, useType } from "./style.ts";

export interface MentionProps {
  label: string;
  kind: "file" | "folder" | "image";
  /** The picture's file, shown on hover. */
  preview?: string;
  /** The line it sits in, which it fits inside. */
  line: number;
}

/** How long the pointer rests on a picture's mention before it shows. */
const PREVIEW_DELAY_MS = 250;

export function Mention({ label, kind, preview, line }: MentionProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [hovered, hover] = useHover(PREVIEW_DELAY_MS);
  const size = Math.max(10, type.code - 1);
  return (
    <div
      {...hover}
      title={preview ? undefined : label}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: Math.max(14, line - 2), paddingLeft: 4, paddingRight: 5, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: tint(t.text, 0.08), cursor: "default" }}
    >
      {kind === "folder" ? <Icon name="folder" size={size} color={t.muted} /> : <ZIcon name={kind === "image" ? "image" : "file"} size={size} color={t.muted} />}
      <text style={{ fontSize: size, fontFamily: type.mono, color: t.text, whiteSpace: "nowrap" }}>{label}</text>
      {hovered && preview ? (
        <anchored side="top" align="start" gap={6} fit="snap" snapMargin={8} deferred occlude priority={2} style={{ backgroundColor: "transparent" }}>
          <div style={{ display: "flex", padding: 4, borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.overlay, boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: "#00000066" } }}>
            <img src={preview} alt={label} objectFit="contain" style={{ maxWidth: 320, maxHeight: 220, minWidth: 48, minHeight: 32, borderRadius: m.radiusSmall }} />
          </div>
        </anchored>
      ) : null}
    </div>
  );
}
