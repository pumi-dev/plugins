// The commands a `/` offers, and what a prompt with pictures becomes for each agent: on files in a
// temporary home and project, and on the agents' own tables.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENTS, promptParts, promptWrites, type AgentSpec } from "../src/agents.ts";
import { bareCommand, builtinCommands, commandsFor, fileCommands, frontMatter, projectDirs } from "../src/commands.ts";

const root = mkdtempSync(join(tmpdir(), "agents-commands-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const home = join(root, "home");
const project = join(home, "src", "app");

function file(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

file(join(project, ".git/HEAD"), "ref: refs/heads/main\n");
file(join(project, ".claude/commands/deploy.md"), "---\ndescription: Ship it\nargument-hint: <env>\n---\nDeploy the app.\n");
file(join(project, ".claude/commands/team/release.md"), "# Release\n\nCut a release.\n");
file(join(project, ".claude/skills/audit/SKILL.md"), "---\nname: audit\ndescription: Audit the deps\n---\nAudit.\n");
file(join(project, ".claude/skills/hidden/SKILL.md"), "---\ndescription: Never\nuser-invocable: false\n---\nNo.\n");
file(join(home, ".claude/commands/mine.md"), "---\ndescription: My own command\n---\nDo it.\n");
file(join(home, ".pi/agent/prompts/review.md"), "---\ndescription: Review the changes\n---\nReview.\n");
file(join(home, ".agents/skills/pdf-tools/SKILL.md"), "---\nname: pdf-tools\ndescription: Read PDFs\n---\nRead.\n");
file(join(home, ".codex/prompts/scan.md"), "---\ndescription: Scan the tree\n---\nScan.\n");

const claude = AGENTS.claude!;
const codex = AGENTS.codex!;
const pi = AGENTS.pi!;

describe("commands", () => {
  test("front matter: its fields, and the body after it", () => {
    expect(frontMatter("---\ndescription: A thing\nname: 'quoted'\n---\nBody\n")).toEqual({ fields: { description: "A thing", name: "quoted" }, body: "Body\n" });
    expect(frontMatter("no front matter\n")).toEqual({ fields: {}, body: "no front matter\n" });
  });

  test("a project's directories run up to its repository, never the home directory", () => {
    expect(projectDirs(join(project, "src", "ui"), home)).toEqual([join(project, "src", "ui"), join(project, "src"), project]);
    expect(projectDirs(home, home)).toEqual([]);
    expect(projectDirs(undefined, home)).toEqual([]);
  });

  test("Claude's commands and skills, from the project and from home", () => {
    const names = fileCommands(claude, project, home).map((each) => each.name);
    expect(names).toEqual(["deploy", "release", "audit", "mine"]);
    const deploy = fileCommands(claude, project, home)[0]!;
    expect(deploy.description).toBe("Ship it");
    expect(deploy.hint).toBe("<env>");
    // A file that says it is not the user's is left out; one with no description says its first line.
    expect(fileCommands(claude, project, home).map((each) => each.name)).not.toContain("hidden");
    expect(fileCommands(claude, project, home).find((each) => each.name === "release")?.description).toBe("Release");
  });

  test("Codex's prompts carry its namespace, pi's skills their prefix, pi's templates their name", () => {
    expect(fileCommands(codex, project, home).map((each) => each.name)).toEqual(["prompts:scan"]);
    expect(fileCommands(pi, project, home).map((each) => each.name)).toEqual(["review", "skill:pdf-tools"]);
  });

  test("the agent's own commands, and files first: one command per name", () => {
    const all = commandsFor(claude, project, home);
    const names = all.map((each) => each.name);
    expect(names[0]).toBe("deploy");
    expect(names).toContain("clear");
    expect(names).toContain("model");
    expect(new Set(names).size).toBe(names.length);
    const model = all.find((each) => each.name === "model")!;
    expect(model.terminal).toBe(true);
    expect(builtinCommands("pi").find((each) => each.name === "thinking")?.hint).toBe("[level]");
  });

  test("a bare command is the one the agent takes, with nothing after its name", () => {
    const commands = commandsFor(pi, project, home);
    expect(bareCommand("/model", commands)?.name).toBe("model");
    expect(bareCommand(" /model ", commands)?.name).toBe("model");
    expect(bareCommand("/model opus", commands)).toBeUndefined();
    expect(bareCommand("/nope", commands)).toBeUndefined();
  });
});

describe("prompts with pictures", () => {
  const shot = "/tmp/My Shot 1.png";

  test("Claude and Codex take a pasted path, then the text", () => {
    for (const spec of [claude, codex] as AgentSpec[]) {
      expect(promptParts(spec, "look at this", [shot])).toEqual({ pastes: ["/tmp/My\\ Shot\\ 1.png"], text: " look at this" });
      expect(promptParts(spec, "", [shot])).toEqual({ pastes: ["/tmp/My\\ Shot\\ 1.png"], text: "" });
      expect(promptParts(spec, "look", [])).toEqual({ pastes: [], text: "look" });
    }
  });

  test("pi is told the path in the prompt itself, quoted", () => {
    expect(promptParts(pi, "look at this", [shot])).toEqual({ pastes: [], text: '/tmp/My Shot 1.png look at this'.replace("/tmp/My Shot 1.png", '"/tmp/My Shot 1.png"') });
    expect(promptParts(pi, "", ["/tmp/a.png"])).toEqual({ pastes: [], text: "/tmp/a.png" });
  });

  test("a one-line slash command is typed, anything else pasted", () => {
    expect(promptWrites("/compact")).toEqual({ body: { text: "/compact" }, submit: { text: "\r" } });
    expect(promptWrites("hello")).toEqual({ body: { paste: "hello" }, submit: { text: "\r" } });
    expect(promptWrites("/a\nb")).toEqual({ body: { paste: "/a\nb" }, submit: { text: "\r" } });
  });
});
