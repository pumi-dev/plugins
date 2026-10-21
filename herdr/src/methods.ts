// Every method of herdr's API, with what this package does about it: `served` ones are answered
// (by the dispatcher in api.ts), `unsupported` ones get herdr's `unsupported` error at once —
// never a hang — which is what herdr's TUI-only, plugin and remote methods are for pumi.
//
// PROVENANCE: herdr `src/api/schema.rs` (`Method`) @ v0.9.3 (Apache-2.0).

export type Support =
  | { kind: "served" }
  /** herdr's TUI, plugins, remotes, self-update: not part of pumi, and why. */
  | { kind: "unsupported"; why: string };

/** `unary` is one request and one response; `long` holds the connection: a stream of events. */
export type Shape = "unary" | "long";

export interface Method {
  name: string;
  support: Support;
  shape: Shape;
}

const SERVED: Support = { kind: "served" };

function served(name: string, shape: Shape = "unary"): Method {
  return { name, support: SERVED, shape };
}

function unsupported(name: string, why: string): Method {
  return { name, support: { kind: "unsupported", why }, shape: "unary" };
}

const TUI = "pumi has no herdr TUI";
const PLUGINS = "herdr plugins are not part of pumi";
const REMOTE = "herdr remotes are not part of pumi";
const COPY_MODE = "herdr's copy mode belongs to its TUI";
const AGENTS = "an agent says what it is doing over OSC 7501; pumi has no manifests";

export const METHODS: Method[] = [
  served("ping"),
  served("server.stop"),
  unsupported("server.live_handoff", "pumid restarts with `pumid --restart`"),
  served("server.reload_config"),
  unsupported("server.ssh_agent.register", REMOTE),
  unsupported("server.agent_manifests", AGENTS),
  unsupported("server.reload_agent_manifests", AGENTS),
  served("notification.show"),
  unsupported("product_announcement.dismiss", TUI),
  unsupported("release_notes.dismiss", TUI),
  unsupported("command.invoke", TUI),
  unsupported("client.window_title.set", TUI),
  unsupported("client.window_title.clear", TUI),
  unsupported("client_shell.surface.set", TUI),
  served("session.snapshot"),
  served("workspace.create"),
  served("workspace.list"),
  served("workspace.get"),
  served("workspace.focus"),
  served("workspace.rename"),
  served("workspace.move"),
  served("workspace.move_block"),
  served("workspace.report_metadata"),
  served("workspace.close"),
  served("worktree.list"),
  served("worktree.create"),
  served("worktree.open"),
  served("worktree.remove"),
  served("tab.create"),
  served("tab.list"),
  served("tab.get"),
  served("tab.focus"),
  served("tab.rename"),
  served("tab.move"),
  served("tab.close"),
  served("agent.list"),
  served("agent.get"),
  served("agent.read"),
  served("agent.explain"),
  served("agent.send_keys"),
  served("agent.rename"),
  served("agent.view.set"),
  served("agent.view.clear"),
  served("agent.focus"),
  served("agent.start"),
  served("agent.prompt", "long"),
  served("agent.wait", "long"),
  served("pane.split"),
  served("pane.swap"),
  served("pane.move"),
  served("pane.zoom"),
  served("pane.layout"),
  served("pane.process_info"),
  served("layout.export"),
  served("layout.apply"),
  served("layout.set_split_ratio"),
  served("pane.neighbor"),
  served("pane.edges"),
  served("pane.focus_direction"),
  served("pane.resize"),
  served("pane.scroll"),
  served("pane.clear"),
  unsupported("pane.edit_scrollback", COPY_MODE),
  served("pane.selection.read"),
  unsupported("pane.copy_motion", COPY_MODE),
  unsupported("pane.copy_search", COPY_MODE),
  served("pane.list"),
  served("pane.current"),
  served("pane.get"),
  served("pane.focus"),
  served("pane.input.set"),
  served("pane.link.activate"),
  served("pane.link.resolve"),
  served("pane.rename"),
  served("pane.send_text"),
  served("pane.send_keys"),
  served("pane.send_input"),
  served("pane.read"),
  served("pane.report_agent"),
  served("pane.report_agent_session"),
  served("pane.report_metadata"),
  served("pane.clear_agent_authority"),
  served("pane.release_agent"),
  served("pane.close"),
  unsupported("popup.close", TUI),
  served("events.subscribe", "long"),
  served("events.wait", "long"),
  served("pane.wait_for_output", "long"),
  served("integration.list"),
  served("integration.install"),
  served("integration.uninstall"),
  unsupported("plugin.link", PLUGINS),
  unsupported("plugin.list", PLUGINS),
  unsupported("plugin.unlink", PLUGINS),
  unsupported("plugin.enable", PLUGINS),
  unsupported("plugin.disable", PLUGINS),
  unsupported("plugin.action.list", PLUGINS),
  unsupported("plugin.action.invoke", PLUGINS),
  unsupported("plugin.log.list", PLUGINS),
  unsupported("plugin.pane.open", PLUGINS),
  unsupported("plugin.pane.focus", PLUGINS),
  unsupported("plugin.pane.close", PLUGINS),
];

/** pumi's own methods, in their own namespace so herdr's never collide with them. */
export const PUMI_METHODS: Method[] = [
  // Server facts the app shows: pid, boot id, version, sockets.
  served("pumi.server.info"),
  // The whole model in one answer: herdr's session snapshot plus every tab's layout tree.
  served("pumi.state"),
  // Live handoff: exec this binary in place, keeping every pane's program.
  served("pumi.server.restart"),
  // The folders in a folder on the server's machine, for choosing where a space opens there.
  served("pumi.fs.dirs"),
  // The server's own Tailscale node: sign in and out, sharing this server with the user's other
  // devices, and which of them may.
  served("pumi.tailnet.status"),
  served("pumi.tailnet.login"),
  served("pumi.tailnet.logout"),
  served("pumi.tailnet.share"),
  served("pumi.tailnet.allow"),
  served("pumi.tailnet.forget"),
];

/** The method herdr asks for by that name, or nothing: its own first, then pumi's. */
export function find(name: string): Method | undefined {
  return METHODS.find((method) => method.name === name) ?? PUMI_METHODS.find((method) => method.name === name);
}
