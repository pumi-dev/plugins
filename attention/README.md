# attention

Says so when an agent is waiting for you: a notice, `An agent is waiting for you` or
`3 agents are waiting for you`, each time the count of blocked agents goes up.

```sh
pumi plugin add ./attention
```

An agent's state is its tab's `agent` trait (`@agent.status`: `working`, `blocked`, `done`, `idle`,
`error`), which the agents' hooks report (`pumi skill add` installs them). The package counts the
tabs whose agent says `blocked` whenever an agent's state changes or a tab closes, and says so only
when the count is higher than at the last look: two agents blocking in the same turn give one
notice, and an agent that is answered gives none. It contributes no slot and has no `ui.tsx`.

## Options

Their full names start `amresyd.attention.`.

| Option | Default | |
| --- | --- | --- |
| `bounce` | `once` | `none`, `once` or `until_focus`: how the Dock icon is to bounce when an agent is blocked and the app is in the background. `none` also turns the notice off. |
| `badge` | `false` | Badge the icon with how many agents are blocked. |

The package does not bounce the Dock or badge the icon itself yet: what it does is the notice, and
a change to either option counts the agents again.

## Working on it

```sh
bun test                                # the count and what is said, in src/count.ts
./node_modules/.bin/tsc --noEmit -p .   # the types
```
