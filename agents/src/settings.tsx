// Settings → Agents, one page: each agent installed here with how it opens from the `+` menu (Off,
// Terminal or GUI), the ones that are not named in one line, then what sets them all at once and
// three switches. Hooks go in and
// out by themselves (`main.ts` `syncHooks`), so a row only says whether its agent is connected.
// What it reads and writes is the worker's (`main.ts`).
import { useCallback, useEffect, useState } from "react";
import { ChoiceGrid, Icon, Note, OptionRow, Page, Row, Section, useOption, useTheme } from "pumi";

import type { Choice } from "./catalog.ts";
import { agentRows, setMode, type AgentRow } from "./main.ts";
import { PREFIX } from "./names.ts";

const ABOUT = "Coding agents you open from the + menu. Terminal opens the agent's own screen, with a button to flip it to a chat. GUI opens a chat tab that runs the agent itself.";

/** A choice's cell: wide enough for "Terminal". */
const CELL = { width: 72, height: 24 };

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

function AgentLine({ row, onChoose }: { row: AgentRow; onChoose(choice: Choice): void }) {
  const t = useTheme();
  const mark = row.icon ? <img src={row.icon} objectFit="contain" style={{ width: 18, height: 18, flexShrink: 0 }} /> : <Icon name="sparkle" size={18} color={t.muted} />;
  const error = row.hook?.error;
  return (
    <Row
      link={`${PREFIX}agent-${row.id}`}
      testId={`agents-agent-${row.id}`}
      icon={mark}
      title={row.title}
      aside={row.hook?.connected && row.choice !== "off" ? "Connected" : undefined}
      description={error ? `Couldn't connect it to pumi: ${error}` : row.note}
      control={<ChoiceGrid choices={row.choices} value={row.choice} onChange={(value) => onChoose(value as Choice)} columns={row.choices.length} cell={CELL} testId={`agents-mode-${row.id}`} />}
    />
  );
}

export function SettingsPage() {
  const { list, error, reload } = useAgents();
  // The list follows the options, set here or in settings.json.
  const [modes] = useOption<Record<string, string>>(`${PREFIX}modes`);
  const [hooks] = useOption<boolean>(`${PREFIX}hooks`);
  const [prefer] = useOption<string>(`${PREFIX}prefer`);
  useEffect(reload, [JSON.stringify(modes ?? {}), hooks, prefer]);
  const [failed, setFailed] = useState<string>();
  const choose = (id: string, choice: Choice) => {
    setFailed(undefined);
    setMode(id, choice).then(reload, (err: Error) => setFailed(String(err?.message ?? err)));
  };
  const rows = list ?? [];
  const here = rows.filter((row) => row.installed);
  const missing = rows.filter((row) => !row.installed);
  return (
    <Page title="Agents" description={ABOUT}>
      <Section id={`${PREFIX}agents`}>
        {failed ? <Note tone="error">{failed}</Note> : null}
        {!list ? <Row title={error ?? "Loading…"} /> : null}
        {list && here.length === 0 ? <Row title="No agents installed" description="Install one (Claude Code, Codex, pi, …) and it shows here." /> : null}
        {here.map((row) => (
          <AgentLine key={row.id} row={row} onChoose={(choice) => choose(row.id, choice)} />
        ))}
        {missing.length ? <Row title="Not installed" description={missing.map((row) => row.title).join(", ")} testId="agents-missing" /> : null}
        {list && error ? <Note tone="error">{error}</Note> : null}
      </Section>
      <Section id={`${PREFIX}options`}>
        <OptionRow name={`${PREFIX}prefer`} />
        <OptionRow name={`${PREFIX}hooks`} />
        <OptionRow name={`${PREFIX}permissions`} />
        <OptionRow name={`${PREFIX}context`} />
      </Section>
    </Page>
  );
}
