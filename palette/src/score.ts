// SPDX-License-Identifier: GPL-3.0-or-later
//
// `normalizeActionQuery` and `humanizeActionName` are adapted from Zed's command palette
// (crates/command_palette/src/command_palette.rs, https://github.com/zed-industries/zed),
// Copyright Zed Industries, Inc., GPL-3.0-or-later; changed for pumi: written in TypeScript.

// The fuzzy matcher itself is nucleo's, in nucleo.ts (MPL-2.0); this file is the palette's own
// arithmetic over it and how an action's name reads.
export * from "./nucleo.ts";
import { match, type Match } from "./nucleo.ts";

/** The most rows a search shows (the core's `MAX_ROWS`). */
export const MAX_ROWS = 200;
/** A label keeps a little of its length against it, so the short name wins. */
export const LENGTH_PENALTY = 0.01;
/** And a match that ignored a capital the query typed keeps a little less of its score. */
export const SMART_CASE_PENALTY = 0.9;
/** How many of the query's capitals a match ignored: `Zoom` matched by `zoom` is one. Counted only
 * when the query types any capital, and only when one character of the labels answers each. */
export function caseMismatches(query: string, marks: readonly number[], label: string): number {
  const typed = Array.from(query).filter((char) => !/\s/.test(char));
  if (!typed.some((char) => char !== char.toLowerCase())) return 0;
  if (typed.length !== marks.length) return 0;
  const chars = Array.from(label);
  let mismatches = 0;
  for (let i = 0; i < typed.length; i++) {
    const matched = chars[marks[i]!];
    const want = typed[i]!;
    if (matched === undefined || matched === want) continue;
    if (matched.toLowerCase() === want.toLowerCase()) mismatches++;
  }
  return mismatches;
}

/** What `mismatches` case mismatches take off a score. */
export function casePenalty(mismatches: number): number {
  return SMART_CASE_PENALTY ** mismatches;
}

/** What a query finds in an action's label, as the palette ranks it: the match's score, the case
 * penalty, and the label's own length against it. */
export function matchLabel(label: string, query: string): Match | null {
  const found = match(label, query);
  if (found === null) return null;
  return {
    score: found.score * casePenalty(caseMismatches(query, found.marks, label)) - Array.from(label).length * LENGTH_PENALTY,
    marks: found.marks,
  };
}

/** The spans of `text` a query matched, in order, so a row can draw them bold: `[text, marked]`. */
export function segments(text: string, marks: readonly number[]): [string, boolean][] {
  const chars = Array.from(text);
  const marked = new Set(marks);
  const out: [string, boolean][] = [];
  for (const [at, char] of chars.entries()) {
    const bold = marked.has(at);
    const last = out[out.length - 1];
    if (last !== undefined && last[1] === bold) last[0] += char;
    else out.push([char, bold]);
  }
  return out;
}

/** A query with the spelling taken out of it, as the core normalises it: `_` is a space (an action
 * is `split_vertical`), `::` is one `:` (`palette::Toggle`), and the spaces are run together. */
export function normalizeActionQuery(input: string): string {
  let out = "";
  for (const char of input.trim()) {
    if (char === "_") out += " ";
    else if (char === ":" && out.endsWith(":")) continue;
    else if (/\s/.test(char) && out.endsWith(" ")) continue;
    else out += char;
  }
  return out;
}

/** An action's name as a person reads it: `split_vertical` is `split vertical`, `palette::Toggle` is
 * `palette: toggle`, `editor::GoToDefinition` is `editor: go to definition`. Ported from the core's
 * `humanize_action_name`, which descends from Zed's. */
export function humanizeActionName(name: string): string {
  const chars = Array.from(name);
  let out = "";
  let at = 0;
  while (at < chars.length) {
    const char = chars[at]!;
    if (char === ":") {
      out += ":";
      while (chars[at] === ":") at++;
      continue;
    }
    if (char === "_") {
      out += " ";
      at++;
      continue;
    }
    if (char !== char.toUpperCase() || char.toLowerCase() === char) {
      out += char;
      at++;
      continue;
    }
    // A capital: the run of them, less the one that opens the word after it.
    let length = 0;
    while (at + length < chars.length && isUpper(chars[at + length]!)) length++;
    const opensNext = isLower(chars[at + length] ?? "");
    const acronym = length - (opensNext ? 1 : 0);
    out = spaced(out);
    out += chars.slice(at, at + acronym).join("");
    if (opensNext) {
      out = spaced(out);
      out += chars[at + acronym]!.toLowerCase();
    }
    at += length;
  }
  return out;
}

function isUpper(char: string): boolean {
  return char === char.toUpperCase() && char !== char.toLowerCase();
}
function isLower(char: string): boolean {
  return char === char.toLowerCase() && char !== char.toUpperCase();
}
function spaced(out: string): string {
  return out !== "" && !out.endsWith(" ") ? `${out} ` : out;
}
