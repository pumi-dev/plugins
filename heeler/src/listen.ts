// Bun's unix sockets, served the way pumi's own server serves its own: a file another process
// answers on is left alone — herdr's clients then talk to that one — and a file a crash left behind
// is taken over. The file is its owner's alone (0600), as the server's own sockets are.
import { chmodSync, rmSync } from "node:fs";
import type { SocketHandler, UnixSocketListener } from "bun";

export type Handler = SocketHandler<undefined>;
export type Listener = UnixSocketListener<undefined>;

function serve(path: string, socket: Handler): Listener {
  const listener = Bun.listen<undefined>({ unix: path, socket });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Somebody took it away already; the listener is still ours.
  }
  return listener;
}

/** Whether a socket file has a server answering on it. */
async function answered(path: string): Promise<boolean> {
  try {
    const socket = await Bun.connect<undefined>({ unix: path, socket: { data() {}, open() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/** How long a busy socket file is given to stop answering, as a reload's previous worker exits. */
const TAKE_OVER_MS = 1_500;
const TAKE_OVER_POLL_MS = 100;

/**
 * Serve `path` with `socket`; throws when another process is serving that file already. A file a dead
 * process left behind is taken over at once; a live owner gets a short grace, because `pumi plugin
 * reload` starts the new worker before the old one's listeners are gone.
 */
export async function listen(path: string, socket: Handler): Promise<Listener> {
  const deadline = Date.now() + TAKE_OVER_MS;
  for (;;) {
    try {
      return serve(path, socket);
    } catch (err) {
      if ((err as { code?: string } | null)?.code !== "EADDRINUSE") throw err;
      if (!(await answered(path))) {
        // Nobody answers on it: a crash left the file, and it is ours to take.
        rmSync(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw err;
      await Bun.sleep(TAKE_OVER_POLL_MS);
    }
  }
}
