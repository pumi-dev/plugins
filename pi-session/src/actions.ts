// What the title bar's two buttons do, each reading its pane afresh: Fork opens `pi --fork <session>`
// in a pane beside that one, in the same directory; Copy puts the session's id, path and directory
// on the clipboard.
import { clipboard, pane } from "pumi";

import { Session } from "./session.ts";
import { setting } from "./settings.ts";

/** Opens `<command> --fork <session>` in a pane beside `at`, in that pane's directory. */
export async function fork(at: number): Promise<void> {
  const session = await Session.of(at);
  const command = [await setting("command", "pi"), "--fork", session.value];
  const args: Record<string, unknown> = { command };
  if (session.cwd !== null) args.cwd = session.cwd;
  const split = (await setting("side", "right")) === "down" ? "down" : "right";
  await pane.open("terminal", args, { beside: at, split });
}

/** Puts the session's id, path and directory on the clipboard, and says what it put there. */
export async function copy(at: number): Promise<string> {
  const summary = (await Session.of(at)).summary();
  await clipboard.set(summary);
  return summary;
}
