// What an agent is told about the workspace it is in: the guide (`context/guide.md`, a template
// that asks for three things — where the agent is, the tabs around it, the block types it can
// open), the map of every session, view, pane and tab built from the model, and `compose`, which
// decides whether an agent is told the whole thing again, only what changed, or nothing. The hook
// (`hooks/run.ts`) and a session tab (`sessions.ts`) hand it on; `wire.ts` keeps what each agent
// was told. No `import … from "pumi"` here.
import { readFileSync } from "node:fs";

import { paneRef, sessionRef, tabRef, viewRef } from "./ids.ts";
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

/** One tab's line, a bullet: `- %3 its name — what it is doing (current)`, `(you)` on its own. */
function line(tab: Tab, you: number | null): string {
  const said = [`- ${tabRef(tab.id)}, ${tabTitle(tab)}`];
  const doing = shown(tab);
  if (doing !== "") said.push(`— ${doing}`);
  const facts = [tab.id === you ? "you" : "", tab.focused ? "current" : ""].filter(Boolean);
  return `${said.join(" ")}${marks(facts)}`;
}

/** Where an agent's tab is, as the guide says it: `tab %3, pane :4, view @2, session $1`. */
export function place(tab: Tab | undefined): string {
  if (tab === undefined) return "a tab";
  const said = [`tab ${tabRef(tab.id)}`];
  if (tab.pane === null) said.push(`floating over view ${viewRef(tab.view)}`);
  else said.push(`pane ${paneRef(tab.pane)}`, `view ${viewRef(tab.view)}`);
  said.push(`session ${sessionRef(tab.session)}`);
  return said.join(", ");
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
 * user is, which the markers say; without one it is the agent's session too. `you` is the tab the
 * agent is in, which says `(you)`.
 */
export function map(
  snapshot: Snapshot,
  opts: { otherSessions: boolean; session: number | null; current?: number | null; you?: number | null },
): string {
  const you = opts.you ?? null;
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
        for (const tab of pane.tabs) lines.push(`      ${line(tab, you)}`);
      }
      if (view.floating.length > 0) {
        lines.push("    (floating)");
        for (const tab of view.floating) lines.push(`      ${line(tab, you)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** What the guide asks for, as `compose` fills it in. */
export interface Now {
  /** Where the agent is: `tab %3, pane :4, view @2, session $1`. */
  place: string;
  /** The tabs around it, as `map` says them. */
  tabs: string;
  /** The block types it can open, as `blockLines` says them. */
  blocks: string;
}

/** The guide with what it asks for filled in: `{place}`, `{tabs}` and `{blocks}`, in that order. */
export function fill(now: Now): string {
  return GUIDE.split("{place}")
    .join(now.place)
    .split("{tabs}")
    .join(now.tabs.replace(/\n+$/, ""))
    .split("{blocks}")
    .join(now.blocks.replace(/\n+$/, ""));
}

/**
 * What an agent is told now: the whole guide the first time (or when asked in full), only the tabs
 * that moved at a prompt, and nothing when nothing did — unless `updates` is `start`, when an agent
 * hears nothing after its session starts.
 */
export function compose(
  when: When,
  resumed: boolean,
  told: string | undefined,
  now: Now,
  updates: Updates,
): string | null {
  const full = () => fill(now);
  if (when === "full" || told === undefined) return full();
  if (when === "start") return resumed ? null : full();
  if (told !== now.tabs && updates === "changes") {
    return `<pumi-panes-changed>\nThe tabs around you changed; they are now:\n${now.tabs}</pumi-panes-changed>\n`;
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
