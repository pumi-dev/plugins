# pumi-dsh

DeepSeek Harness agents in a tab of their own. Each tab is one `dsh --profile sdk` runtime, driven
over the harness's own SDK stdio protocol and drawn as a chat.

The harness keeps everything that is the harness's: its tools, sandbox, permission presets, plugins,
skills and durable sessions. This plugin only starts it, sends what you type, and draws what comes
back — so a tab behaves like the harness you configured, not a reimplementation of it.

## Start one

- The new-tab `+` menu's **DeepSeek Harness** row, or
- the palette's **DSH: new agent**, or
- `pumi call amresyd.dsh.new`

The tab opens where you pressed `+`, as one of that pane's tabs, and its agent starts at once.

## What a tab draws

The conversation: your prompts, the assistant's replies, every tool call with its result, and the
harness's own errors (a failed turn, a rejected model request) as they are. The header carries the
session title, the provider/model route, the permission preset and the sandbox mode. A tool that
the harness would ask about puts an **Allow once / Reject** card in the conversation; the prompt
box is under it, Enter sends.

## Options (Settings → DeepSeek Harness)

| Option | Default | |
|---|---|---|
| `binary` | auto | The `dsh` a tab runs. Auto: the first on the machine, else the Desktop install's launcher. |
| `home` | `$DSH_HOME`, `~/.dsh` | Where the harness keeps profiles, credentials and sessions. |
| `profile` | `sdk` | `sdk` (full agent) or `sdk-minimal` (shell, `read_image`, compaction). |
| `provider` | `deepseek-account` | `deepseek-account` (signed-in account), `deepseek-official` (API key), or another route the profile mounts. |
| `model` | `deepseek-flash` | The model id that route resolves. |
| `effort` | model default | `off`, `low`, `high`, `max`. |
| `max_tokens` | model default | Per-request output cap for the agent and its in-process subagents. |
| `cwd` | the tab's, else home | Where the agent starts. |

**A model route has to work.** The account route needs credit, or an API key saved in the harness's
own Settings (`$DSH_HOME/.credentials.yaml`); an account that cannot pay answers a failed turn with
`Insufficient Balance`, which the tab shows as an error row rather than a silent nothing.

## Use your own gateway key (OpenRouter, OpenAI, any pi-ai route)

The `sdk` profile mounts `dsh-llm-pi-ai` with no routes configured. `Gateway routes` is that
plugin's `providers` dictionary, and the plugin writes it as a `--patch` layer for the runtime — no
file in the harness home to edit:

| Option | Value |
|---|---|
| `Gateway routes` | `{"openrouter": {"apiKeyEnv": "OPENROUTER_API_KEY"}}` |
| `Key variable` | `OPENROUTER_API_KEY` |
| `Gateway key` | your key (kept in the keychain) |
| `Provider` | `openrouter` |
| `Model` | an OpenRouter id, e.g. `deepseek/deepseek-v4-flash` |

A route pi-ai does not ship is declared the same way with `api`, `baseURL` and `models`. Without the
key option, the variable is taken from pumi's own environment, so launching pumi from a shell that
exports `OPENROUTER_API_KEY` works too. Model ids come from pi-ai's catalog: the shipped OpenRouter
route lists 401 chat models (`deepseek/deepseek-v4-flash`, `anthropic/claude-sonnet-4.5`, …).

## How it works

```
+ / palette / pumi call
   → src/main.ts      one Agent per tab, keyed by the tab id
   → src/harness.ts   spawn `dsh --profile sdk` (DSH_HOME set), one session per tab
   → src/rpc.ts       newline-delimited JSON-RPC 2.0 over the child's stdio
                      initialize → session/prompt → session.event notifications
                      approval/request, user-question/ask answered from the tab
   → ui.post("chat/<tab>", snapshot)  →  src/ui.tsx (useChannel) draws it
```

The snapshot is posted whole on every change, so a tab that mounts late draws exactly what one open
all along would. A closed tab stops its agent; the tab → session id map lives in the plugin's state
directory, so a reopened tab continues the same harness session.

## Limits

- **No question UI yet.** A harness `ask_user_question` (including a plan review) is answered
  `cancelled`, and the conversation says so. Plan mode, therefore, cannot be approved from here.
- **No streaming mid-turn.** Rows appear as the harness commits events; assistant text arrives with
  `assistant/message`, not token by token.
- **Tool output is clipped** to 4,000 characters per result, and a conversation keeps its last 400
  rows.
- **No cancel.** The SDK protocol this profile serves has no cancel request; Stop ends the runtime.
- One runtime per tab; the harness's own web UI, if you run it, is a separate process.
