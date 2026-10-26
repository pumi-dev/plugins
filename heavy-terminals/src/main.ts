// heavy-terminals: notice terminals whose processes eat the machine, and put them to sleep: the
// foreground job is suspended as ctrl+z would, and woken with `fg`.
//
// No view: it reads its options, measures every terminal on a timer of its own, and provides
// `sleep` and `wake` (`amresyd.heavy_terminals.sleep` and `.wake`), which a user command of tmux's,
// `pumi call`, or a script reaches.
import { ApiError, call, fn, self } from "pumi";
import { number } from "./options.ts";
import { processes } from "./procs.ts";
import { Watches } from "./watches.ts";

const terminals = new Watches();

/** The pane a caller asked about, as its wire id: an id, a table naming one (`{ pane }`), a user
 * command's `"%3"`, or the current pane. */
async function paneOf(asked: unknown): Promise<string | null> {
  const direct = idOf(asked);
  if (direct !== null) return direct;
  if (asked && typeof asked === "object") {
    const table = asked as { pane?: unknown; args?: unknown };
    const named = idOf(table.pane) ?? (typeof table.args === "string" ? idOf(table.args) : null);
    if (named !== null) return named;
  }
  try {
    return (await call("pane.get", null)).id;
  } catch {
    return null;
  }
}

/** A pane id written as a person or a user command writes one (`3`, `"%3"`), as the API's `%3`. */
function idOf(asked: unknown): string | null {
  const text = typeof asked === "number" ? String(asked) : typeof asked === "string" ? asked.trim() : null;
  const digits = text?.replace(/^%/, "") ?? "";
  return /^[1-9]\d*$/.test(digits) ? `%${digits}` : null;
}

fn.set("sleep", {
    desc: "Suspend a terminal's foreground job, as ctrl+z would.",
    parameters: [["number", "pane"]],
    examples: [{ args: [] }],
  }, async (asked?: unknown) => {
    const id = await paneOf(asked);
    if (id === null) throw new ApiError("invalid_params", "no pane to put to sleep");
    await terminals.sleep(id);
  });

fn.set("wake", {
    desc: "Wake a terminal put to sleep.",
    parameters: [["number", "pane"]],
    examples: [{ args: [] }],
  }, async (asked?: unknown) => {
    const id = await paneOf(asked);
    if (id === null) throw new ApiError("invalid_params", "no pane to wake");
    await terminals.wake(id);
  });

/** How long to wait between two checks: `interval` seconds, and never a spin. */
async function interval(): Promise<number> {
  return Math.max(await number("interval", 5), 0.1) * 1000;
}

/** Whether the package still runs: `self.plugin.prefix` is read through its connection, which a
 * stop (the app unloading it, `pumi/testing`'s) takes away. */
function connected(): boolean {
  try {
    void self.plugin.prefix;
    return true;
  } catch {
    return false;
  }
}

/** Measures every terminal now, then again every `interval` seconds. The option is read each round,
 * so changing it needs no new timer. */
async function measure(): Promise<void> {
  for (;;) {
    try {
      await terminals.check(await processes());
      await Bun.sleep(await interval());
    } catch (err) {
      // A stop takes the connection, and its calls refuse: there is nothing left to measure.
      if (!connected()) return;
      console.error("heavy-terminals:", err);
      await Bun.sleep(1000);
    }
  }
}

// Measuring starts with the package: it has no view, and nothing else would start it.
void measure();
