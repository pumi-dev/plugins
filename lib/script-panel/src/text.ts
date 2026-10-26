// How the page words what it lists, kept apart from the drawing so it can be tested without a
// window: a group's label in two halves, and an item's command less what its name already says.

/**
 * A group's label as two halves: where it is, said loudly, and the file it is read from, said
 * quietly (`runtime/app` and `/package.json`). A directory's label is all place; so is a file at
 * the root, which has no place to say but its own name.
 */
export function splitLabel(label: string): { place: string; file: string } {
  const slash = label.lastIndexOf("/");
  const tail = label.slice(slash + 1);
  if (slash < 0 || !tail.includes(".")) return { place: label, file: "" };
  return { place: label.slice(0, slash), file: label.slice(slash) };
}

/**
 * What a row says beside an item's name: its command, less the name it already shows — a shell
 * script's `bash build.sh` is said as `bash`. A command that is something else is said whole.
 */
export function shortDetail(name: string, detail: string): string {
  const tail = ` ${name}`;
  return detail.endsWith(tail) && detail.length > tail.length ? detail.slice(0, -tail.length) : detail;
}
