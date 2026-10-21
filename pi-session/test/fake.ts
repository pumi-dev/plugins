// The package under pumi/testing's fake app, with the panes there are and what each says of itself:
// `pane.list` lists `scene.panes` by type, `pane.getPlace` reads `scene.places`, `pane.current` is
// `scene.current`, and `option.get` answers a pane's own options from `scene.said` (`"@agent@3"`),
// the package's own from the app's. They are read when asked, so a test sets them as it goes.
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
  /** What each pane says of itself: `"@agent@3": "pi"`, `"@width@77": 50`. */
  said: Record<string, unknown>;
  /** The pane that has the focus, as `pane.current` answers. */
  current: number;
}

/** A fake app with the package's `main` already run, and the scene it saw. */
export interface Fake {
  app: FakeApp;
  scene: Scene;
}

/** Starts the package under a fake app whose scene is `scene`, with its options set as `options`. */
export async function fake(scene: Partial<Scene> = {}, options: Record<string, unknown> = {}): Promise<Fake> {
  const app = new FakeApp({ dir, options });
  const there: Scene = { panes: {}, places: {}, said: {}, current: 0, ...scene };
  /** A pane type as the scene names it: the view's id without the package's prefix. */
  const type = (name?: string | null) => (name?.startsWith(app.init.prefix) ? name.slice(app.init.prefix.length) : (name ?? ""));
  const said = (name: string, opts?: { pane?: number | null } | null) => `${name}@${opts?.pane ?? ""}`;
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
  return { app, scene: there };
}
