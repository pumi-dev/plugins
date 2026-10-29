// The chat, drawn from a transcript: `<Conversation transcript onCommand />`. It knows nothing of
// where the transcript comes from or where a command goes: a package gives it the transcript it
// follows (`change.ts` `follow`) and sends the commands it makes to its producer. Each part is
// usable alone. Its keys (`keys.ts`) work wherever in it the keyboard is: Esc stops the agent,
// ⌃1 … ⌃9 answer the request waiting, ↑ in an empty prompt brings back the one sent before.
import { useTheme } from "pumi";
import { useEffect, useMemo, useRef, useState } from "react";

import { Header } from "./ui/header.tsx";
import { Composer, type ComposerHandle } from "./ui/composer.tsx";
import { chatKey, keystrokeOf, sentPrompts } from "./keys.ts";
import { ImageViewerHost } from "./ui/image.tsx";
import { PermissionCard } from "./ui/question.tsx";
import { PENCIL_ICON, PlanBar, Spinner, Timeline, type MessageAction } from "./ui/timeline.tsx";
import { useTap } from "./ui/press.tsx";
import { useType } from "./ui/style.ts";
import { newCommandId, type Command, type ConfigOption, type Entry, type Transcript } from "./model.ts";
import { modelMaker, type MentionHit } from "./view.ts";
import type { ZedIcon } from "./ui/icons.ts";

export { Header, OptionPicker, type HeaderProps } from "./ui/header.tsx";
export { Composer, type ComposerHandle, type ComposerProps } from "./ui/composer.tsx";
export { chatKey, keystrokeOf, sentPrompts, stepRecall, type ChatKey, type Keystroke } from "./keys.ts";
export { Button, PermissionCard, QuestionCard, type ButtonProps, type PermissionCardProps, type QuestionCardProps } from "./ui/question.tsx";
export { keepTyping, OwnClicks, Press, useTap, type PressProps } from "./ui/press.tsx";
export { CodeBlock, Inline, Markdown, type MarkdownProps } from "./ui/markdown.tsx";
export { DiffView } from "./ui/diff.tsx";
export { ImageViewerHost, Thumb } from "./ui/image.tsx";
export { EntryView, PENCIL_ICON, PlanBar, PlanList, RETURN_ICON, SEND_ICON, Spinner, Thought, Timeline, ToolCard, ToolPart, type EntryViewProps, type MessageAction, type TimelineProps } from "./ui/timeline.tsx";
export { tint, useTextTheme, useType, type ChatType, type TextTheme } from "./ui/style.ts";
export { AddContext, BarButton, ContextRing, ModelPicker, Picker, SendButton, ThinkingControl, ZIcon, type ContextAction, type PickerProps } from "./ui/bar.tsx";
export { ZED_ICONS, type ZedIcon } from "./ui/icons.ts";

/** The mark the model selector shows for a maker (`view.ts` `modelMaker`). */
const MAKER_ICONS: Record<NonNullable<ReturnType<typeof modelMaker>>, ZedIcon> = {
  claude: "ai_claude",
  anthropic: "ai_anthropic",
  openai: "ai_open_ai",
  gemini: "ai_gemini",
  google: "ai_google",
  deepseek: "ai_deep_seek",
  openrouter: "ai_open_router",
  mistral: "ai_mistral",
  xai: "ai_x_ai",
  ollama: "ai_ollama",
};

export interface ConversationProps {
  /** The conversation as it is now; `undefined` while the first snapshot is on its way. */
  transcript: Transcript | undefined;
  /** What the user asked for, each with a new command id. */
  onCommand(command: Command): void;
  /** Entries shown at first, and per "Show earlier". */
  pageSize?: number;
  /**
   * Whether the chat has the window's focus (its pane's): the composer takes the keyboard when it
   * mounts and each time this turns true. A click anywhere in the chat that is not a field's or a
   * drag over text gives it the keyboard too.
   */
  autoFocus?: boolean;
  placeholder?: string;
  /** A press on a link in the text; without, it opens in the system's handler. */
  onLink?(url: string): void;
  /** Leave the header out (a renderer that draws its own). */
  hideHeader?: boolean;
  /** The files an `@` in the draft finds (see `ComposerProps.onMentions`). Without it `@` is plain text. */
  onMentions?(query: string): Promise<MentionHit[]>;
  /** Pictures dropped on the chat are attached to the prompt (true by default), else mentioned as files. */
  images?: boolean;
  /** Where a question the agent asks on its own screen is answered (that screen, shown). */
  onAnswerElsewhere?(): void;
  /** What that button says ("Answer in the terminal"). */
  elsewhereLabel?: string;
  /** What a message offers on hover, beside Copy (and Edit, with `rewinds`). */
  messageActions?(entry: Entry): MessageAction[];
  /**
   * How the producer goes back to before one of the user's messages: `exact`, to that one (a click
   * on it, or its Edit, makes it a field in place, and sending that replaces it and what came
   * after); or `terminal`, in the agent's own screen (its Edit goes there). None without.
   */
  rewinds?: "exact" | "terminal";
  /** Who `terminal` rewinds in (`Claude Code`), for its button. */
  rewindsIn?: string;
  /** The producer forks a session from a turn (`fork`): each turn's controls offer it. */
  forks?: boolean;
  /** Where the composer keeps its draft while the chat is not drawn (`ComposerProps.draftKey`). */
  draftKey?: string;
}

/** The whole chat: the header, the timeline, the requests waiting, and the composer. */
export function Conversation({ transcript, onCommand, pageSize, autoFocus, placeholder, onLink, hideHeader = false, onMentions, images, onAnswerElsewhere, elsewhereLabel, messageActions, rewinds, rewindsIn, forks = false, draftKey }: ConversationProps) {
  // Files dropped anywhere on the chat go to the composer, as if dropped on it.
  const [dropped, setDropped] = useState<{ paths: string[]; n: number }>({ paths: [], n: 0 });
  // The message being edited in place.
  const [editing, setEditing] = useState<Entry | null>(null);
  // Each new number asks the composer to take the keyboard.
  const [focus, setFocus] = useState(0);
  const composer = useRef<ComposerHandle | null>(null);
  const t = useTheme();
  const entries = transcript?.entries;
  // A prompt sent from the empty chat, until it shows in the transcript: the composer stops
  // filling the chat at once, not when the agent answers.
  const [sent, setSent] = useState(false);
  const said = (entries?.length ?? 0) > 0;
  useEffect(() => {
    if (said) setSent(false);
  }, [said]);
  const history = useMemo(() => sentPrompts(entries ?? []), [entries]);
  const editingNow = useRef(false);
  const takeFocus = () => setTimeout(() => !editingNow.current && setFocus((n) => n + 1), 0);
  const tap = useTap(() => takeFocus());
  // The pane given the focus again (a click on its tab, a key that moves there): the composer has it.
  const hadFocus = useRef(autoFocus);
  useEffect(() => {
    if (autoFocus && !hadFocus.current) takeFocus();
    hadFocus.current = autoFocus;
  }, [autoFocus]);
  if (!transcript) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <Loading />
      </div>
    );
  }
  const setOption = (option: ConfigOption, value: string | boolean) => onCommand({ type: "setOption", id: newCommandId(), category: option.category, option: option.id, value });
  const idle = transcript.status !== "working" && transcript.status !== "blocked" && transcript.queue.length === 0;
  // Nothing said yet: the composer is the whole chat.
  const fresh = !said && idle && !sent;
  // A message still being edited that left the conversation (another session, a reload), or once
  // the agent works again, is no longer edited.
  const edited = editing && idle && transcript.entries.some((entry) => entry.id === editing.id) ? editing : null;
  editingNow.current = edited !== null;
  const editable = (entry: Entry) => entry.kind === "user" && idle && rewinds === "exact" && entry.source !== undefined;
  const startEdit = (entry: Entry) => {
    editingNow.current = true;
    setEditing(entry);
  };
  const stopEdit = () => {
    editingNow.current = false;
    setEditing(null);
    takeFocus();
  };
  const answer = (permissionId: string, optionId: string, text?: string) => {
    onCommand({ type: "answer", id: newCommandId(), permissionId, optionId, ...(text !== undefined ? { text } : {}) });
    // Its card goes, and the keyboard with it when one of its buttons had it.
    takeFocus();
  };
  // The chat's keys, from wherever in it the keyboard is: what a field or a list took is not here.
  const first = transcript.permissions[0];
  const onKey = (e: any) => {
    if (e?.defaultPrevented) return;
    const key = chatKey(keystrokeOf(e), { working: transcript.status === "working" || transcript.status === "blocked", answers: first?.options.length ?? 0 });
    if (!key) return;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (key.type === "stop") onCommand({ type: "cancel", id: newCommandId() });
    else if (key.type === "answer" && first) answer(first.id, first.options[key.index]!.id);
    else if (key.type === "type") composer.current?.type(key.text);
  };
  const actionsOf = (entry: Entry): MessageAction[] => {
    const own = messageActions?.(entry) ?? [];
    if (entry.kind !== "user" || !idle || !rewinds) return own;
    if (rewinds === "terminal") return [{ id: "rewind", label: `Edit it in ${rewindsIn ?? "the agent"}`, icon: PENCIL_ICON, onPress: () => onCommand({ type: "rewind", id: newCommandId(), entry: entry.id }) }, ...own];
    if (!editable(entry)) return own;
    return [{ id: "edit", label: "Edit this message", icon: PENCIL_ICON, onPress: () => startEdit(entry) }, ...own];
  };
  return (
    <ImageViewerHost onClose={takeFocus}>
      <div
        {...tap}
        onKeyDown={onKey}
        onFileDrop={(e: any) => {
          const paths: string[] = Array.isArray(e?.paths) ? e.paths : [];
          if (paths.length > 0) setDropped((last) => ({ paths, n: last.n + 1 }));
        }}
        // The chat in the side bar's colour, the composer in the editor's.
        style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: t.surface }}
      >
        {hideHeader ? null : <Header transcript={transcript} onOption={setOption} except={["model", "mode", "thought_level"]} />}
        {fresh ? null : <Timeline transcript={transcript} pageSize={pageSize} onLink={onLink} onAnswerElsewhere={onAnswerElsewhere} elsewhereLabel={elsewhereLabel} messageActions={actionsOf}
          editing={edited?.id}
          editable={editable}
          onEditStart={startEdit}
          onEditCancel={stopEdit}
          onEditSubmit={(text) => {
            if (edited) onCommand({ type: "prompt", id: newCommandId(), text, replaces: edited.id });
            stopEdit();
          }}
          onFork={forks && idle ? (entry) => onCommand({ type: "fork", id: newCommandId(), entry: entry.id }) : undefined}
          onRestore={idle ? (entry) => onCommand({ type: "restore", id: newCommandId(), entry: entry.id }) : undefined}
        />}
        <PlanBar plan={transcript.plan} />
        {transcript.permissions.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, paddingLeft: 10, paddingRight: 10, paddingTop: 8 }}>
            {/* Not focused when they appear: an Enter meant for the composer must not answer one. */}
            {transcript.permissions.map((permission, at) => (
              <PermissionCard key={permission.id} permission={permission} keys={at === 0} onAnswer={answer} />
            ))}
          </div>
        ) : null}
        <Composer
          status={transcript.status}
          commands={transcript.commands}
          queue={transcript.queue}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onMentions={onMentions}
          cwd={transcript.session?.cwd}
          images={images}
          dropped={dropped}
          agent={transcript.session?.agent}
          focus={focus}
          handle={composer}
          draftKey={draftKey}
          history={history}
          options={transcript.options}
          onOption={setOption}
          modelIcon={iconOf(transcript)}
          usage={transcript.usage}
          expandable={transcript.entries.length > 0}
          fill={fresh}
          onSend={(text, pictures) => {
            setSent(true);
            onCommand({ type: "prompt", id: newCommandId(), text, ...(pictures.length > 0 ? { images: pictures } : {}) });
          }}
          onStop={() => onCommand({ type: "cancel", id: newCommandId() })}
          onUnqueue={(queued) => onCommand({ type: "unqueue", id: newCommandId(), queued })}
        />
      </div>
    </ImageViewerHost>
  );
}

/** The model's maker's mark, by the model running (or picked) and the agent. */
function iconOf(t: Transcript): ZedIcon | undefined {
  const picked = t.options.find((option) => option.category === "model");
  const maker = modelMaker(t.session?.model ?? (typeof picked?.current === "string" ? picked.current : undefined), t.session?.agent);
  return maker ? MAKER_ICONS[maker] : undefined;
}

function Loading() {
  const t = useTheme();
  const type = useType();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Spinner size={12} color={t.faint} />
      <text style={{ fontSize: type.small, color: t.faint }}>Loading the conversation…</text>
    </div>
  );
}
