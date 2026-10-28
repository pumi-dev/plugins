// What the chat draws, in the window: the title bar's button that flips an agent tab between its
// terminal and the chat, and the chat itself, which draws the tab's `terminal` block (`Chat`, the
// manifest's `renderers.terminal`) while the tab's `@tab_renderer` names this plugin. The
// conversation is the worker's (`main.ts` `read`, `send`); the chat follows its batches, on the
// channel in the plugin host's windows and by the convention's event in any app's.
import { useCallback, useEffect, useRef, useState } from "react";
import { conversationNames, Icon, IconButton, useChannelListener, useEvent, useMetrics, usePlugin, useTab, useTheme, type RendererProps, type TabId } from "pumi";

import { follow, type Update } from "./conversation/change.ts";
import type { Transcript } from "./conversation/model.ts";
import { questionsOf } from "./conversation/question.ts";
import { Button, Conversation, Header, Press, tint } from "./conversation/ui.tsx";
import { agentSpec, type AgentSpec } from "./agents.ts";
import { mentions, read, send, setChat, toggle } from "./main.ts";
import { UPDATE, type Changed, type TabUpdate } from "./topics.ts";

/** A throw the chat cannot answer: said in the log, not drawn over the window. */
function swallow(err: unknown): void {
  console.error(`chat-ui: ${err instanceof Error ? err.message : String(err)}`);
}

/** A tab's number: the worker names tabs by it (`%3` is `3`). */
function tabId(tab: TabId): number {
  return Number(tab.slice(tab.indexOf("/") + 1).replace(/^[%@$]/, ""));
}

/**
 * A tab's options, as last read: while the window's cache reads the tab again (a change it could
 * not merge) it has none, and a tab drawn from that would flip to its terminal and back.
 */
function useTabOptions(tab: TabId): Record<string, unknown> {
  const options = useTab(tab)?.options as Record<string, unknown> | undefined;
  const last = useRef<Record<string, unknown>>({});
  if (options) last.current = options;
  return last.current;
}

/** The agent a tab's `@agent` names, as last read, or `undefined` before its options were ever read. */
function useAgentSpec(tab: TabId): AgentSpec | null | undefined {
  const options = useTab(tab)?.options as Record<string, unknown> | undefined;
  const last = useRef<AgentSpec | null | undefined>(undefined);
  if (options) last.current = agentSpec(options["@agent"]) ?? null;
  return last.current;
}

/**
 * The `tab.toolbar` slot's component: on an agent tab the chat reads, the button that flips it,
 * drawn as one of the tab's own (`IconButton`, the theme's).
 */
export function Toolbar({ tab }: { tab: TabId }) {
  const t = useTheme();
  const plugin = usePlugin() ?? "";
  const options = useTabOptions(tab);
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
  // Not read yet is not "no agent": the chat waits (it says it is loading) rather than flashing the terminal.
  const spec = useAgentSpec(tab.id);
  if (spec === null) return <terminal tab={tab.id} autoFocus={focused} />;
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
  const options = useTabOptions(`%${tab}`);
  const spec = agentSpec(options["@agent"]);
  const label = spec?.label ?? "the agent";
  const transcript = useTranscript(tab);
  const showTerminal = () => void setChat(tab, false).catch(swallow);
  // One function per tab, so the composer asks again only when the query changes.
  const findFiles = useCallback((query: string) => mentions(tab, query), [tab]);
  // The agent waits on its terminal for something pumi was not asked (no request, no question
  // the timeline shows as one): say so.
  const asking = transcript ? openQuestion(transcript) : false;
  const askingThere = options["@agent.status"] === "blocked" && (transcript?.permissions.length ?? 0) === 0 && !asking;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      {transcript ? (
        <Header transcript={transcript} except={["model"]}>
          <TerminalButton label={label} onPress={showTerminal} />
        </Header>
      ) : null}
      {askingThere ? <AskingThere label={spec?.label ?? "The agent"} onShow={showTerminal} /> : null}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
        <Conversation
          transcript={transcript}
          hideHeader
          autoFocus={focused}
          onMentions={findFiles}
          onAnswerElsewhere={showTerminal}
          elsewhereLabel={`Answer in ${label}`}
          rewinds={spec ? (spec.rewind === "command" ? "exact" : "terminal") : undefined}
          rewindsIn={label}
          onCommand={(cmd) =>
            void send(tab, cmd)
              .then((ack) => ack.rejected && console.warn(`chat-ui: ${ack.rejected}`))
              .catch(swallow)
          }
        />
      </div>
    </div>
  );
}

/** Whether the newest call asks the user and is still open: the timeline draws it, with where to answer. */
function openQuestion(transcript: Transcript): boolean {
  for (let at = transcript.entries.length - 1; at >= 0; at--) {
    const tool = transcript.entries[at]!.tool;
    if (tool && (tool.status === "running" || tool.status === "pending") && questionsOf(tool)) return true;
  }
  return false;
}

function TerminalButton({ label, onPress }: { label: string; onPress(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <Press
      aria-label={`Show ${label}'s terminal`}
      title={`Show ${label}'s terminal`}
      onClick={onPress}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingLeft: 7, paddingRight: 8, flexShrink: 0, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, cursor: "pointer", hover: { backgroundColor: t.hover }, focusVisible: { outlineWidth: 2, outlineColor: t.accent } }}
    >
      <Icon name="terminal" size={12} color={t.muted} />
      <text style={{ fontSize: Math.max(10, m.fontSize - 2), color: t.muted }}>Terminal</text>
    </Press>
  );
}

/** The agent asks something in its own terminal (no hook passed it to pumi): show it there. */
function AskingThere({ label, onShow }: { label: string; onShow(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div role="status" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, margin: 10, marginBottom: 0, padding: 8, paddingLeft: 10, borderRadius: m.radius, borderWidth: 1, borderColor: tint(t["agent.blocked"], 0.7), backgroundColor: tint(t["agent.blocked"], 0.08) }}>
      <Icon name="status_alert" size={13} color={t["agent.blocked"]} />
      <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
        <text style={{ fontSize: m.fontSize, color: t.text }}>{`${label} is asking something in its terminal.`}</text>
      </div>
      <Button label="Show it" icon="terminal" primary onPress={onShow} />
    </div>
  );
}
