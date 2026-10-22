// tmux's command language, on its own: quoting, `;` command lists, `{ }` blocks, `%if`, and the
// words a shell splits.
import { expect, test } from "bun:test";
import { argText, print, printList, parseArgv, parseStr, quote, type Arg, type Command, type Env } from "../src/lang/parse.ts";

/** An environment of named variables; `%if` is true when its format says `yes`. */
function vars(init: Record<string, string> = {}): Env & { all: Map<string, string> } {
  const all = new Map(Object.entries(init));
  return {
    all,
    var: (name) => all.get(name),
    setVar: (name, value) => all.set(name, value),
    condition: (format) => format.includes("yes"),
  };
}

/** Each command as its words, a block its commands' text. */
function words(list: Command[]): string[][] {
  return list.map((c) => [c.name, ...c.args.map((a) => argText(a))]);
}

test("the language", () => {
  const env = vars();
  const text =
    'X=1\nnew-window -n "a $X" ; split-window -h # comment\nbind x { kill-pane ; display hi }\n' +
    "%if '#{yes}'\nset -g @a 'it''s'\n%else\nset -g @a no\n%endif\nsend-keys foo\\; bar";
  const list = parseStr(text, env);
  expect(words(list)).toEqual([
    ["new-window", "-n", "a 1"],
    ["split-window", "-h"],
    ["bind", "x", "kill-pane ; display hi"],
    ["set", "-g", "@a", "its"],
    ["send-keys", "foo;", "bar"],
  ]);
});

test("a shell's words are commands, and its `{ }` a block", () => {
  const list = parseArgv(["new-tab", ";", "split-pane", "-h;", "send-keys", "a\\;", "{", "x", "}"]);
  expect(list.length).toBe(3);
  expect(list[2].args[0] as Arg).toBe("a;");
  const block = list[2].args[1] as Command[];
  expect(block[0].name).toBe("x");
  expect(quote("it's here")).toBe('"it\'s here"');
  expect(print(list[1])).toBe("split-pane -h");
});

test("variables and a home directory are the environment's", () => {
  const env = vars({ HOME: "/home/amr", NAME: "amr" });
  expect(words(parseStr("echo $NAME ${NAME}x", env))).toEqual([["echo", "amrx", "amrx"]]);
  expect(words(parseStr("cd ~/src", env))).toEqual([["cd", "/home/amr/src"]]);
  expect(() => parseStr("cd ~nobody", vars({ HOME: "/home/amr" }))).toThrow("no home directory for ~nobody");
});

test("escapes are characters", () => {
  const list = parseStr('display "a\\tb" \\u00e9 \\101', vars());
  expect(words(list)).toEqual([["display", "a\tb", "é", "A"]]);
  expect(() => parseStr('display "unterminated', vars())).toThrow("unterminated quote");
});

test("%if takes the branch that is true, and its name=value lines set variables", () => {
  const env = vars();
  const list = parseStr("%if '#{no}'\nset -g @a no\n%elif '#{yes}'\nset -g @a yes\n%endif", env);
  expect(words(list)).toEqual([["set", "-g", "@a", "yes"]]);
  const assigned = vars();
  parseStr("A=1\n%hidden B=2", assigned);
  expect([...assigned.all]).toEqual([
    ["A", "1"],
    ["B", "2"],
  ]);
});

test("a command line prints again as itself", () => {
  const list: Command[] = [
    { name: "new-window", args: ["-n", "a b"], line: 1 },
    { name: "bind", args: ["x", [{ name: "kill-pane", args: [], line: 0 }]], line: 2 },
  ];
  expect(printList(list)).toBe("new-window -n 'a b' ; bind x { kill-pane }");
  expect(parseStr(printList(list), vars())).toEqual([
    { name: "new-window", args: ["-n", "a b"], line: 1 },
    { name: "bind", args: ["x", [{ name: "kill-pane", args: [], line: 1 }]], line: 2 },
  ]);
});

test("a line that does not end its block says so", () => {
  expect(() => parseStr("bind x { kill-pane", vars())).toThrow("missing }");
  expect(() => parseStr("}", vars())).toThrow("unexpected }");
  expect(() => parseStr("%endif", vars())).toThrow("%elif, %else or %endif without %if");
});
