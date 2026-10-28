// An icon of the Material Icon Theme as the file the window draws (`icons.ts` says which icon):
// apart from the mapping, so the window side does not load it. An icon's file is its name, or
// `<name>.clone.svg` for the few the theme makes by recolouring another.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where the theme's SVGs are: the `material-icon-theme` package's `icons/`. */
const ICONS = join(dirname(Bun.resolveSync("material-icon-theme/package.json", import.meta.dir)), "icons");

const found = new Map<string, string | null>();

/** The SVG of `name`, when there is one. */
function file(name: string): string | null {
  let path = found.get(name);
  if (path !== undefined) return path;
  path = [`${name}.svg`, `${name}.clone.svg`].map((each) => join(ICONS, each)).find((each) => existsSync(each)) ?? null;
  found.set(name, path);
  return path;
}

/** An icon's SVG file: the light theme's own when `isLight` and the theme has one. */
export function iconPath(icon: string, isLight = false): string {
  return (isLight ? file(`${icon}_light`) : null) ?? file(icon) ?? join(ICONS, `${icon}.svg`);
}
