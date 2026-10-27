// The editor's keys: a keystroke as a chord (`alt+shift+left`), and what each chord does. Keys that
// type text are not here: they arrive from `<text-input>` as text, after their keystroke.
import type { Unit } from "./commands.ts";

export type Action =
  | { t: "move"; unit: Unit; forward: boolean; extend: boolean }
  | { t: "delete"; unit: "char" | "word" | "lineEdge"; forward: boolean }
  | {
      t:
        | "newline"
        | "blankLine"
        | "indent"
        | "outdent"
        | "undo"
        | "redo"
        | "selectAll"
        | "selectLine"
        | "selectNext"
        | "selectParent"
        | "cursorUp"
        | "cursorDown"
        | "toggleComment"
        | "moveLineUp"
        | "moveLineDown"
        | "copyLineUp"
        | "copyLineDown"
        | "deleteLine"
        | "matchingBracket"
        | "escape"
        | "copy"
        | "cut"
        | "paste"
        | "save";
    };

/** What a key event carries that a chord is made of. */
export interface Keystroke {
  key?: string;
  modifiers?: { ctrl?: boolean; alt?: boolean; shift?: boolean; cmd?: boolean };
}

/** Key names as the keymap spells them, for the few the platform spells as words. */
const KEY_NAMES: Record<string, string> = { slash: "/", backslash: "\\", minus: "-", equal: "=", bracketleft: "[", bracketright: "]" };

/** The keystroke as a chord: modifiers in one order (`ctrl`, `alt`, `shift`, `cmd`), then the key. */
export function chord(e: Keystroke): string {
  const m = e.modifiers ?? {};
  const key = (e.key ?? "").toLowerCase();
  return [m.ctrl && "ctrl", m.alt && "alt", m.shift && "shift", m.cmd && "cmd", KEY_NAMES[key] ?? key].filter(Boolean).join("+");
}

const mac = process.platform === "darwin";
/** The platform's command key (`cmd` on macOS, `ctrl` elsewhere), and the one that moves by word. */
const MOD = mac ? "cmd" : "ctrl";
const WORD = mac ? "alt" : "ctrl";

function order(spec: string): string {
  const parts = spec.split("+");
  const key = parts.pop()!;
  return chord({ key, modifiers: { ctrl: parts.includes("ctrl"), alt: parts.includes("alt"), shift: parts.includes("shift"), cmd: parts.includes("cmd") } });
}

function build(): Map<string, Action> {
  const map = new Map<string, Action>();
  const bind = (spec: string, action: Action) => map.set(order(spec.replace(/\bmod\b/g, MOD).replace(/\bword\b/g, WORD)), action);
  const moves: [string, Unit, boolean][] = [
    ["left", "char", false],
    ["right", "char", true],
    ["up", "line", false],
    ["down", "line", true],
    ["word+left", "word", false],
    ["word+right", "word", true],
    ["home", "lineEdge", false],
    ["end", "lineEdge", true],
    ["pageup", "page", false],
    ["pagedown", "page", true],
    ["mod+home", "docEdge", false],
    ["mod+end", "docEdge", true],
  ];
  if (mac) {
    moves.push(["cmd+left", "lineEdge", false], ["cmd+right", "lineEdge", true], ["cmd+up", "docEdge", false], ["cmd+down", "docEdge", true]);
    moves.push(["ctrl+a", "lineEdge", false], ["ctrl+e", "lineEdge", true], ["ctrl+b", "char", false], ["ctrl+f", "char", true], ["ctrl+p", "line", false], ["ctrl+n", "line", true]);
  }
  for (const [spec, unit, forward] of moves) {
    bind(spec, { t: "move", unit, forward, extend: false });
    bind(`shift+${spec}`, { t: "move", unit, forward, extend: true });
  }
  bind("backspace", { t: "delete", unit: "char", forward: false });
  bind("shift+backspace", { t: "delete", unit: "char", forward: false });
  bind("delete", { t: "delete", unit: "char", forward: true });
  bind("word+backspace", { t: "delete", unit: "word", forward: false });
  bind("word+delete", { t: "delete", unit: "word", forward: true });
  if (mac) {
    bind("cmd+backspace", { t: "delete", unit: "lineEdge", forward: false });
    bind("cmd+delete", { t: "delete", unit: "lineEdge", forward: true });
    bind("ctrl+h", { t: "delete", unit: "char", forward: false });
    bind("ctrl+d", { t: "delete", unit: "char", forward: true });
    bind("ctrl+k", { t: "delete", unit: "lineEdge", forward: true });
  }
  const plain: [string, Action["t"]][] = [
    ["enter", "newline"],
    ["shift+enter", "newline"],
    ["mod+enter", "blankLine"],
    ["tab", "indent"],
    ["shift+tab", "outdent"],
    ["mod+]", "indent"],
    ["mod+[", "outdent"],
    ["mod+z", "undo"],
    ["shift+mod+z", "redo"],
    ["mod+y", "redo"],
    ["mod+a", "selectAll"],
    ["mod+l", "selectLine"],
    ["mod+d", "selectNext"],
    ["ctrl+shift+up", "selectParent"],
    ["alt+mod+up", "cursorUp"],
    ["alt+mod+down", "cursorDown"],
    ["mod+/", "toggleComment"],
    ["alt+up", "moveLineUp"],
    ["alt+down", "moveLineDown"],
    ["shift+alt+up", "copyLineUp"],
    ["shift+alt+down", "copyLineDown"],
    ["shift+mod+k", "deleteLine"],
    ["shift+mod+\\", "matchingBracket"],
    ["escape", "escape"],
    ["mod+c", "copy"],
    ["mod+x", "cut"],
    ["mod+v", "paste"],
    ["mod+s", "save"],
  ];
  for (const [spec, t] of plain) bind(spec, { t } as Action);
  return map;
}

export const KEYMAP: ReadonlyMap<string, Action> = build();

/** What the keystroke does in the editor, or undefined for one it leaves to the window. */
export function actionFor(e: Keystroke): Action | undefined {
  return KEYMAP.get(chord(e));
}
