// What an agent is told about the workspace it is in: the guide (`context/guide.md`), the map of
// every session, view, pane and tab built from the model, and `compose`, which decides whether an
// agent is told the whole thing again, only what changed, or nothing. The hook (`hooks/run.ts`)
// and a session tab (`sessions.ts`) hand it on; `wire.ts` keeps what each agent was told. No
// `import … from "pumi"` here.
import { readFileSync } from "node:fs";

import { paneRef, tabRef } from "./ids.ts";
import { sessionLabel, tabTitle, viewLabel } from "./label.ts";
import type { Snapshot, Tab } from "./snapshot.ts";
import { shown } from "./status.ts";

/** The guide every agent is told once, at the top. */
export const GUIDE: string = readFileSync(new URL("../../context/guide.md", import.meta.url), "utf8");

/** How often an agent hears about the workspace again after the first time. */
export type Updates = "changes" | "start";

/** When an agent is told something: its start, a prompt, or a forced full telling. */
export type When = "start" | "prompt" | "full";

/** What decides what agents are told: the `context` option, and the rest fixed (`tell.ts`). */
export interface Settings {
  /** `context`: whether agents are told at all. */
  context: boolean;
  /** `changes` tells it again when the tabs move, `start` only at a start. */
  updates: Updates;
  /** Whether other sessions' tabs are in the map. */
  otherSessions: boolean;
}

export const DEFAULTS: Settings = { context: true, updates: "changes", otherSessions: true };

/** The settings, from the options' values as the server answers them. */
export function settingsOf(context: unknown, updates: unknown, otherSessions: unknown): Settings {
  return {
    context: typeof context === "boolean" ? context : DEFAULTS.context,
    updates: updates === "start" ? "start" : "changes",
    otherSessions: typeof otherSessions === "boolean" ? otherSessions : DEFAULTS.otherSessions,
  };
}

/** One tab's line: its id and name, where it is, what it is doing, and whether it has the focus. */
function line(tab: Tab): string {
  const said = [`${tabRef(tab.id)} ${tabTitle(tab)}`];
  const cwd = tab.cwd.replace(/\/+$/, "");
  if (cwd !== "") said.push(`— ${cwd}`);
  const doing = shown(tab);
  if (doing !== "") said.push(`— ${doing}`);
  if (tab.focused) said.push("(current)");
  return said.join(" ");
}

/** What a pane says of itself, after its id: `(focused)`, `(zoomed)`, both, or nothing. */
function marks(parts: string[]): string {
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/**
 * The map: every session, view, pane and tab an agent is told about, with the ids `pumi` takes —
 * `$1` a session, `@2` a view, `:4` a pane, `%3` a tab — what runs in each tab, where, and what it
 * is doing.
 *
 * `session` is the agent's own: `otherSessions` off keeps the map to it. `current` is where the
 * user is, which the markers say; without one it is the agent's session too.
 */
export function map(
  snapshot: Snapshot,
  opts: { otherSessions: boolean; session: number | null; current?: number | null },
): string {
  const where = opts.current === undefined ? opts.session : opts.current;
  const lines: string[] = [];
  for (const session of snapshot.sessions) {
    if (!opts.otherSessions && opts.session !== null && session.id !== opts.session) continue;
    // What the markers say is where the user is: a view's and a pane's own "current" mean nothing
    // about a session the user is not in.
    const live = session.id === where;
    lines.push(`${sessionLabel(session)}${live ? " (current)" : ""}`);
    for (const view of session.views) {
      lines.push(`  ${viewLabel(view)}${live && view.focused ? " (current)" : ""}`);
      for (const pane of view.panes) {
        const focused = live && view.focused && pane.focused;
        lines.push(`    ${paneRef(pane.id)}${marks([focused ? "focused" : "", pane.zoomed ? "zoomed" : ""].filter(Boolean))}`);
        for (const tab of pane.tabs) lines.push(`      ${line(tab)}`);
      }
      if (view.floating.length > 0) {
        lines.push("    (floating)");
        for (const tab of view.floating) lines.push(`      ${line(tab)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * What an agent is told now: the whole guide and map the first time (or when asked in full), only
 * what changed at a prompt, and nothing when nothing did — unless `updates` is `start`, when an
 * agent hears nothing after its session starts.
 */
export function compose(
  when: When,
  resumed: boolean,
  told: string | undefined,
  current: string,
  updates: Updates,
): string | null {
  const full = () => `${GUIDE}\n<pumi-panes>\n${current}</pumi-panes>\n`;
  if (when === "full" || told === undefined) return full();
  if (when === "start") return resumed ? null : full();
  if (told !== current && updates === "changes") {
    return `<pumi-panes-changed>\nThe panes changed since the last map:\n${current}</pumi-panes-changed>\n`;
  }
  return null;
}

/** Who says the context, in its frame. */
export const SOURCE = "pumi_dev/agents";

/**
 * `text` in the frame an agent is told it in, `<pumi-context from="pumi_dev/agents">…</pumi-context>`:
 * its own end tag inside it is escaped, so the frame closes once.
 */
export function frame(text: string): string {
  const body = text.replaceAll("</pumi-context", "<\\/pumi-context").replace(/\n$/, "");
  return `<pumi-context from="${SOURCE}">\n${body}\n</pumi-context>\n`;
}
