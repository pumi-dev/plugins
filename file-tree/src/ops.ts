// What the panel does to the disk. Each operation is handed the project and
// what the user chose, and leaves the tree to be read again by the panel. A failure is said out
// loud rather than thrown: the panel reports it and stays where it was.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { clipboard, fs, on, workspace } from "pumi";
import * as git from "./git.ts";
import * as relpath from "./relpath.ts";

/** A move or a copy the panel was asked to make, within the project or into it. */
export interface Transfer {
  /** Where it comes from: a path on disk. */
  from: string;
  /** Where it goes, in the project. */
  to: string;
  /** A copy rather than a move, for a drop from outside the project. */
  copy: boolean;
}

/** Asks the user `body` and answers what they chose (`null` when it closed unanswered), waiting
 * for the request to close. */
async function ask(body: Record<string, unknown>): Promise<unknown> {
  const asked = await workspace.openRequest(body);
  const id = asked.id;
  return new Promise((resolve) => {
    const off = on("request.closed", { match: id }, (e) => {
      off();
      resolve((e.data as { answer?: unknown } | undefined)?.answer ?? null);
    });
  });
}

/** Says why an operation failed, and where — to the log, and to the user when there is an app. */
function failed(what: string, err: unknown): void {
  const why = err instanceof Error ? err.message : String(err);
  console.error(`file-tree: ${what}: ${why}`);
  // A test has no app to tell.
  workspace.openRequest({ kind: "notification", title: `File Tree: ${what}: ${why}`, level: "error" }).catch(() => {});
}

/** `rel` made in the project: an empty file, or a folder and everything above it. */
export function create(root: string, rel: string, isDir: boolean): void {
  const path = join(root, rel);
  try {
    if (isDir) mkdirSync(path, { recursive: true });
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "", { flag: "wx" });
    }
  } catch (err) {
    failed(`cannot create ${path}`, err);
  }
}

/** `from` moved to `to`, both in the project. */
export function rename(root: string, from: string, to: string): void {
  try {
    renameSync(join(root, from), join(root, to));
  } catch (err) {
    failed(`cannot move ${from} to ${to}`, err);
  }
}

/** `from` copied to `to`, both in the project, a directory with everything in it. */
export function copy(root: string, from: string, to: string): void {
  try {
    copyPath(join(root, from), join(root, to));
  } catch (err) {
    failed(`cannot copy ${from} to ${to}`, err);
  }
}

function copyPath(from: string, to: string): void {
  if (statSync(from).isDirectory()) cpSync(from, to, { recursive: true });
  else copyFileSync(from, to);
}

/** Each transfer made; one that cannot be does not stop the rest. */
export function drop(root: string, transfers: Transfer[]): void {
  for (const transfer of transfers) {
    const to = join(root, transfer.to);
    try {
      if (transfer.copy) {
        copyPath(transfer.from, to);
        continue;
      }
      if (existsSync(to)) {
        failed(`cannot move ${transfer.from} to ${transfer.to}`, new Error("the name is taken"));
        continue;
      }
      renameSync(transfer.from, to);
    } catch (err) {
      failed(`cannot move ${transfer.from} to ${transfer.to}`, err);
    }
  }
}

/** `rel` to the Trash, the system's own: it can be brought back. */
export async function trash(root: string, rel: string): Promise<void> {
  try {
    await fs.trash([join(root, rel)]);
  } catch (err) {
    failed(`cannot trash ${rel}`, err);
  }
}

/** `rel` deleted for good, once the user has said so. */
export async function remove(root: string, rel: string): Promise<void> {
  const path = join(root, rel);
  const answer = await ask({
    kind: "question",
    title: `Delete ${relpath.fileName(rel)}?`,
    detail: `${path} is deleted for good. It does not go to the Trash.`,
    options: ["Cancel", "Delete"],
  });
  if (answer !== "Delete") return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (err) {
    failed(`cannot delete ${rel}`, err);
  }
}

/** `text` on the clipboard: a path copied out of the tree. */
export async function putOnClipboard(text: string): Promise<void> {
  try {
    await clipboard.set(text);
  } catch (err) {
    failed("cannot copy to the clipboard", err);
  }
}

/** `rel` added to the project's `.gitignore`, or to the repository's `.git/info/exclude`. */
export function ignore(root: string, file: "gitignore" | "exclude", rel: string, isDir: boolean): void {
  let path: string;
  if (file === "gitignore") path = join(root, ".gitignore");
  else {
    const repository = git.repositoryRoot(root);
    if (repository === null) {
      failed("cannot add to .git/info/exclude", new Error("this project is in no repository"));
      return;
    }
    path = join(repository, ".git/info/exclude");
  }
  const pattern = isDir ? `${rel}/` : rel;
  try {
    appendPattern(path, pattern);
  } catch (err) {
    failed(`cannot add to ${path}`, err);
  }
}

/** `pattern` as a line of an ignore file, unless it is already one of them. */
export function appendPattern(path: string, pattern: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.split("\n").some((line) => line.trim() === pattern)) return;
  const next =
    existing === "" ? `${pattern}\n` : existing.endsWith("\n") ? `${existing}${pattern}\n` : `${existing}\n${pattern}\n`;
  writeFileSync(path, next);
}

/** `rel` shown in the Finder. */
export async function reveal(root: string, rel: string): Promise<void> {
  try {
    await fs.open((join(root, rel)), {reveal: true});
  } catch (err) {
    failed(`cannot reveal ${rel}`, err);
  }
}

/** `rel` opened by whatever app owns it, and not by an editor of the user's. */
export async function openWithSystem(root: string, rel: string): Promise<void> {
  try {
    await fs.open(join(root, rel));
  } catch (err) {
    failed(`cannot open ${rel}`, err);
  }
}
