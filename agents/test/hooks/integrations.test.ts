// The hooks the plugin installs into each agent's own config (`src/hooks/integrations.ts`): the
// cases of pumi's `pumi skill` it took them from, and the line itself run by a shell.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOOK_FN } from "../../src/names.ts";
import { AGENT_ENV, agentLaunch, findAgent, HOOK_AGENTS, hookCommand, hookRows, hookState, hookStatus, install, MARKER, merge, ownedFile, PERMISSION_WAIT, resumeCommand, resumeLine, strip, uninstall, VERSION, type HookAgent } from "../../src/hooks/integrations.ts";

const agent = (id: string): HookAgent => findAgent(id)!;
type Json = Record<string, any>;

describe("hooks merged into an agent's config", () => {
  test("Claude's go in beside the user's and come out cleanly", () => {
    const user = { model: "opus", hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "mine.sh" }] }] } };
    const config: Json = structuredClone(user);
    merge(config, agent("claude"));
    merge(config, agent("claude"));
    const start = config.hooks.SessionStart;
    expect(start.length).toBe(2);
    expect(start[1].hooks[0].command).toBe(hookCommand("claude", "start"));
    expect(start[1].hooks[0].timeout).toBe(5);
    expect(config.hooks.UserPromptSubmit[0].hooks[0].command).toBe(hookCommand("claude", "prompt"));
    expect(config.model).toBe("opus");
    strip(config, true);
    expect(config).toEqual(user);
  });

  test("Claude asks permissions through pumi and waits longer for them", () => {
    const config: Json = {};
    merge(config, agent("claude"));
    const hook = config.hooks.PermissionRequest[0].hooks[0];
    expect(hook.command).toBe(hookCommand("claude", "permission"));
    expect(hook.timeout).toBe(PERMISSION_WAIT + 30);
    const codex: Json = {};
    merge(codex, agent("codex"));
    expect(codex.hooks.PermissionRequest).toBeUndefined();
  });

  test("Claude says blocked before a question and working after a tool", () => {
    const config: Json = {};
    merge(config, agent("claude"));
    const pre = config.hooks.PreToolUse[0];
    expect(pre.matcher).toBe("AskUserQuestion|ExitPlanMode");
    expect(pre.hooks[0].command).toBe(hookCommand("claude", "question"));
    for (const event of ["PostToolUse", "PostToolUseFailure"]) {
      const post = config.hooks[event][0];
      expect(post.matcher).toBeUndefined();
      expect(post.hooks[0].command).toBe(hookCommand("claude", "resume"));
    }
    strip(config, true);
    expect(config).toEqual({ hooks: {} });
    const codex: Json = {};
    merge(codex, agent("codex"));
    expect(codex.hooks.PreToolUse).toBeUndefined();
  });

  test("Gemini uses BeforeAgent and milliseconds", () => {
    const config: Json = {};
    merge(config, agent("gemini"));
    expect(config.hooks.BeforeAgent[0].hooks[0].timeout).toBe(5000);
    expect(config.hooks.AfterAgent[0].hooks[0].command).toBe(hookCommand("gemini", "stop"));
  });

  test("a turn's end is the stop hook, and nothing of the plugin's is left after a strip", () => {
    const config: Json = {};
    merge(config, agent("claude"));
    expect(config.hooks.Stop[0].hooks[0].command).toBe(hookCommand("claude", "stop"));
    strip(config, true);
    expect(config).toEqual({ hooks: {} });
  });

  test("Cursor gets its session's start only, beside the user's", () => {
    const config: Json = { version: 1, hooks: { stop: [{ command: "x" }] } };
    merge(config, agent("cursor"));
    expect(config.hooks.sessionStart[0].command).toBe(hookCommand("cursor", "start"));
    expect(config.hooks.beforeSubmitPrompt).toBeUndefined();
    strip(config, false);
    expect(config).toEqual({ version: 1, hooks: { stop: [{ command: "x" }] } });
  });

  test("a config of another shape is made one", () => {
    const config: Json = { hooks: [] };
    merge(config, agent("codex"));
    expect(Object.keys(config.hooks)).toEqual(["SessionStart", "UserPromptSubmit", "Stop"]);
  });
});

describe("the files installed whole", () => {
  test("pi's extension and OpenCode's plugin call the hook function, and only pi takes a queued prompt", () => {
    const pi = ownedFile(agent("pi"))!;
    const omp = ownedFile(agent("omp"))!;
    expect(pi).toContain("sendUserMessage");
    expect(omp).not.toContain("sendUserMessage");
    for (const file of [pi, omp]) {
      for (const hole of ["{agent}", "{stop}", "{live}", "{fn}"]) expect(file).not.toContain(hole);
      expect(file).toContain(`"compact"`);
      expect(file).toContain(`"call", "${HOOK_FN}"`);
      expect(file).toContain("if (!process.env.PUMI_AGENT) return;");
      expect(file).toContain(`// ${MARKER} v${VERSION}`);
      // The chat's live view of a turn reads what it writes.
      expect(file).toContain(`".live"`);
    }
    expect(omp).toContain(`String(process.env.PUMI_TAB ?? ""), "omp", event`);
    const opencode = ownedFile(agent("opencode"))!;
    expect(opencode).toContain("session.idle");
    expect(opencode).not.toContain("{agent}");
    expect(opencode).toContain(`"opencode", event`);
    expect(ownedFile(agent("claude"))).toBeUndefined();
  });

  test("hand the agent what it is told about the workspace, unseen by the user", () => {
    for (const each of ["pi", "omp"]) {
      const file = ownedFile(agent(each))!;
      // At a start, with its next turn; at a prompt, with that prompt.
      expect(file).toContain(`customType: "pumi-context"`);
      expect(file).toContain(`deliverAs: "nextTurn"`);
      expect(file).toContain("return { message: hidden(text) }");
    }
    for (const each of ["opencode", "kilo"]) {
      const file = ownedFile(agent(each))!;
      expect(file).toContain("experimental.chat.system.transform");
      expect(file).toContain("full: true");
    }
  });

  test("are programs their agent can load", () => {
    for (const each of ["pi", "omp"]) expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(ownedFile(agent(each))!)).not.toThrow();
    for (const each of ["opencode", "kilo"]) expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(ownedFile(agent(each))!)).not.toThrow();
  });
});

describe("a session resumed", () => {
  test("by its recipe or the user's", () => {
    for (const each of HOOK_AGENTS.filter((a) => a.resume.length > 0)) expect(resumeLine(each.id, "abc", null)).toBeDefined();
    expect(resumeLine("claude", "abc-123", null)).toBe("claude --resume abc-123");
    expect(resumeLine("claude", "a b; rm -rf ~", null)).toBe("claude --resume 'a b; rm -rf ~'");
    expect(resumeLine("claude", "--dangerously-skip-permissions", null)).toBeUndefined();
    expect(resumeLine("claude", "a\nb", null)).toBeUndefined();
    const overrides = { claude: ["claude", "--resume", "{session}", "--model", "opus"], codex: [], aider: ["aider", "--restore", "{session}"] };
    expect(resumeLine("claude", "x", overrides)).toBe("claude --resume x --model opus");
    expect(resumeLine("codex", "x", overrides)).toBeUndefined();
    expect(resumeLine("aider", "x", overrides)).toBe("aider --restore x");
    expect(resumeLine("codex", "x", null)).toBe("codex resume x");
    expect(resumeCommand(["claude"], "abc")).toBeUndefined();
  });
});

describe("the agents", () => {
  test("only checked ones accept a queue", () => {
    expect(HOOK_AGENTS.filter((a) => a.accepts.includes("queue")).map((a) => a.id)).toEqual(["pi", "claude"]);
    for (const each of HOOK_AGENTS) for (const word of each.accepts) expect(word).toBe("queue");
  });

  test("each id once", () => {
    const ids = HOOK_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("installing", () => {
  const home = () => mkdtempSync(join(tmpdir(), "agents-hooks-"));

  test("into a config the user has, kept once as a backup, and out again", () => {
    const dir = home();
    const file = join(dir, ".claude", "settings.json");
    mkdirSync(join(dir, ".claude"));
    const user = { model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "mine.sh" }] }] } };
    writeFileSync(file, JSON.stringify(user));
    expect(hookState(agent("claude"), dir)).toBe("not_installed");
    expect(install(agent("claude"), dir)).toBe(file);
    expect(hookState(agent("claude"), dir)).toBe("installed");
    expect(JSON.parse(readFileSync(`${file}.pumi-bak`, "utf8"))).toEqual(user);
    install(agent("claude"), dir);
    const twice = JSON.parse(readFileSync(file, "utf8"));
    expect(twice.hooks.Stop.length).toBe(2);
    uninstall(agent("claude"), dir);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(user);
    expect(hookState(agent("claude"), dir)).toBe("not_installed");
  });

  test("a hook of an older version is outdated", () => {
    const dir = home();
    const file = join(dir, ".codex", "hooks.json");
    mkdirSync(join(dir, ".codex"));
    writeFileSync(file, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `old # ${MARKER} v0` }] }] } }));
    expect(hookState(agent("codex"), dir)).toBe("outdated");
    install(agent("codex"), dir);
    expect(hookState(agent("codex"), dir)).toBe("installed");
  });

  test("a file of its own, removed only when it is the plugin's", () => {
    const dir = home();
    const file = join(dir, ".pi", "agent", "extensions", "pumi-context.ts");
    install(agent("pi"), dir);
    expect(readFileSync(file, "utf8")).toBe(ownedFile(agent("pi"))!);
    expect(hookState(agent("pi"), dir)).toBe("installed");
    writeFileSync(file, `${ownedFile(agent("pi"))}\n// changed`);
    expect(hookState(agent("pi"), dir)).toBe("outdated");
    uninstall(agent("pi"), dir);
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, "// the user's own");
    uninstall(agent("pi"), dir);
    expect(existsSync(file)).toBe(true);
  });

  test("a config that is not JSON is left alone", () => {
    const dir = home();
    mkdirSync(join(dir, ".gemini"));
    writeFileSync(join(dir, ".gemini", "settings.json"), "{ not json");
    expect(() => install(agent("gemini"), dir)).toThrow("not JSON");
    expect(readFileSync(join(dir, ".gemini", "settings.json"), "utf8")).toBe("{ not json");
  });

  test("an agent without a hook shape has none to install", () => {
    expect(hookState(agent("amp"), home())).toBe("unsupported");
    expect(() => install(agent("amp"), home())).toThrow("no hook");
  });

  test("the list says what is here and what is in", () => {
    const dir = home();
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "codex"), "");
    install(agent("claude"), dir);
    const rows = hookRows(dir, join(dir, "bin"));
    const by = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(by.claude!.hook).toBe("installed");
    expect(by.claude!.file).toBe("~/.claude/settings.json");
    expect(by.claude!.available).toBe(false);
    expect(by.codex!.available).toBe(true);
    expect(by.amp!.file).toBeUndefined();
  });
});

describe("the hook's line", () => {
  // A POSIX shell runs it; a stand-in for `pumi` says what it was called with.
  const dir = mkdtempSync(join(tmpdir(), "agents-line-"));
  const bin = join(dir, "pumi");
  writeFileSync(bin, `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg"; done\n`);
  chmodSync(bin, 0o755);
  const run = (env: Record<string, string>, input: string) => {
    const base = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
    return Bun.spawnSync(["/bin/sh", "-c", hookCommand("claude", "start")], { env: { ...base, ...env }, stdin: Buffer.from(input) });
  };

  test("is a no-op outside a tab the plugin opened for an agent", () => {
    const out = run({ PUMI_TAB: "%3", PUMI_BIN: bin }, "{}");
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toBe("");
    expect(out.stderr.toString()).toBe("");
  });

  test("calls the hook function with the tab, the agent, the event and its input", () => {
    const input = JSON.stringify({ session_id: "s 1", transcript_path: "/a b.jsonl" });
    const out = run({ PUMI_AGENT: "claude", PUMI_TAB: "%3", PUMI_BIN: bin }, input);
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString().split("\n").slice(0, -1)).toEqual(["call", HOOK_FN, "%3", "claude", "start", input]);
  });

  test("never fails its agent", () => {
    const out = run({ PUMI_AGENT: "claude", PUMI_TAB: "%3", PUMI_BIN: join(dir, "missing") }, "{}");
    expect(out.exitCode).toBe(0);
  });
});

describe("a tab opened for an agent", () => {
  test("is a shell with PUMI_AGENT, the agent typed into it", () => {
    expect(agentLaunch(agent("claude"))).toEqual({ env: { [AGENT_ENV]: "claude" }, command: "claude" });
    expect(agentLaunch(agent("cursor")).command).toBe("cursor-agent");
    expect(hookCommand("claude", "start")).toStartWith(`[ -n "$${AGENT_ENV}" ] && `);
  });
});

describe("a hook's row in Settings", () => {
  test("says its state and the one thing its button does", () => {
    expect(hookStatus({ hook: "installed", available: true })).toEqual({ text: "Installed" });
    expect(hookStatus({ hook: "outdated", available: true })).toEqual({ text: "Outdated", action: "update" });
    expect(hookStatus({ hook: "not_installed", available: false })).toEqual({ text: "Not found", action: "install" });
    expect(hookStatus({ hook: "unsupported", available: true }).action).toBeUndefined();
  });
});
