# browser

A page in a pane: a webview filling it, and the app browser's toolbar over it — back, forward,
reload, an address, the page's name — opened with `{ url }` and reachable from anywhere.

```
  ‹  ›  ↻  example.com/docs/a                    example.com  ↗  ⧉
  ──────────────────────────────────────────────────────────────────
   ...the page...
```

It is the app's own browser pane as close as a package gets. What the app's pane type has and this
does not — downloads, one profile and its cookies, the page's favicon, its history, and the pane an
`open_links` link from a terminal lands in — is written down in pumi's
`docs/plan/ports/browser.md`. The honest answer to "port the browser" is that the pane type stays
native: this is the plugin beside it.

## Open one

```sh
pumi call amresyd.browser.open '{"url":"https://pumi.dev"}'   # beside this pane
pumi call amresyd.browser.openTab '{"url":"example.com"}'     # in a tab of its own
pumi pane open amresyd.browser.page '{"url":"https://example.com"}' --split right
```

`amresyd.browser.page` is the block a pane holds, and `Page` in `src/ui.tsx` draws it. Its own
option `url` is the address, and `pane.open` with `{ url }` sets it as the pane opens.

The command's address is its argument (`{ url }`, or a plain string), else the app's
`browser.home_url`, else the address bar, which is empty and focused on nothing.

## What a pane does

| | |
| --- | --- |
| the toolbar | back, forward, reload (stop while it loads; disabled where there is nowhere to go), the address, the page's name, devtools |
| the keys | `cmd+l` the address, `cmd+r` reload, `cmd+[` back, `cmd+]` forward — the view's own, while it has the keyboard (they are not in Settings → Keys: a key there runs a command, and these are the page's) |
| the address bar | what the app's own resolves: a URL, a host (`example.com`, `localhost:3000`) as an address, anything else as a search of `browser.search_url` |
| `url` (option, pane, block) | the page the pane is on. Setting it navigates that pane; the page writes it back as it goes |
| the state | the address is the pane's `url` option and the name is its `title`, which the page reports: panes that come back come back where they were |

`browser.search_url` and `browser.home_url` are the app's own options, read here: one search
engine and one home page for both browsers.

## The pane protocol

`pane.call` reaches the page for the protocol's three methods, and for the block's own —
`navigate`, `back`, `forward`, `reload`, which the manifest declares:

```sh
pumi pane read %3          # "example.com\nexample.com/docs/a" — the name, then the address
pumi pane selection %3     # null: nothing of another site's document is readable here
pumi pane input %3 --text 'example.com/next'   # typed into the address bar, and Enter
```

`read` and `selection` answer from what the page **reported** to its pane (`pane.call` `report`,
which the server's own block keeps), and `input` arrives at the view as `pane.called`
(`{ pane, method: "input", args }`). The block's own methods are declared in the manifest
(`navigate`, `back`, `forward`, `reload`), so `pane.call` reaches them and the page hears them the
same way; the package's provided functions are the short road, and are what a caller reads by:

```sh
pumi pane navigate %3 '{"url":"example.com"}'   # the block's own method
pumi call amresyd.browser.navigate %3 'example.com'   # or {pane: "%3", url: "example.com"}
pumi call amresyd.browser.back %3
pumi call amresyd.browser.forward %3
pumi call amresyd.browser.reload %3
pumi call amresyd.browser.url %3      # the pane's `url` option
pumi call amresyd.browser.title %3    # the `title` the page reports
```

## What it cannot do, and why

- **No profile, cookies, downloads or zoom.** They are the app's pane type's, and a `webview`
  node has no road to them.
- **No page of its own for links.** A link the page opens in a new window goes to the system's
  browser, and one followed inside the page is nothing the view is told: a link clicked there
  changes nothing a package can see.
- **No reading the document.** `selection` is empty: what a view reports is what it knows, and
  another site's document is not something it can read.

What a package needs beyond that is `docs/plan/ports/browser.md`; the pane type stays native, and
this is the package beside it.

## Tests

```sh
bun test                       # the pure logic: no pumi running
bun run check # tsc --noEmit
```
