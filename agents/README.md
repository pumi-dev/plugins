# agents (pumi-agents)

Every space, tab and agent in this pumi at a glance: which agents are working, which need you and
which are done — and a click to go straight to them. It is pumi's core agents plugin ported to a
package, and it also carries the guide and the restore recipes an agent is told.

```sh
pumi pack add ~/Kitchen/pumi-plugins/agents   # links it; the page joins the app's side bar
cmd+shift+a                                   # show or hide that side bar (the app's own key)
```

## The page

It is the manifest's `contributes.points["panel"]` view (`ui.tsx`'s `Agents`), drawn by the app's own
side bar with the theme's section header over it.

- **Attention** on top: what is blocked or failed, why (`needs permission`, `has a question`,
  `needs a login`, `failed`), what it last said, and where it is.
- **A space** (a session) with its tabs and their panes, folded by a press on its header. A space
  of one tab is that tab's panes; a tab of one agent is that agent, as the core draws them.
- **A row** says what a pane is: its title, its folder, and its agent's state — the mark and the
  word, in the theme's `agent.working`, `agent.blocked`, `agent.done`, `agent.error`, `agent.idle`.
- **A click** goes there: a pane's row to its pane, a tab's to its tab, a space's to its session.
- **A search** above the list, matching titles, tab names and spaces without case while you type.
- **Rename** a space or a tab from its `⋯` menu: the name is a text field on the row itself.
- **`+`** at the top opens a space; a space's `+` a tab in it. **`×`** closes a pane, a tab or a
  space (a space's `Remove`, and a tab's `Close`, are in its menu).
- **Drag** a pane onto another (they trade places), onto a tab (it joins it), or a tab onto another
  tab or a space (it moves).

Nothing is guessed and nothing is read off a screen: an agent's state is its pane's
`@agent_status` and `@program_status`, which the agent itself reports (OSC 7501). `pumi skill
setup` installs the hooks that report for agents that cannot report for themselves.

## What it reads

The core plugin is pushed a snapshot with every change. A package is not, so this package reads
`server.getState` — the whole model as `client.attach` sends it — once per batch of events that
move it (`pane.*`, `tab.*`, `session.*`, `client.attached`, `terminal.*`, `cwd.changed`,
`layout.changed`, and the `@agent_status`-like options), plus a slow clock for what never said so.
`src/snapshot.ts` maps that model the way the app maps it for the core plugin
(`src/runtime/pumid/wire.rs`), so the rows read the same fields.

## Options

| Option | Default | |
| --- | --- | --- |
| `context` | `true` | Tell agents about your workspace. Off silences it for every agent. |
| `context_updates` | `changes` | `changes` tells an agent again when the panes move; `start` only when its session starts. |
| `context_other_sessions` | `true` | Other sessions' panes are in the map too. |
| `context_targets` | `{}` | Each agent's own switch, by agent id: `{"claude": true}`. |
| `restore` | `{}` | Restore recipes, by agent id: `{"codex": ["codex", "resume", "{session}"], "cursor": []}`. |

## The two functions

```sh
# What an agent in pane 3 is told now: the guide and the map once, then only what changed.
pumi call amresyd.agents.context '{"agent":"claude","pane":3,"event":"prompt"}'
# The line that resumes a session, from `agents.restore` and the recipes pumi ships.
pumi call amresyd.agents.restore '{"agent":"claude","session":"abc-123"}'
```

`context/guide.md` is the guide, byte for byte the one the core ships. **The hook is not here**:
installing hooks, reporting an agent's state and writing its pane's `restore_command` are `pumi
skill`'s (the CLI and the core). This package can answer what a hook would hand an agent, and the
line a hook would write.

## Tests

```sh
bun install                    # this package's dependencies, if it grows any
bun scripts/link.mjs           # at the repository's root, once: the SDK's types as @pumid/types
bun test                       # the rows, the guide and the recipes: no pumi running
bun run check                  # tsc --noEmit
```
