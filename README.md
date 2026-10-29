# pumi plugins

Plugins for [pumi](https://github.com/pumi-dev/pumi), one folder each. Install one by its folder:

```sh
pumi plugin add pumi-dev/plugins/file-tree
```

| Plugin | |
| --- | --- |
| [Launcher](launcher) | a tab that lists what you can open in it, for new tabs |
| [Terminal](terminal) | a shell in a tab |
| [File Tree](file-tree) | the project tree in the sidebar: open, rename, move, trash and search files, with git's marks |
| [Git](git) | stage, commit, history and diffs in the sidebar |
| [Browser](browser) | a web page in a tab, with an address bar, and where a terminal's links open |
| [iOS Simulator](simulator) | an iOS Simulator in a tab you can tap and type into, with screenshots for agents |
| [Code Editor](code-editor) | a native code editor for file tabs, built on CodeMirror |
| [VSCode Editor](vscode-editor) | VS Code's editor (Monaco) for file tabs |
| [CSV Viewer](csv-viewer) | CSV and TSV files as a table you can sort, search and edit |
| [Agents](agents) | coding agents from the + menu, in their terminal or a GUI, told about the workspace around them |
| [Pixel Office](pixel-office) | a UI theme: pumi as a pixel-art office with a desk for every view |
| [Music Studio](music-studio) | a song in a tab, laid out as GarageBand does, measured bar by bar for agents |

Each folder is a whole plugin with nothing shared between them, so you can copy one and make it
your own. `pumi plugin dev <folder>` links it into pumi and reloads it on save; its README says how
to test it.

GPL-3.0-or-later.
