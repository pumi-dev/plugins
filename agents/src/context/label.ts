// How the model is named in the map: a session and a view by their own names, or by the id pumi
// takes (`$3`, `@2`), and a tab by its title, the agent in it, its directory, or its block.
import type { Session, Tab, View } from "./snapshot.ts";

/** A session's name, or its id: `$3 pumi`, `$3`. */
export function sessionLabel(session: Session): string {
  const label = session.label.trim();
  return label === "" ? `$${session.id}` : `$${session.id} ${label}`;
}

/** A view's name, or its id: `@2 logs`, `@2`. */
export function viewLabel(view: View): string {
  const name = view.name.trim();
  return name === "" ? `@${view.id}` : `@${view.id} ${name}`;
}

/** A tab's name: its title without decoration, the agent's, its directory, else its block. */
export function tabTitle(tab: Tab): string {
  for (const candidate of [tab.stripped, tab.title, tab.agent]) {
    if (candidate.trim() !== "") return candidate;
  }
  const cwd = tab.cwd.replace(/\/+$/, "");
  if (cwd !== "") return cwd;
  return tab.block === "" ? "tab" : tab.block;
}
