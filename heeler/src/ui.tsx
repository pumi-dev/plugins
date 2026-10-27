// Settings' Heeler page: pair the phone app, with the QR on the page.
//
// This is the pairing surface Heeler's own herdr plugin draws in a terminal popup, as a Settings
// page: the addresses the code offers, the machine's SSH and this account, the code itself as a QR
// (and as text to copy), the device that enrolled, and the one-key revoke. Everything that decides
// anything is in `main.ts`; this file draws and calls it.
import { useEffect, useRef, useState } from "react";
import { Button, call, OptionRow, Page, Row, Section, Switch, useEvent, useInterval, useOption, usePlugin } from "pumi";
import type { SshHost } from "./host.ts";
import type { PairingStatus } from "./pair.ts";

/** QR's quiet zone, in modules: the margin a camera needs round the code. */
const QUIET = 4;
const QR_SIZE = 176;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function clock(seconds: number | undefined): string {
  if (seconds === undefined) return "";
  const left = Math.max(0, Math.round(seconds));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function validUntil(seconds: number | undefined): string {
  return seconds === undefined ? "" : new Date(seconds * 1000).toLocaleTimeString();
}

/** Runs `run` again while the plugin is not answering yet: a page can open before its worker is up. */
async function attempt<T>(run: () => Promise<T>, tries = 10, wait = 250): Promise<T> {
  let last: unknown;
  for (let at = 0; at < tries; at += 1) {
    try {
      return await run();
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw last;
}

/**
 * The code's modules, read back from the text rows `qrRows` made: each row is two module rows in
 * half blocks, with the quiet zone already around them.
 */
function modulesOf(rows: string[]): boolean[][] {
  const lines = rows.map((row) => [...row]);
  const width = lines[0]?.length ?? 0;
  const size = width - QUIET * 2;
  if (size <= 0) return [];
  const doubled: boolean[][] = [];
  for (const line of lines) {
    const top: boolean[] = [];
    const bottom: boolean[] = [];
    for (const cell of line) {
      top.push(cell === "█" || cell === "▀");
      bottom.push(cell === "█" || cell === "▄");
    }
    doubled.push(top, bottom);
  }
  return doubled.slice(QUIET * 2, QUIET * 2 + size).map((row) => row.slice(QUIET, QUIET + size));
}

/** The code as an SVG data URL: one element, crisp at any size, and what a camera reads. */
function qrSvg(modules: boolean[][]): string {
  const side = modules.length + QUIET * 2;
  let path = "";
  modules.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    }),
  );
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** What the page says the pairing is doing. */
function phaseText(status: PairingStatus | null, host: SshHost | null): { title: string; description: string } {
  if (host !== null && !host.running) {
    return {
      title: "Remote Login is off",
      description: host.error ?? "Turn on System Settings → General → Sharing → Remote Login, then check again.",
    };
  }
  if (status === null) return { title: "Pairing", description: "Reading the machine's addresses…" };
  switch (status.phase) {
    case "showing":
      return {
        title: "Scan with Heeler",
        description: `Valid until ${validUntil(status.expiresAt)}, single use. The code enrolls one device key.`,
      };
    case "enrolled":
      return { title: "Device paired", description: "Its key is in ~/.ssh/authorized_keys now." };
    case "expired":
      return { title: "The code expired", description: "Its Bootstrap Key was removed. Show a new code to pair." };
    default:
      return { title: "Pair a device", description: "Show a code, then scan it with the Heeler app." };
  }
}

export function HeelerPage() {
  const plugin = usePlugin();
  const prefix = plugin === undefined ? "" : `${plugin.replace("/", ".").replaceAll("-", "_")}.`;
  const [session] = useOption<string>(`${prefix}session`);
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [host, setHost] = useState<SshHost | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fn = (name: string) => `${prefix}${name}`;
  const apply = (next: PairingStatus) => setStatus(next);
  const pairStatus = async () => (await call(fn("pair.status"))) as PairingStatus;
  const pairConfirm = async (addresses: string[]) => (await call(fn("pair.confirm"), [addresses])) as PairingStatus;
  const pairCancel = async () => (await call(fn("pair.cancel"))) as PairingStatus;
  const pairRevoke = async () => (await call(fn("pair.revoke"))) as PairingStatus;

  const load = async (probe = false) => {
    if (probe) await call(fn("host.restart")).catch(() => undefined);
    const answer = (await attempt(() => call(fn("status")))) as { ssh: SshHost; pairing: PairingStatus };
    apply(answer.pairing);
    setHost(answer.ssh);
    setError(null);
  };

  useEffect(() => {
    void load(true).catch((err) => setError(message(err)));
    return () => {
      if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
    };
  }, []);

  // The page can open before its worker has registered anything (a plugin starting, a reload):
  // the registry says when it has, and then the status is worth reading again.
  useEvent("registry.changed", () => {
    void load().catch(() => undefined);
  });

  // A live code changes on its own: the device enrolls, or the two minutes run out.
  useInterval(
    () => {
      // A poll that loses a race with a restart keeps the last status: the next one recovers.
      void pairStatus().then(apply).catch(() => undefined);
    },
    status?.phase === "showing" ? 500 : null,
  );

  // The checklist follows what the worker suggests while no code is live.
  const candidateKey = status?.candidates.map((candidate) => candidate.address).join(",") ?? "";
  const selectedKey = status?.selected.join(",") ?? "";
  useEffect(() => {
    if (status === null || status.phase === "showing") return;
    setChosen(new Set(status.selected));
  }, [status?.phase, candidateKey, selectedKey]);

  const run = async (action: () => Promise<PairingStatus>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (address: string, on: boolean) => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (on) next.add(address);
      else next.delete(address);
      return next;
    });
  };

  const copy = async () => {
    setError(null);
    try {
      const answer = (await call(fn("pair.copy"))) as { copied: boolean; error?: string };
      if (!answer.copied) return setError(answer.error ?? "There is no live Pairing Code.");
      setCopied(true);
      if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError(message(err));
    }
  };

  const phase = status?.phase ?? "idle";
  const live = phase === "showing";
  const canMint = phase !== "showing" && phase !== "enrolled" && chosen.size > 0 && host?.running === true && !busy;
  const text = phaseText(status, host);
  const addresses = status?.candidates.map((candidate) => candidate.address) ?? [];

  return (
    <Page title="Heeler" description="Pair the Heeler app with this machine: it connects over SSH to this account, as the herdr session below.">
      <Section
        id={`${prefix}pair`}
        title="Pair a device"
        icon="link"
        description="The code carries a single-use key and the machine's SSH fingerprint."
        actions={
          live ? (
            <>
              <Button ghost onClick={() => void copy()}>
                {copied ? "Copied" : "Copy code"}
              </Button>
              <Button danger onClick={() => void run(pairCancel)} disabled={busy}>
                Cancel
              </Button>
            </>
          ) : phase === "enrolled" ? (
            <Button danger onClick={() => void run(pairRevoke)} disabled={busy}>
              Revoke device
            </Button>
          ) : (
            <Button primary onClick={() => void run(() => pairConfirm([...chosen]))} disabled={!canMint} loading={busy}>
              {phase === "expired" ? "Show a new code" : "Show pairing code"}
            </Button>
          )
        }
      >
        <Row
          title={text.title}
          description={text.description}
          icon={phase === "enrolled" ? "check" : host !== null && !host.running ? "status_alert" : "person"}
          aside={live ? `${clock(status?.remainingSeconds)} left` : undefined}
          control={
            host !== null && !host.running ? (
              <Button onClick={() => void load(true)}>Check again</Button>
            ) : phase === "enrolled" && status?.enrolled ? (
              <text style={{ fontFamily: "Menlo", fontSize: 11 }}>{status.enrolled.fingerprint}</text>
            ) : undefined
          }
        />
        {status?.error ? <Row title="Pairing failed" description={status.error} icon="status_alert" /> : null}
        {error ? (
          <Row
            title="The plugin is not answering"
            description={error}
            icon="status_alert"
            control={
              <Button onClick={() => void load(true).catch((err) => setError(message(err)))} loading={busy}>
                Retry
              </Button>
            }
          />
        ) : null}

        {live && status?.qr ? (
          <Row title="Scan it with Heeler" description={`${status.selected.join(", ")} · port ${status.port} · ${status.username}`}>
            <img src={qrSvg(modulesOf(status.qr))} style={{ width: QR_SIZE, height: QR_SIZE, borderRadius: 8 }} />
          </Row>
        ) : null}

        {!live && phase !== "enrolled" && addresses.length > 0 ? (
          <>
            <Row title="Addresses" description="What the phone can reach this machine on. The suggested one is checked." />
            {status?.candidates.map((candidate) => (
              <Row
                key={candidate.address}
                title={candidate.address}
                description={`${candidate.interfaceName} · ${candidate.family}${candidate.preChecked ? " · suggested" : ""}`}
                control={<Switch checked={chosen.has(candidate.address)} onChange={(on) => toggle(candidate.address, on)} aria-label={candidate.address} />}
              />
            ))}
          </>
        ) : null}

        {status !== null ? (
          <Row
            title="SSH"
            description={`${status.username}@${status.port}${host?.running ? "" : " · not answering"}${session ? ` · session ${session}` : ""}`}
            aside={status.fingerprint}
          />
        ) : null}
      </Section>

      <Section title="Connect" description="In Heeler, add a Host with these, or scan the code above.">
        <Row
          title="Address"
          description={
            live && status !== null
              ? status.selected.join(", ")
              : chosen.size > 0
                ? [...chosen].join(", ")
                : "—"
          }
          aside="port 22"
        />
        <Row title="User" description={status?.username ?? "—"} />
        <Row title="Session name" description={session ?? "pumi"} />
        <Row title="Host key" description={status?.fingerprint ?? "—"} />
      </Section>

      <Section title="Options">
        <OptionRow name={`${prefix}session`} />
        <OptionRow name={`${prefix}ssh_port`} />
        <OptionRow name={`${prefix}default_keys`} />
      </Section>
    </Page>
  );
}
