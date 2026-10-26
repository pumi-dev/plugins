// The chat, drawn from a transcript: `<Conversation transcript onCommand />`. It knows nothing of
// where the transcript comes from or where a command goes: a package gives it the transcript it
// follows (`change.ts` `follow`) and sends the commands it makes to its producer. Each part is
// usable alone.
import { useTheme } from "pumi";
import { useState } from "react";

import { Header } from "./ui/header.tsx";
import { Composer } from "./ui/composer.tsx";
import { PermissionCard } from "./ui/permission.tsx";
import { Timeline } from "./ui/timeline.tsx";
import { newCommandId, type Command, type ConfigOption, type Transcript } from "./model.ts";
import type { MentionHit } from "./view.ts";

export { Header, OptionPicker, type HeaderProps } from "./ui/header.tsx";
export { Composer, type ComposerProps } from "./ui/composer.tsx";
export { PermissionCard, type PermissionCardProps } from "./ui/permission.tsx";
export { Press, type PressProps } from "./ui/press.tsx";
export { EntryView, PlanList, Thought, Timeline, ToolCard, ToolPart, type EntryViewProps, type TimelineProps } from "./ui/timeline.tsx";
export { useTextTheme, type TextTheme } from "./ui/style.ts";

export interface ConversationProps {
  /** The conversation as it is now; `undefined` while the first snapshot is on its way. */
  transcript: Transcript | undefined;
  /** What the user asked for, each with a new command id. */
  onCommand(command: Command): void;
  /** Entries shown at first, and per "Show earlier". */
  pageSize?: number;
  /** Take keyboard focus in the composer when it mounts. */
  autoFocus?: boolean;
  placeholder?: string;
  /** A press on a link in the text. */
  onLink?(url: string): void;
  /** Leave the header out (a renderer that draws its own). */
  hideHeader?: boolean;
  /** The files an `@` in the draft finds (see `ComposerProps.onMentions`). Without it `@` is plain text. */
  onMentions?(query: string): Promise<MentionHit[]>;
  /** Pictures dropped on the chat are attached to the prompt (true by default), else mentioned as files. */
  images?: boolean;
}

/** The whole chat: the header, the timeline, the requests waiting, and the composer. */
export function Conversation({ transcript, onCommand, pageSize, autoFocus, placeholder, onLink, hideHeader = false, onMentions, images }: ConversationProps) {
  // Files dropped anywhere on the chat go to the composer, as if dropped on it.
  const [dropped, setDropped] = useState<{ paths: string[]; n: number }>({ paths: [], n: 0 });
  if (!transcript) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <Loading />
      </div>
    );
  }
  const setOption = (option: ConfigOption, value: string | boolean) => onCommand({ type: "setOption", id: newCommandId(), category: option.category, option: option.id, value });
  return (
    <div
      onFileDrop={(e: any) => {
        const paths: string[] = Array.isArray(e?.paths) ? e.paths : [];
        if (paths.length > 0) setDropped((last) => ({ paths, n: last.n + 1 }));
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}
    >
      {hideHeader ? null : <Header transcript={transcript} onOption={setOption} />}
      <Timeline transcript={transcript} pageSize={pageSize} onLink={onLink} />
      {transcript.permissions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, paddingLeft: 8, paddingRight: 8, paddingTop: 6 }}>
          {/* Not focused when they appear: an Enter meant for the composer must not answer one. */}
          {transcript.permissions.map((permission) => (
            <PermissionCard key={permission.id} permission={permission} onAnswer={(permissionId, optionId) => onCommand({ type: "answer", id: newCommandId(), permissionId, optionId })} />
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
        onSend={(text, pictures) => onCommand({ type: "prompt", id: newCommandId(), text, ...(pictures.length > 0 ? { images: pictures } : {}) })}
        onStop={() => onCommand({ type: "cancel", id: newCommandId() })}
        onUnqueue={(queued) => onCommand({ type: "unqueue", id: newCommandId(), queued })}
      />
    </div>
  );
}

function Loading() {
  const t = useTheme();
  return <text style={{ fontSize: 12, color: t.faint }}>Loading the conversation…</text>;
}
