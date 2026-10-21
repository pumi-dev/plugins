// pumi-heeler's own log line, on stderr, where `pumi plugin logs heeler` shows it.
export function log(message: string): void {
  console.error(`pumi-heeler: ${message}`);
}
