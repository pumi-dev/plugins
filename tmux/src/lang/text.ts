// The text a format is made of: its width in cells (styles and `##` not counted), trimming and
// padding it, quoting it for a shell or the command language, and a path's last and first parts
// (pumi-lang's `format::text`, ported).

/** A character's width in cells: its own, 0 for a control character. */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) return 0;
  if (code < 0x1100) return 1;
  // East Asian wide and fullwidth, emoji, and the ranges that are two cells in a terminal.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** The width of text without its styles: `#[fg=red]` is none, `##` is one. */
export function width(s: string): number {
  let w = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === "#") {
      const lead = leadingHashes(s, i);
      w += lead.cells;
      i = lead.end;
      if (s[i] === "#") {
        const end = skipStyle(s, i + 2);
        if (end < 0) return 0;
        i = end + 1;
      }
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i) ?? 0);
      if (ch.charCodeAt(0) < 0x7f && ch.charCodeAt(0) >= 0x20) w += 1;
      else if (ch.charCodeAt(0) >= 0x20) w += charWidth(ch);
      i += ch.length;
    }
  }
  return w;
}

/** The `#`s at `i`: how many, the cells they are, and where the run ends. */
function leadingHashes(s: string, i: number): { count: number; cells: number; end: number } {
  let n = 0;
  while (s[i + n] === "#") n += 1;
  if (n === 0) return { count: 0, cells: 0, end: i };
  if (s[i + n] !== "[") {
    return { count: n, cells: n % 2 === 0 ? n / 2 : Math.floor(n / 2) + 1, end: i + n };
  }
  const cells = Math.floor(n / 2);
  return { count: n, cells, end: n % 2 === 0 ? i + n : i + n - 1 };
}

/** Where the style that starts at `i` (`#[`) ends: its `]`. */
function skipStyle(s: string, i: number): number {
  return s.indexOf("]", i);
}

/** Text whose width is at most `limit`, from its start; a style in it is kept. */
export function trimLeft(s: string, limit: number): string {
  let out = "";
  let w = 0;
  let i = 0;
  while (i < s.length) {
    if (w >= limit) break;
    if (s[i] === "#") {
      const lead = leadingHashes(s, i);
      let cells = lead.cells;
      if (cells > limit - w) cells = limit - w;
      if (cells !== 0) {
        out += lead.count === 1 ? "#" : "#".repeat(2 * cells);
        w += cells;
      }
      i = lead.end;
      if (s[i] === "#") {
        const end = skipStyle(s, i + 2);
        if (end < 0) break;
        out += s.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i) ?? 0);
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x7f && code >= 0x20) {
        if (w < limit) out += s[i];
        w += 1;
      } else if (code >= 0x20) {
        const cw = charWidth(ch);
        if (w + cw <= limit) out += ch;
        w += cw;
      }
      i += ch.length;
    }
  }
  return out;
}

/** Its last `limit` cells. */
export function trimRight(s: string, limit: number): string {
  const total = width(s);
  if (total <= limit) return s;
  const skip = total - limit;
  let out = "";
  let w = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === "#") {
      const lead = leadingHashes(s, i);
      let copy = lead.cells;
      if (w <= skip) copy = skip - w >= copy ? 0 : copy - (skip - w);
      if (copy !== 0) out += lead.count === 1 ? "#" : "#".repeat(2 * copy);
      w += lead.cells;
      i = lead.end;
      if (s[i] === "#") {
        const end = skipStyle(s, i + 2);
        if (end < 0) break;
        out += s.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i) ?? 0);
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x7f && code >= 0x20) {
        if (w >= skip) out += s[i];
        w += 1;
      } else if (code >= 0x20) {
        if (w >= skip) out += ch;
        w += charWidth(ch);
      }
      i += ch.length;
    }
  }
  return out;
}

/** Text in `cells` cells at least, spaces after it. */
export function padAfter(s: string, cells: number): string {
  const n = width(s);
  return n >= cells ? s : s + " ".repeat(cells - n);
}

/** Text in `cells` cells at least, spaces before it. */
export function padBefore(s: string, cells: number): string {
  const n = width(s);
  return n >= cells ? s : " ".repeat(cells - n) + s;
}

/** Text a shell reads as one word. */
export function quoteShell(s: string): string {
  let out = "";
  for (const c of s) {
    if ("|&;<>(){}$`\\\"'*?[# =%\n\t".includes(c)) out += "\\";
    out += c;
  }
  return out;
}

/** Text in single quotes, a quote of its own escaped. */
export function quoteShellSingle(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

/** Text whose `#` a format will not read as one of its own. */
export function quoteStyle(s: string): string {
  return s.replaceAll("#", "##");
}

/** Text as an argument of a command line. */
export function quoteArguments(s: string): string {
  if (s === "") return "''";
  const quotes = [...s].some((c) => " #';${}%".includes(c)) ? '"' : [...s].some((c) => " \"".includes(c)) ? "'" : undefined;
  const first = s[0];
  if (first !== " " && s.length === 1 && (quotes !== undefined || first === "~")) return `\\${s}`;
  const escaped = vis(s, quotes === '"');
  if (quotes === "'") return `'${escaped}'`;
  if (quotes === '"') return escaped.startsWith("~") ? `"\\${escaped}"` : `"${escaped}"`;
  return escaped.startsWith("~") ? `\\${escaped}` : escaped;
}

/** Text with its control characters escaped. */
function vis(s: string, double: boolean): string {
  let out = "";
  for (const c of s) {
    const code = c.codePointAt(0) ?? 0;
    if (c === "\\") out += "\\\\";
    else if (c === '"' && double) out += '\\"';
    else if (c === "$" && double) out += "\\$";
    else if (c === "\n") out += "\\n";
    else if (c === "\t") out += "\\t";
    else if (c === "\r") out += "\\r";
    else if (c === "\x07") out += "\\a";
    else if (c === "\b") out += "\\b";
    else if (c === "\v") out += "\\v";
    else if (c === "\f") out += "\\f";
    else if (code === 0) out += "\\000";
    else if (code < 0x20 || code === 0x7f) out += "\\" + code.toString(8).padStart(3, "0");
    else out += c;
  }
  return out;
}

/** A path's last part. */
export function basename(path: string): string {
  if (path === "") return ".";
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return "/";
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** A path's directory. */
export function dirname(path: string): string {
  if (path === "") return ".";
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return "/";
  const at = trimmed.lastIndexOf("/");
  if (at < 0) return ".";
  const dir = trimmed.slice(0, at).replace(/\/+$/, "");
  return dir === "" ? "/" : dir;
}
