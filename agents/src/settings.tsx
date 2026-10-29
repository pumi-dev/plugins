// Settings → Agents: the plugin's options, and the Hooks section, where each agent's hook (how it
// tells the plugin its session and its state, and hears queued prompts) is installed, brought up
// to date or removed with a click. What it reads and writes is the worker's (`main.ts`).
import { useCallback, useEffect, useState } from "react";
import { Button, Note, OptionRow, Page, Row, Section, StatusDot, useTheme } from "pumi";

import { hookStatus, type HookRow } from "./hooks/integrations.ts";
import { changeHooks, hookList } from "./main.ts";
import { PREFIX } from "./names.ts";

/** The page's own options, in order. */
const OPTIONS = ["auto", "key", "history_mb"];

export function SettingsPage() {
  return (
    <Page title="Agents">
      <Section>
        {OPTIONS.map((key) => (
          <OptionRow key={key} name={`${PREFIX}${key}`} />
        ))}
      </Section>
    </Page>
  );
}

function useHooks(): { list?: HookRow[]; error?: string; reload(): void } {
  const [got, setGot] = useState<{ list?: HookRow[]; error?: string }>({});
  const reload = useCallback(() => {
    hookList().then(
      (list) => setGot({ list }),
      (err: Error) => setGot((was) => ({ ...was, error: String(err?.message ?? err) })),
    );
  }, []);
  useEffect(reload, [reload]);
  return { ...got, reload };
}

function HookLine({ row, busy, run }: { row: HookRow; busy: string | undefined; run(id: string, doing: () => Promise<void>, done: string): void }) {
  const t = useTheme();
  const { text, action } = hookStatus(row);
  const color = row.hook === "installed" ? t.success : row.hook === "outdated" ? t.warning : t.faint;
  const installed = row.hook === "installed" || row.hook === "outdated";
  return (
    <Row
      link={`${PREFIX}hook-${row.id}`}
      testId={`agents-hook-${row.id}`}
      icon={<StatusDot color={color} />}
      title={row.label}
      description={row.file}
      aside={text}
      control={
        <>
          {action ? (
            <Button primary={action === "update" || row.available} loading={busy === row.id} disabled={!!busy} onClick={() => run(row.id, () => changeHooks([row.id], true), `Done. Restart ${row.label} to apply.`)}>
              {action === "update" ? "Update" : "Install"}
            </Button>
          ) : null}
          {installed ? <Button ghost icon="close" title="Remove" disabled={!!busy} onClick={() => run(row.id, () => changeHooks([row.id], false), "Removed.")} /> : null}
        </>
      }
    />
  );
}

export function HooksSection() {
  const { list, error, reload } = useHooks();
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();
  const run = (id: string, doing: () => Promise<void>, done: string) => {
    setBusy(id);
    setStatus(undefined);
    doing()
      .then(
        () => setStatus({ text: done }),
        (err: Error) => setStatus({ text: String(err?.message ?? err), error: true }),
      )
      .finally(() => {
        setBusy(undefined);
        reload();
      });
  };
  // Those here first, then the rest, each kind in the table's order.
  const rows = [...(list ?? [])].sort((a, b) => Number(b.available) - Number(a.available));
  const due = rows.filter((row) => row.available && (row.hook === "not_installed" || row.hook === "outdated"));
  return (
    <Section id={`${PREFIX}hooks`} title="Hooks" description="An agent's hook tells the chat its session and when it works, waits on you or is done, in a tab opened for it.">
      <Row
        title="All agents here"
        description={!list ? (error ?? "Loading…") : due.length ? `${due.length} to install or update` : "Up to date"}
        control={
          <>
            <Button ghost icon="rotate_cw" title="Refresh" disabled={!!busy} onClick={() => (setStatus(undefined), reload())} />
            <Button primary disabled={!due.length || !!busy} loading={busy === "*"} onClick={() => run("*", () => changeHooks(due.map((row) => row.id), true), "Done. Restart agents to apply.")}>
              Install all
            </Button>
          </>
        }
      />
      {status ? <Note tone={status.error ? "error" : undefined}>{status.text}</Note> : null}
      {rows.map((row) => (
        <HookLine key={row.id} row={row} busy={busy} run={run} />
      ))}
      <OptionRow name={`${PREFIX}permissions`} />
      <OptionRow name={`${PREFIX}restore`} />
    </Section>
  );
}
