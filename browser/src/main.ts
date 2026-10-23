// browser: a page in a pane — the app's own browser pane, as close as a package gets.
//
//   pumi call amresyd.browser.open '{"url":"https://pumi.dev"}'   # a page beside this one
//   pumi call amresyd.browser.openTab '{"url":"example.com"}'
//   pumi call amresyd.browser.navigate 3 'example.com'            # the page in pane 3
//   pumi call amresyd.browser.back 3
//
// The window's webview keeps the page's own state (`useWebview`: its address, its title,
// whether it is loading, whether it can go back), so the package keeps none of it: a verb is the
// block's own method (`pane.call`, which the page hears as `pane.called`), and what a caller reads
// of a pane is its options — `url`, which the page writes back as it goes, and the `title` it
// reports. What is here is what the app and other callers reach; `ui.tsx` draws the page.
import { ApiError, call, command, option, pane, plugin, provide, type PlaceSpec } from "pumi";

/** The pane option a page is on and goes to: the block's own (`amresyd.browser.url`). */
const PAGE = "url";

/** The block a page is in: `amresyd.browser.page`. */
const BLOCK = plugin.prefixed("page");

/** The address a call gives: the second argument, or the first's `url`. */
function addressOf(first: unknown, second: unknown): string {
  const url = typeof first === "object" && first !== null ? (first as { url?: unknown }).url : second;
  if (typeof url !== "string" || url.trim() === "") throw new ApiError("invalid_params", "navigate takes the pane and the address");
  return url;
}

/** The pane a call names — `back(3)` or `back({ pane: 3 })`, and `"%3"` too, as `pumi call` writes
 * each of them. */
function paneOf(what: unknown): number {
  const named = typeof what === "object" && what !== null ? (what as { pane?: unknown }).pane : what;
  const id = typeof named === "number" ? named : typeof named === "string" ? Number(named.replace(/^[%]/, "")) : NaN;
  if (!Number.isInteger(id)) throw new ApiError("not_found", `no browser page in pane ${String(named)}`);
  return id;
}

/** A page in a pane: beside this one as the app's browser opens, or in a tab of its own. Its address
 * is the argument (`{ url }`), else the app's `browser.home_url`, else the address bar. */
async function open(args: unknown, place: PlaceSpec): Promise<number> {
  const asked = typeof args === "string" ? args : (args as { url?: unknown } | null)?.url;
  const home = await option.get("browser.home_url").catch(() => null);
  const url = typeof asked === "string" && asked !== "" ? asked : typeof home === "string" ? home : "";
  // The block's option, set as it opens: the page the pane starts on.
  const opened = await pane.open(BLOCK, { [PAGE]: url }, place);
  return opened.id;
}

command("open", (args?: unknown) => open(args, { split: "right" }));
command("openTab", (args?: unknown) => open(args, { kind: "tab", name: "Browser" }));

/** An option of the page in `id`, as the page left it. */
async function said(id: number, name: string): Promise<string> {
  const value = await option.get(name, { pane: id }).catch(() => null);
  return typeof value === "string" ? value : "";
}

/** Asks the page in `id` to do `method`, as `pane.called` tells its renderer to. */
async function act(id: number, method: string, args?: unknown): Promise<null> {
  await call("pane.call", id, method, args ?? {});
  return null;
}

provide(
  plugin.prefixed("navigate"),
  {
    desc: "Show a page in a browser pane: it takes what an address bar takes, a URL or a search.",
    effect: "write",
    parameters: [
      ["number", "pane"],
      ["string", "url"],
    ],
    examples: [
      { args: [3, "example.com"], desc: "Pane 3 goes to https://example.com." },
      { args: [{ pane: 3, url: "https://pumi.dev" }] },
    ],
    returns: "The address it went to.",
    returns_schema: { type: "string" },
  },
  async (first: unknown, second: unknown) => {
    const id = paneOf(first);
    const url = addressOf(first, second);
    await act(id, "navigate", { url });
    return url;
  },
);

provide(
  plugin.prefixed("back"),
  {
    desc: "Step back in a page's history, as `cmd+[` does.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }, { args: [{ pane: 3 }] }],
    returns: "The address it is on now.",
    returns_schema: { type: "string" },
  },
  async (first: unknown) => {
    const id = paneOf(first);
    await act(id, "back");
    return said(id, PAGE);
  },
);

provide(
  plugin.prefixed("forward"),
  {
    desc: "Step forward in a page's history, as `cmd+]` does.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }, { args: [{ pane: 3 }] }],
    returns: "The address it is on now.",
    returns_schema: { type: "string" },
  },
  async (first: unknown) => {
    const id = paneOf(first);
    await act(id, "forward");
    return said(id, PAGE);
  },
);

provide(
  plugin.prefixed("reload"),
  {
    desc: "Load the page again, as `cmd+r` does.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
  },
  (first: unknown) => act(paneOf(first), "reload"),
);

provide(
  plugin.prefixed("url"),
  {
    desc: "The address a browser pane is on; empty for a pane that has not left the address bar.",
    effect: "read",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
    returns_schema: { type: "string" },
  },
  (first: unknown) => said(paneOf(first), PAGE),
);

provide(
  plugin.prefixed("title"),
  {
    desc: "What a browser pane is called: the page's own title, else its host.",
    effect: "read",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
    returns_schema: { type: "string" },
  },
  (first: unknown) => said(paneOf(first), "title"),
);
