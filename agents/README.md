# agents (pumi-agents)

What an agent in a pumi pane is told about the workspace it is in: a short guide to pumi, and a
map of the sessions, tabs and panes around it — once, at its start and first prompt, then only
what changed. It draws nothing: **the agents sidebar is the app theme's**
(`runtime/app/app/theme/default.tsx`, `cmd+b`), and this package has no `slots`.

```sh
pumi pack add ~/Kitchen/pumi-plugins/agents   # links it; it starts with the app
```

## What an agent is told

The core owns the transport — the hook, the deadline, the framing — and a plugin owns what is
said: `agent.sending` fires when an agent starts or is sent a prompt, and this package answers
with the text. Its pane gets a block like this at the top:

```text
<pumi-context from="amresyd/agents">
<pumi>
You are in a pane of pumi, a terminal workspace. …
</pumi>
<pumi-panes>
$7 pumi (current)
  @42 Commit Pending Changes
    %129 π - Move plans out — /Users/amr/Kitchen/pumi — done
</pumi-panes>
</pumi-context>
```

`context/guide.md` is the guide; `src/context.ts` builds the map from the model `src/snapshot.ts`
reads off the API (`session.get`, `tab.get`, `pane.list` and each pane's options under it), and
`compose` decides what is said when: everything the first time (or when the agent asked in full,
after a compaction), only what changed at a prompt, nothing when nothing changed.

An agent that is turned off, or the master switch, and it is told nothing. Its own reports —
`@agent_status`, `@program_status` (OSC 7501) — are what the map says of it; the hook that
reports them, and the `restore_command` a pane comes back with, are `pumi skill`'s.

## Options

| Option | Default | |
| --- | --- | --- |
| `context` | `true` | Tell agents about your workspace. Off silences it for every agent. |
| `updates` | `changes` | `changes` tells an agent again when the panes move; `start` only when its session starts. |
| `other_sessions` | `true` | Other sessions' panes are in the map too. |
| `targets` | `{}` | Each agent's own switch, by agent id: `{"codex": false}` turns that one off. |

They are Settings → Plugins → Agents, or `~/.config/pumi/settings.json` under `options`
(`agents.context`, `agents.updates`, …).

## Tests

```sh
bun tools/link.mjs           # at the repository's root, once: the SDK's types as @pumid/types
bun test                     # the map, the guide, the names, the model: no pumi running
bun run check                # tsc --noEmit
```

The tests cover the pure modules (`src/*.ts`); the worker half (`src/main.ts`) is the wiring.
