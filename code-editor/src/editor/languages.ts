// The languages the editor highlights and indents, by file name: each is a Lezer grammar CodeMirror
// ships, with its indentation, folding, brackets and comment syntax. Anything else is plain text.
import { cpp, css, go, html, java, javascript, json, markdown, python, rust, yaml, type Extension } from "../codemirror.ts";

type Make = () => Extension;

const BY_EXTENSION: Record<string, Make> = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  jsonc: () => json(),
  rs: () => rust(),
  py: () => python(),
  pyi: () => python(),
  go: () => go(),
  c: () => cpp(),
  h: () => cpp(),
  cc: () => cpp(),
  cpp: () => cpp(),
  cxx: () => cpp(),
  hpp: () => cpp(),
  hh: () => cpp(),
  m: () => cpp(),
  mm: () => cpp(),
  java: () => java(),
  css: () => css(),
  html: () => html(),
  htm: () => html(),
  md: () => markdown(),
  markdown: () => markdown(),
  yaml: () => yaml(),
  yml: () => yaml(),
};

/** The file name's extension, lowercased, without its dot. */
export function extensionOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The language support for `path`, or none for plain text. */
export function languageFor(path: string): Extension {
  const make = BY_EXTENSION[extensionOf(path)];
  return make ? make() : [];
}

/** The extensions with a language: the manifest's renderer matches exactly these (`test/`). */
export const EXTENSIONS = Object.keys(BY_EXTENSION);
