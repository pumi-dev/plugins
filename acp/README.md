# acp

Coding agents over [ACP](https://agentclientprotocol.com) (the Agent Client Protocol) in tabs of
their own, drawn as a chat: Claude, Codex, pi, Gemini, OpenCode, Copilot, or any agent that speaks
ACP. Each tab is an agent as a terminal's is (`@agent`, `@agent.status`, `@agent.session`), and its
agent outlives the app.

```sh
pumi plugin add ./acp
pumi call amresyd.acp.new '{"agent": "gemini", "cwd": "~/src/app"}'
```

## Commands

| Command | Function | |
| --- | --- | --- |
| **ACP: new agent pane** | `new {agent?, cwd?, pane?}` | a chat tab beside the current one; with `agent` its agent starts at once, without it the tab asks which |
| **ACP: open session…** | `open {agent?, cwd?, pane?}` | the same, to pick an agent and one of its sessions to load |
| **ACP: continue this terminal agent as an ACP pane** | `handoff {pane?}` | a terminal agent's session (its `@agent` and `@agent.session`), continued in a chat tab in its place: it waits for the agent's turn to end, closes the TUI, and loads the session |
| **ACP: back to terminal** | `back {pane?}` | the other way: the chat tab's session, resumed in the agent's own TUI in a terminal tab beside it, and the chat tab closed |

The titles are the palette's, from the manifest; the functions' full names start `amresyd.acp.`.
`pane` is a tab's number (`3` for `%3`); without one it is the tab in front.

## The agents

| Id | Started with | Signs in with | Resumes in its TUI with |
| --- | --- | --- | --- |
| `claude` | `claude-agent-acp`, else `npx -y @agentclientprotocol/claude-agent-acp@0.94.0` | `claude /login` | `claude --resume <session>` |
| `codex` | `codex-acp`, else `npx -y @agentclientprotocol/codex-acp@2.2.2` | `codex login` | `codex resume <session>` |
| `pi` | `pi-acp`, else `npx -y pi-acp@0.0.34` | `pi` | `pi --session <session>` |
| `gemini` | `gemini --acp` | `gemini` | — |
| `opencode` | `opencode acp` | `opencode auth login` | `opencode --session <session>` |
| `copilot` | `copilot --acp` | `copilot` | — |

Programs are looked for on `PATH` and in the places agents install themselves (`~/.local/bin`,
`~/.bun/bin`, `~/.cargo/bin`, …), since an app started from the desktop often has a short `PATH`.
An agent that needs a sign-in offers it in the tab, run in a terminal beside it.

## Options

Under **ACP** in Settings; their full names start `amresyd.acp.`.

- `agents` — more agents, or replacements for the ones above, by id:
  `{"goose": {"command": "goose", "args": ["acp"], "env": {}}}`, with optional `name`, `login` (a
  command line that signs in) and `resume` (the agent's TUI resuming `{session}`).
- `bun` — the Bun that runs each tab's host process. Empty is the app's own.

## How it works

Each chat tab's agent runs under a host process (`src/host.ts`), a Bun process the worker starts
detached: it starts the agent's ACP server, is its only client (`src/session.ts`), and serves the
conversation on a Unix socket under the plugin's state directory (`src/wire.ts`). The worker is a
client of each host, as any other could be; when the app or the server starts again it finds the
hosts again, or starts new ones that load the session. A host exits when its tab closes.

The worker relays the conversation to the tab's renderer (`ui.post`), serves it to anyone by the
conversation convention (`<prefix>conversation.read`, `send`, and the `conversation.changed`
event, as `agent-chat` does), and asks the agent's permission prompts through `request.open`, so
any UI can answer them. The chat itself is [`lib/conversation`](../lib/conversation)'s, with ACP
mapped onto its changes.

## Working on it

```sh
bun test                                # the host against a fake agent, the manifest
./node_modules/.bin/tsc --noEmit -p .   # the types
```

`test/fake-agent.ts` is an ACP agent the tests start in place of a real one.
