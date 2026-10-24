// What the title bar's two buttons do, each reading its tab afresh: Fork opens `pi --fork <session>`
// in a tab beside that one, in the same directory; Copy puts the session's id, path and directory
// on the clipboard.
import { clipboard, workspace, type TabId } from "pumi";

import { Session } from "./session.ts";
import { setting } from "./settings.ts";

/** Opens `<command> --fork <session>` in a tab beside `at`, in that tab's directory. */
export async function fork(at: TabId): Promise<void> {
  const session = await Session.of(at);
  const command = [await setting("command", "pi"), "--fork", session.value];
  const args: Record<string, unknown> = { command };
  if (session.cwd !== null) args.cwd = session.cwd;
  const split = (await setting("side", "right")) === "down" ? "down" : "right";
  await workspace.openTab("terminal", args, { kind: "tiled", beside: at, split });
}

/** Puts the session's id, path and directory on the clipboard, and says what it put there. */
export async function copy(at: TabId): Promise<string> {
  const summary = (await Session.of(at)).summary();
  await clipboard.set(summary);
  return summary;
}
