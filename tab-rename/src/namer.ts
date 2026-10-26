// The Swift namer (`swift/namer.swift`): built with `swiftc` into the package's cache the first
// time it is needed (and again when its source changes), then kept running, one request at a time
// over JSON lines. No `pumi` here: the caller gives it the directories.
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/** Why there is no model: not a Mac, no `swiftc`, Apple Intelligence off or unsupported, … */
export class Unavailable extends Error {}

type Answer = { id?: number; name?: string; error?: string; ready?: boolean; reason?: string };

const EXITED = "the namer exited";
/** Seconds without a request after which the namer exits. */
const IDLE_SECONDS = 180;

/** The namer's binary for `source`, built if it is not there yet. */
async function binary(source: string, cache: string): Promise<string> {
  const text = readFileSync(source, "utf8");
  const bin = join(cache, `namer-${Bun.hash(text).toString(36)}`);
  if (existsSync(bin)) return bin;
  mkdirSync(cache, { recursive: true });
  const tmp = `${bin}.${process.pid}.tmp`;
  let build: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    build = Bun.spawn(["xcrun", "swiftc", "-O", "-parse-as-library", source, "-o", tmp], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    throw new Unavailable(`swiftc could not run (${e}): install the Xcode command line tools`);
  }
  const [code, err] = await Promise.all([build.exited, new Response(build.stderr).text()]);
  if (code !== 0) throw new Unavailable(`swiftc failed to build the namer: ${err.trim().split("\n").slice(-3).join(" ")}`);
  renameSync(tmp, bin);
  return bin;
}

export class Namer {
  private proc: Bun.Subprocess<"pipe", "pipe", "ignore"> | null = null;
  private starting: Promise<void> | null = null;
  private waiting = new Map<number, (a: Answer) => void>();
  private next = 1;

  constructor(
    private source: string,
    private cache: string,
  ) {}

  /** A name for a tab whose agents work on `titles` (the one in front first), or `null`. */
  async name(titles: string[], maxWords: number): Promise<string | null> {
    let answer = await this.ask(titles, maxWords);
    // It exits when idle (namer.swift): a request that met it on its way out is asked again.
    if (answer.error === EXITED) answer = await this.ask(titles, maxWords);
    if (answer.error) throw new Error(answer.error);
    return answer.name ?? null;
  }

  private async ask(titles: string[], maxWords: number): Promise<Answer> {
    await this.start();
    const proc = this.proc!;
    const id = this.next++;
    return new Promise<Answer>((resolve) => {
      this.waiting.set(id, resolve);
      try {
        proc.stdin.write(`${JSON.stringify({ id, titles, maxWords })}\n`);
        proc.stdin.flush();
      } catch {
        this.waiting.delete(id);
        resolve({ error: EXITED });
      }
    });
  }

  private start(): Promise<void> {
    if (this.proc) return Promise.resolve();
    this.starting ??= this.spawn().finally(() => (this.starting = null));
    return this.starting;
  }

  private async spawn(): Promise<void> {
    if (process.platform !== "darwin") throw new Unavailable("Apple's on-device model is only on macOS");
    const bin = await binary(this.source, this.cache);
    const proc = Bun.spawn([bin, "--idle", String(IDLE_SECONDS)], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    let ready!: (a: Answer) => void;
    const first = new Promise<Answer>((r) => (ready = r));
    this.read(proc, ready);
    proc.exited.then(() => {
      if (this.proc === proc) this.proc = null;
      ready({ ready: false, reason: EXITED });
      for (const done of this.waiting.values()) done({ error: EXITED });
      this.waiting.clear();
    });
    const hello = await first;
    if (!hello.ready) {
      proc.kill();
      throw new Unavailable(`Apple's on-device model is unavailable: ${hello.reason ?? "unknown"}`);
    }
    this.proc = proc;
  }

  /** Each line the namer writes: the first is `ready`, the rest answer requests by id. */
  private async read(proc: Bun.Subprocess<"pipe", "pipe", "ignore">, ready: (a: Answer) => void): Promise<void> {
    const decoder = new TextDecoder();
    let buffered = "";
    let greeted = false;
    for await (const chunk of proc.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        let answer: Answer;
        try {
          answer = JSON.parse(line);
        } catch {
          continue;
        }
        if (!greeted && "ready" in answer) {
          greeted = true;
          ready(answer);
        } else if (typeof answer.id === "number") {
          this.waiting.get(answer.id)?.(answer);
          this.waiting.delete(answer.id);
        }
      }
    }
  }
}
