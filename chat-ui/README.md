# Chat UI

<p align="center"><img src="preview.svg" width="640" alt="A Claude Code session as a chat: messages, a tool call, a permission card and the prompt"></p>

A chat view for your coding agents. Settings → Chat UI picks, for each agent, how it opens from a
pane's `+` menu:

| Mode | What runs | Agents |
| --- | --- | --- |
| Terminal | the agent's own TUI | all |
| Terminal + chat | the TUI, with the chat drawn over it; one click flips between them | Claude Code, Codex, pi, omp |
| ACP | a chat tab that runs the agent's ACP server | Claude Code, Codex, pi, Gemini, OpenCode, Copilot, Kiro |
| SDK | a chat tab that runs the agent over its own protocol | pi (`--mode rpc`), Codex (`app-server`), Claude Code (Agent SDK) |
| Off | left out of the `+` menu, and its tabs left alone | all |

The `+` menu lists the agents installed here whose mode isn't Off.

```sh
pumi plugin add pumi-dev/plugins/chat-ui
```

## Terminal + chat

Nothing restarts and nothing is screen-scraped. The chat reads the session file the agent writes
and types what you send into its terminal, which keeps running underneath. **Terminal** gives it
back exactly as it was.

- **Send while it works**: prompts queue in the chat and go in order when the agent is ready.
  Stop sends Escape.
- **`@` for files**: lists the agent's directory (`.gitignore`d files left out); pick one to add
  it to the prompt. A file in the prompt shows as its icon and name, and Backspace takes it whole.
- **`/` for commands**: the agent's own, plus Claude's `.claude/commands` and skills, Codex's
  prompts, and pi's prompt templates and skills. A command that opens a screen of the agent's own
  (`/model`, `/resume`) shows the terminal.
- **Pictures**: drop one on the chat or the prompt to attach it to the next prompt; rest the
  pointer on it to see it.
- **The draft stays** when the tab flips to the terminal and back.
- **Model picker** beside Send, for Claude Code and pi.
- **Permission prompts** as cards you answer in the chat (Claude's, with Settings → "Answer
  permissions in pumi").
- **Edit a message** you sent: click it, change it, Enter. pi goes back to that exact message
  (through a small pi extension the plugin installs on first use, `~/.pi/agent/extensions/pumi-chat.ts`);
  Claude Code and Codex open their own rewind.
- **For other plugins**: every agent tab it reads serves its conversation as
  `pumi_dev.chat_ui.conversation.read(tab, since?)`, `.send(tab, command)` and the
  `.changed` event.

The tab's toolbar has the button; *Chat UI: flip the focused tab between the terminal and the chat*
is in the palette.

## ACP and SDK tabs

The plugin runs the agent itself, under a small host process per tab (`src/session/host.ts`), so
the agent keeps running when the window closes and the tab finds it again. The host speaks ACP, or
the agent's own protocol, and the chat draws what it says as it is written: text token by token,
calls with their output, permission requests and an agent's questions as cards, its models in the
picker. A tab with a session continues it after a restart.

- *Chat UI: continue this terminal agent in a chat tab* hands a terminal agent's session to a
  chat tab, once its turn is over (its SDK mode when it has that mode chosen, else ACP).
- The toolbar's terminal button, or *Chat UI: continue this chat tab's session in the agent's
  terminal*, goes back to the TUI on the same session.
- ACP adapters that aren't installed are fetched with `npx` at a pinned version.
- **Claude Code's SDK mode** runs your installed `claude` through Anthropic's Agent SDK, signed in
  as it is. Anthropic asks apps built on the Agent SDK to sign in with an API key; on a Pro or Max
  sign-in this use may be billed as extra usage. Terminal + chat runs the unmodified `claude` and
  has no such question.

## Keys

They work wherever the keyboard is in the chat. A pane given the focus puts it in the prompt.

| | |
| --- | --- |
| Enter, Shift+Enter | send; a new line |
| Esc | close the `/` or `@` list, or the edit; else stop the agent while it works |
| ↑ / ↓ | in an empty prompt, the prompts you sent before, and back |
| ↑ ↓ Tab Enter | in the `/` or `@` list, move and pick |
| ⌃1 … ⌃9 | answer the waiting permission with its first … ninth button |
| any letter | typed while a button has the keyboard, it goes into the prompt |

## Options

Settings → Chat UI.

| | |
| --- | --- |
| Agents | one dropdown per agent: its mode (above) |
| Key | a chord that flips the focused agent tab (none) |
| History read | how much of a session file's end is read when the chat opens (4 MB) |
| Bun | the Bun that runs ACP and SDK tabs' hosts (the app's own) |

## Limits

- In Terminal + chat, a reply shows as each message is written to the session file, not token by
  token, and the mode can't be changed from the chat, nor Codex's model: those pickers are the TUI's.
- In ACP and SDK tabs, going back to an earlier message is the agent's own, in its terminal; and
  the agent's own list of sessions to pick from is ACP's only.
- An agent without pumi's hook (`pumi skill add …`) is taken to be ready 15 s after a prompt, so a
  queued prompt may arrive while it still works.

## Development

```sh
pumi plugin dev chat-ui   # link it, reload on save
bun test                  # the parsers, finding session files, the conversation model, mentions, commands, keys, the hosts
```

The tests run on synthetic records shaped like each agent's files; no real session is in them.
`src/conversation/` is the agent-agnostic conversation (the model, its changes, the chat's drawing),
`src/parse/` turns each agent's session file into it, and `src/bridge.ts` follows one tab.
`src/catalog.ts` lists the agents and their modes; `src/sessions.ts` runs the ACP and SDK tabs, and
`src/session/` is their host: one engine per protocol (`acp.ts`, `pi.ts`, `codex.ts`, `claude.ts`),
tested against stand-ins of each (`test/session/`).
