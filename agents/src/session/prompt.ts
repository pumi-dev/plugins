// What a prompt carries to the agent beyond its text, in a session tab's host: the skills it names
// and the pictures' bytes. A skill (`SKILL.md`, the Agent Skills format) is found in the agent's
// own folders (`skillFolders`), or named by the agent (pi's `get_commands`, Codex's `skills/list`);
// it is offered as a slash command with its file (`SlashCommand.skill`). A prompt that names one
// anywhere (`/skill:name`) is sent with the file's instructions before its text, as pi writes a
// skill it loads itself (`<skill name location>`), so `collapseSkills` reads it back the same way.
// A picture that is only a path is read, for an agent that takes bytes. No `import … from "pumi"`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";

import type { Image, SlashCommand } from "../conversation/model.ts";

/** A skill: its name, what it is for, and its `SKILL.md`. */
export interface Skill {
  name: string;
  description?: string;
  file: string;
}

/** The biggest `SKILL.md` read, and the biggest picture. */
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** The folders an agent finds its skills in, nearest first: the project's (from `cwd` up to the home folder or the root), then the user's. */
export function skillFolders(agent: "claude" | "codex", cwd: string, home = homedir()): string[] {
  const own = agent === "claude" ? [".claude/skills"] : [".agents/skills", ".codex/skills"];
  const out: string[] = [];
  for (let at = cwd; ; at = dirname(at)) {
    if (at === home) break;
    for (const each of own) out.push(join(at, each));
    if (dirname(at) === at) break;
  }
  const user = agent === "claude" ? [join(home, ".claude/skills")] : [join(home, ".agents/skills"), join(process.env.CODEX_HOME ?? join(home, ".codex"), "skills")];
  return [...new Set([...out, ...user])];
}

/** The skills in `folders` (each a folder with a `SKILL.md`), the first of each name kept. */
export function findSkills(folders: string[]): Skill[] {
  const out: Skill[] = [];
  for (const folder of folders) {
    let names: string[];
    try {
      names = readdirSync(folder).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const file = join(folder, name, "SKILL.md");
      const skill = readSkill(file, name);
      if (skill && !out.some((each) => each.name === skill.name)) out.push(skill);
    }
  }
  return out;
}

/** The skill `file` is, by its frontmatter (`name`, `description`), its folder's name without one; undefined when there is no such file. */
export function readSkill(file: string, fallback?: string): Skill | undefined {
  let text: string;
  try {
    if (!statSync(file).isFile()) return undefined;
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const front = frontmatter(text);
  const name = front.name ?? fallback ?? basenameOf(dirname(file));
  if (!/^[\w.-]+$/.test(name)) return undefined;
  return { name, ...(front.description ? { description: front.description } : {}), file };
}

/** A skill as the slash command that names it. */
export function skillCommand(skill: Skill): SlashCommand {
  return { name: `skill:${skill.name}`, ...(skill.description ? { description: skill.description } : {}), skill: skill.file };
}

/** `commands` with `skills` among them: a command of the same name as a skill is the skill (an agent that lists its skills as commands). */
export function withSkills(commands: SlashCommand[], skills: Skill[]): SlashCommand[] {
  const names = new Set(skills.map((skill) => skill.name));
  return [...commands.filter((command) => !names.has(command.name.replace(/^\//, ""))), ...skills.map(skillCommand)];
}

/** The `key: value` lines of a file's frontmatter, a folded or literal block (`>`, `|`) joined into one line. */
function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let at = 0; at < lines.length; at++) {
    const line = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[at]!);
    if (!line) continue;
    let value = line[2]!.trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (at + 1 < lines.length && (/^\s+\S/.test(lines[at + 1]!) || lines[at + 1]!.trim() === "")) block.push(lines[++at]!.trim());
      value = block.join(" ").trim();
    }
    out[line[1]!] = value.replace(/^(["'])([\s\S]*)\1$/, "$2");
  }
  return out;
}

/** What a file says after its frontmatter. */
function body(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function basenameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Each `/skill:name` in `text` that one of `commands` is the skill of, once each, in order. */
export function skillsNamed(text: string, commands: SlashCommand[]): SlashCommand[] {
  const out: SlashCommand[] = [];
  for (const match of text.matchAll(/(?:^|\s)\/(skill:[\w.:-]+)/g)) {
    const command = commands.find((each) => each.skill && each.name.replace(/^\//, "") === match[1]);
    if (command && !out.includes(command)) out.push(command);
  }
  return out;
}

/** A skill's instructions as pi gives them to the model: in a `<skill>` block that says where it is. */
export function skillBlock(name: string, file: string): string | undefined {
  try {
    if (statSync(file).size > MAX_SKILL_BYTES) return undefined;
    const text = readFileSync(file, "utf8");
    return `<skill name="${name}" location="${file}">\nReferences are relative to ${dirname(file)}.\n\n${body(text)}\n</skill>`;
  } catch {
    return undefined;
  }
}

/**
 * What the agent is sent for `text`: the instructions of each skill it names, then the text as it
 * was written (its `/skill:name` kept, where the user put it). A text that starts with another
 * command keeps it first, so the agent still runs it. Text that names no skill is itself.
 */
export function expandSkills(text: string, commands: SlashCommand[]): string {
  const blocks = skillsNamed(text, commands).flatMap((command) => {
    const block = skillBlock(command.name.replace(/^\/?skill:/, ""), command.skill!);
    return block ? [block] : [];
  });
  if (blocks.length === 0) return text;
  return (/^\/(?!skill:)\S/.test(text) ? [text, ...blocks] : [...blocks, text]).join("\n\n");
}

/** `images` with the bytes of each that is only a local file read in (one that cannot be read stays as it was). */
export function withBytes(images: Image[]): Image[] {
  return images.map((image) => {
    if (image.data || !image.uri || /^(https?|data):/i.test(image.uri)) return image;
    const path = image.uri.replace(/^file:\/\//, "");
    try {
      if (!existsSync(path) || statSync(path).size > MAX_IMAGE_BYTES) return image;
      return { ...image, mimeType: image.mimeType || mimeOf(path), data: readFileSync(path).toString("base64") };
    } catch {
      return image;
    }
  });
}

function mimeOf(path: string): string {
  const ext = extname(path).slice(1).toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
}
