# stacks

A pumi UI theme that lays the window out as stacked columns in one sideways scroll, after the
stacked notes on [Andy Matuschak's site](https://notes.andymatuschak.org). The text, bars,
colours and side bar are the default theme's.

- **Every tab of the session is a column**: its views are joined into one strip, in their order, each view's tabs in its layout's order. A column's bar is the default pane bar: the tab's icon and title, plugins' toolbar buttons, **+** (a new terminal column beside it) and **×** (close the tab). ⌘D opens a new column too. Right-click a bar for the tab's menu.
- **The first column is the default side bar** (the session tree and the plugins' sections). ⌘B hides it.
- **Sort by dragging**: drag a column by its bar onto another; a line shows whether it lands before or after it. It moves beside that tab, into that tab's view if it was in another.
- **The last screen is a launcher**: everything a new tab can be (Terminal, the agents, Browser, …), the most used first. A row opens its tab as a new column at the end.
- **Columns stack as you scroll**: a column that reaches the left edge stays there and the next slides over it; once only a spine is left, the spine shows the column's title running down it. Click a spine to bring its column back. A focused tab is scrolled into view. Scroll with a sideways trackpad swipe, or shift and the mouse wheel.
- **Widths**: a new column is 90 terminal characters wide (Settings → Stacks → Column width). Drag a column's right edge to size it; double-click the edge for the default again.
- **Colours** follow your terminal colour scheme (Settings → Appearance) as the default theme's do, so a column and its terminal are one colour.

```sh
pumi plugin add ./stacks
pumi option set ui_theme stacks
```
