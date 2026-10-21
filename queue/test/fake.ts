// The package against pumi/testing's fake app, with the app's panes answered from what a test says
// they are: `facts` is the panes there are, and what each says of itself, and `opened` the panes
// the package opened, where.
import { join } from "node:path";
import { FakeApp } from "pumi/testing";

export const dir = join(import.meta.dir, "..");
/** The pane a caller is in, as `pane.current` answers: a job added without `after` belongs to it. */
export const ORIGIN = 9;

/** What a pane says of itself: `@agent_status`, `pane_dead`, and whether its shell is back. */
export interface Pane {
  status?: string | null;
  dead?: boolean;
  deadStatus?: number | null;
  /** Its foreground process group; `pid` is its shell, so the two being equal is at rest. */
  foreground?: number | null;
  pid?: number | null;
  path?: string | null;
}

/** A place a pane was opened at, as far as the queue cares (`PlaceSpec`). */
export interface Place {
  kind?: string;
  slot?: string;
  owner?: number;
  order?: number;
  focus?: boolean;
}

/** A pane the package opened: its type, and where it went. */
export interface Opened {
  type: string;
  place?: Place | null;
}

export interface Fake {
  app: FakeApp;
  /** What the panes say of themselves, by id. */
  readonly facts: Map<number, Pane>;
  /** What pane `id` says of itself from now on. */
  says(id: number, said: Pane): void;
  /** The option of pane `id` changed, as the host says it. */
  changed(id: number, option?: string): Promise<void>;
  /** The panes the package opened, by id. */
  readonly opened: Map<number, Opened>;
  /** Every pane there is: the ones the app has, and the ones the package opened. */
  there(): number[];
}

/** Starts the package on these panes, with these options. */
export async function start(facts: Record<number, Pane> = {}, options: Record<string, unknown> = {}): Promise<Fake> {
  const app = await FakeApp.start({ dir, main: "src/main.ts", options });
  const panes = new Map<number, Pane>(Object.entries(facts).map(([id, said]) => [Number(id), said]));
  const opened = new Map<number, Opened>();
  let next = 100;
  const at = (id: number | undefined) => (id === undefined ? {} : (panes.get(id) ?? {}));

  app.answer("pane.open", (type: string, _args?: unknown, place?: Opened["place"]) => {
    const id = ++next;
    opened.set(id, { type, place });
    return id;
  });
  app.answer("pane.close", (id: number) => {
    opened.delete(id);
    return null;
  });
  app.answer("pane.list", (opts?: { type?: string | null }) => {
    if (opts?.type) return [...opened].filter(([, pane]) => pane.type === opts.type).map(([id]) => id);
    return [...panes.keys(), ...opened.keys()];
  });
  // A place as the app answers it: a slot's `name`, where `pane.open` takes a `slot`.
  app.answer("pane.getPlace", (id: number) => {
    const place = opened.get(id)?.place;
    if (place?.kind === "slot") return { kind: "slot", name: place.slot, owner: place.owner, order: place.order };
    return { kind: "tiled", tab: 1 };
  });
  app.answer("pane.current", () => ORIGIN);
  app.answer("option.get", (name: string, opts?: { pane?: number }) => {
    // The package's own options are asked for by their full name.
    if (name.startsWith("local.queue.")) return app.options.get(name) ?? null;
    const pane = at(opts?.pane);
    switch (name) {
      case "@agent_status":
        return pane.status ?? null;
      case "pane_dead":
        return pane.dead ?? false;
      case "pane_dead_status":
        return pane.deadStatus ?? null;
      case "pane_foreground_pgid":
        return pane.foreground ?? null;
      case "pane_pid":
        return pane.pid ?? null;
      case "pane_current_path":
        return pane.path ?? null;
      default:
        return app.options.get(name) ?? null;
    }
  });
  await app.settle();

  return {
    app,
    facts: panes,
    opened,
    says(id, said) {
      panes.set(id, { ...panes.get(id), ...said });
    },
    changed: (id, option = "pane_foreground_pgid") =>
      app.fire("option.changed", { name: option }, { match: option, pane: id }),
    there: () => [...panes.keys(), ...opened.keys()],
  };
}

