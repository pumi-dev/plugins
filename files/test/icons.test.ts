// Which icon an entry gets: core/files' `file_icons.rs` tests, ported with it. The paths are the
// package's own, since a package cannot ask the app for a core plugin's assets.
import { expect, test } from "bun:test";
import { FOLDER_ICONS, fileIcon, folderIcon } from "../src/icons.ts";

test("icons come from the file name, then the suffixes", () => {
  expect(fileIcon("src/main.rs")).toBe("icons/file_icons/rust.svg");
  expect(fileIcon("README.md")).toBe("icons/file_icons/book.svg");
  expect(fileIcon("eslint.config.js")).toBe("icons/file_icons/eslint.svg");
  expect(fileIcon("auth.module.js")).toBe("icons/file_icons/javascript.svg");
  expect(fileIcon(".gitignore")).toBe("icons/file_icons/git.svg");
  expect(fileIcon("Containerfile")).toBe("icons/file_icons/docker.svg");
  expect(fileIcon("LICENSE")).toBe("icons/file_icons/file.svg");
  expect(fileIcon("src/")).toBe("icons/file_icons/file.svg");
});

test("the several extensions of a name are looked at too", () => {
  expect(fileIcon("docker-compose.yml")).toBe("icons/file_icons/docker.svg");
  expect(fileIcon("component.stories.tsx")).toBe("icons/file_icons/react.svg");
  expect(fileIcon("values.yaml")).toBe("icons/file_icons/helm.svg");
});

test("a folder is open or closed", () => {
  expect(folderIcon(true)).toBe(FOLDER_ICONS[1]);
  expect(folderIcon(false)).toBe(FOLDER_ICONS[0]);
  expect(folderIcon(false)).toBe("icons/file_icons/folder.svg");
});
