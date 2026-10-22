# browser

A page in a pane: a webview filling it, and the app browser's toolbar over it — back, forward,
reload, an address, the page's name — opened with `{ url }` and reachable from anywhere.

```
  ‹  ›  ↻  example.com/docs/a                    example.com  ↗  ⧉
  ──────────────────────────────────────────────────────────────────
   ...the page...
```

It is the app's own browser pane as close as a package gets. What the app's pane type has and this
does not — devtools, downloads, one profile and its cookies, the page's real title and favicon, its
history, and the pane an `open_links` link from a terminal lands in — is written down in pumi's
`docs/plan/ports/browser.md`. The honest answer to "port the browser" is that the pane type stays
native: this is the plugin beside it.

## Open one

```sh
pumi call amresyd.browser.open '{"url":"https://pumi.dev"}'   # beside this pane
pumi call amresyd.browser.openTab '{"url":"example.com"}'     # in a view of its own
pumi call pane.open amresyd.browser.page '{"url":"https://example.com"}' '{"split":"right"}'
```

The command's address is its argument (`{ url }`, or a plain string), else the app's
`browser.home_url`, else the address bar, which is empty and focused on nothing.

## What a pane does

| | |
| --- | --- |
| the toolbar | back, forward, reload (disabled where there is nowhere to go), the address, the page's name, open in the default browser, copy the address |
| the keys | `cmd+l` the address, `cmd+r` reload, `cmd+[` back, `cmd+]` forward — bound in the view's key table, `amresyd.browser.page`, so they are listed in Settings → Keys and answer only in these panes |
| the address bar | what the app's own resolves: a URL, a host (`example.com`, `localhost:3000`) as an address, anything else as a search of `browser.search_url` |
| `url` (option, pane) | the page the pane is on. Setting it navigates that pane; the pane writes it back as it goes |
| the state | the address, the name and the history, under a version (`pane.getState`'s `data`), so a pane that comes back comes back where it was |

`browser.search_url` and `browser.home_url` are the app's own options, read here: one search
engine and one home page for both browsers.

## The pane protocol

`pane.call` reaches a package's view for the protocol's three methods, and for nothing else:

```sh
pumi call pane.call 3 read          # "example.com\nexample.com/docs/a" — the name, then the address
pumi call pane.call 3 selection     # null: nothing of another site's document is readable here
pumi call pane.call 3 input '{"text":"example.com/next"}'   # typed into the address bar, and Enter
```

`read` and `selection` answer from what the view **reported** to its pane (`pane.call` `report`,
which the server's own type keeps), and `input` arrives at the view as `pane.inputReceived`. A
type's own methods have no road into a package, so they are provided functions, told a pane:

```sh
pumi call amresyd.browser.navigate 3 'example.com'   # or {pane: 3, url: "example.com"}
pumi call amresyd.browser.back 3
pumi call amresyd.browser.forward 3
pumi call amresyd.browser.reload 3
pumi call amresyd.browser.url 3
pumi call amresyd.browser.title 3
```

## What it cannot do, and why

- **No page title, and no knowing what the page did.** A `webview` node tells its view nothing —
  not the document's title, not that it loaded, not that a link was followed. The toolbar's name
  is the page's host, and a link clicked inside the page changes nothing the view can see.
- **No history of the page's own.** The view's back and forward walk the addresses it was told to
  load; a step is a fresh load, not a step through the webview's history, and form state and
  scroll position go with the page it left.
- **No devtools, no downloads, no zoom.** They are wry's, and the app's pane type has them.
- **No stopping a load, and no progress.** Nothing says one is happening.

Everything a package needs to close that gap is one API call away, and it is in
`docs/plan/ports/browser.md`: a way to register a pane type (so `pane.call`'s own methods reach a
package) and a way to ask a `webview` node about itself and drive it.

## Tests

```sh
bun test                       # the pure logic: no pumi running
bun run check # tsc --noEmit
```
