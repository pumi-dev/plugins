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
./node_modules/.bin/tsc --noEmit   # the types
```

`themes/alltabs/theme.tsx` is the whole theme: it replaces `TabBar` and inherits every other part
from the app's default. `themes/alltabs/tabbar.tsx` is the grouped bar: every session's tabs, one
group a session, a hairline between groups, no names. Only the session in front gives its selected
tab the `active` look; pressing a tab of another session moves the window there first.

The setting is the package's own option (`all_sessions` in `package.json`'s `contributes.options`,
`on` by default), so Settings → Appearance shows it under All Tabs; `useThemeOption("all_sessions")`
reads it.

This theme was a Lua theme in `~/.config/pumi/themes/alltabs`, which extended the default one; this
package draws what it drew. The `src/` copies of the default theme's parts, the stylesheets and the
old test harness went with the CSS renderer: a `theme.tsx` replaces parts by name now, so nothing
needs extending.
