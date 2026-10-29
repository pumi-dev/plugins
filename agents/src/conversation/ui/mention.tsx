// What a prompt names, drawn as a chip in its line: a file, a folder, a picture or a skill, its
// icon and name on inline code's wash. In the composer the textarea's inline node draws one
// (`inlines`, one character to the caret); in a message `MentionText` draws the text around them.
// A picture's chip shows the picture on hover, above it, and opens it when pressed.
import type { ReactNode } from "react";
import { call, Icon, useHover, useMetrics, useTheme } from "pumi";

import { words } from "../markdown.ts";
import { messageParts } from "../view.ts";
import { ZIcon } from "./bar.tsx";
import { Inline, openLink } from "./markdown.tsx";
import { useViewer } from "./image.tsx";
import { swallow, tint, useType } from "./style.ts";

export type MentionKind = "file" | "folder" | "image" | "skill";

export interface MentionProps {
  label: string;
  kind: MentionKind;
  /** The picture shown on hover: its file, or a data URL. */
  preview?: string;
  /** What the pointer resting on it says (the whole path); its label without. */
  title?: string;
  /** The line it sits in, which it fits inside. */
  line: number;
  /** Its text size; the code size less one without. */
  size?: number;
  /** A press on it (a picture opens); none without. */
  onPress?(): void;
}

/** How long the pointer rests on a picture's chip before it shows. */
const PREVIEW_DELAY_MS = 250;

export function Mention({ label, kind, preview, title, line, size: given, onPress }: MentionProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const [hovered, hover] = useHover(PREVIEW_DELAY_MS);
  const size = given ?? Math.max(10, type.code - 1);
  const skill = kind === "skill";
  return (
    <div
      {...hover}
      role={onPress ? "button" : undefined}
      aria-label={`${kind === "skill" ? "Skill" : kind === "image" ? "Picture" : kind === "folder" ? "Folder" : "File"}: ${label}`}
      title={preview ? undefined : (title ?? label)}
      onClick={onPress ? (e: any) => (e?.stopPropagation?.(), onPress()) : undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: Math.max(14, line - 2),
        flexShrink: 0,
        paddingLeft: 4,
        paddingRight: 5,
        borderRadius: m.radiusSmall,
        borderWidth: 1,
        borderColor: skill ? tint(t.accent, 0.45) : t.border,
        backgroundColor: skill ? tint(t.accent, 0.12) : tint(t.text, 0.08),
        cursor: onPress ? "pointer" : "default",
      }}
    >
      {kind === "folder" ? <Icon name="folder" size={size} color={t.muted} /> : kind === "skill" ? <Icon name="sparkle" size={size} color={t.accent} /> : <ZIcon name={kind === "image" ? "image" : "file"} size={size} color={t.muted} />}
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

export interface MentionTextProps {
  text: string;
  /** Where a relative path is from: the agent's directory. */
  cwd?: string;
  size: number;
  line: number;
  color: string;
  onLink?(url: string): void;
}

/**
 * A message with what it names drawn in its line as chips (`view.ts` `messageParts`); one that
 * names nothing is `Inline`'s. A picture's chip opens it in the viewer, a file's in its app.
 */
export function MentionText({ text, cwd, size, line, color, onLink }: MentionTextProps) {
  const t = useTheme();
  const open = useViewer();
  const parts = messageParts(text, cwd);
  if (!parts.some((part) => part.type === "chip")) return <Inline text={text} size={size} line={line} color={color} onLink={onLink} />;
  const base = { fontSize: size, lineHeight: line, color };
  const rows: ReactNode[][] = [[]];
  parts.forEach((part, p) => {
    if (part.type === "chip") {
      const path = part.path;
      const press = !path ? undefined : part.kind === "image" && open ? () => open({ src: path, alt: part.label, path }) : () => void call("fs.open", path).catch(swallow);
      rows.at(-1)!.push(
        <div key={p} style={{ display: "flex", height: line, alignItems: "center", paddingRight: 2 }}>
          <Mention label={part.label} kind={part.kind} title={part.path ?? part.text} preview={part.kind === "image" ? path : undefined} line={line} onPress={press} />
        </div>,
      );
      return;
    }
    words(part.text).forEach((word, w) => {
      if (word === "\n") return void rows.push([]);
      const url = /^https?:\/\/\S+/.exec(word)?.[0];
      rows.at(-1)!.push(
        url ? (
          <div key={`${p}.${w}`} role="link" title={url} onClick={() => openLink(url, onLink)} style={{ display: "flex", cursor: "pointer", flexShrink: 1, minWidth: 0 }}>
            <text style={{ ...base, color: t.accent, hover: { textDecoration: "underline" } }}>{word}</text>
          </div>
        ) : (
          <text key={`${p}.${w}`} style={{ ...base, flexShrink: 1, minWidth: 0 }}>
            {word}
          </text>
        ),
      );
    });
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {rows.map((pieces, at) => (
        <div key={at} textFlow style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", alignContent: "flex-start", minWidth: 0, minHeight: pieces.length === 0 ? line : undefined }}>
          {pieces}
        </div>
      ))}
    </div>
  );
}
