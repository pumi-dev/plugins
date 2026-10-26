// agents: the sidebar page that says what every space, tab and agent is doing, and a click to go
// there — plus the guide and the restore recipes an agent is told.
//
//   cmd+shift+a                                   the app's sidebar, where the page is
//   pumi call amresyd.agents.context '{"agent":"claude","pane":3,"event":"prompt"}'
//   pumi call amresyd.agents.restore '{"agent":"claude","session":"abc-123"}'
//
// The page is drawn by `ui.tsx` (the manifest's `contributes.slots.panel`), its rows `tree.ts`'s
// and its state `status.ts`'s. What is here is the logic: the model, read from the API when an agent
// asks (`readState`) for the guide and the recipes, and the two functions another package, a script
// or a hook calls. The guide is `context/guide.md`, the same text `pumi skill show` prints.
import { call, fn, option, self } from "pumi";

import { compose, map, onFor, settings, type When } from "./context.ts";
import { line } from "./restore.ts";
import { num } from "./ids.ts";
import { read, type Given, type PaneGiven, type Snapshot, type TabGiven } from "./snapshot.ts";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The model as the API answers it: every session, its tabs, and every pane with the options that
 * say what it is. `pane.list` is every pane, in layout order within a tab.
 */
async function readState(): Promise<Snapshot> {
  const listed: string[] = await call("session.list");
  const now = await call("session.get", null);
  const sessions = await Promise.all(listed.map((id) => call("session.get", id)));

  /** Which session a tab is in. */
  const owner = new Map<string, string>();
  const tabs: TabGiven[] = [];
  for (const each of sessions) {
    for (const [index, id] of each.tabs.entries()) {
      owner.set(id, each.id);
      const info = await call("tab.get", id);
      tabs.push({ id: num(id), space: num(each.id), index, label: info.name ?? "", focused: id === now.activeTab });
    }
  }

  const ids: string[] = await call("pane.list", {});
  const panes: PaneGiven[] = await Promise.all(
    ids.map(async (id) => {
      const info = await call("pane.get", id);
      const options = (info.options ?? {}) as Record<string, unknown>;
      const at = info.tab;
      return {
        id: num(id),
        block: info.block,
        tab: at === null ? null : num(at),
        space: at === null ? null : num(owner.get(at) ?? ""),
        title: text(options["title"]),
        cwd: text(options["pane_current_path"]),
        label: text(options["@label"]),
        options,
        focused: id === now.activeTab,
      };
    }),
  );

  const given: Given = {
    spaces: sessions.map((each) => ({
      id: num(each.id),
      label: each.name,
      current: each.activeTab === null ? null : num(each.activeTab),
      focused: each.id === now.id,
    })),
    tabs,
    panes,
  };
  return read(given);
}

// `cmd+shift+a` (the manifest's key): the app's sidebar, which is where the page is. It is the
// app's own command, so the key does exactly what the app's does.
fn.set("toggle", { desc: "Open the agents sidebar." }, () => call("toggle_sidebar"));

fn.set("context", {
    desc: "What an agent is told now: the guide and the map the first time, only what changed after. `null` when it is not told, or nothing changed.",
    parameters: [["table", "opts"]],
    examples: [{ args: [{ agent: "claude", pane: 3, event: "prompt" }] }, { args: [{ agent: "pi", pane: 5, event: "start", resumed: true }] }],
  }, async (opts: unknown) => {
    const asked = (typeof opts === "object" && opts !== null ? opts : {}) as {
      agent?: unknown;
      pane?: unknown;
      event?: unknown;
      resumed?: unknown;
    };
    const agent = typeof asked.agent === "string" ? asked.agent : "";
    if (agent === "") throw new Error("agents.context needs an `agent`");
    const now = await settings();
    if (!onFor(agent, now)) return null;
    const model = await readState();
    const here = typeof asked.pane === "number" ? asked.pane : model.focus.pane;
    const space = here === null ? null : (model.panes.find((each) => each.id === here)?.space ?? null);
    const said = map(model, { otherSessions: now.otherSessions, space });
    const when: When = asked.event === "start" || asked.event === "prompt" || asked.event === "full" ? asked.event : "prompt";
    const at = `told:${agent}:${here ?? "-"}`;
    const text = compose(when, asked.resumed === true, await option.get(at), said, now.updates);
    // Kept whether or not it was said, as the hook keeps it: what an agent has seen is the map.
    await option.set(at, said);
    return text;
  });

fn.set("restore", {
    desc: "The line that resumes an agent's session when its pane comes back, from `agents.restore` and the recipes pumi ships; `null` when there is none.",
    parameters: [["table", "opts"]],
    examples: [{ args: [{ agent: "claude", session: "abc-123" }] }],
  }, async (opts: unknown) => {
    const asked = (typeof opts === "object" && opts !== null ? opts : {}) as { agent?: unknown; session?: unknown };
    const agent = typeof asked.agent === "string" ? asked.agent : "";
    const session = typeof asked.session === "string" ? asked.session : "";
    if (agent === "" || session === "") throw new Error("agents.restore needs an `agent` and a `session`");
    return line(agent, session, await option.get("restore"));
  });
