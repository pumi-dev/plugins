import { describe, expect, test } from "bun:test";
import { reap, ruleText } from "../src/machine.ts";

describe("the admin rule", () => {
  test("allows the two pmset commands, for this account, and nothing else", () => {
    const shell = ruleText("amr");
    expect(shell).toContain("Cmnd_Alias PUMI_AWAKE = /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0");
    expect(shell).toContain("amr ALL=(ALL) NOPASSWD: PUMI_AWAKE");
    expect(shell).toContain("/etc/sudoers.d/pumi-awake");
    expect(shell).toContain("/usr/sbin/visudo -c -f /etc/sudoers.d/pumi-awake");
    // A rule that does not parse is taken away again, not left to break sudo.
    expect(shell).toContain("|| ( rm -f /etc/sudoers.d/pumi-awake; exit 1 )");
    // No `pmset` beyond the two, and no other command granted.
    expect(shell.match(/pmset/g)?.length).toBe(2);
  });

  test("survives AppleScript's own string, which cannot carry a quote or a backslash", () => {
    expect(ruleText("amr")).not.toContain('"');
    expect(ruleText("amr")).not.toContain("\\");
  });

  test("the shell it runs parses", () => {
    // `/bin/sh -n` reads it without running anything: the file it writes is root's, not ours.
    const checked = Bun.spawnSync(["/bin/sh", "-n", "-c", ruleText("amr")], { stderr: "pipe" });
    expect(checked.stderr.toString()).toBe("");
    expect(checked.exitCode).toBe(0);
  });

  test("an account name it cannot write safely is an admin group instead", () => {
    expect(ruleText("amr; rm -rf /")).toContain("%admin ALL=(ALL) NOPASSWD: PUMI_AWAKE");
    expect(ruleText("")).toContain("%admin ALL=(ALL) NOPASSWD: PUMI_AWAKE");
  });
});

describe("putting out an assertion an earlier run left", () => {
  test("a caffeinate is ended, and anything else is left alone", async () => {
    if (process.platform !== "darwin") return;
    const keeping = Bun.spawn(["/usr/bin/caffeinate", "-i", "-t", "30"], { stdout: "ignore", stderr: "ignore" });
    await Bun.sleep(100);
    expect(reap(keeping.pid)).toBe(true);
    await keeping.exited;

    const other = Bun.spawn(["/bin/sleep", "30"], { stdout: "ignore", stderr: "ignore" });
    await Bun.sleep(100);
    expect(reap(other.pid)).toBe(false);
    other.kill();
  });

  test("a pid that is not a process is nothing to do", () => {
    expect(reap(-1)).toBe(false);
    expect(reap(0)).toBe(false);
  });
});
