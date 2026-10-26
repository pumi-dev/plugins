// How the model is named in the map: a space, a tab and a pane, each by its own name or, when it
// has none, the one pumi and the core give it (`$3`, `Tab 2`, the directory).
import type { Pane, Space, Tab } from "./snapshot.ts";

/** A space's name: its own, or its id as tmux writes it. */
export function spaceLabel(space: Space): string {
  const label = space.label.trim();
  return label === "" ? `$${space.id}` : label;
}

/** A tab's name, or its number: `Tab 2`, as the core says it. */
export function tabLabel(tab: Tab): string {
  const label = tab.label.trim();
  return label === "" ? `Tab ${tab.index + 1}` : label;
}

/** A pane's title: its label, its title without decoration, the agent's name, else its directory. */
export function title(pane: Pane): string {
  for (const candidate of [pane.label, pane.stripped, pane.title, pane.agent]) {
    if (candidate.trim() !== "") return candidate;
  }
  const cwd = pane.cwd.replace(/\/+$/, "");
  return cwd === "" ? "terminal" : cwd;
}
