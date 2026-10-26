// A snapshot with its queries taken out, against the Rust's own vectors (`herdr/ui/src/queries.rs`
// tests): the queries go, everything else — colours, titles, mode sets, a sequence cut off at the
// end — stays byte for byte.
import { expect, test } from "bun:test";
import { strip } from "../src/queries.ts";

const bytes = (value: string | number[]) => (typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value));

test("queries go and the rest stays", () => {
  const snapshot =
    "\x1b[?1049h\x1b[c\x1b[>0c\x1b[6nhi\x1b[?2004$p\x1b[?u\x1b[>q\x1b[14t\x1b]11;?\x07\x1b]4;1;?\x1b\\\x1bP+q544e\x1b\\\x1b[31mred\x1b[0m\x1b]2;title\x07\x1b[8;24;80t";
  expect(strip(bytes(snapshot))).toEqual(bytes("\x1b[?1049hhi\x1b[31mred\x1b[0m\x1b]2;title\x07\x1b[8;24;80t"));
});

test("what is cut off is kept", () => {
  expect(strip(bytes("ok\x1b[3"))).toEqual(bytes("ok\x1b[3"));
  expect(strip(bytes("ok\x1b]11;?"))).toEqual(bytes("ok\x1b]11;?"));
  expect(strip(bytes("ok\x1b"))).toEqual(bytes("ok\x1b"));
});

test("utf8 and plain escapes pass", () => {
  const plain = bytes("π — ok\x1b7\x1b8\x1b=");
  expect(strip(plain)).toEqual(plain);
});

test("each kind of query on its own", () => {
  for (const query of [
    "\x1b[c",
    "\x1b[>c",
    "\x1b[=c",
    "\x1b[5n",
    "\x1b[6n",
    "\x1b[?6n",
    "\x1b[?15n",
    "\x1b[?25n",
    "\x1b[?26n",
    "\x1b[?996n",
    "\x1b[?2004$p",
    "\x1b[?u",
    "\x1b[>q",
    "\x1b[11t",
    "\x1b[21t",
    "\x1b]11;?\x07",
    "\x1b]10;?\x1b\\",
    "\x1b]52;c;?\x07",
    "\x1bP+q544e\x1b\\",
    "\x1bP$q m\x1b\\",
  ]) {
    expect([query, new TextDecoder().decode(strip(bytes(`a${query}b`)))]).toEqual([query, "ab"]);
  }
  // Not queries: a mode set, a private report nobody asks, and a CSI that is not one.
  for (const kept of ["\x1b[?2004h", "\x1b[12t", "\x1b[3~", "\x1b]2;a title\x07"]) {
    expect(new TextDecoder().decode(strip(bytes(kept)))).toBe(kept);
  }
});
