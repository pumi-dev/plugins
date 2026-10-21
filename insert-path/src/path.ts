// A path as it goes into the terminal, and as the picker's header shows it.
import { homedir } from "node:os";

/** What a shell takes as it is, besides letters and digits. */
const PLAIN = "-_./~+@%:=,";

/**
 * A path as one shell argument: bare when nothing in it needs quoting, `'…'` otherwise, with
 * `'\''` for the quotes inside it.
 */
export function quote(path: string): string {
  const plain = path !== "" && Array.from(path).every((c) => /[A-Za-z0-9]/.test(c) || PLAIN.includes(c));
  return plain ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

/** `/Users/me/kit` as `~/kit`, for the header. */
export function tilde(path: string, home: string = homedir()): string {
  return home !== "" && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
