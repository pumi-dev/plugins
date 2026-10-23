# pane-switcher

Alt-Tab for tabs. The trigger (`trigger`, `<M-Tab>` — Option-Tab on a Mac) puts a row of cards
over the window, dimming what is under them, one per tab, as a task switcher shows its windows:

```text
▦ Switch pane  3                                  ← → choose · enter go · esc close
┌──────────────────┐┌──────────────────┐┌──────────────────┐
│ ~/code/pumi      ││ $ cargo test     ││ https://…        │
│ $ git status     ││ running 3 tests  ││  Docs · Guide    │
│ M Cargo.toml     ││ test api …  ok   ││                  │
│──────────────────││──────────────────││──────────────────│
│ ▸ pumi           ││ ▸ zsh            ││ ▸ Docs           │
└──────────────────┘└──────────────────┘└──────────────────┘
```

Each card is drawn from what the tab itself says: the app's own screen of the tab above
(`<preview>`, the grid the app parsed from the tab's bytes, scaled to the card — nothing is
attached and nothing is resized to take it), then the tab's title or the program in it, its
number and directory, and the agent's state when one reported it (`@agent.status`).
A card's icon is its tab's block (`terminal`, or a plugin's).
The highlight starts on the tab you are in; the cards are in most-recently-used order, so the
next one is where you were before. The trigger pressed again moves the highlight on instead of
replacing the switcher, as a held Alt-Tab does. The cards are centred in the float while they fit
in it, and start at its left edge and scroll when they do not.

`Enter` (or a click) goes to the highlighted tab, whichever view it is in. `Escape`, or a press
outside the cards, closes the switcher and changes nothing. `x` closes the highlighted tab. `1`–`9` pick a card directly; `←`/`→`, `Tab`/`Shift-Tab`, `↑`/`↓`,
`Ctrl-P`/`Ctrl-N` and `Home`/`End` move about.

## Options

| Option | | |
| --- | --- | --- |
| `trigger` | `<M-Tab>` | the key that opens it, from any tab |
| `scope` | `session` | `tab` (the view you are in), `session` (every view of it) or `all` (every session's) |
| `order` | `recent` | most recently used first, or `layout` (the view's own order) |
| `width` | `80` | the switcher's width, as a share of the window |
| `height` | `18` | how many terminal rows tall it is |
| `backdrop` | `30` | how much it dims what is under it, 0 to 80 |
| `card_width` | `220` | how wide one card is, in pixels |
| `preview` | `true` | draw each tab's screen in its card; off makes the cards just their titles |
| `preview_rows` | `14` | how many lines tall the screen a card shows is |

The palette's `Switch pane` command and `pumi call amresyd.pane_switcher.open` open it from
anywhere — a key, a script, a menu; the command replaces a switcher already up, and the trigger
pressed while it is up moves its highlight on instead (`src/keys.ts`).

The float is `relative: "client"`: over the whole window rather than just its view, so a switch
from any view of the session still shows it, and `anchor: "center"` keeps it in the middle as the
window changes size. `backdrop` dims what is under it and takes the presses there, and
`dismiss: ["escape", "press"]` is the app's: it closes the float on Escape or a press outside it,
so the switcher handles neither key nor click itself. `focus: false` keeps it from becoming the
tab it is switching from: the view's own state is untouched until a card is picked.

The trigger is mapped in the root key table (the server's `keys` option) as its option says, and follows `trigger`
when it changes: the key it was bound to is unmapped, and the new one mapped, in its place. The
switcher is the block `switcher` (`contributes.blocks`), drawn by `ui.tsx`'s `Switcher`. The cards
are read as the switcher opens: a switcher is momentary, so nothing of it is kept. Its logic is
`src/main.ts` (the worker: the trigger, the cards, the float) and what it draws is `src/ui.tsx`
(React: the row, the highlight, the keys). Work on it:

```sh
bun test                     # the cards and the keys, on their own
./node_modules/.bin/tsc --noEmit -p .   # types, both halves
```
