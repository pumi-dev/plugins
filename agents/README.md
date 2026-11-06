# agents (pumi-agents)

What an agent in a pumi tab is told about the workspace it is in: a short guide to pumi, and a map
of the sessions, views, panes and tabs around it — once, at its start and first prompt, then only
what changed. It draws nothing: **the agents sidebar is the app theme's**
(`runtime/app/app/theme/default.tsx`, `cmd+b`), and this package has no `slots`.

```sh
pumi plugin add ~/Kitchen/pumi-plugins/agents   # links it; it starts with the app
```

## What an agent is told

The core owns the transport — the hook, the deadline, the framing — and a plugin owns what is
said: `agent.sending` fires when an agent starts or is sent a prompt, and this package answers
with the text. Its tab gets a block like this at the top:

```text
<pumi-context from="amresyd/agents">
<pumi>
You are in a tab of pumi, a terminal workspace. …
</pumi>
<pumi-panes>
$7 pumi (current)
  @3 main (current)
    :11 (focused)
      %129 π - Move plans out — /Users/amr/Kitchen/pumi — done (current)
    :12
      %130 zsh — /Users/amr/Kitchen/pumi/src
</pumi-panes>
</pumi-context>
```

The map's ids are pumi's: `$1` a session, `@2` a view, `:4` a pane, `%3` a tab. A view is a layout
of panes, a pane holds tabs with one in front, and a tab is what a program runs in. `(current)`
marks where the user is: the tab with the focus, and the view and pane that have it in the session
the user is in. `(zoomed)` marks a pane that fills its view; a tab in no pane is under
`(floating)`.

`context/guide.md` is the guide; `src/context.ts` builds the map from the model `src/snapshot.ts`
reads off the API (`session.list`, then `session.get` with `deep` — one call for a session's whole
tree), and `compose` decides what is said when: everything the first time (or when the agent asked
in full, after a compaction), only what changed at a prompt, nothing when nothing changed.

An agent that is turned off, or the master switch, and it is told nothing. Its own reports —
`@agent.status` (OSC 7501) — are what the map says of it; the hook that reports them, and the
`restore_command` a tab comes back with, are `pumi skill add`'s.

## Options

| Option | Default | |
| --- | --- | --- |
| `context` | `true` | Tell agents about your workspace. Off silences it for every agent. |
| `updates` | `changes` | `changes` tells an agent again when the tabs move; `start` only when its session starts. |
| `other_sessions` | `true` | Other sessions' tabs are in the map too. |
| `targets` | `{}` | Each agent's own switch, by agent id: `{"codex": false}` turns that one off. |

They are Settings → Plugins → Agents, or `~/.config/pumi/settings.json` under `options`
(`agents.context`, `agents.updates`, …).

## Tests

```sh
bun tools/link.mjs           # at the repository's root, once: the SDK's types as @pumid/types
bun test                     # the model, the map, the guide, the names, and the answer to a turn
bun run check                # tsc --noEmit
```

`src/wire.ts` is the worker's half with its dependencies as arguments (the source, the store, the
settings), so the tests hand it `test/fake.ts` — a session tree shaped as `session.get` with `deep`
answers it — and no pumi needs to be running. `src/main.ts` is only the wiring.
