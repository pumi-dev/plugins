// The machine's half of awake: what holds a Mac up.
//
// Two things, because macOS has two sleeps. `caffeinate` is the first: its assertions stop the
// machine from falling asleep on its own, and it is spawned with `-w <our pid>`, so it lets go when
// pumi does, however pumi ends. The second is the lid: shutting
// it is the kernel's own clamshell sleep, which no assertion can stop and only
// `pmset -a disablesleep` turns off — as root. So the lid's half is a `sudo` call, and the
// `sudoers` rule that makes it silent (no password each time, on the way in and on the way back
// out) is installed once, with the admin prompt macOS shows. It names the two `pmset` commands
// and nothing else.
import { batteryPercent, lidSleepOff, onBattery } from "./plan.ts";

const CAFFEINATE = "/usr/bin/caffeinate";
const PMSET = "/usr/bin/pmset";
const SUDO = "/usr/bin/sudo";
const OSASCRIPT = "/usr/bin/osascript";
const VISUDO = "/usr/sbin/visudo";
const RULE_FILE = "/etc/sudoers.d/pumi-awake";

/** The `sudoers` rule's name: what the two allowed commands are called there. */
const ALIAS = "PUMI_AWAKE";

function log(message: string): void {
  console.error(`pumi-awake: ${message}`);
}

interface Answer {
  code: number;
  out: string;
  err: string;
}

/** Runs `argv` and answers what it said and whether it worked. */
async function run(argv: string[]): Promise<Answer> {
  try {
    const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout as ReadableStream<Uint8Array>).text(),
      new Response(child.stderr as ReadableStream<Uint8Array>).text(),
      child.exited,
    ]);
    return { code, out, err };
  } catch (error: any) {
    return { code: -1, out: "", err: error?.message ?? String(error) };
  }
}

/**
 * The assertion keeping the Mac up, as one `caffeinate`: `-i` the idle system, `-m` the disk, `-s`
 * the whole machine while on AC power. It waits for our pid (`-w`), so a pumi that is killed
 * outright leaves nothing behind.
 */
export class Machine {
  private child: { kill(): void } | null = null;
  private childPid: number | null = null;

  /** Whether an assertion is out now. */
  get holding(): boolean {
    return this.child !== null;
  }

  /** The pid of the `caffeinate` out now, or nothing: worth keeping, so the next run can put it out. */
  get pid(): number | null {
    return this.childPid;
  }

  /** Holds the Mac up, once; a `caffeinate` that ended behind our back is started again. */
  hold(): void {
    if (this.child !== null) {
      if (this.childPid !== null && alive(this.childPid)) return;
      this.stop();
    }
    if (process.platform !== "darwin") return;
    const child = Bun.spawn([CAFFEINATE, "-i", "-m", "-s", "-w", String(process.pid)], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    this.child = { kill: () => child.kill() };
    this.childPid = child.pid;
  }

  /** Lets go: the assertion goes with the process. */
  stop(): void {
    this.child?.kill();
    this.child = null;
    this.childPid = null;
  }
}

/** Whether `pid` is a process still. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends an assertion an earlier run left behind (a worker that was restarted, or crashed, leaves its
 * `caffeinate` waiting for pumi itself). `pid` is only killed when it is still a `caffeinate`.
 */
export function reap(pid: number): boolean {
  if (process.platform !== "darwin" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    const seen = Bun.spawnSync(["/bin/ps", "-p", String(pid), "-o", "command="], { stderr: "ignore" });
    if (seen.exitCode !== 0 || !seen.stdout.toString().includes(CAFFEINATE)) return false;
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/** Whether the lid's sleep is off now, as `pmset` reports it. */
export async function lidSleep(): Promise<boolean> {
  const answer = await run([PMSET, "-g"]);
  return answer.code === 0 && lidSleepOff(answer.out);
}

/** What the machine is running on: its battery or the mains, and how full the battery is. */
export async function battery(): Promise<{ onBattery: boolean; percent: number }> {
  const answer = await run([PMSET, "-g", "batt"]);
  if (answer.code !== 0) return { onBattery: false, percent: -1 };
  return { onBattery: onBattery(answer.out), percent: batteryPercent(answer.out) };
}

/**
 * Whether `sudo` may turn the lid's sleep off and on without a password, which is to say whether
 * the rule is in place. It asks sudo rather than changing anything (`sudo -l`).
 */
export async function maySetLidSleep(): Promise<boolean> {
  const answer = await run([SUDO, "-n", "-l", PMSET, "-a", "disablesleep", "1"]);
  return answer.code === 0;
}

/**
 * Turns the lid's sleep off (`true`) or back on (`false`). Answers whether it took: without the
 * `sudoers` rule and a password already given, it does not.
 */
export async function setLidSleep(off: boolean): Promise<boolean> {
  const answer = await run([SUDO, "-n", PMSET, "-a", "disablesleep", off ? "1" : "0"]);
  if (answer.code !== 0) log(`pmset disablesleep: ${answer.err.trim() || `exit ${answer.code}`}`);
  return answer.code === 0;
}

/**
 * The shell the admin prompt runs: writes the rule (the two `pmset` commands, and nothing else,
 * for this account), checks it with `visudo`, and takes it away again when it does not parse.
 */
export function ruleText(user = process.env.USER ?? ""): string {
  const who = /^[A-Za-z0-9._-]+$/.test(user) ? user : "%admin";
  const allowed = `${PMSET} -a disablesleep 1, ${PMSET} -a disablesleep 0`;
  return [
    `rm -f ${RULE_FILE}`,
    `echo 'Cmnd_Alias ${ALIAS} = ${allowed}' > ${RULE_FILE}`,
    `echo '${who} ALL=(ALL) NOPASSWD: ${ALIAS}' >> ${RULE_FILE}`,
    `chmod 440 ${RULE_FILE}`,
    `${VISUDO} -c -f ${RULE_FILE} > /dev/null 2>&1 || ( rm -f ${RULE_FILE}; exit 1 )`,
  ].join("; ");
}

/**
 * Installs the rule behind the admin prompt, and answers whether it is there now. The shell is
 * written around double quotes and backslashes because AppleScript's own string cannot carry them
 * unescaped; `ruleText` has neither, and this refuses one that does.
 */
export async function installRule(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const shell = ruleText();
  if (shell.includes('"') || shell.includes("\\")) {
    log("the rule's shell would not survive AppleScript, so it was not run");
    return false;
  }
  const apple = `do shell script "${shell}" with administrator privileges`;
  const answer = await run([OSASCRIPT, "-e", apple]);
  if (answer.code !== 0) {
    log(`the admin rule was not installed: ${answer.err.trim() || `exit ${answer.code}`}`);
    return false;
  }
  return true;
}
