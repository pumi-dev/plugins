// pumi-dog: a little pumi in the side bar. It walks back and forth along its track, stops to wag
// and blink, and barks when it is clicked or when `bark` is called.
//
// The art is `sprite.ts` (pixel grids, drawn as runs of one colour), the state machine is
// `walker.ts` (a step is a function of the dog, its settings and the seed), the options are
// `settings.ts` and `ui.tsx` draws it. What is here is the two functions another package, a script
// or a key reaches: the bark, which every dog hears, and the toggle.
import { fn, option, self } from "pumi";

/** The two options the package sets on itself: the last bark, and whether the dog is out. */
const BARK = "@bark";
const OUT = "@dog";

/** Every dog barks: the mark is a global option of its own, which is what the window reads. */
async function bark(): Promise<void> {
  await option.set(self.plugin.prefixed(BARK), Date.now(), { scope: "global" });
}

/** Takes the dog out of its section, or puts it back. */
async function toggle(): Promise<void> {
  // The window reads them too, so they are global, under the package's prefix.
  const name = self.plugin.prefixed(OUT);
  const out = await option.get(name, { scope: "global" });
  await option.set(name, out === false, { scope: "global" });
}

// The manifest's command, which is what gives it its title.
fn.set(self.plugin.prefixed("toggle"), { desc: "Show or hide the dog.", callback: () => toggle() });

// `pumi call amresyd.pumi_dog.bark`: the dog says hi, from anywhere.
fn.set(self.plugin.prefixed("bark"), { desc: "The dog says hi.", callback: () => bark() });

// The dog lives in the side bar while the app is open: the manifest's `panel` slot draws it.
void option.get(self.plugin.prefixed(OUT), { scope: "global" }).catch(() => undefined);
