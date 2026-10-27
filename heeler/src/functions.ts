// What pumi can do with the plugin, as functions: the surface Settings calls.
//
// Heeler's QR and its address list are a UI in Heeler's own herdr plugin. In pumi they are these
// functions (`pumi call heeler.pair.status`), so Settings can draw them without this plugin putting a
// pane in the app: `heeler.pair.status` is the checklist, `heeler.pair.confirm` mints the code and
// answers its QR as text rows, `heeler.pair.poll` is the enrolled device, and `heeler.pair.revoke` is
// the one-key revoke.
//
// Everything answers plain JSON: Settings reads it, and so does a terminal.

import { clipboard, fn, request } from "pumi";
import type { SshHost } from "./host.ts";
import type { Pairing } from "./pair.ts";
import { qrRows } from "./pairing/qr.ts";

/** What the plugin knows that the functions answer with. */
export interface FunctionDeps {
  version: string;
  prefix: string;
  state: string;
  configDir: string;
  host: () => SshHost;
  pairing: Pairing;
  session: () => Promise<string>;
  restartHost: () => Promise<SshHost>;
}

function args(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The addresses a caller asked for: an array, or a lone string as `pumi call` passes it. */
function addressesOf(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : undefined;
}

export function provideFunctions(deps: FunctionDeps): void {
  fn.set(
    "status",
    {
      desc: "The heeler Host: the machine's SSH (the port and `/etc/ssh` fingerprint a code pins), this account, the herdr session, and the pairing state.",
      effect: "read",
    },
    async () => ({
      plugin: { version: deps.version, prefix: deps.prefix, state: deps.state, configDir: deps.configDir },
      session: await deps.session(),
      ssh: deps.host(),
      pairing: await deps.pairing.status(),
    }),
  );

  fn.set(
    "pair.status",
    {
      desc: "The Pairing surface: candidate addresses (the one to pre-check marked), the port, the host key fingerprint, the tailnet, and a live code's QR.",
      effect: "read",
    },
    () => deps.pairing.status(),
  );

  fn.set(
    "pair.confirm",
    {
      desc: "Mint the Pairing Code for these addresses (or the pre-checked ones) and answer the code, its QR as text rows, and when it expires.",
      effect: "write",
      paramsSchema: { type: "object", properties: { addresses: { type: "array", items: { type: "string" } } } },
    },
    (value: unknown) => deps.pairing.confirm(addressesOf(value)),
  );

  fn.set(
    "pair.poll",
    {
      desc: "Check the live code: the device that just enrolled, an expiry, or still waiting.",
      effect: "read",
    },
    () => deps.pairing.poll(),
  );

  fn.set(
    "pair.cancel",
    {
      desc: "End the live pairing ceremony and remove its Bootstrap Key line.",
      effect: "write",
    },
    () => deps.pairing.cancel(),
  );

  fn.set(
    "pair.revoke",
    {
      desc: "Revoke the Device Key that just enrolled, removing its authorized_keys line.",
      effect: "write",
    },
    () => deps.pairing.revoke(),
  );

  fn.set(
    "pair.copy",
    {
      desc: "Put the live Pairing Code on the clipboard, as the `c` key does in Heeler's pairing popup.",
      effect: "write",
    },
    async () => {
      const code = deps.pairing.code();
      if (code === undefined) return { copied: false, error: "There is no live Pairing Code." };
      await clipboard.set(code);
      return { copied: true, code };
    },
  );

  fn.set(
    "pair.qr",
    {
      desc: "Draw any text as a QR, as text rows: a Pairing Code, a URL, a link.",
      effect: "read",
      paramsSchema: { type: "object", properties: { text: { type: "string" } } },
    },
    (text: unknown) => (typeof text === "string" ? { text, qr: qrRows(text) } : { error: "heeler.pair.qr needs text" }),
  );

  fn.set(
    "host.restart",
    {
      desc: "Re-probe the machine's SSH and refresh what the shim reads (after an SSH port change).",
      effect: "write",
    },
    () => deps.restartHost(),
  );

  fn.set(
    "host.key",
    {
      desc: "The SSH host key's OpenSSH fingerprint, the one every Pairing Code pins.",
      effect: "read",
    },
    () => ({ fingerprint: deps.host().fingerprint ?? null }),
  );

  fn.set(
    "say",
    {
      desc: "Say something in pumi's notifications, for a plugin's own checks.",
      effect: "write",
      paramsSchema: { type: "object", properties: { text: { type: "string" } } },
    },
    async (text: unknown) => {
      if (typeof text !== "string") return false;
      await request.open({ kind: "notification", title: text, level: "info" });
      return true;
    },
  );
}

