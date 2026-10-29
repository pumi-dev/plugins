# launcher

A tab that lists what you can open in it: a file, and whatever your plugins add to the `+` menu
(Terminal's shell, Browser's page, …), each with a key to press. What you pick takes the tab's
place, in the same pane.

```sh
pumi plugin add pumi-dev/plugins/launcher
```

## New tabs

Pick Launcher in Settings ▸ General ▸ New tabs open (pumi's `new_tab` option,
`pumi_dev.launcher.new`) and every new tab, split, view and session starts as the list. The start
screen does this when Launcher is among the plugins it installs.

## Keys

| Key | |
| --- | --- |
| `F` | a file, from the system's picker |
| `1` … `9` | the `+` menu's entries, in order |
| `↑` `↓`, `Enter` | choose one, open it |
| `Escape` | close the tab |

## The block

`pumi_dev.launcher.new` takes no arguments. `src/ui.tsx` draws it with the `tab.new` slot's
actions (`useSlot` from `pumi/theme`); `src/kinds.ts` is what the list holds, apart from drawing it.

## Testing

```sh
bun test
```
