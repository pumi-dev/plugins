// herdr's event table: the dotted name a subscription asks for and the snake name an envelope
// carries, each found either way round, and what a subscription to it does.
import { expect, test } from "bun:test";
import { EVENTS, byDotted, bySnake, find } from "../src/events.ts";

test("the lifecycle events herdr knows", () => {
  expect(byDotted("tab.created")?.snake).toBe("tab_created");
  expect(byDotted("pane.agent_status_changed")).toEqual({
    dotted: "pane.agent_status_changed",
    snake: "pane_agent_status_changed",
    delivery: "per_pane",
  });
  expect(byDotted("pane.output_changed")?.delivery).toBe("wait_only");
  expect(byDotted("pane.output_changed")?.snake).toBe("pane_output_changed");
});

test("either name finds it", () => {
  expect(find("workspace.created")).toBe(find("workspace_created")!);
  expect(find("layout.updated")?.dotted).toBe("layout.updated");
  expect(find("nothing.at.all")).toBeUndefined();
});

test("every event's two names differ only in the dot", () => {
  for (const event of EVENTS) expect(event.snake).toBe(event.dotted.replaceAll(".", "_"));
  expect(bySnake("workspace_renamed")?.dotted).toBe("workspace.renamed");
});
