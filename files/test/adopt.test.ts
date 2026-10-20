import { expect, test } from "bun:test";

import { adopt } from "../src/adopt.ts";
import type { View } from "../src/main.ts";
import { plainRow, type Row } from "../src/row.ts";

function row(key: string, text = key): Row {
  return { ...plainRow(key), text, actions: ["Rename"] };
}

function view(rows: Row[]): View {
  return { root: "/p", rows, filter: "", filtering: false, selection: null, naming: null, actions: [], version: 0 };
}

test("a tick that found nothing keeps the view", () => {
  const had = view([row("e:a")]);
  expect(adopt(had, null)).toBe(had);
});

test("rows that did not change keep their objects, and the list too", () => {
  const had = view([row("e:a"), row("e:b")]);
  const next = adopt(had, view([row("e:a"), row("e:b")]))!;
  expect(next.rows).toBe(had.rows);
});

test("only the changed row is new", () => {
  const had = view([row("e:a"), row("e:b")]);
  const next = adopt(had, view([row("e:a"), row("e:b", "renamed")]))!;
  expect(next.rows).not.toBe(had.rows);
  expect(next.rows[0]).toBe(had.rows[0]);
  expect(next.rows[1]!.text).toBe("renamed");
});

test("a row put in between keeps the others", () => {
  const had = view([row("e:a"), row("e:c")]);
  const next = adopt(had, view([row("e:a"), row("e:b"), row("e:c")]))!;
  expect(next.rows[0]).toBe(had.rows[0]);
  expect(next.rows[2]).toBe(had.rows[1]);
});
