// The Host the plugin pairs against: the machine's own SSH on this account.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  SYSTEM_SSH_DIR,
  ensureAuthorizedKeys,
  enrollCommand,
  hostKeyFingerprint,
  hostPaths,
  installShim,
  installUserShim,
  probeSsh,
  readRecord,
  writeRecord,
  type HostRecord,
} from "../src/host.ts";

const dirs: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "heeler-host-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the machine's SSH host", () => {
  test("its files: the shim under the plugin's state, the keys in the account's ~/.ssh", () => {
    const home = "/Users/ada";
    const paths = hostPaths("/state/heeler", home);
    expect(paths.shim).toBe("/state/heeler/bin/herdr");
    expect(paths.authorizedKeys).toBe("/Users/ada/.ssh/authorized_keys");
  });

  test("the fingerprint is the machine sshd's, from /etc/ssh", () => {
    const fingerprint = hostKeyFingerprint();
    expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(hostKeyFingerprint(join(temp(), "nope"))).toBeUndefined();
    expect(existsSync(SYSTEM_SSH_DIR)).toBe(true);
  });

  test("authorized_keys exists, private, before a pairing writes to it", () => {
    const home = temp();
    const path = join(home, ".ssh", "authorized_keys");
    ensureAuthorizedKeys(path);
    expect(readFileSync(path, "utf8")).toBe("");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".ssh")).mode & 0o777).toBe(0o700);
  });

  test("the shim runs the plugin's CLI with pumi's own Bun", () => {
    const paths = hostPaths(temp());
    installShim(paths);
    const body = readFileSync(paths.shim, "utf8");
    expect(body.startsWith("#!/bin/sh\n")).toBe(true);
    expect(body).toContain("BUN_BE_BUN=1");
    expect(body).toContain(`HEELER_STATE='${paths.root}'`);
    expect(body).toContain("cli.ts");
    expect(body).toContain('"$@"');
    expect(statSync(paths.shim).mode & 0o111).not.toBe(0);
  });

  test("~/.local/bin/herdr is written only when no real herdr is there", () => {
    const home = temp();
    const paths = hostPaths(temp(), home);
    const target = join(home, ".local", "bin", "herdr");

    // Nothing there: the shim goes in.
    expect(installUserShim(paths, home)).toBe(target);
    expect(readFileSync(target, "utf8")).toContain("pumi heeler plugin");

    // Our own shim: rewritten.
    writeFileSync(target, "#!/bin/sh\n# herdr, answered by the pumi heeler plugin\nstale\n");
    installUserShim(paths, home);
    expect(readFileSync(target, "utf8")).toContain("cli.ts");

    // A real herdr: left exactly as it was.
    const real = "#!/bin/sh\nexec /usr/local/bin/herdr \"$@\"\n";
    writeFileSync(target, real);
    installUserShim(paths, home);
    expect(readFileSync(target, "utf8")).toBe(real);
  });

  test("the Enrollment forced command names the shim, the state and the pairing", () => {
    const paths = hostPaths("/state/heeler");
    const command = enrollCommand(paths, "abc123");
    expect(command).toContain(`${paths.shim}' __enroll`);
    expect(command).toContain(`--state-dir '${paths.root}'`);
    expect(command).toContain("--pairing-id abc123");
    expect(command).not.toContain('"');
  });

  test("a path that cannot be single-quoted is refused, not mangled", () => {
    expect(() => enrollCommand(hostPaths("/tmp/it's"), "abc")).toThrow();
  });

  test("the probe says whether something answers on the advertised port", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = server.port;
    const open = await probeSsh(port, "127.0.0.1", 500);
    server.stop(true);
    expect(open.running).toBe(true);
    const closed = await probeSsh(port, "127.0.0.1", 300);
    expect(closed.running).toBe(false);
  });

  test("the record the shim reads round-trips", () => {
    const paths = hostPaths(temp());
    mkdirSync(paths.root, { recursive: true });
    const record: HostRecord = {
      plugin: "heeler",
      version: "0.6.2",
      state: paths.root,
      data: paths.root,
      apiSocket: join(paths.root, "herdr.sock"),
      clientSocket: join(paths.root, "herdr-client.sock"),
      gridSocket: join(paths.root, "grid.sock"),
      session: "pumi",
      sessionDir: join(paths.root, "sessions", "pumi"),
      configDir: join(paths.root, "config"),
      bin: paths.shim,
      ssh: { port: 22, user: "ada", fingerprint: "SHA256:0123456789012345678901234567890123456789012", running: true },
    };
    writeRecord(paths, record);
    expect(readRecord(paths)).toEqual(record);
    expect(statSync(join(paths.root, "host.json")).mode & 0o777).toBe(0o600);
  });
});
