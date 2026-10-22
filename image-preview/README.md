# image-preview

Rest the pointer on an image file's path in a terminal to see the image.

**Not ported, and not portable as it stands.** What is here was written against an older plugin
shape (`plugin.json`, a Rust crate built to wasm with the `Plugin` trait's `activate`/`event`,
`runtime::settings()`, a `terminal.match` path matcher, `Place::popover`). pumi no longer loads
that shape: a plugin is a directory whose `package.json` has a `pumi` key, with `src/main.ts` in a
worker and `src/ui.tsx` in the window. The root `Cargo.toml` leaves this crate out of the
workspace, and `pumi plugin add` does not take it.

Two things it needs have no replacement in the API:

1. **A source of "the pointer rested on this path, in this tab, at this row, here is the anchor".**
   No event, slot or hook says a pointer rested on something a terminal drew. Until the app has
   that as a feature of its own, there is nothing for a plugin to listen to.
2. **A card over the tab.** `Place::popover` is gone; a tab now floats with
   `tab.open(block, args, { kind: "float", … })`, which a plugin can ask for. What it has no road to
   is the first part: knowing when.

To bring it back, then:

- `package.json` — `"pumi": { "name": "image-preview", "owner": "amresyd", "api": 1 }` with its two
  settings in `contributes.options` (`max_width`, `max_height`, numbers, 360 and 280).
- `src/ui.tsx` — `Card`, the image at the size those settings allow, and `src/main.ts` the function
  that opens it as a float: `tab.open("…", { path }, { kind: "float", anchor, … })`.
- a trigger, which does not exist yet (1).

`src/size.rs` (an image's dimensions, from its header) is portable as it is: read the header, fit
the size to the settings.
