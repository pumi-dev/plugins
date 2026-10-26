// The API's ids are the strings the formats print (`%3` a pane, `@2` a tab, `$1` a session, and
// `devbox/%3` for one on another server); this package's own model keeps numbers, so each half of
// the package converts at its edge and nowhere else.

/** The number a wire id names (`%3` is `3`). */
export function num(id: string): number {
  return Number(id.slice(id.indexOf("/") + 1).replace(/^[%@$]/, ""));
}

/** The id `%n`. */
export function paneRef(n: number): string {
  return `%${n}`;
}

/** The id `@n`. */
export function tabRef(n: number): string {
  return `@${n}`;
}

/** The id `$n`. */
export function sessionRef(n: number): string {
  return `$${n}`;
}
