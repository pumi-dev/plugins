// A snapshot is a pane's output replayed for a fresh terminal, so the queries in it (device
// attributes, cursor reports, mode and colour queries) were asked long ago. The app's own terminal
// drops what it would answer while it reads a snapshot; a terminal at the far end of herdr's client
// cannot tell, and its answers would reach the program as typed input. So they leave the snapshot
// here. Live output is passed on as it is: its queries are live.

const BEL = 0x07;
const ESC = 0x1b;
const ST_BACKSLASH = 0x5c;

/** `bytes` without the queries in it. A sequence cut off at the end is kept as it is. */
export function strip(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (bytes[at] !== ESC || at + 1 >= bytes.length) {
      out.push(bytes[at]);
      at += 1;
      continue;
    }
    let end: number;
    let query: boolean;
    switch (bytes[at + 1]) {
      case 0x5b: // [
        [end, query] = csi(bytes, at + 2);
        break;
      case 0x5d: // ]
        [end, query] = controlString(bytes, at + 2, true);
        break;
      case 0x50: // P
        [end, query] = controlString(bytes, at + 2, false);
        break;
      default:
        end = at + 1;
        query = false;
    }
    if (!query) for (let i = at; i < Math.max(end, at + 1); i++) out.push(bytes[i]);
    at = Math.max(end, at + 1);
  }
  return Uint8Array.from(out);
}

const decoder = new TextDecoder();

const CSI_QUERY_FINALS = {
  /** Window and cell sizes, and the title (reports only). */
  t: ["11", "13", "14", "15", "16", "18", "19", "20", "21"],
  /** Status and cursor reports, and the colour scheme's (`?996n`). */
  n: ["5", "6", "?6", "?15", "?25", "?26", "?996"],
};

/** A CSI from its first parameter byte at `at`: where it ends, and whether it asks something. */
function csi(bytes: Uint8Array, at: number): [number, boolean] {
  let i = at;
  while (i < bytes.length && bytes[i] >= 0x30 && bytes[i] <= 0x3f) i++;
  const params = bytes.subarray(at, i);
  const interAt = i;
  while (i < bytes.length && bytes[i] >= 0x20 && bytes[i] <= 0x2f) i++;
  const inter = bytes.subarray(interAt, i);
  if (i >= bytes.length) return [bytes.length, false];
  const fin = bytes[i];
  if (fin < 0x40 || fin > 0x7e) return [i, false];
  const bare = inter.length === 0;
  let query = false;
  if (fin === 0x63 && bare) {
    // Device attributes, primary, secondary and tertiary.
    query = Array.from(params).every((byte) => byte === 0x30 || byte === 0x3e || byte === 0x3d);
  } else if (fin === 0x6e && bare) {
    query = (CSI_QUERY_FINALS.n as string[]).includes(decoder.decode(params));
  } else if (fin === 0x70 && decoder.decode(inter) === "$") {
    // A mode's state (DECRQM).
    query = true;
  } else if (fin === 0x75 && bare) {
    // The kitty keyboard flags.
    query = decoder.decode(params) === "?";
  } else if (fin === 0x71 && bare) {
    // The terminal's name and version (XTVERSION).
    query = params[0] === 0x3e;
  } else if (fin === 0x74 && bare) {
    query = (CSI_QUERY_FINALS.t as string[]).includes(decoder.decode(params));
  }
  return [i + 1, query];
}

/** An OSC (`osc`) or DCS from its first byte at `at`, up to BEL (OSC only) or ST. */
function controlString(bytes: Uint8Array, at: number, osc: boolean): [number, boolean] {
  let i = at;
  let bodyEnd = -1;
  for (;;) {
    if (i >= bytes.length) return [bytes.length, false];
    if (bytes[i] === BEL && osc) {
      bodyEnd = i;
      i += 1;
      break;
    }
    if (bytes[i] === ESC && bytes[i + 1] === ST_BACKSLASH) {
      bodyEnd = i;
      i += 2;
      break;
    }
    i += 1;
  }
  const body = decoder.decode(bytes.subarray(at, bodyEnd));
  const query = osc
    ? // A colour asked for: `4;N;?`, `10;?` … `19;?`, a clipboard read (`52;c;?`).
      body.endsWith(";?")
    : // Termcap (XTGETTCAP) and settings (DECRQSS).
      body.startsWith("+q") || body.startsWith("$q");
  return [i, query];
}
