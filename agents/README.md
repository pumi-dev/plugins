# Agents

<p align="center"><img src="preview.svg" width="640" alt="A Claude Code session as a chat: messages, a tool call, a permission card and the prompt"></p>

A chat view for Claude Code, Codex and pi (or omp) tabs. One click flips the tab between the agent's
own terminal and a chat of the same live session, and back.

```sh
pumi plugin add pumi-dev/plugins/agents
```

Nothing restarts and nothing is screen-scraped. The chat reads the session file the agent writes
and types what you send into its terminal, which keeps running underneath. **Terminal** gives it
back exactly as it was.

- **Send while it works**: prompts queue in the chat and go in order when the agent is ready.
  Stop sends Escape.
- **`@` for files**: lists the agent's directory (`.gitignore`d files left out); pick one to add
  `@path` to the prompt.
- **`/` for commands**: the agent's own, plus Claude's `.claude/commands` and skills, Codex's
  prompts, and pi's prompt templates and skills. A command that opens a screen of the agent's own
  (`/model`, `/resume`) shows the terminal.
- **Pictures**: drop one on the chat to attach it to the next prompt.
- **Model picker** beside Send, for Claude Code and pi.
- **Permission prompts** as cards you answer in the chat (Claude's, with "Answer permissions in
  pumi" on).
- **Queued prompts reach the agent at its turn's end** through its stop hook (Claude Code, pi),
  rather than typed once it is idle.
- **Edit a message** you sent: click it, change it, Enter. pi goes back to that exact message
  (through a small pi extension the plugin installs on first use, `~/.pi/agent/extensions/pumi-chat.ts`);
  Claude Code and Codex open their own rewind.
- **For other plugins**: an agent tab is one with the plugin's trait, `@pumi_dev.agents.agent`
  (the agent's id; its fields `.session`, `.model`, `.transcript`, `.accepts`, `.conversation`), and
  its status is the tab's `@status`. Every agent tab it reads serves its conversation as
  `pumi_dev.agents.conversation.read(tab, since?)`, `.send(tab, command)` and the
  `.changed` event.

The tab's toolbar has the button; *Agents: flip the focused tab between the terminal and the chat*
is in the palette.

## Agent tabs

Settings → Agents → **Hooks** installs each agent's hook into the agent's own config (Claude
Code's `~/.claude/settings.json`, Codex's `~/.codex/hooks.json`, pi's extension
`~/.pi/agent/extensions/pumi-context.ts`, …), brings it up to date or takes it out; the user's own
hooks there are left as they are, and the first copy of a config is kept as `.pumi-bak`. A hook
runs only in a terminal opened for its agent, which has `PUMI_AGENT` set:

```sh
pumi call pumi_dev.agents.open claude [cwd]   # a terminal running Claude Code, its hook on
```

The hook tells the plugin the agent's session, model and session file, and its state (the tab's
`@status`); the tab shows the agent's mark (`@icon`) and, when the tab comes back after a restart,
resumes the session (`restore_command`).

## Options

Settings → Agents; the last two are under Hooks.

| | |
| --- | --- |
| Open agents as chats | show every agent tab as a chat as soon as its agent starts (on) |
| Key | a chord that flips the focused agent tab (none) |
| History read | how much of a session file's end is read when the chat opens (4 MB) |
| Answer permissions in pumi | ask Claude Code's permission prompts in pumi, the chat or any client; unanswered in two minutes, Claude asks itself (off) |
| Restore recipes | how each agent resumes its session when its tab comes back, by agent id (`{"claude": ["claude", "--resume", "{session}"]}`) |

## Limits

- A reply shows as each message is written to the session file, not token by token.
- The mode can't be changed from the chat, nor Codex's model: those pickers are the TUI's.
- An agent without its hook (Settings → Agents → Hooks) is taken to be ready 15 s after a prompt,
  so a queued prompt may arrive while it still works.
- A hook hands its input to `pumi call` as one argument: an input past the system's argument limit
  (128 KB on Linux; a permission to write a big file) fails, and the agent asks in its own prompt.

## Development

```sh
pumi plugin dev agents   # link it, reload on save
bun test                  # the parsers, finding session files, the conversation model, mentions, commands, the hooks
```

The tests run on synthetic records shaped like each agent's files; no real session is in them.
`src/conversation/` is the agent-agnostic conversation (the model, its changes, the chat's drawing),
`src/parse/` turns each agent's session file into it, `src/bridge.ts` follows one tab, and
`src/hooks/` is the agents' hooks: the table and their files (`integrations.ts`), and what the hook
function answers (`hook.ts`, `run.ts`).
