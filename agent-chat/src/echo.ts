// A prompt the chat typed, matched against the one the session file later records: the TUI may
// trim it, or join its lines differently. No `import … from "pumi"` here.

/** `text` with its whitespace collapsed: what two copies of one prompt share. */
function normal(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Whether the file's `recorded` prompt is the `typed` one the chat already shows. */
export function matchesEcho(recorded: string, typed: string): boolean {
  const a = normal(recorded);
  const b = normal(typed);
  return a !== "" && (a === b || a.endsWith(b) || b.endsWith(a));
}
