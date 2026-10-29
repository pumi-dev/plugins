// The chat's keys, as words: which keystroke does what, and the prompts ↑ brings back. The chat's
// drawing (`ui.tsx`, `ui/composer.tsx`) asks these; no `import … from "pumi"` here.
//
//   Esc            stop the agent while it works (a list, an edit, a picture shown close first)
//   ↑ / ↓          in an empty prompt: the prompts sent before, newest first, and back
//   ⌃1 … ⌃9        answer the request waiting with its first … ninth answer
//   a letter       typed while the focus is elsewhere in the chat goes into the prompt
import type { Entry } from "./model.ts";

/** A keystroke as the window gives it (`KeyEvent`): its key's name and its modifiers. */
export interface Keystroke {
  /** `"a"`, `"1"`, `"escape"`, `"up"`, `"space"`. */
  key: string;
  /** What it types, when it types something. */
  keyChar?: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  cmd: boolean;
  /** A repeat, the key held down. */
  held: boolean;
}

/** A `KeyEvent`'s keystroke. */
export function keystrokeOf(event: unknown): Keystroke {
  const e = (event ?? {}) as { key?: unknown; keyChar?: unknown; modifiers?: Partial<Record<"ctrl" | "alt" | "shift" | "cmd", unknown>> | null; isHeld?: unknown };
  const m = e.modifiers ?? {};
  return {
    key: typeof e.key === "string" ? e.key.toLowerCase() : "",
    ...(typeof e.keyChar === "string" && e.keyChar !== "" ? { keyChar: e.keyChar } : {}),
    ctrl: m.ctrl === true,
    alt: m.alt === true,
    shift: m.shift === true,
    cmd: m.cmd === true,
    held: e.isHeld === true,
  };
}

/** What a keystroke does in the chat, wherever in it the focus is. */
export type ChatKey = { type: "stop" } | { type: "answer"; index: number } | { type: "type"; text: string };

/** What the chat is doing, as far as its keys care. */
export interface ChatKeyState {
  /** The agent works, or waits on an answer: Esc stops it. */
  working: boolean;
  /** How many answers the request waiting first offers (0: none waits). */
  answers: number;
}

/**
 * The keystroke's meaning in the chat, or nothing when it is not the chat's. A field of the chat's
 * keeps the text typed in it (`keepTyping`), so text that gets here was typed elsewhere in the chat.
 */
export function chatKey(k: Keystroke, state: ChatKeyState): ChatKey | undefined {
  const plain = !k.ctrl && !k.alt && !k.cmd;
  if (k.key === "escape" && plain && !k.shift) return state.working ? { type: "stop" } : undefined;
  // ⌃ and a digit types nothing in a field, and no key of the window's is on it.
  if (k.ctrl && !k.alt && !k.cmd && !k.shift && /^[1-9]$/.test(k.key)) {
    const index = Number(k.key) - 1;
    return index < state.answers ? { type: "answer", index } : undefined;
  }
  // Text typed with the focus on a button of the chat's goes to the prompt.
  if (!k.ctrl && !k.cmd) {
    const text = k.key === "space" ? " " : k.keyChar;
    if (text !== undefined && [...text].length === 1 && text >= " ") return { type: "type", text };
  }
  return undefined;
}

/** What ⌃ and a digit look like, for a hint: `⌃1`. */
export function answerHint(index: number): string | undefined {
  return index >= 0 && index < 9 ? `⌃${index + 1}` : undefined;
}

// ── Bringing a prompt back ────────────────────────────────────────────────────────────────────

/** The prompts the user sent, oldest first, one where the same was sent twice in a row. */
export function sentPrompts(entries: Entry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const text = entry.kind === "user" ? entry.text?.trim() : undefined;
    if (text && out.at(-1) !== text) out.push(text);
  }
  return out;
}

/** Where ↑ is among the prompts sent: the index of the one shown, or `null` while none is. */
export type RecallAt = number | null;

/** Whether the draft is the prompt ↑ brought back, untouched: ↑ and ↓ go on through them. */
export function recalling(prompts: string[], at: RecallAt, draft: string): boolean {
  return at !== null && prompts[at] === draft;
}

/** Whether ↑ or ↓ brings a prompt back now, rather than moving the caret. */
export function recallTakes(direction: "up" | "down", prompts: string[], at: RecallAt, draft: string): boolean {
  if (recalling(prompts, at, draft)) return true;
  return direction === "up" && draft === "" && prompts.length > 0;
}

/**
 * One step through the prompts sent: ↑ to the one before (from an empty draft, the newest), ↓ to
 * the one after, and past the newest back to an empty draft. Nothing when there is nowhere to go.
 */
export function stepRecall(prompts: string[], at: RecallAt, draft: string, direction: "up" | "down"): { at: RecallAt; draft: string } | undefined {
  const now = recalling(prompts, at, draft) ? at : null;
  if (direction === "up") {
    if (now === null) return draft === "" && prompts.length > 0 ? { at: prompts.length - 1, draft: prompts.at(-1)! } : undefined;
    return now > 0 ? { at: now - 1, draft: prompts[now - 1]! } : undefined;
  }
  if (now === null) return undefined;
  return now < prompts.length - 1 ? { at: now + 1, draft: prompts[now + 1]! } : { at: null, draft: "" };
}
