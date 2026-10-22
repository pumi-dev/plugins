// tmux's command language: a line becomes commands, each a name with its arguments, quoted or not
// (`split-window -h ; select-pane -L`, `bind x { kill-pane ; display hi }`), with `%if` blocks,
// `NAME=value`, `# comments`, `$VAR` and `~` (pumi-lang's `cmd::parse`, ported).
//
//   const list = parseStr("new-window -n 'a b' ; split-window -h", noEnv);
//   printList(list);   // the same line again
import { ApiError } from "pumi";

/** An argument: a word, or `{ … }`'s commands. */
export type Arg = string | Command[];

/** One command: its name, its arguments and the line it was on. */
export interface Command {
  name: string;
  args: Arg[];
  line: number;
}

/** A command of words only (`new-window`, `-n`, `a b`). */
export function newCommand(name: string, args: string[] = []): Command {
  return { name, args: args.map((arg) => arg), line: 0 };
}

/** An argument's text: a word as it is, a block printed again as commands. */
export function argText(arg: Arg): string {
  return typeof arg === "string" ? arg : printList(arg);
}

/** An argument's commands: a block as it is, a word parsed. */
export function argCommands(arg: Arg, env: Env): Command[] {
  return typeof arg === "string" ? parseStr(arg, env) : arg;
}

/** What the language reads from outside itself: `$VAR`, `NAME=value`, `%if`. */
export interface Env {
  var(name: string): string | undefined;
  setVar(name: string, value: string, hidden: boolean): void;
  condition(format: string): boolean;
}

/** The environment a command line has outside the server: the process's, and nothing else. */
export const noEnv: Env = {
  var: (name) => process.env[name],
  setVar: () => {},
  condition: () => false,
};

function invalid(message: string): ApiError {
  return new ApiError("invalid_params", message);
}

type Tok =
  | { kind: "newline" }
  | { kind: "semi" }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "word"; text: string }
  | { kind: "assign"; text: string }
  | { kind: "format"; text: string }
  | { kind: "if" }
  | { kind: "elif" }
  | { kind: "else" }
  | { kind: "endif" }
  | { kind: "hidden" }
  | { kind: "eof" };

class Lexer {
  private pos = 0;
  line = 0;
  private condition = false;

  constructor(
    private readonly chars: string[],
    readonly env: Env,
  ) {}

  error(message: string): ApiError {
    return invalid(`line ${this.line}: ${message}`);
  }

  private getc(): string | undefined {
    for (;;) {
      const ch = this.chars[this.pos];
      if (ch === undefined) return undefined;
      this.pos += 1;
      if (ch === "\\" && this.chars[this.pos] === "\n") {
        this.pos += 1;
        this.line += 1;
        continue;
      }
      return ch;
    }
  }

  private ungetc(ch: string | undefined): void {
    if (ch === undefined) return;
    this.pos -= 1;
    if (this.chars[this.pos] === "\n" && this.pos > 0 && this.chars[this.pos - 1] === "\\") this.pos -= 1;
  }

  next(): Tok {
    const condition = this.condition;
    this.condition = false;
    for (;;) {
      const ch = this.getc();
      if (ch === undefined) return { kind: "eof" };
      switch (ch) {
        case " ":
        case "\t":
        case "\r":
          continue;
        case "\n":
          this.line += 1;
          return { kind: "newline" };
        case ";":
          return { kind: "semi" };
        case "{":
          return { kind: "open" };
        case "}":
          return { kind: "close" };
        case "#": {
          let at = this.getc();
          if (condition && at === "{") return { kind: "format", text: this.format() };
          while (at !== undefined && at !== "\n") at = this.getc();
          if (at === "\n") {
            this.line += 1;
            return { kind: "newline" };
          }
          continue;
        }
        case "%": {
          let word = "%";
          // Every branch below returns or throws; the loop goes on for a `%%` word only.
          void 0;
          for (;;) {
            const c = this.getc();
            if (c !== undefined && !" \t\n".includes(c)) word += c;
            else {
              this.ungetc(c);
              break;
            }
          }
          if ([...word].every((c) => c === "%" || (c >= "0" && c <= "9"))) return { kind: "word", text: word };
          this.condition = true;
          switch (word) {
            case "%hidden":
              return { kind: "hidden" };
            case "%if":
              return { kind: "if" };
            case "%elif":
              return { kind: "elif" };
            case "%else":
              return { kind: "else" };
            case "%endif":
              return { kind: "endif" };
            default:
              throw this.error(`unknown directive ${word}`);
          }
          break;
        }
        default: {
          const word = this.token(ch);
          return isAssignment(word) ? { kind: "assign", text: word } : { kind: "word", text: word };
        }
      }
    }
  }

  /** `#{…}` after `%if`, its braces counted, to its own `}`. */
  private format(): string {
    let buf = "#{";
    let depth = 1;
    for (;;) {
      const ch = this.getc();
      if (ch === undefined || ch === "\n") throw this.error("unterminated format");
      if (ch === "#") {
        const next = this.getc();
        if (next === undefined || next === "\n") throw this.error("unterminated format");
        if (next === "{") depth += 1;
        buf += "#" + next;
        continue;
      }
      buf += ch;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) return buf;
      }
    }
  }

  private token(first: string): string {
    type State = "none" | "double" | "single";
    let state: State = "none";
    let buf = "";
    let atStart = true;
    let ch: string | undefined = first;
    while (ch !== undefined) {
      const c = ch;
      if (state === "none" && (c === "\n" || c === " " || c === "\t" || c === ";" || c === "}")) break;
      if (c === "\n") {
        this.line += 1;
        buf += "\n";
        let n = this.getc();
        while (n === " " || n === "\t") n = this.getc();
        if (n === "#") {
          const after = this.getc();
          if (after !== undefined && ",#{}:".includes(after)) this.ungetc(after);
          else {
            let skip = after;
            while (skip !== undefined && skip !== "\n") skip = this.getc();
            ch = this.getc();
            continue;
          }
        }
        ch = n;
        continue;
      }
      if (c === "\\" && state !== "single") {
        buf += this.escape();
        ch = this.getc();
        atStart = false;
        continue;
      }
      if (c === "~" && atStart && state !== "single") {
        buf += this.tilde();
        ch = this.getc();
        atStart = false;
        continue;
      }
      if (c === "$" && state !== "single") {
        buf += this.variable();
        ch = this.getc();
        atStart = false;
        continue;
      }
      if (c === "'") state = state === "none" ? "single" : state === "single" ? "none" : state;
      else if (c === '"') state = state === "none" ? "double" : state === "double" ? "none" : state;
      else {
        buf += c;
        atStart = false;
        ch = this.getc();
        continue;
      }
      atStart = state !== "none" && buf === "";
      ch = this.getc();
    }
    if (state !== "none") throw this.error("unterminated quote");
    this.ungetc(ch);
    return buf;
  }

  /** What `\x` means: its character, an octal or a `\u`/`\U` code point. */
  private escape(): string {
    const ch = this.getc();
    if (ch === undefined) return "";
    const octal = (c: string): number | undefined => (c >= "0" && c <= "7" ? c.charCodeAt(0) - 48 : undefined);
    let out: string;
    if (octal(ch) !== undefined) {
      const a = octal(ch)!;
      const b = this.getc();
      const c = this.getc();
      const bd = b === undefined ? undefined : octal(b);
      const cd = c === undefined ? undefined : octal(c);
      if (bd === undefined || cd === undefined) throw this.error("invalid octal escape");
      out = String.fromCodePoint(a * 64 + bd * 8 + cd);
    } else if (ch >= "8" && ch <= "9") {
      throw this.error("invalid octal escape");
    } else
      switch (ch) {
        case "a":
          out = "\x07";
          break;
        case "b":
          out = "\b";
          break;
        case "e":
          out = "\x1b";
          break;
        case "f":
          out = "\f";
          break;
        case "s":
          out = " ";
          break;
        case "v":
          out = "\v";
          break;
        case "r":
          out = "\r";
          break;
        case "n":
          out = "\n";
          break;
        case "t":
          out = "\t";
          break;
        case "u":
        case "U": {
          const size = ch === "u" ? 4 : 8;
          let hex = "";
          for (let i = 0; i < size; i++) {
            const h = this.getc();
            if (h === undefined || !/[0-9a-fA-F]/.test(h)) throw this.error(`invalid \\${ch} argument`);
            hex += h;
          }
          const code = parseInt(hex, 16);
          if (Number.isNaN(code) || code > 0x10ffff) throw this.error(`invalid \\${ch} argument`);
          out = String.fromCodePoint(code);
          break;
        }
        default:
          out = ch;
      }
    return out;
  }

  /** `$NAME` or `${NAME}`, as the environment has it. */
  private variable(): string {
    const first = this.getc();
    if (first === undefined) return "$";
    const braces = first === "{";
    let name = "";
    if (!braces) {
      if (!isVar(first, true)) {
        this.ungetc(first);
        return "$";
      }
      name += first;
    }
    for (;;) {
      const ch = this.getc();
      if (ch === undefined) {
        if (braces) throw this.error("invalid environment variable");
        break;
      }
      if (braces && ch === "}") break;
      if (isVar(ch, false)) name += ch;
      else {
        if (braces) throw this.error("invalid environment variable");
        this.ungetc(ch);
        break;
      }
    }
    return this.env.var(name) ?? "";
  }

  /** `~` or `~user`, as the environment's home. */
  private tilde(): string {
    let user = "";
    for (;;) {
      const ch = this.getc();
      if (ch === undefined || "/ \t\n\"'".includes(ch)) {
        this.ungetc(ch);
        break;
      }
      user += ch;
    }
    // This machine's home, for `~` and for the user who is running the app; another user's is
    // not one this process can look up, and the Rust said so too (`home_of`, wasm).
    const me = process.env.USER ?? process.env.LOGNAME ?? "";
    const mine = user === "" || user === "~" || me === "" || me === user;
    const home = mine ? this.env.var("HOME") || undefined : undefined;
    if (home === undefined) throw this.error(`no home directory for ~${user}`);
    return home;
  }
}

function isVar(ch: string, first: boolean): boolean {
  if (ch === "=" || (first && ch >= "0" && ch <= "9")) return false;
  return /[0-9A-Za-z_]/.test(ch);
}

function isAssignment(word: string): boolean {
  const at = word.indexOf("=");
  if (at < 0) return false;
  const name = word.slice(0, at);
  if (name === "") return false;
  return [...name].every((c, i) => isVar(c, i === 0));
}

class Parser {
  private peeked: Tok | undefined;

  constructor(private readonly lexer: Lexer) {}

  private peek(): Tok {
    if (this.peeked === undefined) this.peeked = this.lexer.next();
    return this.peeked;
  }

  take(): Tok {
    const tok = this.peeked;
    this.peeked = undefined;
    return tok ?? this.lexer.next();
  }

  statements(inBlock: boolean): Command[] {
    const out: Command[] = [];
    for (;;) {
      const tok = this.peek();
      switch (tok.kind) {
        case "eof":
          if (inBlock) throw this.lexer.error("missing }");
          return out;
        case "close":
          if (inBlock) return out;
          break;
        case "newline":
        case "semi":
          this.take();
          continue;
        case "elif":
        case "else":
        case "endif":
          return out;
      }
      out.push(...this.statement(inBlock));
    }
  }

  private statement(inBlock: boolean): Command[] {
    const tok = this.peek();
    switch (tok.kind) {
      case "hidden": {
        this.take();
        const next = this.take();
        if (next.kind !== "assign") throw this.lexer.error("%hidden needs NAME=value");
        this.assign(next.text, true);
        return [];
      }
      case "assign":
        this.take();
        this.assign(tok.text, false);
        return [];
      case "if":
        return this.condition(inBlock);
      default:
        return this.commands();
    }
  }

  private assign(word: string, hidden: boolean): void {
    const at = word.indexOf("=");
    this.lexer.env.setVar(word.slice(0, at), word.slice(at + 1), hidden);
  }

  private conditionValue(): boolean {
    const tok = this.take();
    if (tok.kind !== "format" && tok.kind !== "word") throw this.lexer.error("%if needs a format");
    return this.lexer.env.condition(tok.text);
  }

  private condition(inBlock: boolean): Command[] {
    this.take();
    let taken: Command[] | undefined;
    let truth = this.conditionValue();
    for (;;) {
      const body = this.statements(inBlock);
      if (truth && taken === undefined) taken = body;
      const tok = this.take();
      switch (tok.kind) {
        case "elif":
          truth = this.conditionValue();
          continue;
        case "else":
          truth = true;
          continue;
        case "endif":
          return taken ?? [];
        default:
          throw this.lexer.error("missing %endif");
      }
    }
  }

  private commands(): Command[] {
    const out: Command[] = [];
    for (;;) {
      const tok = this.peek();
      switch (tok.kind) {
        case "word":
        case "assign":
          out.push(this.command());
          continue;
        case "if":
          out.push(...this.condition(false));
          continue;
        case "semi":
          this.take();
          continue;
        default:
          return out;
      }
    }
  }

  private command(): Command {
    const line = this.lexer.line + 1;
    const tok = this.take();
    if (tok.kind !== "word" && tok.kind !== "assign") throw this.lexer.error("expected a command");
    const args: Arg[] = [];
    for (;;) {
      const next = this.peek();
      switch (next.kind) {
        case "word":
        case "assign":
        case "format":
          this.take();
          args.push(next.text);
          continue;
        case "open": {
          this.take();
          const list = this.statements(true);
          if (this.take().kind !== "close") throw this.lexer.error("missing }");
          args.push(list);
          continue;
        }
        default:
          return { name: tok.text, args, line };
      }
    }
  }
}

/** A line, or a file, as commands. */
export function parseStr(text: string, env: Env = noEnv): Command[] {
  const parser = new Parser(new Lexer([...text], env));
  const list = parser.statements(false);
  const tok = parser.take();
  if (tok.kind === "eof") return list;
  if (tok.kind === "close") throw new ApiError("invalid_params", "unexpected }");
  throw new ApiError("invalid_params", "%elif, %else or %endif without %if");
}

/** A shell's words, as commands: `;` between them, `{ … }` a block. */
export function parseArgv(argv: string[]): Command[] {
  const pos = { at: 0 };
  const list = argvList(argv, pos, false);
  if (pos.at < argv.length) throw invalid("unexpected }");
  return list;
}

function argvList(argv: string[], pos: { at: number }, inBlock: boolean): Command[] {
  const out: Command[] = [];
  let current: Arg[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const [name, ...args] = current;
    if (typeof name !== "string") throw invalid("a command cannot start with {");
    out.push({ name, args, line: 0 });
    current = [];
  };
  while (pos.at < argv.length) {
    const word = argv[pos.at];
    pos.at += 1;
    if (word === "{") {
      current.push(argvList(argv, pos, true));
      continue;
    }
    if (word === "}" && inBlock) {
      flush();
      return out;
    }
    let text = word;
    let end = false;
    if (text.endsWith(";")) {
      text = text.slice(0, -1);
      if (text.endsWith("\\")) text = text.slice(0, -1) + ";";
      else end = true;
    }
    if (!end || text !== "") current.push(text);
    if (end) flush();
  }
  if (inBlock) throw invalid("missing }");
  flush();
  return out;
}

/** A word as the language writes it: bare when it can be. */
export function quote(word: string): string {
  if (word !== "" && ![...word].some((c) => " \t\n;{}\"'\\$#~%".includes(c))) return word;
  if (word.includes("'") || word.includes("\n")) {
    let out = '"';
    for (const c of word) {
      if (c === '"' || c === "\\" || c === "$") out += "\\" + c;
      else if (c === "\n") out += "\\n";
      else if (c === "\t") out += "\\t";
      else out += c;
    }
    return out + '"';
  }
  return `'${word}'`;
}

/** A command as a line. */
export function print(command: Command): string {
  let out = quote(command.name);
  for (const arg of command.args) {
    out += " ";
    out += typeof arg === "string" ? quote(arg) : `{ ${printList(arg)} }`;
  }
  return out;
}

/** Commands as a line, ` ; ` between them. */
export function printList(list: Command[]): string {
  return list.map(print).join(" ; ");
}
