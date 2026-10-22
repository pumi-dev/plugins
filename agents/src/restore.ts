// The restore recipes: how an agent's conversation comes back when its pane does
// (core/agents/src/restore.rs, `restore.json`). A recipe is the program and its arguments, with
// `{session}` where the session's id goes; `agents.restore` in the settings adds or replaces one
// by agent id, and an empty list turns one off.
//
// The hook writes the line this makes to a pane's `restore_command`, and a restored terminal types
// it into its new shell. The hook is `pumi skill`'s; the line is this file's.
import { option } from "pumi";

/** Where a recipe puts the session's id. */
export const SESSION = "{session}";

/** The recipes pumi ships, by agent id. */
export const DEFAULTS: Record<string, string[]> = {
  pi: ["pi", "--session", SESSION],
  claude: ["claude", "--resume", SESSION],
  codex: ["codex", "resume", SESSION],
  opencode: ["opencode", "--session", SESSION],
  cursor: ["cursor-agent", "--resume", SESSION],
};

const words = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const word of value) {
    if (typeof word !== "string") return null;
    out.push(word);
  }
  return out;
};

/** Every recipe there is: the shipped ones, with `overrides` added to or taken out of them. */
export function recipes(overrides: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const tables = [DEFAULTS, typeof overrides === "object" && overrides !== null ? overrides : {}];
  for (const table of tables) {
    for (const [agent, recipe] of Object.entries(table as Record<string, unknown>)) {
      const kept = words(recipe);
      if (kept !== null && kept.length > 0) out.set(agent, kept);
      else if (kept !== null) out.delete(agent);
    }
  }
  return out;
}

/** The command line that resumes `session` for `agent`, or `null` when there is none to make. */
export function line(agent: string, session: string, overrides: unknown): string | null {
  const recipe = recipes(overrides).get(agent);
  return recipe ? command(recipe, session) : null;
}

/**
 * A recipe as one command line, `{session}` put in and quoted, or `null` when the session cannot
 * be one word of a command: empty, an option of its own, or with a control character in it.
 */
export function command(recipe: string[], session: string): string | null {
  const name = session.trim();
  const bad = name === "" || name.startsWith("-") || /[\u0000-\u001f\u007f]/.test(name);
  if (bad || !recipe.some((word) => word.includes(SESSION))) return null;
  return recipe.map((word) => quote(word.split(SESSION).join(name))).join(" ");
}

/** One word of a command line: bare when it is plain, in single quotes otherwise. */
export function quote(word: string): string {
  return word !== "" && /^[A-Za-z0-9\-_./=:,+@%]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** The recipes as the settings have them now. */
export async function settings(): Promise<unknown> {
  return option.get("restore");
}

/** The line for `agent`'s `session`, with the settings' recipes. */
export async function restore(agent: string, session: string): Promise<string | null> {
  return line(agent, session, await settings());
}
