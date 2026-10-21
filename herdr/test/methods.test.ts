// herdr's method table: what is answered, what is `unsupported` (and why), and the long ones.
import { expect, test } from "bun:test";
import { METHODS, PUMI_METHODS, find } from "../src/methods.ts";

test("the methods herdr's clients use are answered", () => {
  for (const name of ["ping", "session.snapshot", "workspace.list", "tab.list", "pane.read", "pane.send_keys", "agent.list", "notification.show"]) {
    expect(find(name)?.support).toEqual({ kind: "served" });
  }
  expect(find("events.subscribe")?.shape).toBe("long");
  expect(find("agent.wait")?.shape).toBe("long");
});

test("herdr's TUI, plugins and remotes say why they are not pumi's", () => {
  expect(find("plugin.list")?.support).toEqual({ kind: "unsupported", why: "herdr plugins are not part of pumi" });
  expect(find("server.ssh_agent.register")?.support).toEqual({ kind: "unsupported", why: "herdr remotes are not part of pumi" });
  expect(find("popup.close")?.support).toEqual({ kind: "unsupported", why: "pumi has no herdr TUI" });
  expect(find("pane.copy_motion")?.support).toEqual({ kind: "unsupported", why: "herdr's copy mode belongs to its TUI" });
});

test("a method herdr has and pumi does not is nothing at all", () => {
  expect(find("no.such.method")).toBeUndefined();
});

test("pumi's own methods are in their own namespace", () => {
  const names = METHODS.map((method) => method.name);
  expect(names).toHaveLength(new Set(names).size);
  for (const method of PUMI_METHODS) expect(method.name.startsWith("pumi.")).toBe(true);
  expect(find("pumi.state")?.support).toEqual({ kind: "served" });
  expect(METHODS.some((method) => method.name.startsWith("pumi."))).toBe(false);
});
