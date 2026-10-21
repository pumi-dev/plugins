// Where a diagram's nodes are: read from the SVG Pele draws (`<g class="pele-node …"
// data-id="ask" transform="translate(x,y)">` around a shape and its label), in the diagram's own
// points, so a click on the picture can say which node it was.

/** One node Pele drew. */
export interface Node {
  /** Its Mermaid id (`ask`). */
  id: string;
  /** What it says. */
  label: string;
  /** Its box, from the diagram's top left corner, in the diagram's points. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const MARK = '<g class="pele-node';

/** Every node Pele drew, in the order it drew them. */
export function nodes(svg: string): Node[] {
  const starts: number[] = [];
  for (let at = svg.indexOf(MARK); at !== -1; at = svg.indexOf(MARK, at + 1)) starts.push(at);
  const out: Node[] = [];
  starts.forEach((start, i) => {
    const tagEnd = svg.indexOf(">", start);
    if (tagEnd === -1) return;
    const tag = svg.slice(start, tagEnd);
    const id = attr(tag, "data-id");
    if (id === undefined) return;
    const body = svg.slice(tagEnd, starts[i + 1] ?? svg.length);
    const [tx, ty] = translate(tag);
    const [x, y, w, h] = shape(body) ?? [-20, -12, 40, 24];
    out.push({ id: unescape(id), label: label(body), x: tx + x, y: ty + y, w, h });
  });
  return out;
}

/** The node at a point of the diagram: the smallest whose box holds it. */
export function at(nodes: Node[], x: number, y: number): number | null {
  let found: number | null = null;
  nodes.forEach((node, i) => {
    if (!contains(node, x, y)) return;
    const best = found === null ? null : nodes[found]!;
    if (best === null || node.w * node.h < best.w * best.h) found = i;
  });
  return found;
}

function contains(node: Node, x: number, y: number): boolean {
  return x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h;
}

/** The value of `name` in a start tag. */
function attr(tag: string, name: string): string | undefined {
  const key = ` ${name}="`;
  const at = tag.indexOf(key);
  if (at === -1) return undefined;
  const from = at + key.length;
  const to = tag.indexOf('"', from);
  return to === -1 ? undefined : tag.slice(from, to);
}

function num(tag: string, name: string): number | undefined {
  const value = attr(tag, name)?.replace(/px$/, "").trim();
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The `translate(x,y)` a node's group is drawn at. */
function translate(tag: string): [number, number] {
  const transform = attr(tag, "transform");
  const inner = transform?.startsWith("translate(") ? transform.slice("translate(".length).split(")")[0]! : undefined;
  if (inner === undefined) return [0, 0];
  const parts = inner
    .split(/[,\s]+/)
    .filter((part) => part !== "")
    .map((part) => Number(part));
  return [parts[0] ?? 0, parts[1] ?? 0];
}

function unescape(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** What every `<text>` of a node says, its tags dropped. */
function label(body: string): string {
  const said: string[] = [];
  let rest = body;
  for (;;) {
    const start = rest.indexOf("<text");
    if (start === -1) break;
    const open = rest.indexOf(">", start);
    if (open === -1) break;
    const close = rest.indexOf("</text>", open);
    if (close === -1) break;
    const inner = rest.slice(open + 1, close);
    let plain = "";
    let inTag = false;
    for (const c of inner) {
      if (c === "<") inTag = true;
      else if (c === ">") inTag = false;
      else if (!inTag) plain += c;
    }
    const text = unescape(plain.trim());
    if (text !== "") said.push(text);
    rest = rest.slice(close);
  }
  return said.join(" ");
}

/** The box of the first shape a node is drawn as, around the node's own origin. */
function shape(body: string): [number, number, number, number] | undefined {
  let first: [number, string] | undefined;
  for (const tag of ["<rect ", "<circle ", "<ellipse ", "<polygon ", "<path "]) {
    const at = body.indexOf(tag);
    if (at === -1) continue;
    if (first === undefined || at < first[0]) first = [at, tag];
  }
  if (first === undefined) return undefined;
  const [start, kind] = first;
  const end = body.indexOf(">", start);
  if (end === -1) return undefined;
  const tag = body.slice(start, end);
  switch (kind) {
    case "<rect ": {
      const [x, y, w, h] = [num(tag, "x") ?? 0, num(tag, "y") ?? 0, num(tag, "width"), num(tag, "height")];
      return w === undefined || h === undefined ? undefined : [x, y, w, h];
    }
    case "<circle ": {
      const r = num(tag, "r");
      return r === undefined ? undefined : [(num(tag, "cx") ?? 0) - r, (num(tag, "cy") ?? 0) - r, r * 2, r * 2];
    }
    case "<ellipse ": {
      const [rx, ry] = [num(tag, "rx"), num(tag, "ry")];
      if (rx === undefined || ry === undefined) return undefined;
      return [(num(tag, "cx") ?? 0) - rx, (num(tag, "cy") ?? 0) - ry, rx * 2, ry * 2];
    }
    case "<polygon ": {
      const points = (attr(tag, "points") ?? "")
        .split(/[,\s]+/)
        .filter((part) => part !== "")
        .map((part) => Number(part))
        .filter((value) => Number.isFinite(value));
      const xs = points.filter((_value, i) => i % 2 === 0);
      const ys = points.filter((_value, i) => i % 2 === 1);
      if (xs.length === 0 || ys.length === 0) return undefined;
      const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
      const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
      return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : undefined;
    }
    default:
      // A diamond's or a subroutine's outline is a path: its box is not worth guessing at, and a
      // node with no box of its own is the label's size.
      return undefined;
  }
}
