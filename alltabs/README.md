# All Tabs

A pumi UI theme: pumi's own window, with every session's tabs in the header — one group a session,
a separator between them, and no names. A tab of another session looks like a tab of that session:
only the session in front gives its selected tab the `active` look. Clicking any of them goes
there.

The rest of the window — the side bar, the docks, the panes, the status bar, the menus and the
session picker — is the default theme's, drawn the same way.

## Its setting

Settings → Appearance, under All Tabs:

- **Show every session in the header, not only the one in front** (`all_sessions`, on by default).
  Off, the header is the default theme's: the tabs of the session in front.

## Using it

```sh
pumi pack add ./alltabs      # links it into the running app
```

Then pick **All Tabs** in Settings → Appearance. It is a theme, not a plugin: nothing runs until
the window is drawn with it.

## Working on it

```sh
bun scripts/link.mjs               # at the repository's root, once: links @pumid/types
bun test                           # against pumi/testing, no pumi needed
./node_modules/.bin/tsc --noEmit   # the types
```

`themes/alltabs/theme.ts` is the whole window; `src/` is the default theme's parts, copied
(see the header of each file), until a theme can `extend` one. `themes/alltabs/base.css` is the
default theme's stylesheet for the same reason, and `themes/alltabs/style.css` is this theme's own
rules: the tab groups, and nothing else.

This theme was a Lua theme in `~/.config/pumi/themes/alltabs`, which extended the default one; this
package draws what it drew. The port is the default theme plus that grouping, because a TS theme
draws the whole window and cannot extend another yet.
