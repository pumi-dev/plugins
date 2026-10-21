// The package under pumi/testing's fake app, with the tabs and panes the tests name: `pane.list`
// lists a tab's panes from `scene.tabs`, `pane.getPlace` reads `scene.places`, `option.get` answers
// a pane's own options from `scene.said` (`"title@3"`) and the package's own from the app's, and
// `format.eval` writes a pane's `#{window_index}.#{pane_index}`. They are read when asked, so a
// test sets them as it goes.
import { join } from "node:path";

import { FakeApp } from "pumi/testing";

/** The package's directory: its package.json is its manifest. */
export const dir = join(import.meta.dir, "..");

/** What the app has, as the tests say it. */
export interface Scene {
  /** The current session's tabs, in order. */
  session: number[];
  /** Every session's tabs, by session. */
  sessions: Record<number, number[]>;
  /** Each tab's panes, in layout order. */
  tabs: Record<number, number[]>;
  /** Where each pane is: `tiled` (the default), `float`, `slot` or `detached`. */
  places: Record<number, string>;
  /** What each pane says of itself: `"title@3": "zsh"`, `"@agent_status@3": "working"`. */
  said: Record<string, unknown>;
  /** The pane being used, as `pane.current` answers. */
  current: number;
}

/** The package's fake app, and the scene it saw. */
export interface Fake {
  app: FakeApp;
  scene: Scene;
}

/** Which of its tab's panes `pane` is, from 0: what `#{pane_index}` says. */
function indexOf(scene: Scene, pane: number | null | undefined): string {
  for (const panes of Object.values(scene.tabs)) {
    const at = panes.indexOf(pane ?? -1);
    if (at >= 0) return String(at);
  }
  return "0";
}

/** Starts the package under a fake app whose scene is `scene`, with its options set as `options`. */
export async function fake(scene: Partial<Scene> = {}, options: Record<string, unknown> = {}): Promise<Fake> {
  const app = new FakeApp({ dir, options });
  // Its own copy: a test's scene is a literal it may share between tests, and closing a pane takes
  // it out of its tab.
  const there: Scene = {
    session: [...(scene.session ?? [1])],
    sessions: Object.fromEntries(Object.entries(scene.sessions ?? {}).map(([one, tabs]) => [one, [...tabs]])),
    tabs: Object.fromEntries(Object.entries(scene.tabs ?? {}).map(([one, panes]) => [one, [...panes]])),
    places: { ...scene.places },
    said: { ...scene.said },
    current: scene.current ?? 0,
  };
  // Every session's tabs, unless the test said: the current session has the ones it named.
  if (Object.keys(there.sessions).length === 0) there.sessions = { 1: there.session };
  const said = (name: string, at?: { pane?: number | null } | null) => `${name}@${at?.pane ?? ""}`;
  app.answer("session.current", () => 1);
  app.answer("session.list", () => Object.keys(there.sessions).map(Number));
  app.answer("tab.current", () => there.session[0] ?? 1);
  app.answer("tab.list", (session: number) => there.sessions[session] ?? []);
  app.answer("pane.list", (opts?: { tab?: number | null; type?: string | null } | null) => {
    const all = Object.values(there.tabs).flat();
    if (opts?.type) return all.filter((at) => there.said[`pane_type@${at}`] === opts.type);
    if (opts?.tab !== undefined && opts.tab !== null) return there.tabs[opts.tab] ?? [];
    return all;
  });
  app.answer("pane.getPlace", (at: number) => ({ kind: there.places[at] ?? "tiled" }));
  app.answer("pane.current", () => there.current);
  app.answer("option.get", (name: string, opts?: { pane?: number | null } | null) => {
    const key = said(name, opts);
    return key in there.said ? there.said[key] : (app.options.get(name) ?? null);
  });
  app.answer("format.eval", (fmt: string, opts?: { pane?: number | null } | null) =>
    fmt.replace("#{window_index}", "1").replace("#{pane_index}", indexOf(there, opts?.pane)),
  );
  // A closed pane is gone from its tab, as the app's is.
  app.answer("pane.close", (at: number) => {
    for (const panes of Object.values(there.tabs)) {
      const from = panes.indexOf(at);
      if (from >= 0) panes.splice(from, 1);
    }
    return null;
  });
  await app.connect("src/main.ts");
  return { app, scene: there };
}
