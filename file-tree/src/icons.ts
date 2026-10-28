// Which icon a file or folder gets: the Material Icon Theme's (PKief/material-icon-theme, MIT, the
// `material-icon-theme` npm package), read the way VS Code reads an icon theme. A file is named by
// its whole name first (`package.json`, `Dockerfile`), then by its extensions, the longest first
// (`d.ts` before `ts`), then it is the plain file. A folder is named by its name, open or closed.
// Names match whatever their case. An icon is its name in the theme (`rust`, `folder-src-open`);
// `iconPath` makes it a file, with a light theme's own where the theme has one.
import * as rel from "./relpath.ts";
import theme from "material-icon-theme/dist/material-icons.json" with { type: "json" };

export { iconPath } from "./icon-path.ts";

type Names = Record<string, string>;

/** A table of the theme's with its names lowercased, as VS Code matches them. */
function lowered(table: Names | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, icon] of Object.entries(table ?? {})) out.set(name.toLowerCase(), icon);
  return out;
}

const fileNames = lowered(theme.fileNames);
const fileExtensions = lowered(theme.fileExtensions);
const folderNames = lowered(theme.folderNames);
const folderNamesExpanded = lowered(theme.folderNamesExpanded);

/** The plain file's icon, and a folder's when its name has none of its own. */
export const DEFAULTS = { file: theme.file, folder: theme.folder, folderExpanded: theme.folderExpanded };

/** Every icon the theme's tables name, for the test that each is a file. */
export function named(): string[] {
  const out = new Set<string>([theme.file, theme.folder, theme.folderExpanded]);
  for (const table of [theme.fileNames, theme.fileExtensions, theme.folderNames, theme.folderNamesExpanded] as Names[]) {
    for (const icon of Object.values(table)) out.add(icon);
  }
  return [...out];
}

/** The icon a file gets. */
export function fileIcon(path: string): string {
  const name = rel.fileName(path).toLowerCase();
  const byName = fileNames.get(name);
  if (byName) return byName;
  // `a.test.ts`: `test.ts`, then `ts`. A dotfile's name after its dot counts as an extension
  // (`.eslintrc` is `eslintrc`), as it does in VS Code.
  for (let dot = name.indexOf("."); dot >= 0; dot = name.indexOf(".", dot + 1)) {
    const found = fileExtensions.get(name.slice(dot + 1));
    if (found) return found;
  }
  return theme.file;
}

/** The icon a folder gets, open or closed. The project's root has none. */
export function folderIcon(path: string, open: boolean): string {
  const name = rel.fileName(path).toLowerCase();
  return (open ? folderNamesExpanded : folderNames).get(name) ?? (open ? theme.folderExpanded : theme.folder);
}
