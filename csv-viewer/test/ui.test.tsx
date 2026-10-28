// The table drawn in the native test renderer, with the app and the worker stood in for: what a
// press, a key and a menu do to what is picked, edited and saved. Skipped where the renderer is
// not built (`PUMI_ADDON` names it).
import { describe, expect, mock, test } from "bun:test";

// One React for the plugin's code and the renderer: the renderer's.
const React = await import("../../../runtime/app/node_modules/react/index.js");
mock.module("react", () => React);

const { buildTable } = await import("../src/parse.ts");
const { rewrite } = await import("../src/write.ts");

const TOKENS = {
  window: "#26282b",
  surface: "#26282b",
  editor: "#1e1f22",
  text: "#dfe1e5",
  muted: "#b0b1b3",
  faint: "#888a8f",
  border: "#393b41",
  hover: "#3c3e41",
  active: "#494a4d",
  selected: "#4a4d54",
  accent: "#3474f0",
  accentText: "#ffffff",
  warning: "#f0c674",
  error: "#cc6666",
  success: "#a6e3a1",
  overlay: "#26282bf2",
};
const OPTIONS: Record<string, unknown> = { numbers: true, striped: true, watch_file: true, header: "auto", delimiter: "auto", max_rows: 100000, columns: "natural" };

/** What the stand-ins saw: the clipboard, and each save. */
const seen = { clipboard: "", saves: [] as any[] };
let file = "";
let mtime = 1;

mock.module("pumi", () => ({
  useTheme: () => TOKENS,
  useMetrics: () => ({ radius: 6, radiusSmall: 4, fontSize: 13 }),
  Icon: () => null,
  IconButton: ({ title, onClick }: { title?: string; onClick(): void }) => React.createElement("div", { "aria-label": title, onClick, style: { width: 16, height: 16 } }),
  call: async (name: string, value: string) => {
    if (name === "clipboard.set") seen.clipboard = value;
    return null;
  },
  keyGlyphs: (keys: string) => keys,
  useChannelListener: () => {},
  useOption: (name: string) => [OPTIONS[name.slice(name.lastIndexOf(".") + 1)], () => {}],
  usePlugin: () => "pumi_dev/csv-viewer",
  useTab: () => ({ options: { path: "/tmp/fruit.csv" } }),
}));

mock.module("../src/main.ts", () => ({
  read: async (path: string, as: { header?: string; delimiter?: string } | null) => {
    const table = buildTable(file, path, { header: (as?.header as any) ?? "auto", delimiter: (as?.delimiter as any) ?? "auto", maxColumns: 256 });
    return { ...table, path, bytes: file.length, mtime, notes: [], writable: true };
  },
  save: async (request: any) => {
    seen.saves.push(request);
    file = rewrite(file, request.ops, request);
    mtime++;
    return { ok: true, mtime, bytes: file.length };
  },
  watch: async () => null,
  unwatch: async () => null,
  reload: async () => null,
  note: async () => null,
}));

const { createTestRoot, hasNativeTestRenderer } = await import("../../../runtime/app/react/testing.ts");
const { Table } = await import("../src/ui.tsx");

const gpu = hasNativeTestRenderer ? describe : describe.skip;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/** The table drawn over a file, once it has been read. */
async function drawn(text: string) {
  file = text;
  seen.clipboard = "";
  seen.saves = [];
  const t = createTestRoot({ width: 900, height: 400 });
  t.render(React.createElement(Table, { tab: { id: "%1" } as any, block: "file", focused: true }));
  for (let i = 0; i < 5; i++) {
    await tick();
    t.renderer.flush();
  }
  // The grid's size comes back as an event, which goes out with the next one: a move off the cells.
  t.renderer.nativeSimulateMouseMove(1, 1);
  await settle(t);
  return t;
}

type Root = Awaited<ReturnType<typeof drawn>>;

/** The middle of the element that says `text`. */
function at(t: Root, text: string): { x: number; y: number } {
  const el = t.renderer.findByText(text);
  if (!el) throw new Error(`nothing says ${text}: ${t.renderer.getAllText().join(" | ")}`);
  const box = t.renderer.getElementBounds(el.id)!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function press(t: Root, text: string, button = 0, modifiers?: string) {
  const { x, y } = at(t, text);
  t.renderer.nativeSimulateMouseDown(x, y, button, modifiers);
  t.renderer.nativeSimulateMouseUp(x, y, button, modifiers);
  await settle(t);
}

/** A click on what says `text`: a menu's item, a button. */
async function click(t: Root, text: string) {
  const { x, y } = at(t, text);
  t.renderer.nativeSimulateClick(x, y, 0);
  await settle(t);
}

async function keys(t: Root, strokes: string) {
  t.renderer.simulateKeystrokes(strokes);
  await settle(t);
}

async function settle(t: Root) {
  for (let i = 0; i < 3; i++) {
    await tick();
    t.renderer.flush();
  }
}

const FRUIT = 'id,name,price\n1,apple,1.20\n2,banana,0.50\n3,cherry,4.00\n';

gpu("the table", () => {
  test("a press picks a cell, ⌘C copies it, and the arrows move and grow the pick", async () => {
    const t = await drawn(FRUIT);
    expect(t.renderer.getAllText()).toContain("banana");
    await press(t, "banana");
    await keys(t, "cmd-c");
    expect(seen.clipboard).toBe("banana");
    await keys(t, "down shift-right");
    expect(t.renderer.getAllText()).toContain("1 × 2 cells");
    await keys(t, "cmd-c");
    expect(seen.clipboard).toBe("cherry\t4.00");
    t.renderer.captureScreenshot("/tmp/csvtest/picked.png");
    t.unmount();
  });

  test("a drag picks a block, and a press alone picks one cell", async () => {
    const t = await drawn(FRUIT);
    await press(t, "banana");
    expect(t.renderer.getAllText()).toContain("banana");
    expect(t.renderer.getAllText().join(" ")).not.toContain("cells");
    const from = at(t, "apple");
    const to = at(t, "0.50");
    t.renderer.nativeSimulateMouseDown(from.x, from.y, 0);
    await settle(t);
    t.renderer.nativeSimulateMouseMove((from.x + to.x) / 2, to.y, 0);
    await settle(t);
    t.renderer.nativeSimulateMouseMove(to.x, to.y, 0);
    t.renderer.nativeSimulateMouseUp(to.x, to.y, 0);
    await settle(t);
    expect(t.renderer.getAllText()).toContain("2 × 2 cells");
    await keys(t, "cmd-c");
    expect(seen.clipboard).toBe("apple\t1.20\nbanana\t0.50");
    // Moving afterwards, with no button held, leaves the block as it is.
    const off = at(t, "cherry");
    t.renderer.nativeSimulateMouseMove(off.x, off.y);
    await keys(t, "cmd-c");
    expect(seen.clipboard).toBe("apple\t1.20\nbanana\t0.50");
    t.renderer.captureScreenshot("/tmp/csvtest/dragged.png");
    t.unmount();
  });

  test("Enter edits in place, Enter again keeps it and goes down, and ⌘S writes the file", async () => {
    const t = await drawn(FRUIT);
    await press(t, "apple");
    await keys(t, "enter");
    expect(t.renderer.findByType("input").length).toBeGreaterThan(1);
    t.renderer.captureScreenshot("/tmp/csvtest/editing.png");
    await keys(t, "s");
    await keys(t, "enter");
    expect(t.renderer.getAllText()).toContain("apples");
    expect(t.renderer.getAllText()).toContain("1 unsaved edit");
    // The keys came back to the table: ⌘C copies the cell below, where the focus went.
    await keys(t, "cmd-c");
    expect(seen.clipboard).toBe("banana");
    await keys(t, "cmd-s");
    expect(seen.saves.length).toBe(1);
    expect(file).toBe("id,name,price\n1,apples,1.20\n2,banana,0.50\n3,cherry,4.00\n");
    expect(t.renderer.getAllText()).not.toContain("1 unsaved edit");
    t.unmount();
  });

  test("Escape throws an edit away, and ⌘Z and ⌘⇧Z undo and redo", async () => {
    const t = await drawn(FRUIT);
    await press(t, "cherry");
    await keys(t, "enter");
    await keys(t, "x");
    await keys(t, "escape");
    expect(t.renderer.getAllText()).toContain("cherry");
    await keys(t, "backspace");
    expect(t.renderer.getAllText()).not.toContain("cherry");
    await keys(t, "cmd-z");
    expect(t.renderer.getAllText()).toContain("cherry");
    await keys(t, "cmd-shift-z");
    expect(t.renderer.getAllText()).not.toContain("cherry");
    t.unmount();
  });

  test("the right button's menu puts rows and columns in and takes them out", async () => {
    const t = await drawn(FRUIT);
    await press(t, "banana", 2);
    t.renderer.captureScreenshot("/tmp/csvtest/menu.png");
    expect(t.renderer.getAllText()).toContain("Insert row below");
    await click(t, "Delete row");
    expect(t.renderer.getAllText()).not.toContain("banana");
    await press(t, "apple", 2);
    await click(t, "Insert column right");
    // A new column is named as it comes: its name is a field.
    await keys(t, "cmd-a");
    await keys(t, "c o l o r enter");
    await keys(t, "cmd-s");
    expect(file).toBe("id,name,color,price\n1,apple,,1.20\n3,cherry,,4.00\n");
    t.unmount();
  });
});
