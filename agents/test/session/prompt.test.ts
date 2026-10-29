// What a prompt carries beyond its text: the skills it names (found in an agent's folders, put in
// before the text as pi puts in one it loads) and read back as the user typed them; a picture's bytes.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expandSkills, findSkills, skillFolders, skillsNamed, withBytes, withSkills } from "../../src/session/prompt.ts";
import { collapseSkills } from "../../src/parse/common.ts";

const root = mkdtempSync(join(tmpdir(), "skills-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function skill(folder: string, name: string, front: string, body = "Do it well.") {
  mkdirSync(join(folder, name), { recursive: true });
  writeFileSync(join(folder, name, "SKILL.md"), `---\n${front}\n---\n\n${body}\n`);
  return join(folder, name, "SKILL.md");
}

test("an agent's folders: the project's from its directory up, then the user's", () => {
  expect(skillFolders("claude", "/h/work/app", "/h")).toEqual(["/h/work/app/.claude/skills", "/h/work/.claude/skills", "/h/.claude/skills"]);
  expect(skillFolders("codex", "/h/app", "/h").slice(0, 2)).toEqual(["/h/app/.agents/skills", "/h/app/.codex/skills"]);
});

test("skills are read from their frontmatter, the nearest of a name kept", () => {
  const near = join(root, "near");
  const far = join(root, "far");
  const file = skill(near, "pdf", "name: pdf-tools\ndescription: >\n  Reads PDFs.\n  Use for reports.");
  skill(far, "pdf-tools", 'name: pdf-tools\ndescription: "the far one"');
  skill(far, "plain", "description: 'no name'");
  expect(findSkills([near, far, join(root, "none")])).toEqual([
    { name: "pdf-tools", description: "Reads PDFs. Use for reports.", file },
    { name: "plain", description: "no name", file: join(far, "plain", "SKILL.md") },
  ]);
});

test("a command an agent lists under a skill's name is the skill", () => {
  const commands = withSkills([{ name: "review" }, { name: "pdf" }], [{ name: "pdf", file: "/s/pdf/SKILL.md" }]);
  expect(commands).toEqual([{ name: "review" }, { name: "skill:pdf", skill: "/s/pdf/SKILL.md" }]);
});

test("a prompt that names a skill anywhere is sent with its instructions first, and reads back as typed", () => {
  const file = skill(join(root, "x"), "deploy", "name: deploy\ndescription: Ships it", "Run `make ship`.");
  const commands = [{ name: "skill:deploy", skill: file }, { name: "review" }];
  const typed = "fix the build then /skill:deploy please";
  expect(skillsNamed(typed, commands).map((c) => c.name)).toEqual(["skill:deploy"]);
  const sent = expandSkills(typed, commands);
  expect(sent).toBe(`<skill name="deploy" location="${file}">\nReferences are relative to ${join(root, "x", "deploy")}.\n\nRun \`make ship\`.\n</skill>\n\n${typed}`);
  expect(collapseSkills(sent)).toBe(typed);
  // Another command first stays first, so the agent runs it.
  expect(expandSkills("/review with /skill:deploy", commands).startsWith("/review with /skill:deploy\n\n<skill")).toBe(true);
  // A skill pi loaded itself (`/skill:deploy args`) reads back as that.
  expect(collapseSkills(`<skill name="deploy" location="${file}">\nbody\n</skill>\n\nship it`)).toBe("/skill:deploy ship it");
  expect(expandSkills("no skills here /tmp/x", commands)).toBe("no skills here /tmp/x");
});

test("a picture that is only a file is sent with its bytes", () => {
  const path = join(root, "dot.png");
  writeFileSync(path, Buffer.from([137, 80, 78, 71]));
  expect(withBytes([{ mimeType: "image/png", uri: path }])).toEqual([{ mimeType: "image/png", uri: path, data: "iVBORw==" }]);
  expect(withBytes([{ mimeType: "image/png", uri: join(root, "gone.png") }])).toEqual([{ mimeType: "image/png", uri: join(root, "gone.png") }]);
});
