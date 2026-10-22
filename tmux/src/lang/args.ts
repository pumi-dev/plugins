// tmux's flags: a command's template (`t:` takes a value, `t::` an optional one) read over the
// arguments a command line gave, the flags and the words after them (pumi-lang's `cmd::args`,
// ported).
//
//   const p = parse("t:h", 0, -1, COMMON_LONGS, ["-h", "-t3", "top"]);
//   p.has("h");   // true
//   p.get("t");   // "3"
//   p.words();    // ["top"]
import { ApiError } from "pumi";
import type { Arg } from "./parse.ts";

/** What a long option is: a switch, a value, or a short flag's other name. */
export type Long = { kind: "short"; flag: string } | { kind: "switch" } | { kind: "value" };

/** A command's arguments, read: its flags (in order, a value or none), its long options, and the
 *  words after them. */
export interface Parsed {
  flags: [flag: string, value: string | undefined][];
  long: Map<string, string | undefined>;
  args: Arg[];
}

/** The long options every command takes (`--target`, `--format`, `--json`, `--help`). */
export const COMMON_LONGS: [string, Long][] = [
  ["target", { kind: "short", flag: "t" }],
  ["format", { kind: "short", flag: "F" }],
  ["cwd", { kind: "short", flag: "c" }],
  ["json", { kind: "switch" }],
  ["help", { kind: "switch" }],
];

export function parsed(): Parsed {
  return { flags: [], long: new Map(), args: [] };
}

export function has(p: Parsed, flag: string): boolean {
  return p.flags.some(([f]) => f === flag);
}

export function count(p: Parsed, flag: string): number {
  return p.flags.filter(([f]) => f === flag).length;
}

/** The last value given to `flag`. */
export function get(p: Parsed, flag: string): string | undefined {
  for (let i = p.flags.length - 1; i >= 0; i--) if (p.flags[i][0] === flag) return p.flags[i][1];
  return undefined;
}

/** Every value given to `flag`, in order. */
export function all(p: Parsed, flag: string): string[] {
  return p.flags.filter(([f, v]) => f === flag && v !== undefined).map(([, v]) => v!);
}

export function long(p: Parsed, name: string): string | undefined {
  return p.long.get(name);
}

export function hasLong(p: Parsed, name: string): boolean {
  return p.long.has(name);
}

/** The `index`th word after the flags. */
export function arg(p: Parsed, index: number): string | undefined {
  const word = p.args[index];
  return typeof word === "string" ? word : undefined;
}

/** The words after the flags, blocks printed again. */
export function words(p: Parsed): string[] {
  return p.args.map((word) => (typeof word === "string" ? word : word.map((c) => c.name).join(" ; ")));
}

/** The flags, long options and arguments as data (`pumi_parse_cmd`'s shape). */
export function toValue(p: Parsed): { flags: Record<string, unknown>; long: Record<string, unknown>; args: Arg[] } {
  const flags: Record<string, unknown> = {};
  for (const [flag, value] of p.flags) {
    const was = flags[flag];
    if (value === undefined) {
      flags[flag] = was === undefined ? true : typeof was === "number" ? was + 1 : was === true ? 2 : [was, true];
    } else if (was === undefined) {
      flags[flag] = value;
    } else if (Array.isArray(was)) {
      flags[flag] = [...was, value];
    } else {
      flags[flag] = [was, value];
    }
  }
  const longs: Record<string, unknown> = {};
  for (const [name, value] of p.long) longs[name] = value === undefined ? true : value;
  return { flags, long: longs, args: p.args };
}

/** Reads a command's arguments against its template, giving its flags, long options and words. */
export function parse(
  template: string,
  min: number,
  max: number,
  longs: [string, Long][],
  args: Arg[],
): Parsed {
  const p = parsed();
  const lookup = (flag: string): [takes: boolean, optional: boolean] | undefined => {
    const at = template.indexOf(flag);
    if (at < 0) return undefined;
    const rest = template.slice(at + flag.length);
    return [rest.startsWith(":"), rest.startsWith("::")];
  };
  let i = 0;
  while (i < args.length) {
    const word = args[i];
    if (typeof word !== "string") break;
    if (word === "--") {
      i += 1;
      break;
    }
    if (word.startsWith("--")) {
      const body = word.slice(2);
      const at = body.indexOf("=");
      const name = at < 0 ? body : body.slice(0, at);
      const inline = at < 0 ? undefined : body.slice(at + 1);
      const found = longs.find(([n]) => n === name);
      if (found === undefined) throw new ApiError("invalid_params", `unknown option --${name}`);
      const kind = found[1];
      i += 1;
      if (kind.kind === "switch") {
        if (inline !== undefined) throw new ApiError("invalid_params", `--${name} takes no value`);
        p.long.set(name, undefined);
      } else if (kind.kind === "value") {
        let value = inline;
        if (value === undefined) {
          const next = args[i];
          if (typeof next !== "string") throw new ApiError("invalid_params", `--${name} expects an argument`);
          value = next;
          i += 1;
        }
        p.long.set(name, value);
      } else {
        const [takes] = lookup(kind.flag) ?? [false, false];
        if (!takes) {
          p.flags.push([kind.flag, undefined]);
          continue;
        }
        let value: string;
        if (inline !== undefined) value = inline;
        else {
          const next = args[i];
          if (next === undefined) throw new ApiError("invalid_params", `--${name} expects an argument`);
          if (typeof next !== "string") throw new ApiError("invalid_params", `--${name} expects a word`);
          value = next;
          i += 1;
        }
        p.flags.push([kind.flag, value]);
      }
      continue;
    }
    if (!word.startsWith("-") || word === "-") break;
    const cluster = word.slice(1);
    i += 1;
    const chars = [...cluster];
    let at = 0;
    while (at < chars.length) {
      const flag = chars[at];
      at += 1;
      if (!/[0-9A-Za-z]/.test(flag)) throw new ApiError("invalid_params", `invalid flag -${flag}`);
      const found = lookup(flag);
      if (found === undefined) throw new ApiError("invalid_params", `unknown flag -${flag}`);
      const [takes, optional] = found;
      if (!takes) {
        p.flags.push([flag, undefined]);
        continue;
      }
      const rest = chars.slice(at).join("");
      if (rest !== "") {
        p.flags.push([flag, rest]);
        break;
      }
      const next = args[i];
      if (next === undefined) {
        if (optional) p.flags.push([flag, undefined]);
        else throw new ApiError("invalid_params", `-${flag} expects an argument`);
      } else if (
        optional &&
        typeof next === "string" &&
        next.startsWith("-") &&
        next.length > 1 &&
        (next[1] === "-" || /[A-Za-z]/.test(next[1]))
      ) {
        p.flags.push([flag, undefined]);
      } else {
        p.flags.push([flag, typeof next === "string" ? next : undefined]);
        i += 1;
      }
      break;
    }
  }
  p.args = args.slice(i);
  const n = p.args.length;
  if (n < min || (max >= 0 && n > max)) {
    throw new ApiError("invalid_params", arity(min, max));
  }
  return p;
}

/** Why the arguments were neither too few nor too many. */
function arity(min: number, max: number): string {
  const s = (n: number) => (n === 1 ? "" : "s");
  if (max === 0) return "takes no arguments";
  if (max < 0) return `needs at least ${min} argument${s(min)}`;
  if (min === max) return `needs ${min} argument${s(min)}`;
  return `needs ${min} to ${max} arguments`;
}
