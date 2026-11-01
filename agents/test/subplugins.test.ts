// The sub-plugins (`src/subplugins.ts`): the ones the plugin ships, each an agent's, read into the
// registry; what an installed one adds; and what a broken one is refused for.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentSpec } from "../src/agents.ts";
import { catalog, catalogAgent, choicesOf } from "../src/catalog.ts";
import { agentList, setRegistry, SUB_API } from "../src/registry.ts";
import { BUNDLED, listSubPlugins, readBundled, registryOf, type SubEntry } from "../src/subplugins.ts";

const dir = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pumi;
const shipped = readBundled(dir);
const tmp = mkdtempSync(join(tmpdir(), "agents-subs-"));
afterAll(async () => {
  rmSync(tmp, { recursive: true, force: true });
  // The registry as every other test has it.
  setRegistry((await registryOf(shipped, true)).registry);
});

/** A sub-plugin in a folder of its own, as pumi lists an installed one. */
function sub(name: string, pumi: Record<string, unknown>, files: Record<string, string> = {}, main?: string): SubEntry {
  const path = join(tmp, name);
  mkdirSync(join(path, "src"), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text);
  const full = { name, owner: "you", parent: "pumi_dev/agents", parentApi: 1, ...pumi };
  writeFileSync(join(path, "package.json"), JSON.stringify({ name, ...(main ? { main } : {}), pumi: full }));
  return { id: `you/${name}`, path, main: main ?? null, manifest: full, active: true, bundled: false };
}

test("the plugin takes sub-plugins of its API's level, and ships one per agent in agents/", () => {
  expect(manifest.subPlugins).toEqual({ api: SUB_API, title: "Agents", bundled: BUNDLED });
  expect(shipped.map((s) => s.id)).toEqual(
    ["amp", "claude", "codex", "copilot", "cursor", "droid", "gemini", "hermes", "kilo", "kiro", "omp", "opencode", "pi", "qwen"].map((id) => `pumi_dev/agent-${id}`),
  );
  for (const each of shipped) {
    const pkg = JSON.parse(readFileSync(join(each.path, "package.json"), "utf8"));
    expect(pkg.private).toBe(true);
    expect([pkg.pumi.parent, pkg.pumi.parentApi]).toEqual(["pumi_dev/agents", SUB_API]);
  }
});

test("the agents come in the order their sub-plugins rank them, each with what it says", () => {
  expect(catalog().map((agent) => agent.id)).toEqual(["pi", "claude", "codex", "omp", "gemini", "opencode", "cursor", "amp", "droid", "copilot", "kiro", "qwen", "kilo", "hermes"]);
  const claude = catalogAgent("claude")!;
  expect([claude.from, claude.sdk, claude.hook?.shape.kind, claude.chat?.format]).toEqual(["pumi_dev/agent-claude", "claude", "hooks", "claude"]);
  expect(catalogAgent("pi")!.hook?.shape).toEqual({ kind: "file", file: ".pi/agent/extensions/pumi-context.ts", template: join(dir, "agents", "pi", "hook.ts.tmpl") });
  expect(catalogAgent("pi")!.icon).toBe(join(dir, "agents", "pi", "icon.svg"));
});

test("an agent's chat needs a sub-plugin that is on to read its format", async () => {
  // Without pi's sub-plugin: omp keeps its terminal and loses its chat (pi's format); pi is gone.
  const { registry } = await registryOf(
    shipped.filter((s) => s.id !== "pumi_dev/agent-pi"),
    true,
  );
  setRegistry(registry);
  expect(catalogAgent("pi")).toBeUndefined();
  expect(catalogAgent("omp")).toBeDefined();
  expect(agentSpec("omp")).toBeUndefined();
  expect(agentSpec("claude")?.label).toBe("Claude Code");
  setRegistry((await registryOf(shipped, true)).registry);
  expect(agentSpec("omp")?.format).toBe("pi");
  expect(choicesOf(catalogAgent("pi")!)).toEqual(["off", "terminal", "gui"]);
});

test("the window reads the data alone: a format is known by name, with no code imported", async () => {
  const { registry, errors } = await registryOf(shipped, false);
  expect(errors).toEqual([]);
  expect([...registry.formats.keys()].sort()).toEqual(["claude", "codex", "pi"]);
  expect([...registry.formats.values()].every((f) => f === null)).toBe(true);
  expect(registry.engines.get("pi")?.run).toEqual(["{program}", "--mode", "rpc"]);
});

test("an installed sub-plugin adds an agent, its format and its engine after the shipped ones", async () => {
  const amp = sub(
    "agent-zed",
    { agents: [{ id: "zed", title: "Zed Agent", program: "zed-agent", icon: "mark.svg", chat: { format: "zed", cancel: "\u001b", images: "text", home: ".zed", rewind: "backtrack" } }], formats: ["zed"], engines: { zed: { module: "src/engine.ts", run: ["{program}", "--rpc"] } } },
    { "mark.svg": "<svg/>", "src/index.ts": 'export const formats = { zed: { parser: () => ({ record: () => [] }), locate: () => undefined } };\n', "src/engine.ts": "export function createDriver() {}\n" },
    "src/index.ts",
  );
  const { registry, errors } = await registryOf([...shipped, amp], true);
  expect(errors).toEqual([]);
  setRegistry(registry);
  expect(agentList().at(-1)?.id).toBe("zed");
  expect(agentSpec("zed")?.label).toBe("Zed Agent");
  expect(catalogAgent("zed")?.icon).toBe(join(amp.path, "mark.svg"));
  expect(registry.engines.get("zed")?.module).toBe(join(amp.path, "src", "engine.ts"));
});

test("one that is off, of a newer level, or naming what another has is left out, and says why", async () => {
  const off = { ...sub("agent-off", { agents: [{ id: "off", title: "Off", program: "off" }] }), active: false };
  const newer = sub("agent-new", { parentApi: SUB_API + 1, agents: [{ id: "new", title: "New", program: "new" }] });
  const twice = sub("agent-twice", { agents: [{ id: "claude", title: "Claude again", program: "claude" }], engines: { pi: { module: "src/x.ts" } } });
  const broken = sub("agent-broken", { agents: [{ id: "Bad Id", title: "x", program: "x" }, { id: "fine", title: "Fine", program: "fine", icon: "../../escape.svg", hook: { shape: { kind: "file", file: ".x", template: "../nope" } } }], engines: { acp: { module: "src/x.ts" } }, formats: ["fine"] });
  const { registry, errors } = await registryOf([...shipped, off, newer, twice, broken], true);
  const ids = registry.agents.map((a) => a.id);
  expect(ids).not.toContain("off");
  expect(ids).not.toContain("new");
  expect(registry.agents.find((a) => a.id === "claude")?.from).toBe("pumi_dev/agent-claude");
  const fine = registry.agents.find((a) => a.id === "fine")!;
  expect([fine.icon, fine.hook]).toEqual([undefined, undefined]);
  expect(errors.join("\n")).toContain("you/agent-new: it is written for the agents' sub-plugin API 2");
  expect(errors.join("\n")).toContain("agent `claude` is pumi_dev/agent-claude's already");
  expect(errors.join("\n")).toContain("engine `pi` is pumi_dev/agent-pi's already");
  expect(errors.join("\n")).toContain("an agent needs an `id` (lowercase)");
  expect(errors.join("\n")).toContain("engine `acp` needs a `module`");
  expect(errors.join("\n")).toContain("it says it reads fine, and has no `main`");
});

test("a pumi that does not list sub-plugins: the ones in agents/ are read from disk", async () => {
  const listed = await listSubPlugins(() => Promise.reject(new Error("unknown field `parent`")), dir);
  expect(listed.map((s) => s.id)).toEqual(shipped.map((s) => s.id));
  const given = [{ id: "a/b", path: "/x", active: true }];
  expect(await listSubPlugins(() => Promise.resolve(given), dir)).toEqual(given);
});
