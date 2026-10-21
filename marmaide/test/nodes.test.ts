// The diagram's nodes, read from the SVG Pele draws: where a click lands, and what it names.
import { expect, test } from "bun:test";
import { at, nodes } from "../src/nodes.ts";
import { draw } from "../src/pele.ts";

const SVG = `<svg viewBox="0 0 342 64"><g class="pele-edges"><g class="pele-edge" data-id="L_ask_draw_0"><path d="M131,32L172,32"/></g></g><g class="pele-nodes"><g class="pele-node pele-shape-rect" data-id="ask" transform="translate(69.58,32)"><rect x="-61.58" y="-24" width="123.17" height="48" fill="#f3f3f3" style="rx:4px"/><text class="pele-label" x="0" y="5.6">the <tspan>question</tspan></text></g><g class="pele-node pele-shape-circle" data-id="end" transform="translate(300,32)"><circle cx="0" cy="0" r="20"/><text>a &amp; b</text></g></g></svg>`;

test("nodes are where Pele drew them", () => {
  const found = nodes(SVG);
  expect(found.length).toBe(2);
  expect([found[0]!.id, found[0]!.label]).toEqual(["ask", "the question"]);
  expect(Math.abs(found[0]!.x - 8)).toBeLessThan(0.01);
  expect(Math.abs(found[0]!.y - 8)).toBeLessThan(0.01);
  expect([found[1]!.label, found[1]!.w]).toEqual(["a & b", 40]);
});

test("a click lands on the smallest node under it, and on no edge", () => {
  const found = nodes(SVG);
  expect(at(found, 70, 30)).toBe(0);
  expect(at(found, 300, 40)).toBe(1);
  expect(at(found, 160, 32)).toBeNull();
});

test("a real diagram has its nodes, with their shapes", () => {
  const drawn = draw("flowchart LR\n  ask[the question] --> draw{marmaide}");
  const found = nodes(drawn.svg).map((node) => node.id);
  expect(found).toContain("ask");
  expect(found).toContain("draw");
  const ask = nodes(drawn.svg).find((node) => node.id === "ask")!;
  expect(ask.label).toBe("the question");
  expect(ask.w).toBeGreaterThan(40);
  expect(ask.h).toBeGreaterThan(20);
});
