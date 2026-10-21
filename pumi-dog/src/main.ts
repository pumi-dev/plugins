// pumi-dog: a little pumi in the status bar. It walks back and forth along its track, stops to wag
// and blink, and barks when it is clicked or when `bark` is called. `toggle` takes it away and
// brings it back.
//
// The art is `sprite.ts` (pixel grids, painted on a canvas), the state machine is `walker.ts` (a
// step is a function of the dog, its settings and the seed), the options are `settings.ts` and the
// view is `dog.ts`. What is here is the dog's pane: where it goes, and the two functions.
import { pane, Pane, pkg, provide, view } from "pumi";
import { barkAll, Dog } from "./dog.ts";

/** The dog's pane, if it is out. */
async function shown(): Promise<Pane | null> {
  try {
    const panes = (await pane.list({ type: pkg.prefixed("dog") })) as Pane[] | null;
    return panes?.[0] ?? null;
  } catch (err) {
    console.error("pumi-dog: looking for its pane:", err);
    return null;
  }
}

/** Puts the dog in the status line, unless it is already there. */
async function show(): Promise<void> {
  if (await shown()) return;
  const place = { kind: "slot", name: "statusline", order: 1000, focus: false } as const;
  try {
    await pane.open(pkg.prefixed("dog"), {}, place);
  } catch (err) {
    console.error("pumi-dog: opening its pane:", err);
  }
}

/** Takes the dog away, or brings it back. */
async function toggle(): Promise<void> {
  const dog = await shown();
  if (!dog) return show();
  try {
    await dog.close(true);
  } catch (err) {
    console.error("pumi-dog: closing its pane:", err);
  }
}

view("dog", Dog);

// `pumi call amresyd.pumi_dog.toggle`: takes the dog away and brings it back.
provide(pkg.prefixed("toggle"), { desc: "Show or hide the dog.", examples: [{ args: [] }] }, () => toggle());

// `pumi call amresyd.pumi_dog.bark`: the dog says hi, from anywhere.
provide(pkg.prefixed("bark"), { desc: "The dog says hi." }, () => barkAll());

// The dog lives in the status bar while the app is open: it comes out with the package, and
// `toggle` is what puts it away.
void show();
