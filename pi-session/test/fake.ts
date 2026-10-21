// The package under pumi/testing's fake app, with the panes there are and what each says of itself:
// `pane.list` lists `scene.panes` by type, `pane.getPlace` reads `scene.places`, `pane.current` is
// `scene.current`, and `option.get` answers an option set on a pane from `scene.said` (`"@agent@3"`),
// one set on the app (the package's own, `"local.pi_session.side"`) from there or from the fake's.
// They are read when asked, so a test sets them as it goes.
import { join } from "node:path";

import { FakeApp } from "pumi/testing";

/** The package's directory: its package.json is its manifest. */
export const dir = join(import.meta.dir, "..");

/** Where a view is, as `pane.getPlace` says it. */
export interface Place {
  kind: string;
  name?: string;
  owner?: number;
}

/** The app the package is under: what there is, and what it says. */
export interface Scene {
  /** The panes of each type, by the view's id (`terminal`, `strip`), as `pane.list` lists them. */
  panes: Record<string, number[]>;
  /** Where each view is, by its pane's id. */
  places: Record<number, Place>;
  /** What is set where: an option on a pane (`"@agent@3"`), or one on the app (`"local.pi_session.side"`). */
  said: Record<string, unknown>;
  /** The pane that has the focus, as `pane.current` answers. */
  current: number;
}

/** A fake app with the package's `main` already run, and the scene it saw. */
export interface Fake {
  app: FakeApp;
  scene: Scene;
  /** The view `pane.open` drew for each pane (one opened with `{ pane }`), by that pane's id. */
  views: Map<number, number>;
}

/** Starts the package under a fake app whose scene is `scene`, with its options set as `options`. */
export async function fake(scene: Partial<Scene> = {}, options: Record<string, unknown> = {}): Promise<Fake> {
  const app = new FakeApp({ dir, options });
  const there: Scene = { panes: {}, places: {}, said: {}, current: 0, ...scene };
  /** A pane type as the scene names it: the view's id without the package's prefix. */
  const type = (name?: string | null) => (name?.startsWith(app.init.prefix) ? name.slice(app.init.prefix.length) : (name ?? ""));
  const said = (name: string, opts?: { pane?: number | null } | null) => (opts?.pane === undefined || opts.pane === null ? name : `${name}@${opts.pane}`);
  const views = new Map<number, number>();
  let next = 9_000;
  app.answer("pane.open", (_type?: unknown, args?: { pane?: number }) => {
    const view = ++next;
    if (args?.pane !== undefined) views.set(args.pane, view);
    return view;
  });
  app.answer("pane.list", (opts?: { type?: string | null } | null) => there.panes[type(opts?.type)] ?? []);
  app.answer("pane.getPlace", (id: number) => there.places[id] ?? { kind: "tiled" });
  app.answer("pane.current", () => there.current);
  app.answer("option.get", (name: string, opts?: { pane?: number | null } | null) => {
    const key = said(name, opts);
    return key in there.said ? there.said[key] : (app.options.get(name) ?? null);
  });
  app.answer("option.set", (name: string, value: unknown, opts?: { pane?: number | null } | null) => {
    there.said[said(name, opts)] = value;
    return null;
  });
  await app.connect("src/main.ts");
  return { app, scene: there, views };
}
