// browser: a page in a pane — the app's own browser pane, as close as a package gets.
//
//   pumi call amresyd.browser.open '{"url":"https://pumi.dev"}'   # a page beside this one
//   pumi call amresyd.browser.openTab '{"url":"example.com"}'
//   pumi call amresyd.browser.navigate 3 'example.com'            # the page in pane 3
//   pumi call amresyd.browser.back 3
//
// The window's webview keeps the page's own state now (`useWebview`: its address, its title,
// whether it is loading, whether it can go back), so the package no longer keeps it: a call names a
// pane and writes what it wants on that pane's options, which the view follows. What is here is
// what the app and other callers reach; `ui.tsx` draws the page and its toolbar.
import { ApiError, command, option, pane, pkg, provide, type PlaceSpec } from "pumi";

/** The pane option the view follows for a page to show (`navigate`), and the one it acts on
 * (`back`, `forward`, `reload`): `{"cmd": "back", "at": 1699999999999}`. */
const GO = "@url";
const ACT = "@act";
/** What the view mirrors of the page it draws, so `url` and `title` can answer with it. */
const STATE = "@state";

/** The pane option a page is opened with: its address. */
const START = "url";

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
  const opened = await pane.open(pkg.prefixed("page"), {}, place);
  if (url !== "") await opened.options.set(START, url);
  return opened.id;
}

command("open", (args?: unknown) => open(args, { split: "right" }));
command("openTab", (args?: unknown) => open(args, { kind: "tab", name: "Browser" }));

/** What the view last said of the page in `id`: its address and its name. */
async function said(id: number): Promise<{ url?: string; title?: string }> {
  const value = await option.get(STATE, { pane: id }).catch(() => null);
  return typeof value === "object" && value !== null ? (value as { url?: string; title?: string }) : {};
}

/** Asks the page in `id` to do `cmd`, and answers what it says of itself afterwards. */
async function act(id: number, cmd: "back" | "forward" | "reload"): Promise<string> {
  await option.set(ACT, { cmd, at: Date.now() }, { pane: id });
  return (await said(id)).url ?? "";
}

provide(
  pkg.prefixed("navigate"),
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
    await option.set(GO, url, { pane: id });
    return url;
  },
);

provide(
  pkg.prefixed("back"),
  {
    desc: "Step back in a page's history, as `cmd+[` does.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }, { args: [{ pane: 3 }] }],
    returns: "The address it is on now.",
    returns_schema: { type: "string" },
  },
  (first: unknown) => act(paneOf(first), "back"),
);

provide(
  pkg.prefixed("forward"),
  {
    desc: "Step forward in a page's history, as `cmd+]` does.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }, { args: [{ pane: 3 }] }],
    returns: "The address it is on now.",
    returns_schema: { type: "string" },
  },
  (first: unknown) => act(paneOf(first), "forward"),
);

provide(
  pkg.prefixed("reload"),
  {
    desc: "Load the page again, as `cmd+r` does.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
  },
  (first: unknown) => act(paneOf(first), "reload"),
);

provide(
  pkg.prefixed("url"),
  {
    desc: "The address a browser pane is on; empty for a pane that has not left the address bar.",
    effect: "read",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
    returns_schema: { type: "string" },
  },
  async (first: unknown) => (await said(paneOf(first))).url ?? "",
);

provide(
  pkg.prefixed("title"),
  {
    desc: "What a browser pane is called: the page's own title, else its host.",
    effect: "read",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
    returns_schema: { type: "string" },
  },
  async (first: unknown) => (await said(paneOf(first))).title ?? "",
);
