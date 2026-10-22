// The guide an agent is told, and the map of panes under it — this package's half of
// core/agents/src/context/: `guide.md` (shipped as a template, the same text), the map built from
// the snapshot, and `compose`, which decides whether an agent is told the whole thing again, only
// what changed, or nothing.
//
// What is not here is the hook: installing one, reporting an agent's state and writing
// `restore_command` are `pumi skill`'s (the CLI and the core), and a package cannot do them. What
// a hook, a script or another package can do is call `amresyd.agents.context`, which reads these
// options and answers what the agent should be told.
import { readFileSync } from "node:fs";

import { option } from "pumi";

import type { Snapshot } from "./snapshot.ts";
import { shown } from "./status.ts";
import { spaceLabel, tabLabel, title } from "./tree.ts";

/** The guide every agent is told once, at the top: it is what `pumi skill show` prints. */
export const GUIDE: string = readFileSync(new URL("../context/guide.md", import.meta.url), "utf8");

/** How often an agent hears about the workspace again after the first time. */
export type Updates = "changes" | "start";

/** When an agent is told something: the hook events the core knows, and a forced full telling. */
export type When = "start" | "prompt" | "full";

/** The options that decide what agents are told. */
export interface Settings {
  /** `context`: the master switch. */
  context: boolean;
  /** `context_updates`: `changes` tells it again when the panes move, `start` only at a start. */
  updates: Updates;
  /** `context_other_sessions`: whether other sessions' panes are in the map. */
  otherSessions: boolean;
  /** `context_targets`: each agent's own switch, by agent id. */
  targets: Record<string, boolean>;
}

export const DEFAULTS: Settings = { context: true, updates: "changes", otherSessions: true, targets: {} };

/** The settings, as the options say them. */
export async function settings(): Promise<Settings> {
  const [context, updates, otherSessions, targets] = await Promise.all([
    option.get("context"),
    option.get("context_updates"),
    option.get("context_other_sessions"),
    option.get("context_targets"),
  ]);
  return {
    context: typeof context === "boolean" ? context : DEFAULTS.context,
    updates: updates === "start" ? "start" : "changes",
    otherSessions: typeof otherSessions === "boolean" ? otherSessions : DEFAULTS.otherSessions,
    targets: switches(targets),
  };
}

/** A `context_targets` table, keeping only what says a boolean. */
export function switches(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [agent, on] of Object.entries(value)) if (typeof on === "boolean") out[agent] = on;
  return out;
}

/** Whether a given agent is told at all: the master switch, and its own. */
export function onFor(agent: string, settings: Settings): boolean {
  return settings.context && settings.targets[agent] === true;
}

/**
 * The map: every pane an agent is told about, with the ids `pumi` takes — `$1` a session, `@2` a
 * tab, `%3` a pane — what runs in each, where, and what it is doing.
 */
export function map(snapshot: Snapshot, opts: { otherSessions: boolean; space: number | null }): string {
  const lines: string[] = [];
  for (const space of snapshot.spaces) {
    if (!opts.otherSessions && opts.space !== null && space.id !== opts.space) continue;
    lines.push(`$${space.id} ${spaceLabel(space)}${space.focused ? " (current)" : ""}`);
    for (const tab of space.tabs) {
      lines.push(`  @${tab.id} ${tabLabel(tab)}`);
      for (const pane of tab.panes) {
        const said = [`    %${pane.id}`, title(pane)];
        const cwd = pane.cwd.replace(/\/+$/, "");
        if (cwd !== "") said.push(`— ${cwd}`);
        const doing = shown(pane);
        if (doing !== "") said.push(`— ${doing}`);
        lines.push(said.join(" "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * What an agent is told now: the whole guide and map the first time (or when asked in full), only
 * what changed at a prompt, and nothing when nothing did — unless `context_updates` is `start`,
 * when an agent hears nothing after its session starts.
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
