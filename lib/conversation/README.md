# conversation

What `agent-chat` and `acp` share: an agent-agnostic conversation, the one reducer that keeps every
copy of it the same, ACP mapped onto it, and the chat drawn from it. It is a **library**: no
view, command or option, so pumi never starts it. A package imports its files by relative path
(`../../lib/conversation/src/change.ts`), as `scripts` does `script-panel`.

| File | |
| --- | --- |
| `src/model.ts` | the types: `Transcript`, `Entry`, `Tool`, `Permission`, `ConfigOption`, `Cursor`, `Command`, … |
| `src/change.ts` | `Change`, `apply`, `coalesce`, the bounds, `Producer`, `follow`, the changes every producer says |
| `src/acp.ts` | ACP's `session/update`, `session/request_permission` and setup/prompt answers → `Change`s; commands → ACP calls |
| `src/diff.ts` | `unifiedDiff(path, old, new)`: a patch for `<diff>` |
| `src/view.ts` | what the chat says in words (pure, tested): grouping a turn's work, a call's headline, … |
| `src/markdown.ts` | the markdown agents write, as blocks and inline runs (pure, tested) |
| `src/question.ts` | a call that asks the user (`AskUserQuestion`, `ask_user_question`): its questions and answers |
| `src/ui.tsx`, `src/ui/*.tsx` | `<Conversation>` and its parts |

Only `ui.tsx` and `ui/` import `pumi`; the rest runs anywhere. Diffs are `lib/diff`'s.

## The contract

- **`Transcript`** is JSON: `{ epoch, seq, session?, status, entries, permissions, plan, options,
  commands, usage, queue, truncated }`. `status` is `idle | working | blocked | done | error`.
- **`Entry`** is `{ id, kind, at, … }`, kind `user | agent | thought | tool | plan | notice | image | turn`,
  with the field its kind has (`text`, `tool`, `image` + `from`, `plan`, `level`, `turn`; `clipped`
  when its text was cut). A **`Tool`** is `{ id, kind, title, status, input?, content, locations? }`,
  content `text | diff{path, old?, new, unified?} | terminal{output, exitCode?, id?} | image`.
- **`Change`**: `push`, `append` (text delta), `replace`, `tool` (patch a call), `truncate`, `status`,
  `permissionAsked` (status becomes `blocked`), `permissionResolved` (none left: back to `working`),
  `plan`, `options`, `commands`, `usage`, `session`, `queue`. `apply(t, change)` answers a new
  transcript and throws `ChangeError` when the change does not fit.
- **`Cursor`** is `{ epoch, seq }`, a transcript's own two fields. Changes go out in **batches**
  (`{ type: "changes", from, to, changes }`); each moves `seq` by one. A **snapshot** is
  `{ type: "snapshot", transcript }`. A new epoch (the producer restarted, the session reloaded)
  means a snapshot.
- **`Command`** (view → producer), each with a `CommandId` so a resend is acted on once
  (`CommandLedger`): `prompt{text, images?}`, `cancel`, `answer{permissionId, optionId}`,
  `setOption{category, value, option?}`, `unqueue{queued}`, `steer{queued}` (a queued prompt
  into the running turn, where the producer can), `sendNow{queued}` (the turn cancelled, that
  prompt next), `rewind{entry}` (back to before a
  user message), and a `prompt` with `replaces: entry` is an edit of that message. An `answer` to
  a question may carry `text`. The producer answers an `Ack {id, rejected?}`.

## A producer

```ts
import { Producer, promptChanges, endTurnChanges } from "../../lib/conversation/src/change.ts";
import { fromSessionUpdate, fromPermissionRequest } from "../../lib/conversation/src/acp.ts";

const producer = new Producer({ publish: (update) => emit("conversation.changed", { pane, update }) });
producer.push(...promptChanges(text, [], producer));                       // the user's prompt
producer.push(...fromSessionUpdate(producer.transcript, update, producer)); // each session/update
// conversation.read(pane, since?) answers:
producer.read(since);                                                       // the batches missed, or a snapshot
```

`push` applies at once (so the next mapping reads the transcript as it now is) and cuts to the
bounds (`BOUNDS`: 2000 entries, 4M of text, 256k per entry; a terminal keeps its tail); at most
every 60 ms what is pending goes out as one batch, consecutive appends joined. `snapshot()` and
`read()` publish what is pending first. The producer is the `Stamp` mappings take: entry ids
(`<epoch prefix>.<n>`) and the time.

## A view

```tsx
import { follow } from "../../lib/conversation/src/change.ts";
import { Conversation } from "../../lib/conversation/src/ui.tsx";

const [transcript, setTranscript] = useState<Transcript>();
// on each update: the next transcript, or undefined → read again without a cursor
const next = follow(transcript, update);
<Conversation transcript={transcript} onCommand={(command) => void send(pane, command)} autoFocus />;
```

`Conversation` takes `{ transcript, onCommand, pageSize?, autoFocus?, placeholder?, onLink?,
hideHeader?, onMentions?, images?, rewinds?, rewindsIn?, steers? }`. Its parts stand alone: `Header {transcript, onOption?}`,
`Timeline {transcript, pageSize?, onLink?}`, `EntryView`, `ToolCard`, `ToolPart`, `PlanList`,
`Thought`, `PermissionCard {permission, onAnswer, autoFocus?}`, `Composer {status, commands?,
queue?, onSend, onStop?, onUnqueue?, onSteer?, onSendNow?, onMentions?, cwd?, images?, dropped?, placeholder?, autoFocus?,
disabled?}`, `OptionPicker`. Enter sends, Shift+Enter is a new line; the last `pageSize` (60)
entries show, "Show earlier" brings more.
The queue is a card over the field (`QueueCard`): it folds, Clear All (⌥⌘⌫) takes every prompt
back, and each row has Delete, Edit (back into the field), Steer (⌃⌘S, only with `onSteer`) and
Send Now. The keys and Enter with nothing written act on the first row. Colours are the theme's (`useTextTheme` gives them to
`<markdown>`, `<code>`, `<diff>`, `<textarea>`).

`Press {onClick, disabled?, focusableWhenDisabled?, role?, style?}` is what presses: the SDK has no
button, so it is a `div` with the `button` role (or `option` in a list), a tab stop, pressed by a
click, Enter or Space.

### The composer's picks

`/` lists the transcript's `commands`, `@` lists the files `onMentions(query)` answers (paths as
the draft writes them, `MentionHit {path, dir?}`: `agent-chat`'s walk of the agent's directory).
Up/Down or Ctrl+P/Ctrl+N move in the list, Tab or a click takes the one marked (a directory keeps
its `/` for the next part), Enter takes it or sends a command that takes nothing, Escape closes
it. While the list shows the field is given `interceptKeys`, so those keys reach the view rather
than moving its caret. Files dropped on it are mentioned (`@path`, from `cwd` when they are under
it); pictures are attached above the field instead, and `onSend(text, images)` gets them with the
prompt. `dropped {paths, n}` is the same for a drop on the chat around the field.

The words of a draft are `view.ts`'s, and tested: `caretAfterEdit` (where an edit left the caret,
since the field does not say), `mentionAt`, `applyMention`, `insertMentions`, `mentionText`,
`imageTypeOf`, `relativeTo`, `baseName`.

## ACP

| ACP | Changes |
| --- | --- |
| `agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk` | append to the newest entry of that kind, else push one; images are `image` entries, resource links markdown links |
| `tool_call` / `tool_call_update` | push the `tool` entry / patch it. `execute` → `shell`, `edit` with only new files → `write`, `delete`/`move` → `edit`, `mcp__…` → `mcp`, `Task` or `subagent_type` → `subagent`. Diff content keeps `oldText`/`newText`; a terminal keeps what `terminalOutput` put in it; `rawOutput` fills a call that says no content |
| `plan` | `plan`, and the turn's `plan` entry replaced (or pushed) |
| `available_commands_update` | `commands` |
| `current_mode_update`, `config_option_update` | `options` |
| `session_info_update` | `session` (title) |
| `usage_update` | `usage` (`contextPct` from `used`/`size`, `cost`) |
| `session/request_permission` | `permissionAsked` (and the call, if new); answer with `permissionResponse(optionId)` |
| `session/new` / `load` / `resume` answer | `fromSessionSetup`: `session`, and `options` from `configOptions`, else `modes` (`acp.mode`) and `models` (`acp.model`) |
| `session/prompt` answer | `fromPromptResponse`: a `turn` entry, open calls `canceled` when cancelled, requests withdrawn, status `done` |

The other way: `promptBlocks(text, images)` is `session/prompt`'s `prompt`, `setOptionRequest` the
`session/set_mode` / `set_model` / `set_config_option` call, `setOptionChange` the change once it is
done.

## Working on it

```sh
bun tools/link.mjs                    # at the repository's root: the SDK's types
bun test                                # model, change, acp, diff, view
./node_modules/.bin/tsc --noEmit -p .
```
