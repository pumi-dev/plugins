// Vendors the Material Icon Theme (PKief/material-icon-theme, MIT) from Open VSX into the package:
// every SVG into `icons/material/`, the theme's mapping, trimmed to what the tree reads, into
// `src/material.json`, and the icons that have a light theme's own into `src/material-light.json`.
// Run again for a newer release:
//
//   bun tools/vendor-material.ts            # the latest
//   bun tools/vendor-material.ts 5.39.0     # that version
import { mkdirSync, readdirSync, rmSync, copyFileSync, writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const API = "https://open-vsx.org/api/PKief/material-icon-theme";
const root = join(import.meta.dir, "..");

const meta = (await (await fetch(Bun.argv[2] ? `${API}/${Bun.argv[2]}` : API)).json()) as {
  version: string;
  files: { download: string };
};
const vsix = await fetch(meta.files.download);
if (!vsix.ok) throw new Error(`${meta.files.download}: ${vsix.status}`);
const work = mkdtempSync(join(tmpdir(), "material-"));
const file = join(work, "theme.vsix");
await Bun.write(file, vsix);
const unzip = Bun.spawnSync(["unzip", "-q", file, "-d", work]);
if (unzip.exitCode !== 0) throw new Error(`unzip: ${unzip.stderr.toString()}`);
const ext = join(work, "extension");

const theme = JSON.parse(readFileSync(join(ext, "dist/material-icons.json"), "utf8"));
const icons = join(root, "icons/material");
rmSync(icons, { recursive: true, force: true });
mkdirSync(icons, { recursive: true });
const names: string[] = [];
for (const [name, def] of Object.entries<{ iconPath: string }>(theme.iconDefinitions)) {
  const from = join(ext, "dist", def.iconPath);
  copyFileSync(from, join(icons, `${name}.svg`));
  names.push(name);
}
copyFileSync(join(ext, "LICENSE.txt"), join(icons, "LICENSE"));

const keep = ["fileExtensions", "fileNames", "folderNames", "folderNamesExpanded", "rootFolderNames", "rootFolderNamesExpanded"];
const pick = (from: Record<string, unknown>) => Object.fromEntries(keep.filter((k) => from[k]).map((k) => [k, from[k]]));
const mapping = {
  version: meta.version,
  file: theme.file,
  folder: theme.folder,
  folderExpanded: theme.folderExpanded,
  rootFolder: theme.rootFolder,
  rootFolderExpanded: theme.rootFolderExpanded,
  ...pick(theme),
  light: pick(theme.light ?? {}),
};
writeFileSync(join(root, "src/material.json"), JSON.stringify(mapping));
// The icons a light theme draws instead (`rust` has none, `toml` has `toml_light`): what the window
// needs to know, without the whole mapping.
const light = names.filter((name) => names.includes(`${name}_light`));
writeFileSync(join(root, "src/material-light.json"), JSON.stringify(light));
rmSync(work, { recursive: true, force: true });
console.log(`material-icon-theme ${meta.version}: ${names.length} icons, ${readdirSync(icons).length - 1} files`);
