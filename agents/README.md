# agents (pumi-agents)

What an agent in a pumi tab is told about the workspace it is in: a short guide to pumi, and a
map of the sessions, views and tabs around it — once, at its start and first prompt, then only
what changed. It draws nothing: **the agents sidebar is the app theme's**
(`runtime/app/app/theme/default.tsx`, `cmd+b`), and this package has no `slots`.

```sh
pumi plugin add ./agents   # links it; it starts with the app
```

## What an agent is told

The core owns the transport — the hook, the deadline, the framing — and a plugin owns what is
said: `agent.sending` fires when an agent starts or is sent a prompt, and this package answers
with the text. Its tab gets a block like this at the top:

```text
<pumi-context from="amresyd/agents">
<pumi>
You are in a pane of pumi, a terminal workspace. …
</pumi>
<pumi-panes>
$7 pumi (current)
  @42 Commit Pending Changes
    %129 π - Move plans out — /Users/me/code/pumi — done
</pumi-panes>
</pumi-context>
```

`context/guide.md` is the guide; `src/context.ts` builds the map (`$` a session, `@` a view, `%` a
tab) from the model `src/snapshot.ts` reads off the API (every session, its views, and each tab
with its options), and
`compose` decides what is said when: everything the first time (or when the agent asked in full,
after a compaction), only what changed at a prompt, nothing when nothing changed.

An agent that is turned off, or the master switch, and it is told nothing. Its own reports —
`@agent.status` (OSC 7501) — are what the map says of it; the hook that reports them, and the
`restore_command` a tab comes back with, are `pumi skill add`'s.

## Options

| Option | Default | |
| --- | --- | --- |
| `context` | `true` | Tell agents about your workspace. Off silences it for every agent. |
| `updates` | `changes` | `changes` tells an agent again when tabs open, close or move; `start` only when its session starts. |
| `other_sessions` | `true` | Other sessions' tabs are in the map too. |
| `targets` | `{}` | Each agent's own switch, by agent id: `{"codex": false}` turns that one off. |

They are in Settings under **Agent context**, or `~/.config/pumi/settings.json` under `options`
(`amresyd.agents.context`, `amresyd.agents.updates`, …).

## Tests

```sh
bun tools/link.mjs           # at the repository's root, once: the SDK's types as @pumid/types
bun test                     # the map, the guide, the names, the model: no pumi running
bun run check                # tsc --noEmit
```

The tests cover the pure modules (`src/*.ts`); the worker half (`src/main.ts`) is the wiring.
