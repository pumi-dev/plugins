/** What an error says, for a notice or the log: a call's own message, or what was thrown. */
export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
