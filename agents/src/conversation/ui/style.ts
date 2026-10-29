// The chat's look, from the theme: the colours `<textarea>` draws with, and the small pieces every
// part uses (the type sizes, the monospaced family, washes of the theme's colours). A view is given
// no appearance of its own (`useAppearance` is not the plugin SDK's), so every colour here is one of
// the theme's tokens, or a wash of one (`tint`).
import { useMemo } from "react";
import { useFont, useMetrics, useTheme } from "pumi";
import { blend } from "../view.ts";

export { blend, tint } from "../view.ts";

/** The native text elements' `theme` prop: the fields this sets of gpuix's `GpuixTheme`. */
export interface TextTheme {
  bg: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  textDim: string;
  accent: string;
  caret: string;
  codeText: string;
  codeWash: string;
  diffAdd: string;
  diffDel: string;
  diffHunkBg: string;
  metrics: { mdTextSize: number; codeTextSize: number; diffTextSize: number };
}

/**
 * The colour a block sits on — a call's card, a code block, a message of the user's: the chat's own
 * (`t.surface`) a step toward the text's, so a block reads as one on the page instead of a hole in
 * it. A step lighter on a dark theme, a step darker on a light one.
 */
export function useBlockColor(): string {
  const t = useTheme();
  return useMemo(() => blend(t.surface, t.text, 0.06) ?? t.surface, [t.surface, t.text]);
}

/** The window theme's colours, as the native text elements take them. */
export function useTextTheme(): TextTheme {
  const t = useTheme();
  const m = useMetrics();
  return useMemo(
    () => ({
      bg: t.editor,
      border: t.border,
      text: t.text,
      textMuted: t.muted,
      textFaint: t.faint,
      textDim: t.faint,
      accent: t.accent,
      caret: t.accent,
      codeText: t.text,
      codeWash: t.surface,
      diffAdd: t.success,
      diffDel: t.error,
      diffHunkBg: t.surface,
      metrics: { mdTextSize: m.fontSize, codeTextSize: m.fontSize - 1, diffTextSize: m.fontSize - 1 },
    }),
    [t, m],
  );
}

/** The chat's type: its sizes and line heights, from the theme's font size, and the terminal's family for code. */
export interface ChatType {
  /** Prose. */
  body: number;
  bodyLine: number;
  /** Labels, tool lines. */
  small: number;
  smallLine: number;
  /** Captions, counts. */
  tiny: number;
  /** Code, output, diffs. */
  code: number;
  codeLine: number;
  mono: string;
}

export function useType(): ChatType {
  const m = useMetrics();
  const font = useFont();
  return useMemo(() => {
    const body = m.fontSize;
    const code = Math.max(10, m.fontSize - 1);
    return {
      body,
      bodyLine: Math.round(body * 1.55),
      small: Math.max(10, body - 1),
      smallLine: Math.round(Math.max(10, body - 1) * 1.45),
      tiny: Math.max(9, body - 2),
      code,
      codeLine: Math.round(code * 1.5),
      mono: font.family,
    };
  }, [m.fontSize, font.family]);
}

/** A throw a part cannot answer: said in the log, not drawn over the window. */
export function swallow(err: unknown): void {
  console.error(`conversation: ${err instanceof Error ? err.message : String(err)}`);
}
