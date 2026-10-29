// What a session tab draws, as the `Session` renderer of the plugin's own `session` block: while the
// agent starts, signs in or offers its sessions, those steps; then the chat of the host's
// conversation, which the worker relays (`session.update.<tab>`, folded with `follow`) beside the
// host's own state (`session.state.<tab>`).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useChannel, useChannelListener, useMetrics, useTheme, type RendererProps, type TabId } from "pumi";

import { follow, type Update } from "../conversation/change.ts";
import type { Command, Transcript } from "../conversation/model.ts";
import { Conversation, Press } from "../conversation/ui.tsx";
import type { HostState } from "../session/wire.ts";
import { AGENT } from "../names.ts";
import { attach, authenticate, followFile, login, restart, retry, sessionMentions, sessionSend, startSession } from "../main.ts";

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
  const options = (tab.options ?? {}) as Record<string, unknown>;
  if (typeof options[AGENT] !== "string" || options[AGENT] === "") {
    return (
      <Centered>
        <Faint text="Starting…" />
      </Centered>
    );
  }
  return <Live id={id} focused={focused} />;
}

function Live({ id, focused }: { id: number; focused: boolean }) {
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
  const onCommand = (command: Command) => {
    setRejected(undefined);
    sessionSend(id, command)
      .then((ack) => ack.rejected && setRejected(ack.rejected))
      .catch(swallow);
  };
  const state = live ?? first;
  const phase = state?.phase ?? "starting";
  const chat = transcript && (phase === "ready" || phase === "loading" || (phase === "exited" && transcript.entries.length > 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      {phase === "loading" ? <Banner text="Loading the session…" /> : null}
      {phase === "exited" && chat ? <Banner text={state?.error ?? "The agent exited."} tone="error" action={{ label: "Start again", onPress: () => void restart(id).catch(swallow) }} /> : null}
      {rejected ? <Banner text={rejected} tone="error" /> : null}
      {chat ? (
        <Conversation
          transcript={transcript}
          onCommand={onCommand}
          autoFocus={focused}
          draftKey={`session:${id}`}
          onMentions={(query) => sessionMentions(id, query)}
          rewinds={state?.canEdit ? "exact" : undefined}
          forks={state?.canFork === true}
          onFollowFile={(path, line) => void followFile(id, path, line).catch(swallow)}
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
          <Action label="Start again" primary onPress={() => void restart(id).catch(swallow)} />
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
