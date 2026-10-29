// A session file as it grows: its last `max` bytes once (the start of a big file is left out), then
// each line appended after. The agent appends whole JSON lines; a line still being written waits
// for its newline. A file that shrinks or is replaced is read again from its end. Reads the file
// (node:fs) but no `import … from "pumi"`.
import { closeSync, fstatSync, openSync, readSync, statSync, watch, type FSWatcher } from "node:fs";

export interface TailOptions {
  /** The most of the file's end read at first. */
  max: number;
  /** The lines read: the file's last ones at first (`first`), then each batch appended. */
  onLines(lines: string[], first: boolean, skipped: boolean): void;
  /** The file was cut or replaced: what was read of it no longer holds. */
  onReset(): void;
  /** How often it looks for growth besides the file system's word, in ms. */
  interval?: number;
}

export class Tail {
  #fd: number | undefined;
  #ino = 0;
  #offset = 0;
  #carry: Buffer = Buffer.alloc(0);
  #watcher: FSWatcher | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #stopped = false;

  constructor(
    readonly path: string,
    readonly options: TailOptions,
  ) {}

  /** Reads the end of the file, then follows it. Throws when it cannot be opened. */
  start(): void {
    this.#open();
    try {
      this.#watcher = watch(this.path, () => this.poll());
      this.#watcher.on("error", () => this.#watcher?.close());
    } catch (err) {
      // No watch on this file system: the interval below still reads it.
      console.warn(`agents: not watching ${this.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.#timer = setInterval(() => this.poll(), this.options.interval ?? 1000);
  }

  stop(): void {
    this.#stopped = true;
    this.#watcher?.close();
    if (this.#timer) clearInterval(this.#timer);
    if (this.#fd !== undefined) closeSync(this.#fd);
    this.#fd = undefined;
  }

  /** Reads what was appended since the last read. */
  poll(): void {
    if (this.#stopped || this.#fd === undefined) return;
    let size: number;
    let ino: number;
    try {
      const stat = statSync(this.path);
      size = stat.size;
      ino = stat.ino;
    } catch {
      return;
    }
    if (ino !== this.#ino || size < this.#offset) {
      closeSync(this.#fd);
      this.#fd = undefined;
      this.options.onReset();
      return;
    }
    if (size === this.#offset) return;
    const lines = this.#read(size);
    if (lines.length > 0) this.options.onLines(lines, false, false);
  }

  #open(): void {
    this.#fd = openSync(this.path, "r");
    const stat = fstatSync(this.#fd);
    this.#ino = stat.ino;
    const start = Math.max(0, stat.size - this.options.max);
    this.#offset = start;
    this.#carry = Buffer.alloc(0);
    let lines = this.#read(stat.size);
    // Begun in the middle of a line: that one is not whole.
    if (start > 0) lines = lines.slice(1);
    this.options.onLines(lines, true, start > 0);
  }

  /** The whole lines from the offset up to `size`; a last line with no newline yet waits. */
  #read(size: number): string[] {
    const chunks: Buffer[] = [this.#carry];
    const buffer = Buffer.allocUnsafe(1 << 20);
    while (this.#offset < size) {
      const n = readSync(this.#fd!, buffer, 0, Math.min(buffer.length, size - this.#offset), this.#offset);
      if (n <= 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, n)));
      this.#offset += n;
    }
    const { lines, carry } = splitLines(Buffer.concat(chunks));
    this.#carry = carry;
    return lines;
  }
}

/** The whole lines in `bytes` (decoded once each is whole, so a character is never cut), and the bytes after the last newline. */
export function splitLines(bytes: Buffer): { lines: string[]; carry: Buffer } {
  const end = bytes.lastIndexOf(0x0a);
  if (end < 0) return { lines: [], carry: bytes };
  const lines = bytes
    .subarray(0, end)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  return { lines, carry: Buffer.from(bytes.subarray(end + 1)) };
}
