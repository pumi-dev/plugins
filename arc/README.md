# Arc

A UI theme for [pumi](https://pumi.dev): the window as [Arc](https://arc.net) has it. The window's
own buttons live in a cream sidebar at the left — back, forward and reload on the tab in front, a new
tab, the tab's menu — under them an address pill that says where that tab is, a row of its own small
buttons, the tabs you pinned as pale letter tiles, and the session's views as folders of tabs. The
panes float beside the sidebar as rounded cards with soft shadows, a split's two side by side with a
gutter between them.

```sh
pumi plugin add amresyd/arc        # or: pumi plugin dev /path/to/arc
pumi option set ui_theme arc
```

Its settings are under the theme picker in Settings: **Appearance** (Arc's daylight cream, its dark
raisin, or the system's), **Arc's address bar over the browser's** (below), **Letter tiles for pages**
and **Blur behind the window** (not drawn yet).

## What the tab in front is

The pill says the tab's own thing, so a sidebar of pumi tabs still reads like a browser's:

- a **page** (the [browser](../../browser) plugin's tab, or any block that keeps a `url` option)
  says its **site**, `howtogeek.com`, and a press on it makes it a field: type, press Enter, and the
  page goes there — a bare line is the plugin's own search.
- a **terminal** says `Terminal`, an **agent** `Agent`, an editor `Editor`: the tab's block, in a word.
- a tab that is not a page and that the pill is typed into **opens a page** beside it, as Arc's
  address bar makes a new tab.

## The browser's own bars

The browser plugin draws its own toolbar and foot inside a page's tab. Arc has one address bar, so
the theme paints its bar over the first and its address along the second: the page fills the card,
Arc's pill is the address. The page, its block's methods and everything an agent reads of it stay the
plugin's — nothing of it is reimplemented.

Those bars are 32 and 20 pixels; if a plugin version changes them, turn **Arc's address bar over the
browser's** off and the browser's own toolbar shows inside the card again.

## Corners

A page is a native view: the window cannot clip it to a rounded corner. The theme cuts each card's
four corners with squares of the window's colour painted over the page, and its bar and foot carry
the rounded corners themselves — the same trick that lets a menu paint over a page.

## What it keeps

The pinned tabs, the folders you opened and the sidebar's width, across restarts.

Dragging works the Arc way: a tab dragged beside another row, onto a folder, or onto a card — which
splits it on whichever side it is dropped.

## Notes

A theme's `theme.tsx` is reloaded by `pumi plugin dev`; a file it imports (`parts.tsx` here) is not,
until pumi restarts. Editing the parts needs the app restarted.
