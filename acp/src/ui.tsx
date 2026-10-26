// What an ACP pane draws, as the `Chat` renderer of its own `amresyd.acp.chat` block (the
// manifest's `blocks`): before it has an agent, which agent and where; while the agent starts,
// signs in or offers its sessions, those steps; then lib/conversation's chat of the host's
// conversation, which the worker relays (`update.<pane>`, folded with `follow`) beside the host's
// own state (`state.<pane>`).
import { useCallback, useEffect, useRef, useState } from "react";
import { useChannel, useChannelListener, useMetrics, usePane, useTheme, type RefLike, type RendererProps } from "pumi";

import { follow, type Update } from "../../lib/conversation/src/change.ts";
import type { Command, Transcript } from "../../lib/conversation/src/model.ts";
import { Conversation, Press, useTextTheme } from "../../lib/conversation/src/ui.tsx";
import type { HostState } from "./wire.ts";
import { agents, attach, authenticate, begin, login, restart, retry, send, start } from "./main.ts";

/** A throw the pane cannot answer: said in the log. */
function swallow(err: unknown): void {
  console.error(`acp: ${err instanceof Error ? err.message : String(err)}`);
}

/** A pane's number: a renderer is given a ref (`{ id: 3 }`), which a hook takes; the worker wants the number. */
function paneId(pane: RefLike): number {
  return typeof pane === "number" ? pane : pane.id;
}

/** The `chat` block's renderer: one ACP agent's pane. */
export function Chat({ pane, focused }: RendererProps) {
  const id = paneId(pane);
  const options = usePane(pane)?.options ?? {};
  if (typeof options["@agent"] !== "string" || options["@agent"] === "") {
    return <Chooser id={id} cwd={String(options["@acp_cwd"] ?? "")} mode={options["@acp_mode"] === "pick" ? "pick" : "new"} focused={focused} />;
  }
  return <Live id={id} focused={focused} />;
}

// ── Before an agent ─────────────────────────────────────────────────────────────────────────

function Chooser({ id, cwd, mode, focused }: { id: number; cwd: string; mode: "new" | "pick"; focused: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  const text = useTextTheme();
  const [list, setList] = useState<{ id: string; name: string; installed: boolean }[]>();
  const [chosen, setChosen] = useState<string>();
  const [dir, setDir] = useState(cwd);
  const [error, setError] = useState<string>();
  useEffect(() => {
    agents()
      .then((all) => {
        setList(all);
        setChosen((was) => was ?? all.find((a) => a.installed)?.id ?? all[0]?.id);
      })
      .catch(swallow);
  }, []);
  useEffect(() => setDir((was) => was || cwd), [cwd]);
  const go = (how: "new" | "pick") => {
    if (!chosen) return;
    begin(id, chosen, dir, how).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };
  const other = mode === "new" ? "pick" : "new";
  return (
    <Centered>
      <text style={{ fontSize: m.fontSize + 2, fontWeight: 600, color: t.text }}>Start an agent</text>
      <div role="listbox" aria-label="Agents" style={{ display: "flex", flexDirection: "column", gap: 2, width: 320 }}>
        {(list ?? []).map((a) => (
          <Press
            key={a.id}
            role="option"
            aria-selected={a.id === chosen}
            aria-label={`${a.name}${a.installed ? "" : " (not installed)"}`}
            onClick={() => setChosen(a.id)}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: m.radiusSmall, cursor: "pointer", backgroundColor: a.id === chosen ? t.selected : undefined, hover: { backgroundColor: t.hover } }}
          >
            <text style={{ fontSize: m.fontSize, color: t.text, flexGrow: 1 }}>{a.name}</text>
            <text style={{ fontSize: 11, color: t.faint }}>{a.installed ? "" : "fetched with npx, or missing"}</text>
          </Press>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 320 }}>
        <text style={{ fontSize: 11, color: t.muted }}>Directory</text>
        <input
          aria-label="The agent's directory"
          value={dir}
          autoFocus={focused}
          theme={text}
          onChange={(e) => setDir(e.value ?? "")}
          onSubmit={() => go(mode)}
          style={{ height: 26, paddingLeft: 6, paddingRight: 6, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.editor, color: t.text, fontSize: m.fontSize }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
        <Action label={mode === "new" ? "New session" : "Open a session…"} primary onPress={() => go(mode)} />
        <Action label={other === "new" ? "New session" : "Open a session…"} onPress={() => go(other)} />
      </div>
      {error ? <text style={{ fontSize: 12, color: t.error }}>{error}</text> : null}
    </Centered>
  );
}

// ── With an agent ───────────────────────────────────────────────────────────────────────────

function Live({ id, focused }: { id: number; focused: boolean }) {
  const live = useChannel<HostState | undefined>(`state.${id}`, undefined);
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
  useChannelListener(`update.${id}`, (update: Update) => {
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
    send(id, command)
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
      {chat ? <Conversation transcript={transcript} onCommand={onCommand} autoFocus={focused} /> : <Setup id={id} state={state} />}
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
                onClick={() => void start(id, s.id).catch(swallow)}
                style={{ display: "flex", flexDirection: "column", paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
              >
                <text style={{ fontSize: m.fontSize, color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{s.title ?? s.id}</text>
                <text style={{ fontSize: 11, color: t.faint, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{[s.updatedAt?.replace("T", " ").slice(0, 16), s.cwd].filter(Boolean).join(" · ")}</text>
              </Press>
            ))}
            {state.sessions?.length ? null : <text style={{ fontSize: 12, color: t.faint }}>{state.canList ? "No sessions here yet." : `${name} can't list its sessions over ACP.`}</text>}
          </div>
          <Action label="New session" primary onPress={() => void start(id, null).catch(swallow)} />
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
          <text style={{ fontSize: 12, color: t.faint }}>{state?.error ? `${name} didn't start.` : `Starting ${name}…`}</text>
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

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>{children}</div>;
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
