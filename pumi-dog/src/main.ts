// pumi-dog: a little pumi in the status bar. It walks back and forth along its track, stops to wag
// and blink, and barks when it is clicked or when `bark` is called.
//
// The art is `sprite.ts` (pixel grids, drawn as runs of one colour), the state machine is
// `walker.ts` (a step is a function of the dog, its settings and the seed), the options are
// `settings.ts` and `ui.tsx` draws it. What is here is the two functions another package, a script
// or a key reaches: the bark, which every dog hears, and the toggle.
import { command, option, plugin, provide } from "pumi";

/** The two options the package sets on itself: the last bark, and whether the dog is out. */
const BARK = "@bark";
const OUT = "@dog";

/** Every dog barks: the mark is an option, which is what the window reads. */
async function bark(): Promise<void> {
  await option.set(plugin.prefixed(BARK), Date.now());
}

/** Takes the dog out of the status bar, or puts it back. */
async function toggle(): Promise<void> {
  const out = await option.get(plugin.prefixed(OUT));
  await option.set(plugin.prefixed(OUT), out === false);
}

command("toggle", () => toggle());

// `pumi call amresyd.pumi_dog.bark`: the dog says hi, from anywhere.
provide(plugin.prefixed("bark"), { desc: "The dog says hi.", examples: [{ args: [] }] }, () => bark());
provide(plugin.prefixed("toggle"), { desc: "Show or hide the dog.", examples: [{ args: [] }] }, () => toggle());

// The dog lives in the status bar while the app is open: the manifest's `status` slot draws it.
void option.get(plugin.prefixed(OUT)).catch(() => undefined);
