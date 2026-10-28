// A unified patch from a file's two texts, for `<diff patch>` when a producer has the texts but no
// patch (ACP's diff content is `oldText`/`newText`). Line-based Myers, with the common head and
// tail trimmed first; a change too large to diff closely is said as the old lines out and the new
// in. No `import … from "pumi"` here.

/** Lines of context around each change. */
const CONTEXT = 3;
/** Past this many differing lines, the diff stops looking for the shortest edit. */
const MAX_EDIT = 2000;

type Op = { kind: " " | "-" | "+"; line: string };

/** `git diff`'s patch of `path` from `old` (absent: a new file) to `next`; "" when they are the same. */
export function unifiedDiff(path: string, old: string | undefined, next: string): string {
  const a = old === undefined || old === "" ? [] : splitLines(old);
  const b = next === "" ? [] : splitLines(next);
  const ops = diffLines(a, b);
  if (!ops.some((op) => op.kind !== " ")) return "";
  const header = [`diff --git a/${path} b/${path}`, old === undefined ? "--- /dev/null" : `--- a/${path}`, `+++ b/${path}`];
  return `${[...header, ...hunks(ops)].join("\n")}\n`;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The edit from `a` to `b`, line by line. */
export function diffLines(a: string[], b: string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const ops: Op[] = a.slice(0, head).map((line) => ({ kind: " ", line }));
  ops.push(...myers(midA, midB));
  for (const line of a.slice(a.length - tail)) ops.push({ kind: " ", line });
  return ops;
}

/** The shortest edit script (Myers, O((N+M)·D)); the whole of `a` out and `b` in past `MAX_EDIT`. */
function myers(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ kind: "+", line }));
  if (m === 0) return a.map((line) => ({ kind: "-", line }));
  const max = Math.min(n + m, MAX_EDIT);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [...a.map((line): Op => ({ kind: "-", line })), ...b.map((line): Op => ({ kind: "+", line }))];
  // Walk back through the trace, from the end to the start.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ kind: " ", line: a[x]! });
    }
    if (down) {
      y--;
      ops.push({ kind: "+", line: b[y]! });
    } else {
      x--;
      ops.push({ kind: "-", line: a[x]! });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ kind: " ", line: a[x]! });
  }
  return ops.reverse();
}

/** The `@@` hunks of `ops`, `CONTEXT` lines around each change, near ones joined. */
function hunks(ops: Op[]): string[] {
  const changed = ops.map((op, at) => (op.kind === " " ? -1 : at)).filter((at) => at >= 0);
  const out: string[] = [];
  let first = 0;
  while (first < changed.length) {
    let last = first;
    while (last + 1 < changed.length && changed[last + 1]! - changed[last]! <= 2 * CONTEXT + 1) last++;
    const start = Math.max(0, changed[first]! - CONTEXT);
    const end = Math.min(ops.length, changed[last]! + CONTEXT + 1);
    // Line numbers of the hunk's first line, on each side.
    let oldLine = 1;
    let newLine = 1;
    for (const op of ops.slice(0, start)) {
      if (op.kind !== "+") oldLine++;
      if (op.kind !== "-") newLine++;
    }
    const body = ops.slice(start, end);
    const oldCount = body.filter((op) => op.kind !== "+").length;
    const newCount = body.filter((op) => op.kind !== "-").length;
    out.push(`@@ -${oldCount === 0 ? oldLine - 1 : oldLine},${oldCount} +${newCount === 0 ? newLine - 1 : newLine},${newCount} @@`);
    for (const op of body) out.push(`${op.kind}${op.line}`);
    first = last + 1;
  }
  return out;
}
