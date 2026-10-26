// Which icon a file or folder gets: the Material Icon Theme's (PKief/material-icon-theme, MIT, from
// Open VSX; vendored by `tools/vendor-material.ts` into `icons/material/` and `material.json`), read
// the way VS Code reads an icon theme. A file is named by its whole name first (`package.json`,
// `Dockerfile`), then by its extensions, the longest first (`d.ts` before `ts`), then it is the
// plain file. A folder is named by its name, open or closed.
// Names match whatever their case. An icon is its name in the theme (`rust`, `folder-src-open`);
// `iconPath` makes it a file, with a light theme's own where the theme has one.
import * as rel from "./relpath.ts";
import theme from "./material.json" with { type: "json" };

export { ICONS, iconPath } from "./icon-path.ts";

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
