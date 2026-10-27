// What the chat draws, in the window: the title bar's button that flips an agent tab between its
// terminal and the chat, and the chat itself, which draws the tab's `terminal` block (`Chat`, the
// manifest's `renderers.terminal`) while the tab's `@tab_renderer` names this plugin. The
// conversation is the worker's (`main.ts` `read`, `send`); the chat follows its batches, on the
// channel in the plugin host's windows and by the convention's event in any app's.
import { useCallback, useEffect, useRef, useState } from "react";
import { conversationNames, Icon, IconButton, useChannelListener, useEvent, useMetrics, usePlugin, useTab, useTheme, type RendererProps, type TabId } from "pumi";

import { follow, type Update } from "../../lib/conversation/src/change.ts";
import type { Transcript } from "../../lib/conversation/src/model.ts";
import { Conversation, Header, Press } from "../../lib/conversation/src/ui.tsx";
import { agentSpec } from "./agents.ts";
import { mentions, read, send, setChat, toggle } from "./main.ts";
import { UPDATE, type Changed, type TabUpdate } from "./topics.ts";

/** A throw the chat cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`agent-chat: ${err instanceof Error ? err.message : String(err)}`);
}

/** A tab's number: the worker names tabs by it (`%3` is `3`). */
function tabId(tab: TabId): number {
  return Number(tab.slice(tab.indexOf("/") + 1).replace(/^[%@$]/, ""));
}

/**
 * The `tab.toolbar` slot's component: on an agent tab the chat reads, the button that flips it,
 * drawn as one of the tab's own (`IconButton`, the theme's).
 */
export function Toolbar({ tab }: { tab: TabId }) {
  const t = useTheme();
  const plugin = usePlugin() ?? "";
  const options = (useTab(tab)?.options ?? {}) as Record<string, unknown>;
  const spec = agentSpec(options["@agent"]);
  if (!spec) return null;
  const chat = options["@tab_renderer"] === plugin;
  const asking = options["@agent.status"] === "blocked";
  const tip = chat ? `Show ${spec.label}'s terminal` : asking ? `${spec.label} is asking: show the chat` : `Show ${spec.label} as a chat`;
  return (
    <IconButton
      icon={chat ? "terminal" : "sparkle"}
      title={tip}
      active={chat}
      color={asking && !chat ? t["agent.blocked"] : undefined}
      onClick={() => void toggle(tabId(tab)).catch(swallow)}
    />
  );
}

/**
 * The `terminal` renderer (the manifest's `renderers`): the chat, over the terminal it keeps
 * running under. A tab of a terminal whose agent the chat does not read (it was named by
 * `@tab_renderer`, or nothing else draws terminals) is drawn as the terminal it is.
 */
export function Chat({ tab, focused }: RendererProps) {
  const spec = agentSpec(((useTab(tab.id)?.options ?? {}) as Record<string, unknown>)["@agent"]);
  if (!spec) return <terminal tab={tab.id} autoFocus={focused} />;
  return <TabChat tab={tabId(tab.id)} focused={focused} />;
}

/** The tab's conversation, followed from the worker: a snapshot first, then each batch. */
function useTranscript(tab: number): Transcript | undefined {
  const plugin = usePlugin() ?? "";
  const [transcript, setTranscript] = useState<Transcript>();
  const local = useRef<Transcript | undefined>(undefined);
  const reading = useRef<"no" | "yes" | "again">("no");

  const take = useCallback((next: Transcript) => {
    local.current = next;
    setTranscript(next);
  }, []);

  // One read at a time; asked for again while one is out, it reads once more after.
  const reread = useCallback(() => {
    if (reading.current !== "no") {
      reading.current = "again";
      return;
    }
    reading.current = "yes";
    read(tab)
      .then((update) => {
        const next = follow(undefined, update);
        if (next) take(next);
      }, swallow)
      .finally(() => {
        const again = reading.current === "again";
        reading.current = "no";
        if (again) reread();
      });
  }, [tab, take]);

  const apply = useCallback(
    (update: Update) => {
      const next = follow(local.current, update);
      if (next) take(next);
      else reread();
    },
    [take, reread],
  );

  useEffect(() => {
    local.current = undefined;
    setTranscript(undefined);
    reread();
  }, [reread]);

  // In the plugin host's windows: the worker's batches, in process.
  useChannelListener(UPDATE, (data: TabUpdate) => {
    if (data?.tab === tab) apply(data.update);
  });
  // In any app's: the convention's event (a batch heard on both is applied once).
  useEvent<Changed>(conversationNames(plugin).changed, (e) => {
    const data = e.data;
    if (data?.tab !== tab) return;
    if (data.from) return apply({ type: "changes", from: data.from, to: data.cursor, changes: data.changes });
    const now = local.current;
    if (!now || now.epoch !== data.cursor.epoch || now.seq < data.cursor.seq) reread();
  });
  return transcript;
}

/** One agent tab's chat. */
function TabChat({ tab, focused }: { tab: number; focused: boolean }) {
  const options = (useTab(`%${tab}`)?.options ?? {}) as Record<string, unknown>;
  const spec = agentSpec(options["@agent"]);
  const transcript = useTranscript(tab);
  const showTerminal = () => void setChat(tab, false).catch(swallow);
  // One function per tab, so the composer asks again only when the query changes.
  const findFiles = useCallback((query: string) => mentions(tab, query), [tab]);
  // The agent waits on its terminal for something pumi was not asked (no request): say so.
  const askingThere = options["@agent.status"] === "blocked" && (transcript?.permissions.length ?? 0) === 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>{transcript ? <Header transcript={transcript} /> : null}</div>
        <TerminalButton label={spec?.label ?? "the agent"} onPress={showTerminal} />
      </div>
      {askingThere ? <AskingThere label={spec?.label ?? "The agent"} onShow={showTerminal} /> : null}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
        <Conversation
          transcript={transcript}
          hideHeader
          autoFocus={focused}
          onMentions={findFiles}
          placeholder={transcript && (transcript.status === "working" || transcript.status === "blocked") ? `Queue a message for ${spec?.label ?? "the agent"}…` : undefined}
          onCommand={(cmd) =>
            void send(tab, cmd)
              .then((ack) => ack.rejected && console.warn(`agent-chat: ${ack.rejected}`))
              .catch(swallow)
          }
        />
      </div>
    </div>
  );
}

function TerminalButton({ label, onPress }: { label: string; onPress(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <Press
      aria-label={`Show ${label}'s terminal`}
      title={`Show ${label}'s terminal`}
      onClick={onPress}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 22, marginRight: 8, paddingLeft: 6, paddingRight: 6, flexShrink: 0, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover }, focusVisible: { outlineWidth: 2, outlineColor: t.accent } }}
    >
      <Icon name="terminal" size={12} color={t.muted} />
      <text style={{ fontSize: 12, color: t.muted }}>Terminal</text>
    </Press>
  );
}

/** The agent asks something in its own terminal (no hook passed it to pumi): show it there. */
function AskingThere({ label, onShow }: { label: string; onShow(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div role="status" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, margin: 8, padding: 8, borderRadius: m.radius, borderWidth: 1, borderColor: t["agent.blocked"], backgroundColor: t.surface }}>
      <Icon name="lock" size={13} color={t["agent.blocked"]} />
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
        <text style={{ fontSize: m.fontSize, color: t.text }}>{`${label} is asking something in its terminal.`}</text>
      </div>
      <Press
        aria-label="Show the terminal"
        onClick={onShow}
        style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 10, paddingRight: 10, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: t.accent, hover: { opacity: 0.9 }, focusVisible: { outlineWidth: 2, outlineColor: t.accent, outlineOffset: 1 } }}
      >
        <text style={{ fontSize: m.fontSize - 1, color: t.accentText }}>Show the terminal</text>
      </Press>
    </div>
  );
}
