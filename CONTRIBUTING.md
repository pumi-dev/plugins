# Contributing

Fixes and new plugins are welcome. Each directory is a plugin of its own; keep a change to the
plugin it is about, and say in its README what it does for the user.

## Set up

Develop against a pumi checkout beside this one, which gives the packages pumi's SDK types:

```sh
git clone https://github.com/pumi-dev/pumi
git clone https://github.com/pumi-dev/pumi-plugins
(cd pumi/runtime/app && bun install)   # the app's own dependencies: typescript and the types tsc needs
cd pumi-plugins
bun tools/link.mjs                     # links pumi's SDK into every package as @pumid/types
bun install                            # the packages' own npm dependencies
```

`bun tools/link.mjs` reads `../pumi`, or the checkout `$PUMI_SRC` names. Run it again after adding
a package.

To try a plugin, run it in a pumi you have installed: `pumi plugin dev ./<dir>` links the directory,
reloads the plugin on every save and prints its log until you stop it; `pumi plugin logs <name>`
shows the log afterwards. `pumi plugin new <dir>` writes a new plugin to start from (pumi's
`runtime/app/template`).

## Test

```sh
bun run test                                        # every package's tests and types (bun tools/all.mjs)
cd <dir> && bun test                                # one package's tests
cd <dir> && ./node_modules/.bin/tsc --noEmit -p .   # its types
```

Tests run on the pure modules, with no pumi running. Add a test for the logic you change.

## Conventions

These are in [AGENTS.md](AGENTS.md) in full; in brief:

- A plugin is its `package.json` (the `pumi` key is the manifest), `src/main.ts` (the worker) and
  `src/ui.tsx` (what it draws). Everything it contributes is declared in the manifest.
- Logic that can be pure goes in `src/*.ts` modules that do not import `pumi`, and is tested in
  `test/*.test.ts`.
- Everything of a plugin's own is prefixed `owner.name.`. Do not write the prefix out: the owner is
  `amresyd` for a linked plugin and `pumi_dev` for one installed from GitHub. Use
  `self.plugin.prefixed(…)` and `usePlugin()`.
- Use pumi's names: session → view → pane → tab, and the slots and option scopes pumi defines
  (`../pumi/docs/user/plugins.md`).
- Draw with style objects, colours from `useTheme()` and sizes from `useMetrics()`; no CSS, no
  colour literals.
- A plugin's README says what it does, its commands, keys and options, and anything a user should
  know. Keep it terse and plain.

## License

Contributions are under the repository's license, GPL-3.0-or-later ([LICENSE](LICENSE)).
`palette/src/nucleo.ts` is a port of nucleo and stays under the MPL-2.0. Code adapted from
elsewhere keeps its notice: list it in [NOTICE](NOTICE).
