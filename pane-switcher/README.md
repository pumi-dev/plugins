# pane-switcher

Alt-Tab for panes. The trigger (`pane_switcher.trigger`, `<M-Tab>` — Option-Tab on a Mac) puts
a row of cards over the window, dimming what is under them, one per pane, as a task switcher
shows its windows:

```text
← → choose · enter go · esc close                                    5
┌──────────────────┐┌──────────────────┐┌──────────────────┐
│ ~/Kitchen/pumi   ││ $ cargo test     ││ https://…        │
│ $ git status     ││ running 3 tests  ││  Docs · Guide     │
│ M Cargo.toml     ││ test api …  ok   ││                   │
│──────────────────││──────────────────││──────────────────│
│ ▸ pumi           ││ ▸ zsh            ││ ▸ Docs           │
└──────────────────┘└──────────────────┘└──────────────────┘
```

Each card is drawn from what the pane itself says: its last lines in the colours its program
wrote them in (`pane.cells`, the screen the app parsed — nothing is resized to take it, and a
pane the app never drew falls back to `pumi_pane_call`'s `read` text), set in the terminal's
font, its title or the program in it, its `tab.pane` number and directory, and the agent's
state when one reported it (`@agent_status`). The highlight starts on the pane you are in; the
cards are in most-recently-used order, so the next one is where you were before. The trigger
pressed again moves the highlight on instead of replacing the switcher, as a held Alt-Tab does.
The cards are centred in the float while they fit in it, and start at its left edge and scroll
when they do not.

`Enter` (or a click) goes to the highlighted pane, whichever tab it is in. `Escape`, or a press
outside the cards, closes the switcher and changes nothing. `x` closes the highlighted pane (its
`PaneClosePre` may refuse). `1`–`9` pick a card directly; `←`/`→`, `Tab`/`Shift-Tab`, `↑`/`↓`,
`Ctrl-P`/`Ctrl-N` and `Home`/`End` move about.

## Options

| Option | | |
| --- | --- | --- |
| `trigger` | `<M-Tab>` | the key that opens it, from any pane |
| `scope` | `session` | `tab`, `session` (every tab of it) or `all` (every session's) |
| `order` | `recent` | most recently used first, or `layout` (the tab's own order) |
| `width` | `80` | the switcher's width, as a share of the window |
| `height` | `18` | how many terminal rows tall it is |
| `backdrop` | `30` | how much it dims what is under it, 0 to 100 |
| `card_width` | `220` | how wide one card is, in pixels |
| `preview` | `true` | draw each pane's last lines in its card, in its own colours |
| `preview_rows` | `14` | how many lines |

`pumi call pane_switcher.open` opens it from anywhere — a key, a script, a menu.

The float is `relative = "client"`: over the whole window rather than just its tab, so a switch
from any tab of the session still shows it, and `anchor = "center"` keeps it in the middle as the
window changes size. `backdrop` dims what is under it and takes the presses there, and
`dismiss = ["escape", "press"]` is the app's: it closes the float on Escape or a press outside
it, so the switcher handles neither key nor click itself. `focus: false` keeps it from becoming
the pane it is switching from: the tab's own state is untouched until a card is picked.
