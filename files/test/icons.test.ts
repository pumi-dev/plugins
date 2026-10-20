// Which icon an entry gets: the Material Icon Theme's, matched as VS Code matches an icon theme.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileIcon, folderIcon, iconPath } from "../src/icons.ts";
import theme from "../src/material.json" with { type: "json" };

test("a file is named by its whole name, then its extensions, the longest first", () => {
  expect(fileIcon("src/main.rs")).toBe("rust");
  expect(fileIcon("package.json")).toBe("nodejs");
  expect(fileIcon("Dockerfile")).toBe("docker");
  expect(fileIcon("README.md")).toBe("readme");
  expect(fileIcon("types/index.d.ts")).toBe("typescript-def");
  expect(fileIcon("ui.tsx")).toBe("react_ts");
  expect(fileIcon("data.JSON")).toBe("json");
  expect(fileIcon("nothing.known-here")).toBe(theme.file);
  expect(fileIcon("LICENSE")).toBe("license");
});

test("a folder is named by its name, open or closed", () => {
  expect(folderIcon("crates/app/src", false)).toBe("folder-src");
  expect(folderIcon("src", true)).toBe("folder-src-open");
  expect(folderIcon("whatever", false)).toBe(theme.folder);
  expect(folderIcon("whatever", true)).toBe(theme.folderExpanded);
});

test("every icon the mapping names is a file in the package, and a light theme has its own", () => {
  const named = new Set<string>([theme.file, theme.folder, theme.folderExpanded]);
  for (const table of [theme.fileNames, theme.fileExtensions, theme.folderNames, theme.folderNamesExpanded]) {
    for (const icon of Object.values(table as Record<string, string>)) named.add(icon);
  }
  const missing = [...named].filter((icon) => !existsSync(iconPath(icon)));
  expect(missing).toEqual([]);
  expect(iconPath("toml", true).endsWith("/toml_light.svg")).toBe(true);
  expect(iconPath("rust", true).endsWith("/rust.svg")).toBe(true);
});
