// pumi-herdr's own log line, on stderr, where `pumi plugin logs herdr` shows it.
export function log(message: string): void {
  console.error(`pumi-herdr: ${message}`);
}
