// An icon of the Material Icon Theme as the file the window draws (`icons.ts` says which icon):
// apart from the mapping, so the window side does not load it.
import { join } from "node:path";
import lightOnes from "./material-light.json" with { type: "json" };

/** Where the theme's SVGs are. */
export const ICONS = join(import.meta.dir, "..", "icons", "material");

const light = new Set<string>(lightOnes);

/** An icon's SVG file: the light theme's own when `isLight` and the theme has one. */
export function iconPath(icon: string, isLight = false): string {
  return join(ICONS, `${isLight && light.has(icon) ? `${icon}_light` : icon}.svg`);
}
