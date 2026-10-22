// agents: the sidebar page that says what every space, tab and agent is doing, and a click to go
// there — plus the guide and the restore recipes an agent is told.
//
//   cmd+shift+a                                   the app's sidebar, where the page is
//   pumi call amresyd.agents.context '{"agent":"claude","pane":3,"event":"prompt"}'
//   pumi call amresyd.agents.restore '{"agent":"claude","session":"abc-123"}'
//
// The page is drawn by `ui.tsx` (the manifest's `contributes.points.panel`), its rows `tree.ts`'s
// and its state `status.ts`'s. What is here is the logic: the model kept fresh from the events that
// move it (`src/model.ts`, `src/snapshot.ts`) for the guide and the recipes, and the two functions
// another package, a script or a hook calls. The guide is `context/guide.md`, the same text
// `pumi skill show` prints.
import { action, command, option, pkg, provide, storage } from "pumi";

import { compose, map, onFor, settings, type When } from "./context.ts";
import { follow, snapshot } from "./model.ts";
import { line } from "./restore.ts";

// `cmd+shift+a` (the manifest's key): the app's sidebar, which is where the page is. It is the
// app's own action, so the key does exactly what the app's does.
command("toggle", () => action.run("toggle_sidebar"));

provide(
  pkg.prefixed("context"),
  {
    desc: "What an agent is told now: the guide and the map the first time, only what changed after. `null` when it is not told, or nothing changed.",
    parameters: [["table", "opts"]],
    examples: [{ args: [{ agent: "claude", pane: 3, event: "prompt" }] }, { args: [{ agent: "pi", pane: 5, event: "start", resumed: true }] }],
  },
  async (opts: unknown) => {
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
    const here = typeof asked.pane === "number" ? asked.pane : snapshot().focus.pane;
    const space = here === null ? null : (snapshot().panes.find((each) => each.id === here)?.space ?? null);
    const said = map(snapshot(), { otherSessions: now.otherSessions, space });
    const when: When = asked.event === "start" || asked.event === "prompt" || asked.event === "full" ? asked.event : "prompt";
    const at = `told:${agent}:${here ?? "-"}`;
    const text = compose(when, asked.resumed === true, await storage.get<string>(at), said, now.updates);
    // Kept whether or not it was said, as the hook keeps it: what an agent has seen is the map.
    await storage.set(at, said);
    return text;
  },
);

provide(
  pkg.prefixed("restore"),
  {
    desc: "The line that resumes an agent's session when its pane comes back, from `agents.restore` and the recipes pumi ships; `null` when there is none.",
    parameters: [["table", "opts"]],
    examples: [{ args: [{ agent: "claude", session: "abc-123" }] }],
  },
  async (opts: unknown) => {
    const asked = (typeof opts === "object" && opts !== null ? opts : {}) as { agent?: unknown; session?: unknown };
    const agent = typeof asked.agent === "string" ? asked.agent : "";
    const session = typeof asked.session === "string" ? asked.session : "";
    if (agent === "" || session === "") throw new Error("agents.restore needs an `agent` and a `session`");
    return line(agent, session, await option.get("restore"));
  },
);

follow();
