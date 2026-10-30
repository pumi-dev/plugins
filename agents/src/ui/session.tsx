// What a session tab draws, as the `Session` renderer of the plugin's own `session` block: the chat
// of the host's conversation, which the worker relays (`session.update.<tab>`, folded with
// `follow`) beside the host's own state (`session.state.<tab>`), or the step the agent needs first
// (signing in, picking a session). The chat shows while the agent starts: a prompt sent then waits
// in its queue and goes once the agent is ready.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useChannel, useChannelListener, useMetrics, useTab, useTheme, type RendererProps, type TabId } from "pumi";

import { follow, type Update } from "../conversation/change.ts";
import type { Command, Queued, Transcript } from "../conversation/model.ts";
import { Conversation, Press } from "../conversation/ui.tsx";
import type { HostState } from "../session/wire.ts";
import { AGENT, SESSION_START } from "../names.ts";
import { useKept } from "./kept.ts";
import { attach, authenticate, login, restart, retry, sessionMentions, sessionSend, startSession } from "../main.ts";

/** A throw the tab cannot answer: said in the log. */
function swallow(err: unknown): void {
  console.error(`agents: ${err instanceof Error ? err.message : String(err)}`);
}

/** A tab's number: the worker names tabs by it (`%3` is `3`). */
function tabNumber(tab: TabId): number {
  return Number(tab.slice(tab.indexOf("/") + 1).replace(/^[%@$]/, ""));
}

/** The `session` block's renderer: one agent the plugin runs. */
export function Session({ tab, focused }: RendererProps) {
  const id = tabNumber(tab.id);
  // The tab as the window has it now: the props are the tab as it was when the renderer was made,
  // before the worker named its agent, and would say "Starting…" until something else drew it.
  const live = useTab(tab.id)?.options as Record<string, unknown> | undefined;
  const options = (live ?? tab.options ?? {}) as Record<string, unknown>;
  if (typeof options[AGENT] !== "string" || options[AGENT] === "") {
    return (
      <Centered>
        <Faint text="Starting…" />
      </Centered>
    );
  }
  return <Live id={id} focused={focused} picks={options[SESSION_START] === "pick"} tab={tab.id} options={options} />;
}

/** `picks`: the tab starts on the agent's list of sessions, so no chat shows before it. */
function Live({ id, focused, picks, tab, options }: { id: number; focused: boolean; picks: boolean; tab: TabId; options: Record<string, unknown> }) {
  const kept = useKept(tab, options);
  const live = useChannel<HostState | undefined>(`session.state.${id}`, undefined);
  const [first, setFirst] = useState<HostState>();
  const [transcript, setTranscript] = useState<Transcript>();
  const [rejected, setRejected] = useState<string>();
  const held = useRef<Transcript | undefined>(undefined);
  const keep = (next: Transcript) => {
    held.current = next;
    setTranscript(next);
  };
  const reread = useCallback(() => {
    attach(id)
      .then((got) => {
        if (got.state) setFirst(got.state);
        if (got.transcript) keep(follow(held.current, { type: "snapshot", transcript: got.transcript }) ?? got.transcript);
      })
      .catch(swallow);
  }, [id]);
  useEffect(reread, [reread]);
  useChannelListener(`session.update.${id}`, (update: Update) => {
    if (!held.current) {
      if (update.type === "snapshot") keep(update.transcript);
      return;
    }
    const next = follow(held.current, update);
    if (!next) reread();
    else if (next !== held.current) keep(next);
  });
  const send = (command: Command) => {
    setRejected(undefined);
    sessionSend(id, command)
      .then((ack) => ack.rejected && setRejected(ack.rejected))
      .catch(swallow);
  };
  const state = live ?? first;
  const phase = state?.phase ?? "starting";
  const starting = phase === "starting" && !state?.error && !picks;
  // The prompts sent while the agent starts, in order: they go once it is ready.
  const [waiting, setWaiting] = useState<Queued[]>([]);
  useEffect(() => {
    if (phase !== "ready" || waiting.length === 0) return;
    for (const each of waiting) send({ type: "prompt", id: each.id, text: each.text, ...(each.images ? { images: each.images } : {}) });
    setWaiting([]);
  }, [phase, waiting.length]);
  const onCommand = (command: Command) => {
    if (command.type === "prompt") kept.remember(command.text);
    if (phase === "ready") return send(command);
    if (command.type === "prompt" && !command.replaces) return setWaiting((was) => [...was, { id: command.id, text: command.text, ...(command.images ? { images: command.images } : {}) }]);
    if (command.type === "unqueue" && waiting.some((each) => each.id === command.queued)) return setWaiting((was) => was.filter((each) => each.id !== command.queued));
    send(command);
  };
  const shown = transcript && waiting.length > 0 ? { ...transcript, queue: [...transcript.queue, ...waiting] } : transcript;
  const chat = shown && (phase === "ready" || phase === "loading" || starting || (phase === "exited" && shown.entries.length > 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      {phase === "loading" ? <Banner text="Loading the session…" /> : null}
      {starting && chat ? <Banner text={`Starting ${state?.name ?? "the agent"}…`} /> : null}
      {phase === "exited" && chat ? <Banner text={state?.error ?? "The agent exited."} tone="error" action={{ label: "Start again", onPress: () => void restart(id).catch(swallow) }} /> : null}
      {rejected ? <Banner text={rejected} tone="error" /> : null}
      {chat ? (
        <Conversation
          transcript={shown!}
          onCommand={onCommand}
          autoFocus={focused}
          draftKey={`session:${id}`}
          savedDraft={kept.savedDraft}
          onDraft={kept.onDraft}
          pastPrompts={kept.pastPrompts}
          onMentions={(query) => sessionMentions(id, query)}
          rewinds={state?.canEdit ? "exact" : undefined}
          forks={state?.canFork === true}
        />
      ) : (
        <Setup id={id} state={state} />
      )}
    </div>
  );
}

/** What shows until the conversation does: starting, signing in, picking a session, or why it stopped. */
function Setup({ id, state }: { id: number; state: HostState | undefined }) {
  const t = useTheme();
  const m = useMetrics();
  const name = state?.name ?? "the agent";
  const error = state?.error ? <text style={{ fontSize: 12, color: t.error, maxWidth: 420 }}>{state.error}</text> : null;
  switch (state?.phase) {
    case "auth":
      return (
        <Centered>
          <text style={{ fontSize: m.fontSize, color: t.text }}>{`${name} needs you to sign in.`}</text>
          {(state.authMethods ?? []).map((method) => (
            <Action key={method.id} label={method.name} hint={method.description} onPress={() => void authenticate(id, method.id).catch(swallow)} />
          ))}
          <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
            <Action label="Sign in in a terminal" onPress={() => void login(id).catch(swallow)} />
            <Action label="Try again" primary onPress={() => void retry(id).catch(swallow)} />
          </div>
          {error}
        </Centered>
      );
    case "picking":
      return (
        <Centered>
          <text style={{ fontSize: m.fontSize + 2, fontWeight: 600, color: t.text }}>{`${name}'s sessions`}</text>
          <div role="listbox" aria-label="Sessions" style={{ display: "flex", flexDirection: "column", gap: 2, width: 420, maxHeight: 360, overflowY: "scroll" }}>
            {(state.sessions ?? []).map((s) => (
              <Press
                key={s.id}
                role="option"
                aria-label={s.title ?? s.id}
                onClick={() => void startSession(id, s.id).catch(swallow)}
                style={{ display: "flex", flexDirection: "column", paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
              >
                <text style={{ fontSize: m.fontSize, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{s.title ?? s.id}</text>
                <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{[s.updatedAt?.replace("T", " ").slice(0, 16), s.cwd].filter(Boolean).join(" · ")}</text>
              </Press>
            ))}
            {state.sessions?.length ? null : <Faint text={state.canList ? "No sessions here yet." : `${name} can't list its sessions.`} />}
          </div>
          <Action label="New session" primary onPress={() => void startSession(id, null).catch(swallow)} />
          {error}
        </Centered>
      );
    case "exited":
      return (
        <Centered>
          <text style={{ fontSize: m.fontSize, color: t.text }}>{`${name} stopped.`}</text>
          {error}
          <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
            <Action label="Start again" primary onPress={() => void restart(id).catch(swallow)} />
            <Action label="New session" onPress={() => void restart(id, true).catch(swallow)} />
          </div>
        </Centered>
      );
    default:
      return (
        <Centered>
          <Faint text={state?.error ? `${name} didn't start.` : `Starting ${name}…`} />
          {error}
          {state?.error ? (
            <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
              <Action label="Try again" primary onPress={() => void retry(id).catch(swallow)} />
              <Action label="Start again" onPress={() => void restart(id).catch(swallow)} />
              {/* A session that can't be loaded (the app quit before it was saved): a new one, the draft and the prompts kept. */}
              <Action label="New session" onPress={() => void restart(id, true).catch(swallow)} />
            </div>
          ) : null}
        </Centered>
      );
  }
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────────

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>{children}</div>;
}

function Faint({ text }: { text: string }) {
  const t = useTheme();
  return <text style={{ fontSize: 12, color: t.faint }}>{text}</text>;
}

function Action({ label, hint, primary = false, onPress }: { label: string; hint?: string; primary?: boolean; onPress(): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <Press
      aria-label={label}
      title={hint}
      onClick={onPress}
      style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: 12, paddingRight: 12, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: primary ? t.accent : t.active, hover: { opacity: 0.9 } }}
    >
      <text style={{ fontSize: m.fontSize, color: primary ? t.accentText : t.text }}>{label}</text>
    </Press>
  );
}

function Banner({ text, tone, action }: { text: string; tone?: "error"; action?: { label: string; onPress(): void } }) {
  const t = useTheme();
  return (
    <div role="status" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, paddingLeft: 10, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderBottomWidth: 1, borderColor: t.border }}>
      <text style={{ fontSize: 12, color: tone === "error" ? t.error : t.muted, flexGrow: 1 }}>{text}</text>
      {action ? <Action label={action.label} onPress={action.onPress} /> : null}
    </div>
  );
}
