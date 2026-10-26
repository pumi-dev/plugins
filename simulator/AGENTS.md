# pumi-simulator

An iOS Simulator in a pane. `src/main.ts` (the worker) owns `simctl` and one `serve-sim` per booted
device; `src/ui.tsx` draws serve-sim's preview page in a `<WebView>`.

- **The pane's device** is the pane option `amresyd.simulator.udid` (`scope: "pane"`,
  `blocks: ["device"]`), so `pane.open(BLOCK, { "amresyd.simulator.udid": udid }, place)` sets it.
  The renderer reads it with `usePane(pane)?.options` — a renderer's `pane` prop is a `Ref`, which
  has no options.
- **One streamer per device**, addressed by the state file serve-sim writes
  (`$TMPDIR/serve-sim/server-<udid>.json`). `stream()` adopts a live one, `launch()` starts one,
  `release()` schedules `stop()` after the `keepalive` option. Pids this worker started are
  recorded in `paths.state/helpers.json` and killed on the next start: a reload's children outlive
  the worker.
- **serve-sim takes the device positionally** (`serve-sim --port 3210 <udid>`), not `-d`.
- **Node, not Bun**: `entrypoint()` installs serve-sim with the app's own Bun
  (`process.execPath install`), but the streamer runs on the `node` option, else `PATH`, else nvm
  or Homebrew. Its native helper is a Node-API addon.
- **Never proxy serve-sim's routes.** It has a shell-exec route guarded only by a token readable
  from its own `/api`. Bind loopback, keep the check on the address, and treat the page as data.

## Working on it

```sh
cd /Users/amr/Kitchen/pumi-plugins && bun tools/link.mjs   # after adding the package: links @pumid/types
cd simulator && bunx tsc --noEmit                          # the workspace's types for `import "pumi"`
pumi plugin dev /Users/amr/Kitchen/pumi-plugins/simulator  # reload on save
pumi plugin logs simulator                                  # its stderr
```

`$TMPDIR/serve-sim/` and `keepalive` explain most "the streamer is still running" surprises;
`pumi plugin logs simulator` shows serve-sim's own output, which `launch()` also prints when it
fails to come up.
