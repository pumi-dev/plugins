# agent-chat

A chat button in the title bar of every Claude Code, Codex and pi (or omp) tab. It flips the tab in
place between the agent's own terminal and a rendered chat of the same live session, and back.

```text
  ● Claude Code  src/pumi                    ✦ ◫ ⊟ ✕   ← ✦ is the button
  ┌────────────────────────────────────────────────────┐
  │ ● Fixing the build   Claude Code          ▣ Terminal│
  │ you    the tests fail on main                       │
  │ ▸ Bash  cargo test                         ✓        │
  │ The failure is in …                                 │
  │ ┌────────────────────────────────────────────── ↑ ┐ │
  │ │ Message the agent… (/ for commands)             │ │
  └────────────────────────────────────────────────────┘
```

The TUI stays the session's only owner. Nothing restarts, and nothing is screen-scraped. The chat
reads the session file the agent writes and types what you send into its terminal. While the chat
shows, the TUI keeps running under it, and **Terminal** gives it back exactly as it was.

## How it works

- **The renderer.** The chat is the manifest's `renderers.terminal` (`ui.tsx` `Chat`): a
  renderer of the `terminal` block, drawn for one tab while its `@tab_renderer` option names
  this plugin (`amresyd/agent-chat`). The terminal keeps running under it, untouched, and shows
  again as it was when the option goes. The option is kept with the tab, so a tab that showed
  the chat shows it again after a restart, read again from its file. A terminal tab with no agent
  the chat reads is drawn as the terminal it is.
- **Reading.** The session file is `@agent.transcript` when the agent's hook gave it. Otherwise it
  is worked out from `@agent.session` and the tab's directory (`src/locate.ts`):
  - Claude: `~/.claude/projects/<encoded cwd>/<id>.jsonl`, falling back to any project folder,
    since a resumed session stays where it began.
  - Codex: `~/.codex/sessions/**/rollout-*<id>.jsonl`.
  - pi: `~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl`; omp's is under `~/.omp`.

  The chat reads the end of the file (**History read**, 4 MB by default), then each line appended
  (`src/tail.ts`). One parser per agent (`src/parse/`) turns records into lib/conversation's
  changes. A file that does not exist yet is looked for again until it does, since Claude writes
  it with the first prompt.
- **Following the session.** A new `@agent.session` or `@agent.transcript` (`/clear`, a resume)
  starts the new file. pi's file is a tree: the chat shows the branch its last entry is on and
  reads again when pi moves to another branch.
- **Status** is the hook's `@agent.status`.
- **Sending.** A prompt goes in as a bracketed paste, then Enter, and only while the agent waits
  for one. A one-line `/command` is typed rather than pasted. While the agent works, prompts are
  queued in the chat and sent in order when it is done; Stop sends Escape. A queued prompt's Steer
  types it in now, into the running turn (each agent takes a prompt submitted mid-turn); its Send
  Now sends Escape and puts it first. A prompt shows at once
  and is matched with the file's copy when the file says it.
- **Pictures.** A picture dropped on the chat (or on the field) is attached above it, shown as a
  thumbnail with its name, and taken off with its ×. It goes in when the prompt does: Claude Code
  and Codex are handed its path pasted alone, which is how their TUI attaches a dragged file; pi
  is told the path in the prompt itself (`promptParts`, `src/agents.ts`). Pictures show in the
  timeline when the session file records them, since an echo of them could not be matched with
  the file's copy. Any other dropped file is mentioned instead (below).
- **Files by `@`.** Typing `@` lists the agent's directory (`src/mentions.ts`: the palette's walk
  and fuzzy score, so `.gitignore`s are kept and `.git` is left out), directories too; Up/Down
  move, Tab or a click writes `@path` into the draft (a directory keeps its `/`), Enter does the
  same, Escape closes the list. A path with a space is quoted: `@"my file.md"`.
- **Commands by `/`.** The list holds the agent's own commands (`src/commands.ts`, per agent) and
  the ones made of files: Claude's `.claude/commands` and skills, Codex's `~/.codex/prompts`,
  pi's prompt templates and skills (`~/.pi/agent`, `~/.agents/skills`, the project's own). Those
  are read again every time a reader reads the conversation, at most every 15 s, so a new command
  file shows up without a reload. A command that opens a screen of the agent's own (`/model`,
  `/resume`, anything listed as `terminal`) shows the terminal once it is typed.
- **The model.** The picker beside Send (`src/models.ts`) switches the model while the agent
  waits. Claude Code lists its aliases (Default, Opus, Sonnet, Haiku, Opus Plan) and the models
  its settings and environment name; pi and omp list their settings' `enabledModels`, else what
  `--list-models` lists. A pick is pasted as `/model <name>`, and shows at once (the hook says the
  model only at the next turn). Claude Code's `/model` also saves it as the default for new
  sessions, as it does in its terminal. Codex's `/model` is a picker of its own, so it, and
  "More in …", open the agent's picker in its terminal.
- **Questions from the agent.** While a chat shows, the requests pumi holds for the tab
  (`agent.request`) are drawn as permission cards and answered with `agent.answer`. That covers
  Claude's permission prompts with Settings → "Answer permissions in pumi". When the agent is
  `blocked` with no request (it is asking in its own terminal), the chat says so and offers
  **Show the terminal**.
- **Editing a message.** A message of yours can be edited while the agent waits: a click on it (or
  its pencil) turns it into a field in place, with its text. Enter or ↵ sends it, which replaces
  the message and everything after it; Escape or × leaves it as it was. Only the conversation goes
  back, not files.
  - pi and omp go to that exact message through `pi/pumi-chat.ts`, the plugin's own extension
    (`/pumi-rewind <entry>`, which works like `/tree`). On first use the chat copies it to
    `~/.pi/agent/extensions/pumi-chat.ts` and runs `/reload`. The branch left behind stays in `/tree`.
  - Claude Code and Codex have no way to be sent to a given message, so the pencil opens their own
    way back in their terminal: Claude's `/rewind`, Codex's Escape Escape.
- **Focus.** The field takes the keyboard when the chat's pane gets the focus, and on a click
  anywhere in the chat that is not a drag over text or a click in another field.
- **Serving the conversation.** Every agent tab it reads gets `@agent.conversation` set to this
  package, unless another package already serves it. Then anything can read the conversation and
  send to it:
  - `<prefix>conversation.read(tab, since?)`
  - `<prefix>conversation.send(tab, command)`
  - the `<prefix>conversation.changed` event, which carries `{tab, changes, cursor, from}`
    (`from` is `null` for a new epoch: read again).

## Options

These are under **Agent chat** in Settings; their full names start with `amresyd.agent_chat.`.

- `auto`: on by default. Every agent tab the chat reads is shown as the chat as soon as its agent
  starts (and, at start or when turned on, every agent tab open then). A tab flipped back to its
  terminal stays there until an agent starts in it again; `@agent_chat.taken` on the tab says so.
- `key`: a chord that flips the focused agent tab, in the root key table. Empty by default; the
  title bar's button and the `toggle` command work regardless.
- `history_mb`: how much of a session file's end is read when the chat opens. Default 4, from 1 to
  64.

## Limits

- The chat shows what the agent writes to its file, so a reply appears as each message is
  written, not token by token.
- A picture is attached by its path, not its bytes: the agent's TUI reads the file. A picture from
  the clipboard has no file until something saves it, so it is dropped in as one.
- An `@path` goes in as text, as if typed and sent: the agent opens the file with its tools. Only a
  dropped picture is attached (Claude Code and Codex take its path pasted alone; pi is told it in
  the prompt).
- The mode can't be changed from the chat, nor Codex's model: their pickers are the TUI's.
- The `@` list walks the agent's directory on its first use, so a very big tree fills in a moment
  after the first few keys.
- Requests are only heard while some tab shows the chat. With none showing, an agent's hook gets
  `null` from pumi at once and asks in its own terminal.
- An agent that never reports its status (no hook) is taken to be ready 15 s after a prompt, so a
  queued prompt may arrive while it still works.

## Working on it

```sh
bun test                              # the parsers, the file finding, the tail, commands, mentions
./node_modules/.bin/tsc --noEmit -p .
```

The `/` list's keys (Up/Down/Enter taken from the field) need `interceptKeys` on `<textarea>`,
which is the app's own build: `(cd runtime/app && bun run addon)` in the pumi checkout. Without
it the list still works with Tab, a click, and Enter (through `onSubmit`).

The tests run on synthetic records shaped like each agent's files. No real session is copied into
them.
