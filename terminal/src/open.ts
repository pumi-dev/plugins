// What `open` takes: from the `+` menu, `{tab, place}` (the tab it goes beside and where); from
// `pumi call`, nothing, or `{command, cwd, env}` for what the shell runs. No `import … from "pumi"`
// here, so it is tested without the app.

/** Where a new terminal goes when nothing says: beside the caller's tab, to the right. */
export const BESIDE = { kind: "tiled", split: "right" } as const;

/** The launch keys a terminal block takes; anything else in the call is not for it. */
const LAUNCH = ["command", "cwd", "env", "keep"] as const;

export interface Opening {
  args: Record<string, unknown>;
  place: Record<string, unknown>;
}

/** The terminal's arguments and its place, from what `open` was called with. */
export function opening(given: unknown): Opening {
  const g = given && typeof given === "object" ? (given as Record<string, unknown>) : {};
  const args: Record<string, unknown> = {};
  for (const key of LAUNCH) if (g[key] !== undefined) args[key] = g[key];
  const place: Record<string, unknown> = g.place && typeof g.place === "object" ? { ...(g.place as Record<string, unknown>) } : { ...BESIDE };
  if (typeof g.tab === "string" && g.tab !== "" && place.beside === undefined && place.pane === undefined) place.beside = g.tab;
  return { args, place };
}

/** Whether the first run makes new tabs open a shell: only while nobody has chosen what they open. */
export function claims(newTab: unknown, claimed: unknown): boolean {
  return claimed !== true && (newTab === "" || newTab === null || newTab === undefined);
}
