// What usage draws, in the window's React tree: a segment in the status bar for each plan signed
// in — a meter for the window closest to its limit, the windows' shares and when they reset — and,
// in the side bar's Usage section, every window of every plan with its account and its pace. The
// numbers are the worker's (`main.ts`); the settings are the plugin's options, which the window
// reads itself so a change of layout is a render, not a read.

import { useEffect, useState } from "react";
import {
  IconButton,
  useChannel,
  useInterval,
  useMetrics,
  useNow,
  useOption,
  usePlugin,
  useTheme,
  type Tokens,
} from "pumi";

import { current, refresh } from "./main.ts";
import {
  ago,
  ahead,
  band,
  barWindows,
  describeWindows,
  left,
  percent,
  resetText,
  tightest,
  type Reading,
  type Snapshot,
  type Window,
} from "./model.ts";
import { coerce, OPTION_OF, type Settings } from "./settings.ts";

/** The plugin's own option prefix (`amresyd.usage.`), as pumi names an option. */
function usePrefix(): string {
  const id = usePlugin() ?? "";
  return id ? `${id.replace("/", ".").replaceAll("-", "_")}.` : "";
}

/**
 * The plugin's options as settings. Each is a hook of its own, in the same order every render:
 * a change of one re-renders this view, and the value is the server's, not a copy.
 */
function useSettings(): Settings {
  const prefix = usePrefix();
  const show = useOption<boolean>(`${prefix}${OPTION_OF.show}`);
  const claude = useOption<boolean>(`${prefix}${OPTION_OF.claude}`);
  const codex = useOption<boolean>(`${prefix}${OPTION_OF.codex}`);
  const copilot = useOption<boolean>(`${prefix}${OPTION_OF.copilot}`);
  const openrouter = useOption<boolean>(`${prefix}${OPTION_OF.openrouter}`);
  const layout = useOption<string>(`${prefix}${OPTION_OF.layout}`);
  const windows = useOption<number>(`${prefix}${OPTION_OF.windows}`);
  const resets = useOption<string>(`${prefix}${OPTION_OF.resets}`);
  const label = useOption<boolean>(`${prefix}${OPTION_OF.label}`);
  const meter = useOption<number>(`${prefix}${OPTION_OF.meter}`);
  const tint = useOption<boolean>(`${prefix}${OPTION_OF.tint}`);
  const warnAt = useOption<number>(`${prefix}${OPTION_OF.warnAt}`);
  const critAt = useOption<number>(`${prefix}${OPTION_OF.critAt}`);
  const every = useOption<number>(`${prefix}${OPTION_OF.every}`);
  const alert = useOption<boolean>(`${prefix}${OPTION_OF.alert}`);
  const values: Record<string, unknown> = {
    [OPTION_OF.show]: show,
    [OPTION_OF.claude]: claude,
    [OPTION_OF.codex]: codex,
    [OPTION_OF.copilot]: copilot,
    [OPTION_OF.openrouter]: openrouter,
    [OPTION_OF.layout]: layout,
    [OPTION_OF.windows]: windows,
    [OPTION_OF.resets]: resets,
    [OPTION_OF.label]: label,
    [OPTION_OF.meter]: meter,
    [OPTION_OF.tint]: tint,
    [OPTION_OF.warnAt]: warnAt,
    [OPTION_OF.critAt]: critAt,
    [OPTION_OF.every]: every,
    [OPTION_OF.alert]: alert,
  };
  return coerce((option) => values[option]);
}

/**
 * The plans as the worker last read them: what it posts while the view is mounted, and what it
 * answers with when the view mounts (a later window, or the view drawing before the first post).
 */
function useReadings(): Snapshot | null {
  const posted = useChannel<Snapshot | null>("usage", null);
  const [early, setEarly] = useState<Snapshot | null>(null);
  useEffect(() => {
    let alive = true;
    current()
      .then((snapshot) => {
        if (alive) setEarly(snapshot);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  // Another app's window hears no posts: it asks again now and then instead.
  useInterval(() => {
    current()
      .then((snapshot) => setEarly(snapshot ?? null))
      .catch(() => undefined);
  }, 60_000);
  return posted ?? early;
}

/** The status bar's view: one segment per plan, tightest limit first in each. */
export function Segments() {
  const settings = useSettings();
  const snapshot = useReadings();
  const now = useNow(30_000);
  const readings = snapshot?.readings ?? [];
  if (!settings.show || readings.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: "100%", flexShrink: 0 }}>
      {readings.map((reading) => (
        <Segment key={reading.provider} reading={reading} settings={settings} now={now} />
      ))}
    </div>
  );
}

/** One plan in the status bar: its name, a meter for its tightest window, its windows' shares. */
function Segment({ reading, settings, now }: { reading: Reading; settings: Settings; now: number }) {
  const t = useTheme();
  const m = useMetrics();
  const report = reading.report;
  const top = tightest(report?.windows);
  const windows = report ? barWindows(report.windows, settings.windows) : [];
  return (
    <div
      aria-label={`${reading.name} usage`}
      title={tip(reading, settings, now)}
      onClick={() => void refresh().catch(() => undefined)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 18,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: m.radiusSmall,
        flexShrink: 0,
        cursor: "pointer",
        hover: { backgroundColor: t.hover },
      }}
    >
      {settings.label ? <text style={{ fontSize: 11, color: t.muted }}>{reading.name}</text> : null}
      {top && settings.layout !== "compact" ? (
        <Meter used={top.used} width={settings.meter} color={meterColor(t, top.used, settings)} rail={t.active} />
      ) : null}
      {settings.layout === "detailed" ? (
        windows.map((window, i) => (
          <div key={`${window.title}-${i}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
            {i > 0 ? <text style={{ fontSize: 11, color: t.faint }}>·</text> : null}
            <text style={{ fontSize: 11, color: numberColor(t, window.used, settings) }}>{`${Math.round(percent(window.used))}%`}</text>
            <Reset window={window} settings={settings} now={now} />
          </div>
        ))
      ) : top && settings.layout === "compact" ? (
        <text style={{ fontSize: 11, color: numberColor(t, top.used, settings) }}>{`${Math.round(percent(top.used))}%`}</text>
      ) : null}
      {reading.error ? <text style={{ fontSize: 11, color: t.warning }}>!</text> : null}
    </div>
  );
}

/** When a window comes back, in the words the settings ask for. */
function Reset({ window, settings, now }: { window: Window; settings: Settings; now: number }) {
  const t = useTheme();
  const text = resetText(window, now, settings.resets);
  if (!text) return null;
  return <text style={{ fontSize: 10.5, color: t.faint }}>{text}</text>;
}

/** A window's share as a bar; `width` is the whole bar, the fill is `used` of it. */
function Meter({ used, width, color, rail }: { used: number; width: number | string; color: string; rail: string }) {
  const share = percent(used);
  return (
    <div style={{ width, height: 4, borderRadius: 2, flexShrink: 0, backgroundColor: rail, overflow: "hidden" }}>
      {share > 0 ? <div style={{ width: `${share}%`, height: "100%", borderRadius: 2, backgroundColor: color }} /> : null}
    </div>
  );
}

/** A window's share, in the colour the thresholds ask for. */
function numberColor(t: Tokens, used: number, settings: Settings): string {
  if (!settings.tint) return t.text;
  switch (band(used, settings.warnAt, settings.critAt)) {
    case "critical":
      return t.error;
    case "warning":
      return t.warning;
    default:
      return t.text;
  }
}

/** A meter's fill: quiet until a window nears its limit, then the warning and error colours. */
function meterColor(t: Tokens, used: number, settings: Settings): string {
  if (!settings.tint) return t.muted;
  switch (band(used, settings.warnAt, settings.critAt)) {
    case "critical":
      return t.error;
    case "warning":
      return t.warning;
    default:
      return t.muted;
  }
}

/** What a segment says when the mouse rests on it: both windows, the account, and when it was read. */
function tip(reading: Reading, settings: Settings, now: number): string {
  const lines: string[] = [];
  const account = reading.report?.account;
  const who = [reading.name, account?.plan, account?.email].filter(Boolean).join(" · ");
  lines.push(who);
  lines.push(...describeWindows(reading.report, now, settings.resets));
  const balance = reading.report?.balance;
  if (balance) lines.push(`Credits: ${balance}`);
  if (reading.error) lines.push(reading.error);
  lines.push(`Read ${ago(reading.at, now)} · click to read again`);
  return lines.join("\n");
}

// ---- the side bar

/** The side bar's Usage section: every plan, its windows, its account, and why a read failed. */
export function Details() {
  const t = useTheme();
  const settings = useSettings();
  const snapshot = useReadings();
  const now = useNow(15_000);
  const readings = snapshot?.readings ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 10 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
        <text style={{ fontSize: 10.5, color: t.faint, flexGrow: 1 }}>{snapshot ? `Read ${ago(snapshot.at, now)}` : "Reading the plans…"}</text>
        <IconButton icon="rotate_cw" title="Read the plans again" onClick={() => void refresh().catch(() => undefined)} />
      </div>
      {readings.length === 0 ? <Nothing yet={snapshot !== null} /> : null}
      {readings.map((reading) => (
        <Plan key={reading.provider} reading={reading} settings={settings} now={now} />
      ))}
    </div>
  );
}

/** One plan: who it is, each window with its meter and reset, then whatever else it reports. */
function Plan({ reading, settings, now }: { reading: Reading; settings: Settings; now: number }) {
  const t = useTheme();
  const m = useMetrics();
  const report = reading.report;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 8,
        borderRadius: m.radius,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.border,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 6 }}>
        <text style={{ fontSize: 12, fontWeight: 600, color: t.text, flexGrow: 1 }}>{reading.name}</text>
        {report?.account.plan ? <text style={{ fontSize: 10.5, color: t.accent }}>{report.account.plan}</text> : null}
      </div>
      {report?.account.email ? <text style={{ fontSize: 10.5, color: t.faint }}>{report.account.email}</text> : null}
      {report?.windows.map((window, i) => (
        <Limit key={`${window.title}-${i}`} window={window} settings={settings} now={now} />
      ))}
      {report?.balance ? (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", gap: 6 }}>
          <text style={{ fontSize: 10.5, color: t.muted }}>Credits</text>
          <text style={{ fontSize: 10.5, color: t.text }}>{report.balance}</text>
        </div>
      ) : null}
      {report?.facts?.map((section) => (
        <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <text style={{ fontSize: 10, color: t.faint }}>{section.title}</text>
          {section.rows.map(([key, value], i) => (
            <div key={`${key}-${i}`} style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", gap: 6 }}>
              <text style={{ fontSize: 10.5, color: t.muted }}>{key}</text>
              <text style={{ fontSize: 10.5, color: t.text }}>{value}</text>
            </div>
          ))}
        </div>
      ))}
      {reading.error ? <text style={{ fontSize: 10.5, color: t.warning }}>{reading.error}</text> : null}
      {reading.at ? <text style={{ fontSize: 10, color: t.faint }}>Read {ago(reading.at, now)}</text> : null}
    </div>
  );
}

/** One window in the panel: its share, a meter, what is left, when it resets, and its pace. */
function Limit({ window, settings, now }: { window: Window; settings: Settings; now: number }) {
  const t = useTheme();
  const share = Math.round(percent(window.used));
  const reset = resetText(window, now, settings.resets);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", gap: 6 }}>
        <text style={{ fontSize: 11, color: t.text }}>{window.title}</text>
        <text style={{ fontSize: 11, color: numberColor(t, window.used, settings) }}>{`${share}% used`}</text>
      </div>
      <Meter used={window.used} width="100%" color={meterColor(t, window.used, settings)} rail={t.active} />
      <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
        <text style={{ fontSize: 10, color: t.faint }}>{`${Math.round(left(window.used))}% left`}</text>
        {reset ? <text style={{ fontSize: 10, color: t.muted }}>{`resets ${reset}`}</text> : null}
        {ahead(window, now) ? <text style={{ fontSize: 10, color: t.warning }}>ahead of pace</text> : null}
      </div>
    </div>
  );
}

/** What the panel says while no plan is signed in: which sign-ins it would read with no setting. */
function Nothing({ yet }: { yet: boolean }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 2 }}>
      <text style={{ fontSize: 11, color: t.text }}>{yet ? "No plan is signed in on this Mac." : "Looking for a plan…"}</text>
      {yet ? (
        <text style={{ fontSize: 10.5, color: t.muted }}>
          Claude Code's keychain item, the Codex CLI's `~/.codex/auth.json`, or `gh auth token` for Copilot would be read with nothing to set. An
          OpenRouter key goes in Settings → Usage → Keys.
        </text>
      ) : null}
    </div>
  );
}
