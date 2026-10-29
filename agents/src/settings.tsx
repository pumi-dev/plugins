// Settings → Agents, one page: each agent (how it opens from the `+` menu, and its hook, installed,
// brought up to date or removed with a click), then the chat's options, the hooks', and what agents
// are told about the workspace. What it reads and writes is the worker's (`main.ts`).
import { useCallback, useEffect, useState } from "react";
import { Button, Icon, Note, OptionRow, Page, Row, Section, SelectField, StatusDot, useOption, useTheme } from "pumi";

import type { Mode } from "./catalog.ts";
import { hookStatus } from "./hooks/integrations.ts";
import { agentRows, changeHooks, setMode, type AgentRow } from "./main.ts";
import { PREFIX } from "./names.ts";

const MODES_HELP =
  "Terminal: its own TUI. Terminal + chat: the TUI with the chat drawn over it, one click from the TUI. ACP and SDK: a chat tab that runs the agent itself. Off: left out of the + menu and left alone.";

function useAgents(): { list?: AgentRow[]; error?: string; reload(): void } {
  const [got, setGot] = useState<{ list?: AgentRow[]; error?: string }>({});
  const reload = useCallback(() => {
    agentRows().then(
      (list) => setGot({ list }),
      (err: Error) => setGot((was) => ({ ...was, error: String(err?.message ?? err) })),
    );
  }, []);
  useEffect(reload, [reload]);
  return { ...got, reload };
}

/** What a row says under the agent's name: whether it is here, its hook, and the SDK's note. */
function describe(row: AgentRow): string {
  if (!row.installed) return "Not installed here";
  const hook = row.hook ? `Hook: ${hookStatus(row.hook).text.toLowerCase()}` : "No hook";
  return row.mode === "sdk" && row.note ? `${hook}. ${row.note}` : hook;
}

/** Changing something: which agent is busy (`*` for all), and the note it leaves. */
type Run = (id: string, doing: () => Promise<void>, done: string) => void;

function AgentLine({ row, busy, run }: { row: AgentRow; busy: string | undefined; run: Run }) {
  const t = useTheme();
  const hook = row.hook;
  const action = hook ? hookStatus(hook).action : undefined;
  const installed = hook?.hook === "installed" || hook?.hook === "outdated";
  const dot = hook?.hook === "installed" ? t.success : hook?.hook === "outdated" ? t.warning : t.faint;
  const mark = row.icon ? <img src={row.icon} objectFit="contain" style={{ width: 18, height: 18, flexShrink: 0 }} /> : <Icon name="sparkle" size={18} color={t.muted} />;
  return (
    <Row
      link={`${PREFIX}agent-${row.id}`}
      testId={`agents-agent-${row.id}`}
      icon={mark}
      title={row.title}
      description={describe(row)}
      control={
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          {hook && row.installed ? <StatusDot color={dot} /> : null}
          {action && row.installed ? (
            <Button primary={action === "update"} loading={busy === row.id} disabled={!!busy} onClick={() => run(row.id, () => changeHooks([row.id], true), `Done. Restart ${row.title} to apply.`)}>
              {action === "update" ? "Update hook" : "Install hook"}
            </Button>
          ) : null}
          {installed ? <Button ghost icon="close" title="Remove the hook" disabled={!!busy} onClick={() => run(row.id, () => changeHooks([row.id], false), "Removed.")} /> : null}
          <SelectField options={row.modes} value={row.mode} onChange={(mode) => run(row.id, () => setMode(row.id, mode as Mode), "")} width={170} testId={`agents-mode-${row.id}`} />
        </div>
      }
    />
  );
}

export function SettingsPage() {
  const { list, error, reload } = useAgents();
  // The list follows the modes, set here or in settings.json.
  const [modes] = useOption<Record<string, string>>(`${PREFIX}modes`);
  useEffect(reload, [JSON.stringify(modes ?? {})]);
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();
  const run: Run = (id, doing, done) => {
    setBusy(id);
    setStatus(undefined);
    doing()
      .then(
        () => setStatus(done ? { text: done } : undefined),
        (err: Error) => setStatus({ text: String(err?.message ?? err), error: true }),
      )
      .finally(() => {
        setBusy(undefined);
        reload();
      });
  };
  const rows = list ?? [];
  const due = rows.filter((row) => row.installed && row.hook && (row.hook.hook === "not_installed" || row.hook.hook === "outdated"));
  return (
    <Page title="Agents" description="Coding agents in your tabs: how each one opens from the + menu, its chat, its hook, and what it is told about your workspace.">
      <Section
        id={`${PREFIX}agents`}
        title="Agents"
        description={`${MODES_HELP} An agent's hook tells pumi its session and when it works, waits on you or is done.`}
        actions={
          <>
            <Button ghost icon="rotate_cw" title="Refresh" disabled={!!busy} onClick={() => (setStatus(undefined), reload())} />
            <Button primary disabled={!due.length || !!busy} loading={busy === "*"} onClick={() => run("*", () => changeHooks(due.map((row) => row.id), true), "Done. Restart agents to apply.")}>
              {due.length ? `Install ${due.length} hook${due.length === 1 ? "" : "s"}` : "Hooks up to date"}
            </Button>
          </>
        }
      >
        {status ? <Note tone={status.error ? "error" : undefined}>{status.text}</Note> : null}
        {!list ? <Row title={error ?? "Loading…"} /> : null}
        {rows.map((row) => (
          <AgentLine key={row.id} row={row} busy={busy} run={run} />
        ))}
        {list && error ? <Note tone="error">{error}</Note> : null}
      </Section>
      <Section id={`${PREFIX}chat`} title="Chat">
        <OptionRow name={`${PREFIX}key`} />
        <OptionRow name={`${PREFIX}history_mb`} />
        <OptionRow name={`${PREFIX}bun`} />
      </Section>
      <Section id={`${PREFIX}hooks`} title="Hooks">
        <OptionRow name={`${PREFIX}permissions`} />
        <OptionRow name={`${PREFIX}restore`} />
      </Section>
      <Section id={`${PREFIX}context`} title="Workspace context" description="What an agent is told about the sessions, panes and tabs around it: a short guide to pumi and a map, at its start, then only what changed.">
        <OptionRow name={`${PREFIX}context`} />
        <OptionRow name={`${PREFIX}context_updates`} />
        <OptionRow name={`${PREFIX}context_other_sessions`} />
      </Section>
    </Page>
  );
}
