// herdr's public ids: `w<N>` workspaces, `<ws>:t<N>` tabs, `<ws>:p<N>` panes, with `N` in herdr's
// 32-symbol alphabet (bijective base 32, no `I`, `L`, `O`, `U`), and terminals `term_<N>`.
//
// pumi's ids are the numbers: a session `$5` is the workspace `w5`, its tab `@7` is `w5:t7`, its
// pane `%9` is `w5:p9`, terminal `term_9`. So herdr's ids never need a table, and a pane's id
// names its workspace while only its number is read back.
//
// PROVENANCE: herdr `src/workspace.rs` (`encode_public_number`, `decode_public_number`,
// `public_*_id_for_number`) @ v0.9.3 (Apache-2.0).

const ALPHABET = "123456789ABCDEFGHJKMNPQRSTVWXYZ0";

/** A number in herdr's alphabet: `1` is `1`, `31` is `Z`, `32` is `0`, `33` is `11`. */
export function encode(value: number): string {
  if (value === 0) return "0";
  let encoded = "";
  let left = value;
  while (left > 0) {
    const digit = (left - 1) % ALPHABET.length;
    encoded = ALPHABET[digit] + encoded;
    left = Math.floor((left - 1) / ALPHABET.length);
  }
  return encoded;
}

/** The number `value` names, or `undefined` when a character is not in herdr's alphabet. */
export function decode(value: string): number | undefined {
  if (value === "") return undefined;
  let decoded = 0;
  for (const char of value) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return undefined;
    decoded = decoded * ALPHABET.length + digit + 1;
  }
  return decoded;
}

/** A session's workspace id. */
export function workspace(number: number): string {
  return `w${encode(number)}`;
}

/** A tab's id, in the workspace `workspaceId`. */
export function tab(workspaceId: string, number: number): string {
  return `${workspaceId}:t${encode(number)}`;
}

/** A pane's id, in the workspace `workspaceId`. */
export function pane(workspaceId: string, number: number): string {
  return `${workspaceId}:p${encode(number)}`;
}

/** A terminal's id, which is its pane's number. */
export function terminal(number: number): string {
  return `term_${number}`;
}

/** The number of a workspace id (`w5`). */
export function workspaceNumber(id: string): number | undefined {
  return id.startsWith("w") ? decode(id.slice(1)) : undefined;
}

/** The workspace id and number of a tab id (`w5:t7`), or nothing. */
export function splitTab(id: string): [string, number] | undefined {
  const at = id.lastIndexOf(":t");
  if (at < 0) return undefined;
  const number = decode(id.slice(at + 2));
  return number === undefined ? undefined : [id.slice(0, at), number];
}

/** The workspace id and number of a pane id (`w5:p9`), or nothing. */
export function splitPane(id: string): [string, number] | undefined {
  const at = id.lastIndexOf(":p");
  if (at < 0) return undefined;
  const number = decode(id.slice(at + 2));
  return number === undefined ? undefined : [id.slice(0, at), number];
}
