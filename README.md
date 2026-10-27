# pumi-plugins

Plugins for [pumi](https://pumi.dev), the terminal workspace for coding agents. Each directory is
one plugin: TypeScript on Bun, whose `package.json`'s `pumi` key is its manifest — what it
contributes, read without running it. Its `src/main.ts` runs in a worker (the logic: functions,
events, options), and its `src/ui.tsx` draws in the window, in React; both `import … from "pumi"`.
pumi's plugin API is [docs/user/plugins.md](https://github.com/pumi-dev/pumi/blob/main/docs/user/plugins.md)
in its repository.

pumi's model is session → view → pane → tab: a session holds views, a view is split into panes,
and a pane holds tabs, each a terminal, a file or a plugin's own block.

## The plugins

| Directory | What it does |
| --- | --- |
| [`acp`](acp) | Coding agents over ACP (Claude, Codex, pi, Gemini, OpenCode, Copilot, any ACP agent) in tabs of their own, drawn as a chat; the agent outlives the app |
| [`agent-chat`](agent-chat) | A button on every Claude Code, Codex and pi tab that flips it between the agent's terminal and a rendered chat of the same live session |
| [`agent-overview`](agent-overview) | Every agent in this pumi in one tab: who is working, who is blocked, and where; a row goes to its tab |
| [`agents`](agents) | Tells each agent about the workspace it is in: a short guide to pumi and a map of the sessions, views and tabs around it, then only what changed |
| [`attention`](attention) | A notice each time the count of agents waiting for you goes up |
| [`csv`](csv) | CSV, TSV and other delimited files as a table you can sort, search, resize and copy from, in a file tab |
| [`files`](files) | The project tree in the side bar, with git's marks: open, rename, trash, drag and filter files |
| [`gather`](gather) | A UI theme: the window as a pixel-art office in Gather's style, views as rooms and panes as desks |
| [`git`](git) | The repository in the side bar: changes as a path tree to stage, unstage, discard and commit, the history, and a native diff tab |
| [`heavy-terminals`](heavy-terminals) | Notices terminals whose processes eat the machine, and suspends their foreground job as ctrl+z would |
| [`heeler`](heeler) | The host for the [Heeler](https://heeler.app) mobile app on the machine's own SSH: herdr's API over pumi, QR pairing, notifications and Live Activities |
| [`image-preview`](image-preview) | Not ported: an image preview written for an older plugin shape, kept for its parts; pumi does not load it |
| [`insert-path`](insert-path) | Type `/` in a terminal and pick a file: a floating fuzzy picker types the path in |
| [`kanban`](kanban) | A board of cards over the window: write a brief, drag the card to start an agent on it, and the board follows the agent's state |
| [`marmaide`](marmaide) | Mermaid diagrams in a tab, drawn by Pele, and a `draw` function an agent explains things with |
| [`monaco`](monaco) | Monaco, VS Code's editor, drawing the core's file tabs, themed by the window |
| [`nudge`](nudge) | An OS notification when an agent is blocked or done, taken back when it stops being either |
| [`office`](office) | A UI theme: a pixel office you walk around, a desk for every view (or tab) with its agent at it |
| [`p-rex`](p-rex) | A UI theme in the terminals' own colours, a little see-through, with the views in a list down the side |
| [`p3`](p3) | A UI theme after T3 Code: flat graphite, every view a thread in the side bar under its project |
| [`palette`](palette) | The command palette: `cmd+shift+p` runs any command, `cmd+p` finds a file in the project |
| [`pane-switcher`](pane-switcher) | Alt-Tab for tabs: a row of cards showing what each tab holds, to pick one |
| [`perf`](perf) | How the app is doing, floating in a corner: CPU, memory, frames, core plugins and the busiest threads |
| [`pi-session`](pi-session) | Two buttons on every pi tab: Fork opens `pi --fork <session>` beside it, Copy copies the session |
| [`pumi-dog`](pumi-dog) | A little dog in the side bar that walks its track, wags, blinks, and barks when you click it |
| [`queue`](queue) | Commands that run one at a time, each after the tab it waits for is done, with a bar in the tabs that have work |
| [`scripts`](scripts) | A side bar page of everything a repository can run: every `package.json`'s scripts and its shell scripts, each run in a terminal |
| [`simulator`](simulator) | An iOS Simulator in a tab: serve-sim streams it, a web view draws it, touches go back to the device |
| [`tab-rename`](tab-rename) | Names each view after what its agents are working on, with Apple's on-device model |
| [`usage`](usage) | How much of your AI plans is left (Claude, Codex, Copilot, OpenRouter), in a section of the side bar |
| [`win98`](win98) | A UI theme: Windows 98, with a window for each view, a taskbar and a Start menu |
| [`lib/conversation`](lib/conversation) | A library, not a plugin: the agent-agnostic conversation, its ACP mapping and the chat `agent-chat` and `acp` draw |
| [`lib/script-panel`](lib/script-panel) | A library, not a plugin: the script list `scripts` draws, and running a script in a terminal |
| [`tools`](tools) | `link.mjs` links pumi's SDK types into every package; `all.mjs` runs every package's tests and type check |

## Install

You need pumi; `pumi` is on the `PATH` of every tab. A plugin can be installed from GitHub by its
directory, or linked from a checkout of this repository:

```sh
pumi plugin add pumi-dev/pumi-plugins/scripts   # from GitHub: the scripts directory of this repository
pumi plugin add ./scripts                       # from a checkout, at its root: links the directory
pumi plugin dev ./scripts                       # links it, reloads it on every save, prints its log
```

A linked plugin runs from its directory, so an edit is picked up by `pumi plugin update
amresyd/scripts` (or by `pumi plugin dev`, which reloads it itself). `pumi registry list plugin`
lists what is installed, `pumi plugin logs scripts` shows what one said, and `pumi plugin remove
amresyd/scripts` takes it away (a linked directory stays).

Everything a plugin names is prefixed `owner.name.`: its options, functions and blocks. The owner
is the manifest's, `amresyd`, for a plugin linked from a checkout (`amresyd.scripts.max_depth`),
and the GitHub owner, `pumi_dev`, for one installed from GitHub (`pumi_dev.scripts.max_depth`). The
examples in each plugin's README use the linked names. Options are in Settings, on a page per
plugin, or `pumi option set`:

```sh
pumi option set amresyd.scripts.max_depth 6
pumi option set ui_theme win98                  # a UI theme, once its plugin is installed
```

A plugin runs with your permissions and no sandbox; each manifest's `uses` (`files`, `processes`,
`network`) says what it needs.

## Develop and test

A pumi checkout beside this one (`../pumi`, or `$PUMI_SRC`) gives the packages pumi's SDK types,
and its `runtime/app` dependencies (`bun install` there) give them `tsc`:

```sh
bun tools/link.mjs        # links the SDK's types as @pumid/types into every package; again after adding one
bun install               # the packages' own npm dependencies (csv, heeler, marmaide, monaco)
bun run test              # every package's tests and types, at once (bun tools/all.mjs)
cd scripts && bun test    # one package's tests: no pumi needs to be running
cd scripts && ./node_modules/.bin/tsc --noEmit -p .   # its types
```

What a package does with the API itself is tried in the app, with `pumi plugin dev`.
[CONTRIBUTING.md](CONTRIBUTING.md) has the conventions, and [AGENTS.md](AGENTS.md) the details for
coding agents.

## License

GPL-3.0-or-later; see [LICENSE](LICENSE). `palette/src/nucleo.ts` is MPL-2.0. Third-party code, including Zed's, is listed in [NOTICE](NOTICE).
