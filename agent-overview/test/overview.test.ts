// The model: which panes are agents, what each is doing, where it is, and the order they sort in.
import { expect, test } from "bun:test";

import { folder, place, statusOf, stripTitle, tilde, Overview } from "../src/overview.ts";
import { state } from "./window.ts";

/** The model the fixture describes, as the view reads it. */
function overview(): Overview {
  return Overview.fromState(state());
}

const panes = (agents: { pane: number }[]) => agents.map((agent) => agent.pane);

test("only panes in tabs are agents", () => {
  const all = overview();
  expect(panes(all.agents)).toEqual([100, 101, 200]);
  expect(all.currentPane).toBe(100);
});

test("what wants the user comes first", () => {
  const all = overview();
  expect(all.agents.map((agent) => agent.status)).toEqual(["blocked", "error", "idle"]);
  expect(all.needsYou()).toBe(2);
  expect(all.sessions()).toBe(2);
  expect(all.count("idle")).toBe(1);
});

test("a blocked agent says what it waits for", () => {
  const claude = overview().agents[0]!;
  expect(claude.kind).toBe("claude");
  expect(claude.why).toBe("needs permission");
  expect(claude.message).toBe("Bash(rm -rf build)?");
  expect(place(claude)).toBe("main › agents");
  expect(folder(claude)).toBe("pumi");
  expect(claude.title).toBe("claude");
  expect(claude.here).toBe(true);
  expect(claude.conversation).toBe("conv-1");
});

test("a done whose record failed is a failure", () => {
  const built = overview().agents[1]!;
  expect(built.status).toBe("error");
  expect(built.why).toBe("failed");
  expect(built.kind).toBe("make");
  expect(built.sessionName).toBe("main");
  expect(built.here).toBe(false);
});

test("filters and a query narrow the list", () => {
  const all = overview();
  const ids = (filter: Parameters<Overview["visible"]>[0], query: string) => panes(all.visible(filter, query));
  expect(ids("needs-you", "")).toEqual([100, 101]);
  expect(ids("idle", "")).toEqual([200]);
  expect(ids("working", "")).toEqual([]);
  expect(ids("all", "claude")).toEqual([100]);
  expect(ids("all", "pumi claude")).toEqual([100]);
  expect(ids("all", "review")).toEqual([200]);

  const groups = all.groups("all", "");
  expect(groups.map((group) => group.name)).toEqual(["main", "work"]);
  expect(groups.map((group) => group.agents.length)).toEqual([2, 1]);
});

test("a search finds an agent by its conversation and its title", () => {
  const all = overview();
  expect(panes(all.visible("all", "conv-1"))).toEqual([100]);
  expect(panes(all.visible("all", "π"))).toEqual([200]);
});

test("a record's state fills in what the option did not say", () => {
  expect(statusOf("", [{ id: "", state: "working" }])).toEqual({ status: "working", why: "" });
  expect(statusOf("", [{ id: "ask", state: "blocked", kind: "question" }])).toEqual({
    status: "blocked",
    why: "has a question",
  });
  expect(statusOf("", [{ id: "", state: "blocked", kind: "auth" }])).toEqual({ status: "blocked", why: "needs a login" });
  expect(statusOf("blocked", [])).toEqual({ status: "blocked", why: "waiting on you" });
  expect(statusOf("", undefined)).toEqual({ status: "unknown", why: "" });
});

test("a title loses the spinner a shell puts in front of it", () => {
  expect(stripTitle("⠋ π - pumi")).toBe("π - pumi");
  expect(stripTitle("  claude ")).toBe("claude");
  expect(stripTitle("~/src/pumi")).toBe("~/src/pumi");
});

test("a directory under the home directory is written with a tilde", () => {
  const home = process.env.HOME ?? "";
  expect(tilde(`${home}/Kitchen/pumi`)).toBe("~/Kitchen/pumi");
  expect(tilde("/elsewhere/x")).toBe("/elsewhere/x");
});
