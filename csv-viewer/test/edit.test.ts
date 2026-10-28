// Editing and writing back, with no app running: what an edit does to the table, what undoes it,
// and the text a file is saved as.
import { describe, expect, test } from "bun:test";

import { apply, deleteColumn, deleteRows, insertColumn, insertRows, inverse, renameColumn, setCells, sheetOf, wire, type Op, type Sheet } from "../src/edit.ts";
import { buildTable } from "../src/parse.ts";
import { eolOf, field, line, rewrite } from "../src/write.ts";

const sheet = (): Sheet =>
  sheetOf(
    ["id", "name"],
    [
      ["1", "a"],
      ["2", "b"],
      ["3", "c"],
    ],
    ["number", "text"],
    true,
  );

/** Each edit, then its inverse, gives back the sheet it started from. */
function roundTrip(start: Sheet, op: Op | null): Sheet {
  expect(op).not.toBeNull();
  const after = apply(start, op!);
  expect(apply(after, inverse(op!))).toEqual(start);
  return after;
}

describe("edits", () => {
  test("set changes the cells it names, and only when they change", () => {
    const s = sheet();
    expect(setCells(s, [{ row: 0, column: 1, value: "a" }])).toBeNull();
    const after = roundTrip(s, setCells(s, [{ row: 1, column: 1, value: "B" }]));
    expect(after.rows[1]).toEqual(["2", "B"]);
    // The sheet given is left as it was.
    expect(s.rows[1]).toEqual(["2", "b"]);
  });

  test("rows go in where they are asked, and come out by their places", () => {
    const s = sheet();
    const added = roundTrip(s, insertRows(s, 1, 2));
    expect(added.rows.map((row) => row[0])).toEqual(["1", "", "", "2", "3"]);
    const gone = roundTrip(s, deleteRows(s, [2, 0]));
    expect(gone.rows).toEqual([["2", "b"]]);
  });

  test("a column goes in with a free name and keeps the others' ids", () => {
    const s = sheet();
    const after = roundTrip(s, insertColumn(s, 1));
    expect(after.headers).toEqual(["id", "Column 3", "name"]);
    expect(after.keys).toEqual([0, 2, 1]);
    expect(after.rows[0]).toEqual(["1", "", "a"]);
    const gone = roundTrip(after, deleteColumn(after, 0));
    expect(gone.headers).toEqual(["Column 3", "name"]);
    expect(deleteColumn(sheetOf(["x"], [["1"]], ["text"], true), 0)).toBeNull();
  });

  test("a file without names makes them again when a column comes", () => {
    const s = sheetOf(["Column 1", "Column 2"], [["a", "b"]], ["text", "text"], false);
    expect(apply(s, insertColumn(s, 0)).headers).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(renameColumn(s, 0, "x")).toBeNull();
  });

  test("what the worker is sent leaves out what only an undo needs", () => {
    const s = sheet();
    expect(wire(deleteRows(s, [1])!)).toEqual({ kind: "deleteRows", at: [1] });
    expect(wire(insertColumn(s, 0))).toEqual({ kind: "insertColumn", at: 0, name: "Column 3" });
  });
});

describe("writing", () => {
  test("quotes a value only when it has to", () => {
    expect(field("plain", ",")).toBe("plain");
    expect(field("a, b", ",")).toBe('"a, b"');
    expect(field('5" pipe', ",")).toBe('"5"" pipe"');
    expect(field("two\nlines", "\t")).toBe('"two\nlines"');
    expect(line([""], ",")).toBe('""');
    expect(eolOf("a\r\nb")).toBe("\r\n");
    expect(eolOf("a")).toBe("\n");
  });

  const opts = { delimiter: ",", hasHeader: true };

  test("one cell edited changes one line, and leaves the others' quotes alone", () => {
    const text = 'id,note\n1,"quoted"\n2,"a, b"\n\n3,x\n';
    const out = rewrite(text, [{ kind: "set", cells: [{ row: 2, column: 1, value: "y, z" }] }], opts);
    expect(out).toBe('id,note\n1,"quoted"\n2,"a, b"\n\n3,"y, z"\n');
  });

  test("keeps CRLF, and no newline at the end when the file had none", () => {
    const text = "a,b\r\n1,2\r\n3,4";
    expect(rewrite(text, [{ kind: "insertRows", at: [2], rows: [["5", "6"]] }], opts)).toBe("a,b\r\n1,2\r\n3,4\r\n5,6");
    expect(rewrite(text, [{ kind: "deleteRows", at: [1] }], opts)).toBe("a,b\r\n1,2");
  });

  test("renames, and puts in and takes out columns in every record, the header too", () => {
    const text = "a,b\n1,2\n3\n";
    expect(rewrite(text, [{ kind: "rename", column: 0, name: "A" }], opts)).toBe("A,b\n1,2\n3\n");
    expect(rewrite(text, [{ kind: "insertColumn", at: 1, name: "c" }], opts)).toBe("a,c,b\n1,,2\n3,\n");
    expect(rewrite(text, [{ kind: "deleteColumn", at: 1 }], opts)).toBe("a\n1\n3\n");
  });

  test("a short record is padded only as far as a cell set in it", () => {
    expect(rewrite("a,b,c\n1\n", [{ kind: "set", cells: [{ row: 0, column: 1, value: "x" }] }], opts)).toBe("a,b,c\n1,x\n");
  });

  test("rows past the table's limit are kept, and get a column put in", () => {
    const text = "n,v\n1,a\n2,b\n3,c\n";
    const table = buildTable(text, "x.csv", { maxRows: 1 });
    expect(table.rows.length).toBe(1);
    expect(rewrite(text, [{ kind: "insertColumn", at: 0, name: "k" }, { kind: "set", cells: [{ row: 0, column: 0, value: "first" }] }], opts)).toBe("k,n,v\nfirst,1,a\n,2,b\n,3,c\n");
  });

  test("columns past the table's 256 are kept", () => {
    const wide = Array.from({ length: 300 }, (_, i) => `c${i}`).join(",");
    const text = `${wide}\n${wide}\n`;
    const out = rewrite(text, [{ kind: "set", cells: [{ row: 0, column: 0, value: "x" }] }], opts);
    expect(out.split("\n")[1]!.split(",").length).toBe(300);
    expect(out.split("\n")[1]!.startsWith("x,c1,")).toBe(true);
  });

  test("a file without a header counts its rows from the first record", () => {
    expect(rewrite("1,2\n3,4\n", [{ kind: "set", cells: [{ row: 0, column: 0, value: "9" }] }], { delimiter: ",", hasHeader: false })).toBe("9,2\n3,4\n");
    expect(() => rewrite("1,2\n", [{ kind: "rename", column: 0, name: "x" }], { delimiter: ",", hasHeader: false })).toThrow();
  });

  test("an edit naming a row that is not there is refused", () => {
    expect(() => rewrite("a\n1\n", [{ kind: "set", cells: [{ row: 5, column: 0, value: "x" }] }], opts)).toThrow();
    expect(() => rewrite("a\n1\n", [{ kind: "deleteRows", at: [3] }], opts)).toThrow();
  });

  test("tabs are written as tabs", () => {
    expect(rewrite("a\tb\n1\t2\n", [{ kind: "set", cells: [{ row: 0, column: 1, value: "x y" }] }], { delimiter: "\t", hasHeader: true })).toBe("a\tb\n1\tx y\n");
  });
});
