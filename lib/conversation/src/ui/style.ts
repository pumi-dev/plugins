// The chat's look, from the theme: the colours `<markdown>`, `<code>`, `<diff>` and `<textarea>`
// draw with, and the small pieces every part uses. A view is given no appearance of its own
// (`useAppearance` is not the SDK's), so the native text keeps its dark look for what these leave
// unset (the syntax colours); every field a light theme must change, these set.
import { useMemo } from "react";
import { useMetrics, useTheme } from "pumi";

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

/** A throw a part cannot answer: said in the log, not drawn over the window. */
export function swallow(err: unknown): void {
  console.error(`conversation: ${err instanceof Error ? err.message : String(err)}`);
}
