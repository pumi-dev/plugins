// The machine's processes, as the API lists them, and what a pane's tree of them costs together.
// `process` is the SDK's, not Node's: what it lists is the machine the panes run on.
import { process } from "pumi";

/** A process: what its parent is, the CPU it uses, the memory it holds. */
export interface Proc {
  ppid: number;
  /** Cores × 100, as `ps`'s `%cpu`: 100 is one core. */
  cpu: number;
  /** Bytes. */
  rss: number;
}

/** Every process, by pid. */
export type Procs = Map<number, Proc>;

/**
 * Every process on the machine the panes run on (`process.list`, so it is the server's, not the
 * app's). A failure is said, and the table comes back empty: this round has nothing to measure.
 */
export async function processes(): Promise<Procs> {
  const procs: Procs = new Map();
  let listed: unknown;
  try {
    listed = await process.list();
  } catch (err) {
    console.error("heavy-terminals: process.list:", err);
    return procs;
  }
  for (const each of Array.isArray(listed) ? listed : []) {
    const one = (each ?? {}) as { pid?: unknown; parentPid?: unknown; cpu?: unknown; rss?: unknown };
    if (typeof one.pid !== "number" || typeof one.parentPid !== "number") continue;
    // `cpu` is `ps`'s `%cpu` and `rss` its kilobytes-to-bytes, as the server reads them; a process
    // whose line the table lacks costs nothing.
    procs.set(one.pid, {
      ppid: one.parentPid,
      cpu: typeof one.cpu === "number" ? one.cpu : 0,
      rss: typeof one.rss === "number" ? one.rss : 0,
    });
  }
  return procs;
}

/** A pane's processes together: its program's, and theirs, down the tree. */
export function usage(procs: Procs, root: number): { cpu: number; rss: number } {
  const children = new Map<number, number[]>();
  for (const [pid, proc] of procs) {
    // A process that is its own parent (`ps` shows pid 0 that way) would keep the walk going.
    if (proc.ppid === pid) continue;
    const kids = children.get(proc.ppid);
    if (kids) kids.push(pid);
    else children.set(proc.ppid, [pid]);
  }
  let cpu = 0;
  let rss = 0;
  const todo = [root];
  while (todo.length > 0) {
    const pid = todo.pop() as number;
    const proc = procs.get(pid);
    if (proc) {
      cpu += proc.cpu;
      rss += proc.rss;
    }
    const kids = children.get(pid);
    if (kids) todo.push(...kids);
  }
  return { cpu, rss };
}
