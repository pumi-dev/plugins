# heeler

Heeler's Host for pumi — a normal herdr Host: the machine's own SSH on port 22, this account, and a
herdr session named `pumi`.

One plugin is everything the [Heeler](https://heeler.app) mobile app needs from this machine: it
serves herdr's API and terminal-attach sockets on pumi's sessions, tabs and panes; it mints the QR
**Pairing Code** that enrolls a phone into the account's `authorized_keys`; and it sends Heeler's
**Agent Notifications** and drives its **Live Activities** from an agent's `@agent_status`.

The plugin runs **no SSH server of its own** and has **no Tailscale integration**: Heeler connects to
the machine's OpenSSH (macOS `Remote Login`, or the distro's sshd) exactly as it would to any herdr
Host, from the LAN or from whatever VPN the machine or the phone is on. A `herdr` shim is installed
only so the commands Heeler runs answer on a machine that has no herdr installed; a real herdr at
`~/.local/bin/herdr` is left untouched and used.

```
Heeler app ──ssh :22 (the machine's sshd, as your account)──▶ herdr.sock / herdr-client.sock
     │                    │                                          │
     │                    ├── direct-streamlocal (the herdr API) ────┤
     │                    ├── PTY: herdr agent/terminal attach ──────┤ (live terminal)
     │                    └── SFTP: notifications.json ──▶ config dir │
     └── scan QR ──▶ HERDR-PAIR:1:… ──▶ Bootstrap Key ──▶ Device Key enrolled
```

## What it answers

### herdr's API, on pumi's model

`src/api.ts`, `src/server.ts`, `src/view.ts`, `src/methods.ts`, `src/events.ts`.

The protocol is herdr's own (v0.9.x, newline-delimited JSON, protocol 22); `ping`, `pane.read` and
`events.subscribe` are the parts worth knowing. herdr's public ids come from pumi's: session `$5` is
`w5`, its tab `@7` is `w5:t7`, its pane `%9` is `w5:p9`, terminal `term_9`.

Nothing keeps a screen: `pane.read` is the core's own text (`pane.call`'s `read`), keys are
`{"keys": […]}` on the same call, and what an agent is doing is the pane's `@agent`/`@agent_status`
(OSC 7501). Methods herdr serves from its own TUI, plugins or remotes answer `unsupported`, with the
reason. `PARITY.md` is the method-by-method accounting.

The sockets are in pumi's data directory (`$PUMI_DATA_DIR`, else
`~/Library/Application Support/pumi`, else `~/.local/share/pumi`) and, as herdr keeps a named
session, in `~/.config/herdr/sessions/<session>/` — `pumi` by default. In Heeler's Host form:
the machine's address, **port 22**, **your account**, **Session name `pumi`**.

### The SSH host: the machine's own

`src/host.ts`, `src/cli.ts`.

The plugin starts nothing and needs no root: it pairs against and advertises the account's OpenSSH.

* **Host key** — the fingerprint in every Pairing Code is the machine's, read from
  `/etc/ssh/ssh_host_{ed25519,ecdsa,rsa}_key.pub`, the same key the machine's sshd presents.
* **Enrolled keys** — a pairing writes a `restrict,command="…"` line into
  `~/.ssh/authorized_keys` (the account sshd reads it); Enrollment appends the Device Key and
  self-revokes the bootstrap line. Only the lines tagged `herdr-pairing:…` are ours; the account's
  other keys are never touched, and the one-key revoke removes a Device Key by its key blob.
* **The `herdr` shim** — `<state>/bin/herdr`, run by the Enrollment forced command by absolute path,
  and at `~/.local/bin/herdr` **only when no real herdr is there** (a machine with herdr keeps it;
  Heeler's commands put `~/.local/bin` first on their PATH). The shim runs `src/cli.ts` with pumi's
  own embedded Bun (`BUN_BE_BUN=1`), so no Node, no herdr and no extra install is needed.

The commands Heeler runs, in that file:

| Command | |
| --- | --- |
| `herdr --version` | herdr 0.9.4 |
| `herdr session list --json` | the session this plugin answers as |
| `herdr plugin list --json` | `plugin.list`'s envelope, with the `heeler` entry Heeler looks for |
| `herdr plugin config-dir <id>` | the config directory (created) |
| `herdr remote-api-bridge [--check]` / `remote-client-bridge` | stdio ↔ the plugin's sockets |
| `herdr agent attach …` / `terminal attach …` | a live terminal on `herdr-client.sock` |
| `herdr __enroll …` | the forced command behind a Bootstrap Key |

`ssh_port` (option, 22) is what the Pairing Code advertises; move it only if Remote Login itself was
moved. The pairing surface also reports whether something answers on that port
(`heeler.status`/`heeler.pair.status`), and names Remote Login when nothing does.

### Pairing, the QR

`src/pair.ts`, `src/pairing/*`, `src/functions.ts`.

The Pairing Code is Heeler's v1 envelope, byte for byte (`HERDR-PAIR:<version>:<base64url JSON>`),
including the shared test vectors. Confirming the address list mints a single-use **Bootstrap Key**:

* its raw seed rides in the QR (`seed`/`exp`), its public half becomes a
  `restrict,command="…herdr __enroll…"` line, tagged `herdr-pairing:<id>:exp:<unix-seconds>`, for two
  minutes;
* Heeler connects with it once, writes its Device Key public line on stdin, and the forced command
  appends that key under the same lock, self-revokes the bootstrap line, and answers
  `HERDR-ENROLL:OK:<SHA256:…>` — or one of `invalid_key`, `no_input`, `expired`, `unknown_pairing`
  without consuming the line, so the app may retry;
* the enrolled fingerprint and line are recorded, so the success screen can show the device and
  **revoke it with one key**.

Crashes cannot leave anything behind: expired bootstrap lines and stale pending/enrolled records are
swept at every start and every ceremony. The QR is rendered as block characters
(`qrRows`/`qrText`), so it reads in any monospaced view — no ANSI, no image.

### Notifications and Live Activities

`src/notify.ts`, `src/activity.ts`, `src/seal.ts`.

The same hooks Heeler's herdr plugin runs, over pumi's `@agent_status` instead of herdr's
`pane.agent_status_changed`. Heeler writes its Notification Registration to the plugin's config
directory (`~/.config/herdr/plugins/config/heeler/notifications.json`, the path both this plugin and
a real herdr's `plugin config-dir heeler` print); the plugin reads it before every push, so a device
enabled or revoked in the app is followed at once. Blocked/Done alerts are debounced, deduped,
re-checked, and encrypted (AES-256-GCM, `HERDR-NOTIFY:1`) to Heeler's relay; Live Activities are
latest-wins and encrypted under `HERDR-ACTIVITY:1`. Session scoping is Heeler 0.6.0's: an entry is
delivered only to its session, and legacy entries to every session. `notify.json`'s `relay_url`,
`debounce_ms`, `activity_debounce_ms` and `retry_delay_ms` are read from the same directory.

## Settings, and what is still missing there

The user-facing half is Settings, as functions (`pumi call heeler.…`):

| Function | |
| --- | --- |
| `heeler.status` | the whole Host: the machine's SSH (port, `/etc/ssh` fingerprint, whether it answers), this account, the session, the pairing phase |
| `heeler.pair.status` | the checklist: candidate addresses (pre-check marked), port, username, host-key fingerprint, a live code's QR |
| `heeler.pair.confirm [addresses]` | mint the code and answer it, its QR rows, and the expiry |
| `heeler.pair.poll` | the device that just enrolled, an expiry, or still waiting |
| `heeler.pair.cancel` / `heeler.pair.revoke` | end the ceremony / revoke the enrolled Device Key |
| `heeler.pair.copy` / `heeler.pair.qr <text>` | the code to the clipboard / any text as a QR |
| `heeler.host.restart` / `heeler.host.key` | re-probe the SSH port / the host key fingerprint |

**Blockers in pumi's Settings for drawing the pairing surface today** (Settings is the native gpui
window, `src/ui/settings/`):

1. **No plugin view in Settings.** `contributes` has no `settings` entry, and Settings cannot host a
   `ui.tsx` (it is not the React window). What Settings can render of a plugin today is its declared
   options only.
2. **No controls for this flow.** Settings has no read-only multi-line text block (for `qrText`), no
   check-list for `candidates`/`selected`, and no buttons that run one of a plugin's functions and
   show its answer.
3. **No live refresh.** A code changes phase on its own (enrolled / expired). Settings would have to
   poll `heeler.pair.poll` (500 ms while a code is up is plenty) or pumi would need a
   plugin→Settings event.
4. **Monospace fidelity.** The QR is text rows of `█ ▀ ▄`; it must be drawn in a monospaced font,
   unwrapped, with a line height that keeps the cells square enough to scan.

A minimal contract that would unblock it, in the shape Settings already has: a
`contributes.settings` page per plugin with **actions** (a button that calls one provided function
and shows its JSON/text result) plus two controls — `code` (monospaced, multi-line, no wrap) and
`list` (strings with checkboxes) — would draw this whole flow without touching the React SDK.

Meanwhile every function works from a terminal. To get a scannable QR today:

```sh
pumi call heeler.pair.confirm | jq -r .qrText     # the live code's QR, as block text
pumi call heeler.pair.copy                         # or the code itself, to the clipboard
```

`heeler.pair.confirm` takes the addresses as its first argument (a string, or an array); with none it
uses the pre-checked ones. `heeler.pair.status` draws the same checklist without minting anything.

## Options

- `session` (string, `pumi`): the herdr session the sockets are served as, so Heeler's Host session
  name reaches it. Empty: only pumi's data directory.
- `ssh_port` (number, 22): the port the Pairing Code advertises — the account's sshd.
- `default_keys` (boolean, on): bind herdr's prefix keys (`C-b` then `v`, `-`, `h` `j` `k` `l`, …)
  while the plugin runs.

## Where its files are

Under the plugin's state directory (`~/.local/state/pumi/plugins/amresyd.heeler` by default):

```
bin/herdr         the shim the Enrollment forced command names, and a host without herdr runs
host.json         what the shim reads (sockets, session, config dir, SSH port)
pending/ enrolled/    one pairing ceremony's records
```

And in the account's own home:

```
~/.ssh/authorized_keys     the enrolled Device Keys, and a bootstrap line while pairing
~/.local/bin/herdr         the shim, only when no real herdr is installed
~/.config/herdr/sessions/<session>/herdr{,-client}.sock
~/.config/herdr/plugins/config/heeler/notifications.json, notify.json
```

The account's `authorized_keys` is edited atomically (under an exclusive lock, temp file + rename,
mode 0600), so sshd's `StrictModes` stays happy and a crash cannot truncate it. A pairing's line is
tagged `herdr-pairing:<id>:exp:<seconds>`; the startup sweep removes expired ones.

## How it is built

TypeScript on Bun, no view of its own. `src/main.ts` wires it: the sockets, the shim, the pairing
controller, the notification hooks and the provided functions. The pure modules (`src/pairing`,
`src/wire.ts`, `src/grid.ts`, `src/view.ts`, `src/seal.ts`) are what the tests run without pumi.

```sh
bun test
./node_modules/.bin/tsc --noEmit
```

macOS and Linux: the pairing reads `/etc/ssh` and writes `~/.ssh/authorized_keys`, which is where a
POSIX sshd looks. (Heeler has Windows Hosts of its own; this plugin does not cover them.)

**A note on the typecheck.** The plugin runs in the released pumi app (0.42.0) and uses the SDK that
app ships: `provide`, `notify`, `plugin.prefixed`, numeric pane ids. The pumi checkout beside this
repository is mid-move to the v-next SDK (`fn.set`, string ids, `self.plugin`), so `tsc` against that
checkout reports those SDK moves for every package in this repository, this one included — not
runtime errors. The live plugin loads and runs; the port to the new SDK is a separate change once
pumi settles.

Ported from Heeler's herdr plugin (Apache-2.0, `plugin/` of
[ZingerLittleBee/Heeler](https://github.com/ZingerLittleBee/Heeler)): the Pairing Code envelope, keys,
Enrollment protocol, notification/activity envelopes and address rules. Ported from herdr
(Apache-2.0): the API vocabulary, ids, wire and grid protocols. The pumi side is pumi's own.
