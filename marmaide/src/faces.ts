// The faces a diagram is set in, read from the package's options: the app's own by default, since
// the app draws the diagram with its own SVG renderer and only has the fonts the machine has. A
// family named here must be one the machine has too — nothing is shipped with the package to be.
import { option } from "pumi";
import { FALLBACK_FONT, FALLBACK_MONO, type Faces } from "./pele.ts";
import type { AppTheme } from "./palette.ts";

/** What a diagram is set in: the options, over the app's own faces. */
export async function faces(theme: AppTheme | null): Promise<Faces> {
  const [font, mono, size] = await Promise.all([option.get("font"), option.get("font_mono"), option.get("font_size")]);
  return {
    font: named(font) ?? named(theme?.fonts?.font) ?? FALLBACK_FONT,
    mono: named(mono) ?? named(theme?.fonts?.mono) ?? FALLBACK_MONO,
    size: typeof size === "number" && Number.isFinite(size) ? size : 16,
  };
}

/** `text` trimmed, or nothing when it is empty or not text. */
function named(text: unknown): string | undefined {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed === "" ? undefined : trimmed;
}
