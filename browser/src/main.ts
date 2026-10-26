// browser: a page in a pane — the app's own browser pane, as close as a package gets.
//
//   pumi call amresyd.browser.open '{"url":"https://pumi.dev"}'   # a page beside this one
//   pumi call amresyd.browser.openTab '{"url":"example.com"}'
//   pumi call amresyd.browser.navigate 3 'example.com'            # the page in pane 3
//   pumi call amresyd.browser.back 3
//
// The window's webview keeps the page's own state (`useWebview`: its address, its title,
// whether it is loading, whether it can go back), so the package keeps none of it: a navigable
// pane's `url` option is its address, a method of the pane is the block's own function
// (`amresyd.browser.page.navigate`, `pane.call` of one reaching it), and what a caller reads of a
// pane is that option and the `title` it reports. What is here is what the app and other callers
// reach; `ui.tsx` draws the page.
import { ApiError, call, fn, option, self, ui } from "pumi";

/** The pane option a page is on and goes to: the block's own (`amresyd.browser.url`). */
const PAGE = "url";

/** The block a page is in: `amresyd.browser.page`. */
const BLOCK = self.plugin.prefixed("page");

/** The topic the page hears its block's own methods on, in whichever window draws it. */
const TOPIC = "page";

/** Where a page opens: the app's browser's own place, or a tab's. */
type Place = Record<string, unknown>;

/** The address a call gives: the second argument, or the first's `url`. */
function addressOf(first: unknown, second: unknown): string {
  const url = typeof first === "object" && first !== null ? (first as { url?: unknown }).url : second;
  if (typeof url !== "string" || url.trim() === "") throw new ApiError("invalid_params", "navigate takes the pane and the address");
  return url;
}

/** The pane a call names — `back(3)`, `back({ pane: 3 })` or `back("%3")`, as `pumi call` writes
 * each of them — as its wire id. */
function paneOf(what: unknown): string {
  const named = typeof what === "object" && what !== null ? (what as { pane?: unknown }).pane : what;
  const id = typeof named === "number" ? `%${named}` : typeof named === "string" ? (named.startsWith("%") ? named : `%${Number(named)}`) : "";
  if (!/^(?:[A-Za-z0-9._-]+\/)?%[1-9][0-9]*$/.test(id)) throw new ApiError("not_found", `no browser page in pane ${String(named)}`);
  return id;
}

/** A page in a pane: beside this one as the app's browser opens, or in a tab of its own. Its address
 * is the argument (`{ url }`), else the app's `browser.home_url`, else the address bar. */
async function open(args: unknown, place: Place): Promise<string> {
  const asked = typeof args === "string" ? args : (args as { url?: unknown } | null)?.url;
  const home = await option.get("browser.home_url").catch(() => null);
  const url = typeof asked === "string" && asked !== "" ? asked : typeof home === "string" ? home : "";
  // The block's option, set as it opens: the page the pane starts on.
  return call("pane.open", BLOCK, { [PAGE]: url }, place);
}

/** An option of the page in `id`, as the page left it. */
async function said(id: string, name: string): Promise<string> {
  const value = await option.get(name, { scope: "pane", id }).catch(() => null);
  return typeof value === "string" ? value : "";
}

/** Tells the page in `id` to do `method`: what only the window's webview can do (go back, reload,
 * take what was typed). The pane's `url` option is what survives it. */
function tell(id: string, method: string, args?: unknown): null {
  ui.post(TOPIC, { pane: id, method, args: args ?? {} });
  return null;
}

/** The page in `id` goes to `url`, and answers where it went. */
async function navigate(id: string, url: string): Promise<string> {
  await option.set(PAGE, url, { scope: "pane", id });
  return url;
}

fn.set("open", { desc: "Open a page beside this one.", effect: "write", returns_schema: { type: "string" } }, (args?: unknown) =>
  open(args, { split: "right" }),
);
fn.set("openTab", { desc: "Open a page in a tab of its own.", effect: "write", returns_schema: { type: "string" } }, (args?: unknown) =>
  open(args, { kind: "tab", name: "Browser" }),
);

// The block's own methods: `pane.call("%3", "back")` reaches `amresyd.browser.page.back` with the
// pane's id first, then the call's arguments.

/** Show a page in a browser pane: it takes what an address bar takes, a URL or a search. */
async function go(first: unknown, second: unknown): Promise<string> {
  const id = paneOf(first);
  const url = addressOf(first, second);
  return navigate(id, url);
}

fn.set(
  "page.navigate",
  {
    desc: "Show a page in a browser pane: it takes what an address bar takes, a URL or a search.",
    effect: "write",
    parameters: [
      ["string", "pane"],
      ["table", "args"],
    ],
    returns_schema: { type: "string" },
  },
  (pane: unknown, args: unknown) => go(pane, args),
);
fn.set(
  "page.back",
  { desc: "Step back in a page's history, as `cmd+[` does.", effect: "write", parameters: [["string", "pane"]] },
  (pane: unknown) => tell(paneOf(pane), "back"),
);
fn.set(
  "page.forward",
  { desc: "Step forward in a page's history, as `cmd+]` does.", effect: "write", parameters: [["string", "pane"]] },
  (pane: unknown) => tell(paneOf(pane), "forward"),
);
fn.set(
  "page.reload",
  { desc: "Load the page again, as `cmd+r` does.", effect: "write", parameters: [["string", "pane"]] },
  (pane: unknown) => tell(paneOf(pane), "reload"),
);
fn.set(
  "page.input",
  {
    desc: "What is typed into a page's address bar: `{text}`, `{paste}`, or `{keys}` with Enter among them.",
    effect: "write",
    parameters: [
      ["string", "pane"],
      ["table", "args"],
    ],
  },
  (pane: unknown, args: unknown) => tell(paneOf(pane), "input", args),
);
fn.set(
  "page.describe",
  { desc: "What the page says of itself: its title, its address, and the text it shows.", effect: "read", parameters: [["string", "pane"]] },
  (pane: unknown) => said(paneOf(pane), PAGE),
);

// What a caller of the package asks: the same methods, by the names a script knows.

fn.set(
  "navigate",
  {
    desc: "Show a page in a browser pane: it takes what an address bar takes, a URL or a search.",
    effect: "write",
    parameters: [
      ["number", "pane"],
      ["string", "url"],
    ],
    examples: [{ args: [3, "pumi.dev"] }, { args: [{ pane: 3 }, "pumi.dev"] }],
    returns: "The address it went to.",
    returns_schema: { type: "string" },
  },
  async (first: unknown, second: unknown) => go(first, second),
);
fn.set(
  "back",
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
    tell(id, "back");
    return said(id, PAGE);
  },
);
fn.set(
  "forward",
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
    tell(id, "forward");
    return said(id, PAGE);
  },
);
fn.set(
  "reload",
  {
    desc: "Load the page again, as `cmd+r` does.",
    effect: "write",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
  },
  (first: unknown) => tell(paneOf(first), "reload"),
);
fn.set(
  "url",
  {
    desc: "The address a browser pane is on; empty for a pane that has not left the address bar.",
    effect: "read",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
    returns_schema: { type: "string" },
  },
  (first: unknown) => said(paneOf(first), PAGE),
);
fn.set(
  "title",
  {
    desc: "What a browser pane is called: the page's own title, else its host.",
    effect: "read",
    parameters: [["number", "pane"]],
    examples: [{ args: [3] }],
    returns_schema: { type: "string" },
  },
  (first: unknown) => said(paneOf(first), "title"),
);
