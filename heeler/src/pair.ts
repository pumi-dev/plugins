// The pairing ceremony, driven from pumi: Heeler's QR Pairing Code, its address list, and the
// enrolled device that comes back.
//
// Heeler's own herdr plugin draws this as a terminal popup; in pumi the same ceremony is a function
// surface (`heeler.pair.*`) for Settings to draw, and the QR is text rows so any monospaced view can
// show it. The pieces are Heeler's: address candidates, a single-use Bootstrap Key whose restricted
// `~/.ssh/authorized_keys` line lasts two minutes, an Enrollment that appends the Device Key and
// self-revokes the bootstrap line, and a success state with a one-key revoke.
//
// The Host is the machine's own OpenSSH on this account, as a normal herdr Host is: the fingerprint
// in the code is `/etc/ssh`'s, the port is the account's sshd (22 by default), and the line lands in
// the account's `authorized_keys` where that sshd reads it.
//
// PROVENANCE: Heeler `plugin/src/pair-popup.js`, `pairing-session.js`, `addresses.js` @ plugin 0.6.2
// (Apache-2.0); the state machine is this plugin's.

import { homedir } from "node:os";
import { log } from "./log.ts";
import { enrollCommand, hostPaths, type SshHost } from "./host.ts";
import { candidateAddresses, type Candidate } from "./pairing/addresses.ts";
import { commentOf, removeKeyLine, sweepExpiredBootstrapLines } from "./pairing/authorized.ts";
import { encodePairingCode } from "./pairing/code.ts";
import { qrRows, qrText } from "./pairing/qr.ts";
import {
  PAIRING_TTL_SECONDS,
  beginPairing,
  endPairing,
  expirePairing,
  readEnrollment,
  sweepExpiredStateFiles,
  type EnrollmentRecord,
} from "./pairing/session.ts";

/** What the pairing surface shows. */
export interface PairingStatus {
  /** `idle`: no code; `showing`: a code is live; `expired`: it timed out; `enrolled`: a device paired. */
  phase: "idle" | "showing" | "expired" | "enrolled";
  /** Every address the code could offer, the likely one pre-checked. */
  candidates: Candidate[];
  /** The addresses in the live code, or the pre-checked ones while there is none. */
  selected: string[];
  port: number;
  username: string;
  /** The host key fingerprint the code pins: the machine sshd's, from `/etc/ssh`. */
  fingerprint: string;
  /** The Pairing Code, while one is live. */
  code?: string;
  /** The code as text rows, quiet zone included. */
  qr?: string[];
  /** The same, one line per row. */
  qrText?: string;
  /** Unix seconds the code dies at. */
  expiresAt?: number;
  /** How long the code has left, in seconds. */
  remainingSeconds?: number;
  /** The device that just paired: show its fingerprint and offer the revoke. */
  enrolled?: { fingerprint: string; label: string };
  /** What could not be done, in words. */
  error?: string;
  /** The Bootstrap Key line lives only two minutes; Settings can show this. */
  ttlSeconds: number;
}

/** The plugin's own state and the machine's SSH, as the ceremony needs them. */
export interface PairingDeps {
  stateDir: string;
  host: () => SshHost;
  home?: string;
}

/** The live ceremony. */
interface Ceremony {
  pairingId: string;
  addresses: string[];
  code: string;
  qr: string[];
  expiresAt: number;
}

export class Pairing {
  private ceremony: Ceremony | undefined;
  private enrolledRecord: EnrollmentRecord | undefined;
  private expired = false;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PairingDeps) {}

  private get home(): string {
    return this.deps.home ?? process.env.HOME ?? homedir();
  }

  private get paths() {
    return hostPaths(this.deps.stateDir, this.home);
  }

  /** Candidate addresses, from the machine's interfaces. */
  candidates(): Candidate[] {
    return candidateAddresses();
  }

  /** The state, without side effects beyond an expiry check. */
  async status(): Promise<PairingStatus> {
    await this.expireIfDue();
    return this.view(this.candidates());
  }

  /**
   * Mint a code for `addresses` (or for the pre-checked ones). One live ceremony at a time: asking
   * again while one is live answers the live one.
   */
  async confirm(addresses?: string[]): Promise<PairingStatus> {
    return this.serial(async () => {
      const candidates = this.candidates();
      if (this.ceremony !== undefined) return this.view(candidates);
      const offered = new Set(candidates.map((candidate) => candidate.address));
      const chosen =
        addresses !== undefined && addresses.length > 0
          ? addresses.filter((address) => offered.has(address))
          : preChecked(candidates);
      if (chosen.length === 0) {
        return { ...this.view(candidates), error: "Select at least one address this phone can reach." };
      }
      const host = this.deps.host();
      if (host.fingerprint === undefined) {
        return { ...this.view(candidates), error: "No SSH host key under /etc/ssh: turn on Remote Login first." };
      }
      const paths = this.paths;
      try {
        await sweepExpiredBootstrapLines(paths.authorizedKeys);
        sweepExpiredStateFiles(this.deps.stateDir);
        const session = await beginPairing({
          authorizedKeysPath: paths.authorizedKeys,
          stateDir: this.deps.stateDir,
          command: (pairingId) => enrollCommand(paths, pairingId),
        });
        const code = encodePairingCode({
          addresses: chosen,
          port: host.port,
          username: host.user,
          hostKeyFingerprint: host.fingerprint,
          bootstrapSeed: session.seed,
          expiresAt: session.expiresAt,
        });
        const qr = qrRows(code);
        this.ceremony = { pairingId: session.pairingId, addresses: chosen, code, qr, expiresAt: session.expiresAt };
        this.enrolledRecord = undefined;
        this.expired = false;
        log(`pairing ${session.pairingId}: a code for ${chosen.join(", ")} on port ${host.port}, until ${new Date(session.expiresAt * 1000).toISOString()}`);
      } catch (err) {
        return { ...this.view(candidates), error: `Could not start pairing: ${why(err)}` };
      }
      return this.view(candidates);
    });
  }

  /** Check whether the device enrolled, and expire the code when its time is up. */
  async poll(): Promise<PairingStatus> {
    return this.serial(async () => {
      await this.expireIfDue();
      return this.view(this.candidates());
    });
  }

  /** End the ceremony: the bootstrap line, its pending record and any enrollment record go. */
  async cancel(): Promise<PairingStatus> {
    return this.serial(async () => {
      const live = this.ceremony;
      this.ceremony = undefined;
      this.enrolledRecord = undefined;
      this.expired = false;
      if (live !== undefined) {
        await endPairing({ authorizedKeysPath: this.paths.authorizedKeys, stateDir: this.deps.stateDir, pairingId: live.pairingId });
      }
      return this.view(this.candidates());
    });
  }

  /** Remove the device that just paired: one key, no ceremony left behind. */
  async revoke(): Promise<PairingStatus> {
    return this.serial(async () => {
      const record = this.enrolledRecord;
      this.enrolledRecord = undefined;
      this.expired = false;
      if (record !== undefined) {
        try {
          await removeKeyLine(this.paths.authorizedKeys, record.line);
        } catch (err) {
          return { ...this.view(this.candidates()), error: `Could not revoke the Device Key: ${why(err)}` };
        }
        await endPairing({ authorizedKeysPath: this.paths.authorizedKeys, stateDir: this.deps.stateDir, pairingId: record.pairingId });
        log(`pairing ${record.pairingId}: revoked ${record.fingerprint}`);
      }
      return this.view(this.candidates());
    });
  }

  /** The code as one string: what the copy button puts on the clipboard. */
  code(): string | undefined {
    return this.ceremony?.code;
  }

  // ---- internals

  private async expireIfDue(): Promise<void> {
    const live = this.ceremony;
    if (live === undefined) return;
    const record = readEnrollment(this.deps.stateDir, live.pairingId);
    if (record !== null) return this.enroll(record);
    if (Math.floor(Date.now() / 1000) <= live.expiresAt) return;
    try {
      const late = await expirePairing({
        authorizedKeysPath: this.paths.authorizedKeys,
        stateDir: this.deps.stateDir,
        pairingId: live.pairingId,
      });
      this.ceremony = undefined;
      if (late !== null) return this.enroll(late);
      this.expired = true;
    } catch (err) {
      log(`pairing ${live.pairingId}: ${why(err)}`);
    }
  }

  private enroll(record: EnrollmentRecord): void {
    this.ceremony = undefined;
    this.enrolledRecord = record;
    this.expired = false;
    log(`pairing ${record.pairingId}: enrolled ${record.fingerprint}`);
  }

  private view(candidates: Candidate[]): PairingStatus {
    const host = this.deps.host();
    const live = this.ceremony;
    const chosen = live?.addresses ?? preChecked(candidates);
    const now = Math.floor(Date.now() / 1000);
    const enrolled = this.enrolledRecord;
    const phase: PairingStatus["phase"] = phaseOf(live, enrolled, this.expired);
    return {
      phase,
      candidates,
      selected: chosen,
      port: host.port,
      username: host.user,
      fingerprint: host.fingerprint ?? "",
      ...(live === undefined ? {} : { code: live.code, qr: live.qr, qrText: qrText(live.code), expiresAt: live.expiresAt }),
      ...(live === undefined ? {} : { remainingSeconds: Math.max(0, live.expiresAt - now) }),
      ...(enrolled === undefined ? {} : { enrolled: { fingerprint: enrolled.fingerprint, label: commentOf(enrolled.line) } }),
      ttlSeconds: PAIRING_TTL_SECONDS,
    };
  }

  /** One ceremony mutation at a time, so a double tap cannot mint or revoke twice. */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.busy.then(run, run);
    this.busy = next.catch(() => undefined);
    return next;
  }
}

/** The addresses to pre-check: the ones `candidateAddresses` marks. */
function preChecked(candidates: Candidate[]): string[] {
  return candidates.flatMap((candidate) => (candidate.preChecked ? [candidate.address] : []));
}

/** Where the surface is: a live code, a just-enrolled device, the expired one, or nothing yet. */
function phaseOf(live: Ceremony | undefined, enrolled: EnrollmentRecord | undefined, expired: boolean): PairingStatus["phase"] {
  if (live !== undefined) return "showing";
  if (enrolled !== undefined) return "enrolled";
  if (expired) return "expired";
  return "idle";
}

function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
