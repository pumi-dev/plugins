# image-preview

Rest the pointer on an image file's path in a terminal to see the image.

**Not ported yet.** This is the plugin as it was written against the v1 plugin shape
(`plugin.json`, the `Plugin` trait with `activate`/`event`, `runtime::settings()`,
`terminal.match` with a `path` matcher, `Place::popover`). That shape is gone: a package is
now `ui/` (a wasm component built from a crate with `pumi_plugin::plugin!(init)`, see
docs/v2/23) plus `pumi.toml`.

To bring it back, two things are needed:

1. A source of "the pointer rested on this path, in this pane, at this row, here is the
   anchor" — the matchers that produced it lived in the host's `runtime/plugin/matchers.lua`,
   and the host runs no Lua now. Either the app gets that as a general feature (docs/v2/06),
   or the plugin reads the pane under the pointer itself.
2. `ui/`: `Card` as a view (`Render`), the settings as `pumi_create_option` calls
   (`image_preview.max_width`, `image_preview.max_height`), and the hover card as a
   `pumi_open_pane` with `place: {kind: "float", …}`.

`src/size.rs` (an image's dimensions, from its header) is portable as it is.
