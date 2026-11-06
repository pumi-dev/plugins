// The menu bar icon: src/bar.swift, built with `swiftc` into the plugin's cache the first time it
// is asked for (and again when the source changes), then kept running while pumi runs. One JSON
// line to stdin shows the icon and says what it means, `hide` takes it away, and the menu's clicks
// come back one word to a line (`settings`). Nothing here decides anything: the plugin
// says what the icon shows, and does what the menu asks.
//
// The helper quits when its stdin closes, which is to say when the plugin's worker goes: no icon
// outlives the plugin that put it there.
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/** What the icon and its menu say. */
export interface BarState {
  /** The menu's one line: why this Mac is up. */
  why: string;
}

function log(message: string): void {
  console.error(`pumi-awake: ${message}`);
}

/** The helper's binary for `source`, built if it is not there yet and again when the source changes. */
export async function build(source: string, cache: string): Promise<string> {
  const text = readFileSync(source, "utf8");
  const bin = join(cache, `bar-${Bun.hash(text).toString(36)}`);
  if (existsSync(bin)) return bin;
  mkdirSync(cache, { recursive: true });
  const tmp = `${bin}.${process.pid}.tmp`;
  const build = Bun.spawn(["xcrun", "swiftc", "-O", "-parse-as-library", source, "-o", tmp], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, err] = await Promise.all([build.exited, new Response(build.stderr as ReadableStream<Uint8Array>).text()]);
  if (code !== 0) throw new Error(`swiftc could not build the menu bar icon: ${err.trim().split("\n").slice(-3).join(" ")}`);
  renameSync(tmp, bin);
  return bin;
}

/** A helper with its three ends piped: what it reads, writes, and what it complains on. */
type Helper = Bun.Subprocess<"pipe", "pipe", "pipe">;

/** The icon in the menu bar, once the plugin has something to say with it. */
export class Menubar {
  private proc: Helper | null = null;
  private starting: Promise<boolean> | null = null;
  private buffer = "";
  private state: BarState | null = null;

  /** What a click on the menu says (`settings`). */
  onCommand: (command: string) => void = () => {};

  constructor(
    private source: string,
    private cache: () => string,
  ) {}

  /** Shows the icon saying `state`, or takes it away with `null`. */
  async set(state: BarState | null): Promise<void> {
    this.state = state;
    if (state === null) return this.write("hide");
    if (!(await this.start())) return;
    this.write(JSON.stringify(state));
  }

  /** Ends the helper: the icon goes with it. */
  stop(): void {
    this.state = null;
    this.write("quit");
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
  }

  private async start(): Promise<boolean> {
    if (this.proc !== null) return true;
    if (process.platform !== "darwin") return false;
    this.starting ??= this.spawn().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async spawn(): Promise<boolean> {
    try {
      const bin = await build(this.source, this.cache());
      const proc = Bun.spawn([bin], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }) as Helper;
      this.proc = proc;
      void this.read(proc);
      if (this.state !== null) this.write(JSON.stringify(this.state));
      return true;
    } catch (error: any) {
      log(error?.message ?? String(error));
      return false;
    }
  }

  /** One line written to the helper; nothing when it is not running (the next `set` starts it). */
  private write(line: string): void {
    const proc = this.proc;
    if (proc === null) return;
    try {
      proc.stdin.write(`${line}\n`);
      proc.stdin.flush();
    } catch {
      this.proc = null;
    }
  }

  /** The helper's clicks, one word to a line, as it makes them. */
  private async read(proc: Helper): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
        this.buffer += decoder.decode(chunk, { stream: true });
        let at = this.buffer.indexOf("\n");
        while (at >= 0) {
          const line = this.buffer.slice(0, at).trim();
          this.buffer = this.buffer.slice(at + 1);
          if (line !== "") {
            try {
              this.onCommand(line);
            } catch (error: any) {
              log(`a menu click: ${error?.message ?? error}`);
            }
          }
          at = this.buffer.indexOf("\n");
        }
      }
    } catch {
      // The pipe closed: it ended, which is what `stop` does too.
    } finally {
      if (this.proc === proc) this.proc = null;
      this.buffer = "";
    }
  }
}
