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

/** Serve `path` with `socket`; throws when another process is serving that file already. */
export async function listen(path: string, socket: Handler): Promise<Listener> {
  try {
    return serve(path, socket);
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "EADDRINUSE") throw err;
    if (await answered(path)) throw err;
    rmSync(path, { force: true });
    return serve(path, socket);
  }
}
