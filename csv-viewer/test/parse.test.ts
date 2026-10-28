// The parsing, with no app running: what a file's text becomes, and what the table says of it.
import { describe, expect, test } from "bun:test";

import { buildTable, compareCells, isNumeric, looksLikeHeader, matchesRow, numberOf, records, sniffDelimiter } from "../src/parse.ts";

describe("records", () => {
  test("splits on the separator, and drops blank lines", () => {
    expect(records("a,b\n1,2\n\n3,4\n", ",").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  test("keeps separators, quotes and line breaks inside quotes", () => {
    const text = 'id,note\n1,"a, b"\n2,"he said ""hi"""\n3,"two\nlines"\n';
    expect(records(text, ",").rows).toEqual([
      ["id", "note"],
      ["1", "a, b"],
      ["2", 'he said "hi"'],
      ["3", "two\nlines"],
    ]);
  });

  test("takes a quote in the middle of a field as one, not as an opening", () => {
    expect(records('size\n5" pipe\n', ",").rows).toEqual([["size"], ['5" pipe']]);
  });

  test("reads a CRLF file, and an empty trailing field", () => {
    expect(records("a,b\r\n1,\r\n", ",").rows).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });

  test("counts every record but keeps only maxRows of them", () => {
    const text = Array.from({ length: 10 }, (_, i) => `${i}`).join("\n");
    const parsed = records(text, ",");
    expect(parsed.total).toBe(10);
    const kept = records(text, ",", { maxRows: 3 });
    expect(kept.rows.length).toBe(3);
    expect(kept.total).toBe(10);
    expect(kept.dropped).toBe(7);
  });

  test("cuts a row wider than maxColumns, and says it did", () => {
    const parsed = records("1,2,3,4", ",", { maxColumns: 2 });
    expect(parsed.rows).toEqual([["1", "2"]]);
    expect(parsed.ragged).toBe(1);
  });
});

describe("sniffDelimiter", () => {
  test("finds the separator a file actually uses", () => {
    expect(sniffDelimiter("name;price\napple;1.5\npear;2\n")).toBe("semicolon");
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("tab");
    expect(sniffDelimiter("a|b\n1|2\n")).toBe("pipe");
    expect(sniffDelimiter("a,b\n1,2\n")).toBe("comma");
  });

  test("a separator inside quoted text does not win", () => {
    const text = 'a,b\n1,"one; two; three; four"\n2,"five; six; seven; eight"\n';
    expect(sniffDelimiter(text)).toBe("comma");
  });

  test("the extension wins a tie", () => {
    // One row, one field: nothing separates them at all.
    expect(sniffDelimiter("only one field\n", "tab")).toBe("tab");
  });

  test("a single column of names is commas when nothing else is there", () => {
    expect(sniffDelimiter("hello\nworld\n")).toBe("comma");
  });
});

describe("isNumeric and numberOf", () => {
  test("reads the shapes a table counts", () => {
    for (const value of ["42", "-3.5", "1,234.50", "12%", "$9.99", "1e6", " 7 "]) expect(isNumeric(value)).toBe(true);
    for (const value of ["", "abc", "12abc", "1.2.3", "N/A"]) expect(isNumeric(value)).toBe(false);
  });

  test("gives the number a cell means, separators and signs and all", () => {
    expect(numberOf("1,234.50")).toBe(1234.5);
    expect(numberOf("$9.99")).toBe(9.99);
    expect(numberOf("12%")).toBe(12);
    expect(numberOf("abc")).toBe(null);
  });
});

describe("looksLikeHeader", () => {
  test("names over numbers are names", () => {
    expect(looksLikeHeader([["name", "price"], ["apple", "1.5"], ["pear", "2"]])).toBe(true);
  });

  test("a first row of numbers is data", () => {
    expect(looksLikeHeader([["1", "2"], ["3", "4"]])).toBe(false);
  });

  test("a repeated or blank name is not a header", () => {
    expect(looksLikeHeader([["a", "a"], ["1", "2"]])).toBe(false);
    expect(looksLikeHeader([["a", ""], ["1", "2"]])).toBe(false);
  });

  test("a file of plain words is taken to have names, and a single row too", () => {
    expect(looksLikeHeader([["city", "country"], ["Paris", "France"]])).toBe(true);
    expect(looksLikeHeader([["city", "country"]])).toBe(true);
  });
});

describe("compareCells", () => {
  test("numbers sort as numbers in a number column", () => {
    const sorted = ["10", "9", "100"].sort((a, b) => compareCells(a, b, "number"));
    expect(sorted).toEqual(["9", "10", "100"]);
  });

  test("text sorts as text, but reads 2 before 10", () => {
    const sorted = ["item 10", "item 2"].sort((a, b) => compareCells(a, b, "text"));
    expect(sorted).toEqual(["item 2", "item 10"]);
  });

  test("a number that is not one falls back to text", () => {
    expect(compareCells("n/a", "2", "number")).not.toBe(0);
  });

  test("empty cells come first", () => {
    expect(compareCells("", "1", "text")).toBeLessThan(0);
    expect(compareCells("1", "", "text")).toBeGreaterThan(0);
  });
});

describe("matchesRow", () => {
  test("every word must be somewhere in the row, in any cell", () => {
    const row = ["Ada Lovelace", "1815", "London"];
    expect(matchesRow(row, "ada london")).toBe(true);
    expect(matchesRow(row, "ada paris")).toBe(false);
    expect(matchesRow(row, "ADA")).toBe(true);
    expect(matchesRow(row, "")).toBe(true);
  });
});

describe("buildTable", () => {
  const text = "id,name,price\n1,apple,1.5\n2,pear,2.25\n";

  test("takes the first record as names, and counts the rows under it", () => {
    const table = buildTable(text, "/tmp/fruit.csv");
    expect(table.headers).toEqual(["id", "name", "price"]);
    expect(table.rows.length).toBe(2);
    expect(table.hasHeader).toBe(true);
    expect(table.firstRow).toBe(2);
    expect(table.records).toBe(3);
    expect(table.leftOut).toBe(0);
    expect(table.columns).toBe(3);
  });

  test("reads a column of numbers as numbers", () => {
    const table = buildTable(text, "/tmp/fruit.csv");
    expect(table.kinds).toEqual(["number", "text", "number"]);
  });

  test("names the columns of a file with no header", () => {
    const table = buildTable("1,apple\n2,pear\n", "/tmp/fruit.csv", { header: "none" });
    expect(table.headers).toEqual(["Column 1", "Column 2"]);
    expect(table.rows.length).toBe(2);
    expect(table.firstRow).toBe(1);
  });

  test("pads a short record, and says some were not the same width", () => {
    const table = buildTable("a,b,c\n1,2\n3,4,5\n", "/tmp/x.csv");
    expect(table.rows).toEqual([
      ["1", "2", ""],
      ["3", "4", "5"],
    ]);
    expect(table.ragged).toBe(1);
  });

  test("a row limit leaves the rest counted, and says how many", () => {
    const many = ["n", ...Array.from({ length: 20 }, (_, i) => String(i))].join("\n");
    const table = buildTable(many, "/tmp/x.csv", { maxRows: 5 });
    expect(table.rows.length).toBe(5);
    expect(table.leftOut).toBe(15);
    expect(table.records).toBe(21);
  });

  test("the extension picks the separator when the option is auto", () => {
    expect(buildTable("a\tb\n1\t2\n", "/tmp/x.tsv").delimiter).toBe("\t");
    expect(buildTable("a\tb\n1\t2\n", "/tmp/x.csv").delimiter).toBe("\t");
    expect(buildTable("a\tb\n1\t2\n", "/tmp/x.csv", { delimiter: "comma" }).delimiter).toBe(",");
  });

  test("an empty file is a table with no columns", () => {
    const table = buildTable("", "/tmp/empty.csv");
    expect(table.columns).toBe(0);
    expect(table.rows).toEqual([]);
  });
});
