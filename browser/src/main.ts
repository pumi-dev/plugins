// browser: a page in a tab. The app has the webview (`<WebView>`, `useWebview`); everything a
// browser is beyond it — the tab, its toolbar, its address bar, its settings, where a terminal's
// links go — is this plugin.
//
//   pumi call pumi_dev.browser.open '{"url":"https://pumi.dev"}'   # a page beside this one
//   pumi call pumi_dev.browser.openView '{"url":"example.com"}'
//   pumi call pumi_dev.browser.navigate %3 'example.com'           # the page in tab %3
//   pumi call pumi_dev.browser.back %3
//
// The window's webview keeps the page's own state (`useWebview`: its address, its title,
// whether it is loading, whether it can go back), so the package keeps none of it: a navigable
// tab's `url` option is its address, a method of the tab is the block's own function
// (`pumi_dev.browser.page.navigate`, `tab.call` of one reaching it), and what a caller reads of a
// tab is that option and the `title` it reports. What is here is what the app and other callers
// reach; `ui.tsx` draws the page.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ApiError, call, fn, option, paths, self, ui, workspace } from "pumi";

import { resolve } from "./address.ts";
import type { Described, Note } from "./notes.ts";
import { listed } from "./notes.ts";

/** The tab option a page is on and goes to: the block's own (`pumi_dev.browser.url`). */
const PAGE = "url";

/** Where a search goes when `search_url` cannot be read. */
const SEARCH = "https://duckduckgo.com/?q={query}";

/** The block a page is in: `pumi_dev.browser.page`. */
const BLOCK = self.plugin.prefixed("page");

/** The topic the page hears its block's own methods on, in whichever window draws it. */
const TOPIC = "page";

/** Where a page opens: beside a tab, or in a view of its own. */
type Place = Record<string, unknown>;

/** The address a call gives: the second argument, or the first's `url`. */
function addressOf(first: unknown, second: unknown): string {
  const url = typeof first === "object" && first !== null ? (first as { url?: unknown }).url : second;
  if (typeof url !== "string" || url.trim() === "") throw new ApiError("invalid_params", "navigate takes the tab and the address");
  return url;
}

/** The tab a call names — `back("%3")`, `back({ tab: "%3" })` or `back(3)`, as `pumi call` writes
 * each of them — as its wire id. */
function tabOf(what: unknown): string {
  const named = typeof what === "object" && what !== null ? (what as { tab?: unknown }).tab : what;
  const id = typeof named === "number" ? `%${named}` : typeof named === "string" ? (named.startsWith("%") ? named : `%${Number(named)}`) : "";
  if (!/^(?:[A-Za-z0-9._-]+\/)?%[1-9][0-9]*$/.test(id)) throw new ApiError("not_found", `no browser page in tab ${String(named)}`);
  return id;
}

/** One of the plugin's global options (`home_url`): the manifest declares them, Settings sets them. */
async function setting(name: string): Promise<string | null> {
  const value = await option.get(name, { scope: "global" }).catch(() => null);
  return typeof value === "string" ? value : null;
}

/** What `open` is given: an address, or `{ url }`; the app adds `tab` and `link` for a terminal's
 * cmd+clicked link (`shift` when shift was held too). */
interface Opening {
  url?: unknown;
  tab?: unknown;
  link?: unknown;
  shift?: unknown;
}

/** A page in a tab: beside this one, or in a view of its own. Its address is the argument
 * (`{ url }`), else `home_url`, else the address bar. A terminal's link (`link: true`) opens beside
 * its terminal, or in the system's browser when `open_links` says so (shift says the other), as
 * does a link no page can be (`mailto:`). */
async function open(args: unknown, place: Place): Promise<string | null> {
  const given: Opening = typeof args === "string" ? { url: args } : ((args ?? {}) as Opening);
  const asked = typeof given.url === "string" ? given.url : "";
  if (given.link === true && asked !== "") {
    const system = ((await setting("open_links")) === "system") !== (given.shift === true);
    if (system || resolve(asked, (await setting("search_url")) ?? SEARCH)?.kind === "system") {
      await call("fs.open", asked);
      return null;
    }
  }
  const url = asked !== "" ? asked : ((await setting("home_url")) ?? "");
  const beside = typeof given.tab === "string" && given.tab !== "" ? { beside: given.tab } : {};
  // The block's option, set as it opens: the page the tab starts on.
  const opened = await workspace.openTab(BLOCK, { [self.plugin.prefixed(PAGE)]: url }, { ...place, ...beside });
  return opened.id;
}

/** An option of the page in `id`, as the page left it. */
async function said(id: string, name: string): Promise<string> {
  const value = await option.get(name, { scope: "tab", id }).catch(() => null);
  return typeof value === "string" ? value : "";
}

/** Tells the page in `id` to do `method`: what only the window's webview can do (go back, reload,
 * take what was typed). The tab's `url` option is what survives it. */
function tell(id: string, method: string, args?: unknown): null {
  ui.post(TOPIC, { tab: id, method, args: args ?? {} });
  return null;
}

/** The page in `id` goes to `url`, and answers where it went. */
async function navigate(id: string, url: string): Promise<string> {
  await option.set(PAGE, url, { scope: "tab", id });
  return url;
}

fn.set(
  "open",
  {
    desc: "Open a page beside this tab (or `tab`). With `link: true` it is a terminal's link, which `open_links` may send to the system's browser instead.",
    effect: "write",
    examples: [{ args: [{ url: "https://pumi.dev" }] }, { args: ["example.com"] }],
    returns: "The tab it opened, or `null` when the system's browser took the link.",
    returns_schema: { type: ["string", "null"] },
  },
  (args?: unknown) => open(args, { kind: "tiled", split: "right" }),
);
fn.set("openView", { desc: "Open a page in a view of its own.", effect: "write", returns_schema: { type: ["string", "null"] } }, (args?: unknown) =>
  open(args, { kind: "view", name: "Browser" }),
);

// The block's own methods: `tab.call("%3", "back")` reaches `pumi_dev.browser.page.back` with the
// tab's id first, then the call's arguments.

/** Show a page in a browser tab: it takes what an address bar takes, a URL or a search. */
async function go(first: unknown, second: unknown): Promise<string> {
  const id = tabOf(first);
  const url = addressOf(first, second);
  return navigate(id, url);
}

fn.set(
  "page.navigate",
  {
    desc: "Show a page in a browser tab: it takes what an address bar takes, a URL or a search.",
    effect: "write",
    parameters: [
      ["string", "tab"],
      ["table", "args"],
    ],
    returns_schema: { type: "string" },
  },
  (tab: unknown, args: unknown) => go(tab, args),
);
fn.set(
  "page.back",
  { desc: "Step back in a page's history, as `cmd+[` does.", effect: "write", parameters: [["string", "tab"]] },
  (tab: unknown) => tell(tabOf(tab), "back"),
);
fn.set(
  "page.forward",
  { desc: "Step forward in a page's history, as `cmd+]` does.", effect: "write", parameters: [["string", "tab"]] },
  (tab: unknown) => tell(tabOf(tab), "forward"),
);
fn.set(
  "page.reload",
  { desc: "Load the page again, as `cmd+r` does.", effect: "write", parameters: [["string", "tab"]] },
  (tab: unknown) => tell(tabOf(tab), "reload"),
);
fn.set(
  "page.input",
  {
    desc: "What is typed into a page's address bar: `{text}`, `{paste}`, or `{keys}` with Enter among them.",
    effect: "write",
    parameters: [
      ["string", "tab"],
      ["table", "args"],
    ],
  },
  (tab: unknown, args: unknown) => tell(tabOf(tab), "input", args),
);
fn.set(
  "page.describe",
  { desc: "What the page says of itself: its title, its address, and the text it shows.", effect: "read", parameters: [["string", "tab"]] },
  (tab: unknown) => said(tabOf(tab), PAGE),
);

// What a caller of the package asks: the same methods, by the names a script knows.

fn.set(
  "navigate",
  {
    desc: "Show a page in a browser tab: it takes what an address bar takes, a URL or a search.",
    effect: "write",
    parameters: [
      ["number", "tab"],
      ["string", "url"],
    ],
    examples: [{ args: [3, "pumi.dev"] }, { args: [{ tab: 3 }, "pumi.dev"] }],
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
    parameters: [["number", "tab"]],
    examples: [{ args: [3] }, { args: [{ tab: 3 }] }],
    returns: "The address it is on now.",
    returns_schema: { type: "string" },
  },
  async (first: unknown) => {
    const id = tabOf(first);
    tell(id, "back");
    return said(id, PAGE);
  },
);
fn.set(
  "forward",
  {
    desc: "Step forward in a page's history, as `cmd+]` does.",
    effect: "write",
    parameters: [["number", "tab"]],
    examples: [{ args: [3] }, { args: [{ tab: 3 }] }],
    returns: "The address it is on now.",
    returns_schema: { type: "string" },
  },
  async (first: unknown) => {
    const id = tabOf(first);
    tell(id, "forward");
    return said(id, PAGE);
  },
);
fn.set(
  "reload",
  {
    desc: "Load the page again, as `cmd+r` does.",
    effect: "write",
    parameters: [["number", "tab"]],
    examples: [{ args: [3] }],
  },
  (first: unknown) => tell(tabOf(first), "reload"),
);
fn.set(
  "url",
  {
    desc: "The address a browser tab is on; empty for a tab that has not left the address bar.",
    effect: "read",
    parameters: [["number", "tab"]],
    examples: [{ args: [3] }],
    returns_schema: { type: "string" },
  },
  (first: unknown) => said(tabOf(first), PAGE),
);
fn.set(
  "title",
  {
    desc: "What a browser tab is called: the page's own title, else its host.",
    effect: "read",
    parameters: [["number", "tab"]],
    examples: [{ args: [3] }],
    returns_schema: { type: "string" },
  },
  (first: unknown) => said(tabOf(first), "title"),
);

// What an agent drives a page with. Each runs in the window that draws the tab: the worker asks the
// page's component (`ui.post`), which runs it in the page's webview and hands the answer back
// (`answered`). Every one is a block method (`pumi tab call %3 snapshot`) and the package's
// function (`pumi call pumi_dev.browser.snapshot %3`).

/** What waits for a window's answer, by the id it was asked with. */
const asked = new Map<string, { done(ok: boolean, value: unknown): void }>();
let asks = 0;

/** Asks the page in `tab` to do `what` (`kit`, `eval`, `snapshot`, `loaded`), at most `ms`. */
async function ask(tab: string, what: string, args: Record<string, unknown>, ms = 15_000): Promise<unknown> {
  const open = (await call("tab.get", tab).catch(() => null)) as { block?: string } | null;
  if (open?.block !== BLOCK) throw new ApiError("not_found", open ? `${tab} is not a browser tab (it holds ${open.block})` : `no tab ${tab}`);
  const id = `${Date.now().toString(36)}-${++asks}`;
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      asked.delete(id);
      fail(new ApiError("timeout", `the page in ${tab} did not answer in ${Math.round(ms / 1000)} s: is its tab shown in a window?`));
    }, ms);
    asked.set(id, {
      done(ok, value) {
        clearTimeout(timer);
        asked.delete(id);
        if (ok) done(value);
        else fail(new ApiError("exception", typeof value === "string" ? value.replace(/^Error: /, "") : JSON.stringify(value)));
      },
    });
    ui.post(TOPIC, { tab, method: "run", args: { id, what, ...args } });
  });
}

/** A window's answer to `ask`: the first one counts. */
export async function answered(id: string, ok: boolean, value: unknown): Promise<void> {
  asked.get(id)?.done(ok, value);
}

/** The arguments of a call as an object: `{…}` as it is, else nothing. */
function opts(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

/** The second of a package call's arguments, or what a target-taking tool was given bare. */
function given(args: unknown, key?: string): Record<string, unknown> {
  if (key && (typeof args === "string" || typeof args === "number")) return { [key]: args };
  return opts(args);
}

/** One of the kit's methods (`kit.ts`) on the page in `tab`, its time allowed with it. */
function kit(tab: string, method: string, args: Record<string, unknown>, ms?: number): Promise<unknown> {
  return ask(tab, "kit", { call: method, call_args: args }, ms);
}

/** A target-taking tool's arguments: `"e12"`, `"button.save"`, `{target}`, `{text}`, `{ref}`, `{selector}`. */
function targeted(args: Record<string, unknown>): Record<string, unknown> {
  if (args.target !== undefined) return args;
  for (const k of ["ref", "selector"] as const) if (typeof args[k] === "string") return { ...args, target: args[k] };
  if (args.text !== undefined || args.role !== undefined || args.name !== undefined) {
    const { text, role, name, index, ...rest } = args;
    return { ...rest, target: { text, role, name, index } };
  }
  return args;
}

/** What `eval` runs: an expression's value, or a function body's `return`. */
function body(script: string): string {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => unknown;
  try {
    new AsyncFunction(`return (${script}\n);`);
    return `return (${script}\n);`;
  } catch {
    return script;
  }
}

/** A tool, as a block method and as the package's function. `run` gets the tab's id and its arguments. */
interface Tool {
  desc: string;
  effect: "read" | "write";
  /** What the second argument holds, said once for both forms. */
  args?: string;
  /** A bare string or number as the second argument means `{[bare]: it}`. */
  bare?: string;
  examples?: unknown[];
  returns?: string;
  run(tab: string, args: Record<string, unknown>): Promise<unknown> | unknown;
}

const TARGET = "A target is a ref from `snapshot` (`e12`), a CSS selector, or `{text}` / `{role, name}`, with `index` among several.";

const TOOLS: Record<string, Tool> = {
  snapshot: {
    desc: "The page as an agent reads it: its address, title and scroll, then its headings, text, and each link, button and field with a ref (`[e12]`) the other tools take. Start here.",
    effect: "read",
    args: "`{target?, max?}`: one part of the page, at most `max` characters (30000).",
    examples: [{}, { max: 8000 }, { target: "main" }],
    run: (tab, a) => kit(tab, "snapshot", a),
  },
  text: {
    desc: "The text the page shows (its innerText), or one element's.",
    effect: "read",
    args: "`{target?, max?}`.",
    bare: "target",
    run: (tab, a) => kit(tab, "text", targeted(a)),
  },
  html: {
    desc: "The page's HTML, or one element's outerHTML.",
    effect: "read",
    args: "`{target?, max?}`.",
    bare: "target",
    run: (tab, a) => kit(tab, "html", targeted(a)),
  },
  find: {
    desc: `One element, described: its ref, a unique CSS selector, role, name, box, attributes, text, HTML, ancestors, computed style, and the source file and components a framework's dev build says it comes from. ${TARGET}`,
    effect: "read",
    args: "`{target}` (or the target bare).",
    bare: "target",
    examples: [{ target: "e12" }, { text: "Sign in" }, { target: "nav a.active" }],
    run: (tab, a) => kit(tab, "find", targeted(a)),
  },
  click: {
    desc: `Click an element as a person would: scrolled into view, then pointer and mouse events and \`click\` at its middle. ${TARGET}`,
    effect: "write",
    args: "`{target, button?: \"right\"|\"middle\", double?}`.",
    bare: "target",
    examples: [{ target: "e12" }, { text: "Sign in" }],
    run: (tab, a) => kit(tab, "click", targeted(a)),
  },
  hover: {
    desc: `Move the mouse over an element (its menus and tooltips open). ${TARGET}`,
    effect: "write",
    args: "`{target}`.",
    bare: "target",
    run: (tab, a) => kit(tab, "hover", targeted(a)),
  },
  fill: {
    desc: `Set a field's value as typing would leave it (input and change events): a text field, a textarea, a select (by value or label), a checkbox (true or false), an editable element. ${TARGET}`,
    effect: "write",
    args: "`{target, value}`.",
    examples: [{ target: "e7", value: "ada@example.com" }, { target: "select#country", value: "Egypt" }],
    run: (tab, a) => kit(tab, "fill", targeted(a)),
  },
  type: {
    desc: "Type text where the keyboard is, or into `target`, adding to what is there.",
    effect: "write",
    args: "`{text, target?}`.",
    run: (tab, a) => kit(tab, "type", a.target !== undefined || a.ref !== undefined || a.selector !== undefined ? targeted(a) : a),
  },
  press: {
    desc: "Press a key where the keyboard is, or on `target`: `Enter` (submits a form), `Escape`, `Tab`, `ArrowDown`, `a`, `cmd+a`… The page hears keydown and keyup.",
    effect: "write",
    args: "`{key, target?}` (or the key bare).",
    bare: "key",
    examples: [{ key: "Enter" }, { key: "Escape" }],
    run: (tab, a) => kit(tab, "press", a.target !== undefined || a.ref !== undefined || a.selector !== undefined ? targeted(a) : a),
  },
  scroll: {
    desc: "Scroll the page (or a scrolling element): by `y` pixels (most of a screen without), `to` `top` or `bottom`, or until `target` is in view.",
    effect: "write",
    args: "`{y?, x?, to?, target?}`.",
    examples: [{}, { to: "bottom" }, { target: "e40" }],
    run: (tab, a) => kit(tab, "scroll", targeted(a)),
  },
  waitFor: {
    desc: "Wait until an element is on the page (or `gone: true`, until it is not), or with `load: true` until the page has loaded. At most `timeout` ms (10000, 60000 at most).",
    effect: "read",
    args: "`{target | text | selector, gone?, timeout?}` or `{load: true, timeout?}`.",
    examples: [{ text: "Saved" }, { selector: ".spinner", gone: true }, { load: true }],
    run: (tab, a) => {
      const ms = Math.min(Math.max(Number(a.timeout) || 10_000, 50), 60_000);
      if (a.load) return ask(tab, "loaded", { timeout: ms }, ms + 2_000);
      return kit(tab, "wait", targeted({ ...a, timeout: ms }), ms + 2_000);
    },
  },
  eval: {
    desc: "Run JavaScript in the page and answer its value, as JSON says it: an expression (`document.title`), or a function body that `return`s; it may `await`. It runs as the page's own script, with the page's cookies and logins.",
    effect: "write",
    args: "`{script, timeout?}` (or the script bare).",
    bare: "script",
    examples: [{ script: "document.title" }, { script: "const r = await fetch('/api/me'); return r.status" }],
    run: (tab, a) => {
      if (typeof a.script !== "string" || a.script.trim() === "") throw new ApiError("invalid_params", "eval takes `script`");
      const ms = Math.min(Math.max(Number(a.timeout) || 10_000, 50), 120_000);
      return ask(tab, "eval", { script: body(a.script), timeout: ms }, ms + 2_000);
    },
  },
  console: {
    desc: "The page's console lines and uncaught errors since it loaded (the last 300): `level` (`error`, `warn,error`) filters them; `clear: true` leaves later calls only what comes after.",
    effect: "read",
    args: "`{level?, last?, clear?, all?}`.",
    examples: [{}, { level: "error" }],
    run: (tab, a) => kit(tab, "console", a),
  },
  screenshot: {
    desc: "A PNG of what the page shows, written to `path` or to a file of the plugin's cache; answers the file's path, for an agent to look at. macOS only for now.",
    effect: "read",
    args: "`{path?}`: absolute, or relative to the plugin's cache.",
    bare: "path",
    returns: "The PNG's absolute path.",
    run: (tab, a) => {
      const dir = join(paths.cache, "screenshots");
      mkdirSync(dir, { recursive: true });
      const file = typeof a.path === "string" && a.path !== "" ? a.path : `${tab.replace(/\W/g, "")}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      const path = file.startsWith("/") ? file : join(dir, file);
      return ask(tab, "snapshot", { path }, 20_000);
    },
  },
  notes: {
    desc: "The notes the user left on elements of the page (with the picker): what they want done, and each element as `find` describes it. In a tab, an agent reads them with `tab.call(tab, \"notes\")`. Answers the unread ones (`all: true`: every one) and marks them read.",
    effect: "read",
    args: "`{all?, peek?}`: `peek` leaves them unread.",
    run: (tab, a) => readNotes(tab, a.all === true, a.peek === true),
  },
  clearNotes: {
    desc: "Take the user's notes off the page once they are done: `ids` some of them, without every one.",
    effect: "write",
    args: "`{ids?}`.",
    run: (tab, a) => dropNotes(tab, Array.isArray(a.ids) ? a.ids.map(Number) : null),
  },
};

for (const [name, tool] of Object.entries(TOOLS)) {
  const desc = tool.args ? `${tool.desc} Takes ${tool.args}` : tool.desc;
  const run = (first: unknown, second: unknown) => tool.run(tabOf(first), given(second, tool.bare));
  fn.set(`page.${name}`, { desc, effect: tool.effect, parameters: [["string", "tab"], ["table", "args"]] }, run);
  fn.set(
    name,
    {
      desc,
      effect: tool.effect,
      parameters: [["number", "tab"], ["table", "args"]],
      examples: [{ args: [3] }, ...(tool.examples ?? []).map((e) => ({ args: [3, e] }))],
      ...(tool.returns ? { returns: tool.returns } : {}),
    },
    run,
  );
}

// The user's notes: an element of a page picked in the toolbar, and what they want done with it.
// They are kept with the plugin (its store), and an agent reads them with the block's `notes`
// method (`tab.call(tab, "notes")`), which marks them read.

const NOTES = "notes";
let notes: Note[] = [];
let lastId = 0;
const loaded = option.get(NOTES).then((kept) => {
  if (Array.isArray(kept)) notes = kept as Note[];
  lastId = notes.reduce((n, note) => Math.max(n, note.id), 0);
}).catch(() => {});

async function save(tab?: string): Promise<void> {
  await option.set(NOTES, notes.length ? notes : null).catch(() => {});
  for (const t of tab ? [tab] : [...new Set(notes.map((n) => n.tab))]) ui.post("notes", { tab: t, notes: notes.filter((n) => n.tab === t) });
}

/** The notes on the page in `tab`, for its toolbar. */
export async function notesOf(tab: string): Promise<Note[]> {
  await loaded;
  return notes.filter((n) => n.tab === tab);
}

/** A note the user wrote about `element`, on the page in `tab`. */
export async function addNote(tab: string, text: string, element: Described, page: { url: string; title: string }): Promise<Note> {
  await loaded;
  const note: Note = { id: ++lastId, tab, url: page.url, title: page.title, note: text.trim(), at: new Date().toISOString(), read: false, element };
  notes.push(note);
  await save(tab);
  return note;
}

/** Takes notes off the page in `tab`: `ids`, or every one. */
export async function dropNotes(tab: string, ids: number[] | null): Promise<number> {
  await loaded;
  const before = notes.length;
  notes = notes.filter((n) => n.tab !== tab || (ids !== null && !ids.includes(n.id)));
  await save(tab);
  return before - notes.length;
}

async function readNotes(tab: string, all: boolean, peek: boolean): Promise<string> {
  await loaded;
  const mine = notes.filter((n) => n.tab === tab && (all || !n.read));
  const answer = listed(tab, mine, notes.filter((n) => n.tab === tab).length);
  if (!peek && mine.some((n) => !n.read)) {
    for (const n of mine) n.read = true;
    await save(tab);
  }
  return answer;
}
