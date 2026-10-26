// What an agent's title says it is working on, and what the model answers turned into a tab name.
// Pure: no `pumi` here, so the tests run without an app.

/** Leading spinners and marks agents put before their title (Claude Code's `✳`, braille dots). */
const MARKS = /^[^\p{L}\p{N}]+/u;

/**
 * The topic of an agent's terminal title, or `null` when it names no task. pi writes
 * `π - <session name> - <folder>`, Claude Code `✳ <summary>`; a title that is only the agent's
 * name, the folder, or a path says nothing.
 */
export function topic(title: string, agent = "", folder = ""): string | null {
  const parts = title
    .split(/\s+[-–—|]\s+/)
    .map((p) => p.trim())
    .filter((p) => !/^[~/]/.test(p))
    .map((p) => p.replace(MARKS, "").trim())
    .filter(Boolean);
  const plain = (s: string) => s.toLowerCase();
  const noise = new Set([plain(agent), plain(folder), "pi", "π", "claude", "claude code", "codex", "opencode"].filter(Boolean));
  const kept = parts.filter((p) => !noise.has(plain(p)) && p.length > 1);
  const text = kept.join(" - ").trim();
  return text.length >= 3 ? text : null;
}

/** The base name of a path: `/a/b/pumi` → `pumi`. */
export function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

/**
 * The model's answer as a tab name: no quotes, punctuation or emoji, `CamelCase` split into words,
 * at most `maxWords` words (one more is let through: the model counts loosely, and a cut name reads
 * worse than a long one). A word the titles write in capitals keeps them (`Ui` → `UI`). `null`
 * when nothing is left.
 */
export function clean(answer: string, maxWords: number, titles: string[] = []): string | null {
  const caps = new Map<string, string>();
  for (const w of titles.join(" ").split(/[^\p{L}\p{N}.+#]+/u)) if (/\p{Lu}.*\p{Lu}/u.test(w)) caps.set(w.toLowerCase(), w);
  const words = answer
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}\s'+#.-]/gu, " ")
    .replace(/(^|\s)[.'-]+|[.'-]+(\s|$)/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => caps.get(w.toLowerCase()) ?? w);
  if (words.length === 0) return null;
  const name = words.slice(0, Math.max(1, maxWords) + 1).join(" ");
  return name.length > 40 ? name.slice(0, 40).replace(/\s+\S*$/, "") || name.slice(0, 40) : name;
}

/** The topics a tab is named from, as one key: the same topics are the same name. */
export function key(topics: string[], maxWords: number): string {
  return `${maxWords}\n${topics.join("\n")}`;
}
