// How the model is named in the map: a project and a view by their folder's or their own name, or
// by the id pumi takes (`$3`, `@2`), and a tab by its title, the agent in it, its directory, or its
// block.
import { basename } from "node:path";

import type { Project, Tab, View } from "./snapshot.ts";

/** A project's folder, or its id: `$3 pumi`, `$3`. */
export function projectLabel(project: Project): string {
  const folder = basename(project.path.replace(/\/+$/, "")) || project.path;
  return folder === "" ? `$${project.id}` : `$${project.id} ${folder}`;
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
