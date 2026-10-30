// A call that asks the user: its questions, and the answers its result gives.
import { expect, test } from "bun:test";

import type { Entry, Permission, Tool } from "../../src/conversation/model.ts";
import { askedInCards, askingOf, answersOf, picked, questionOutcome, questionsOf } from "../../src/conversation/question.ts";

const input = {
  questions: [
    { question: "Which key?", header: "Prefix", multiSelect: false, options: [{ label: "ctrl+a", description: "Classic" }, { label: "ctrl+b" }] },
    { question: "Which parts?", header: "Parts", multiSelect: true, options: [{ label: "A" }, { label: "B" }, { label: "C" }] },
  ],
};

const call = (over: Partial<Tool> = {}): Tool => ({ id: "t1", kind: "other", title: "AskUserQuestion", status: "running", input, content: [], ...over });

test("the questions of a call that asks", () => {
  expect(questionsOf(call())).toEqual([
    { question: "Which key?", header: "Prefix", multiSelect: false, options: [{ label: "ctrl+a", description: "Classic" }, { label: "ctrl+b" }] },
    { question: "Which parts?", header: "Parts", multiSelect: true, options: [{ label: "A" }, { label: "B" }, { label: "C" }] },
  ]);
  expect(questionsOf(call({ title: "ask_user_question" }))?.length).toBe(2);
  expect(questionsOf(call({ title: "Bash", input: { command: "ls" } }))).toBeUndefined();
});

test("the answers, as Claude Code and pi write them", () => {
  const text = 'User has answered your questions: "Which key?"="ctrl+a", "Which parts?"="A, C". You can now continue.';
  const answers = answersOf(call({ status: "completed", content: [{ type: "text", text }] }));
  expect([...answers]).toEqual([
    ["Which key?", "ctrl+a"],
    ["Which parts?", "A, C"],
  ]);
  expect(picked(answers.get("Which parts?"), "C")).toBe(true);
  expect(picked(answers.get("Which parts?"), "B")).toBe(false);
  expect(answersOf(call({ content: [{ type: "text", text }] })).size).toBe(0);
});

test("a question left unanswered says how it ended", () => {
  expect(questionOutcome(call({ status: "failed" }), new Map())).toBe("Not answered");
  expect(questionOutcome(call({ status: "completed", content: [{ type: "text", text: "User declined to answer questions" }] }), new Map())).toBe("Dismissed");
  expect(questionOutcome(call(), new Map())).toBeUndefined();
});

// pi's ask-user tool in RPC mode: a select per question, `N. label — description` and a last row for one's own words.
const piSelect: Permission = {
  id: "p1",
  kind: "question",
  title: "[Prefix] Which key?",
  options: [
    { id: "0", label: "1. ctrl+a — Classic", kind: "other" },
    { id: "1", label: "2. ctrl+b", kind: "other" },
    { id: "2", label: "3. Type something.", kind: "other" },
  ],
};

test("a request that asks a call's question is the card's: each choice its option, and a field for words", () => {
  expect(askingOf(call(), piSelect)).toEqual({ permission: piSelect, question: 0, choices: ["0", "1"], words: true });
  // Codex's: the labels as they are, no words.
  const codex: Permission = { id: "p2", kind: "question", title: "Which key?", options: [{ id: "0", label: "ctrl+a", kind: "other" }, { id: "1", label: "ctrl+b", kind: "other" }] };
  expect(askingOf(call(), codex)).toMatchObject({ question: 0, choices: ["0", "1"], words: false });
  // pi's multi-select is a field: no choice is an option, each is sent as words.
  const multi: Permission = { id: "p3", kind: "question", title: "[Parts] Which parts?\n\n1. A\n2. B\n3. C\n\nEnter the numbers", text: true, options: [{ id: "send", label: "Send", kind: "other" }] };
  expect(askingOf(call(), multi)).toMatchObject({ question: 1, choices: [undefined, undefined, undefined], words: true });
});

test("a request that is not one of its questions stays the chat's", () => {
  expect(askingOf(call(), { ...piSelect, title: "Something else?" })).toBeUndefined();
  expect(askingOf(call(), { ...piSelect, kind: "permission" })).toBeUndefined();
  expect(askingOf(call({ status: "completed" }), piSelect)).toBeUndefined();
  // A choice the request does not offer, and no words to send it as.
  expect(askingOf(call(), { id: "p4", kind: "question", title: "Which key?", options: [{ id: "0", label: "ctrl+a", kind: "other" }] })).toBeUndefined();
});

test("the cards that answer the requests waiting: the latest open call that asks each", () => {
  const entry = (id: string, tool: Tool): Entry => ({ id, kind: "tool", at: 0, tool });
  const entries = [entry("e1", call({ id: "old", status: "completed" })), entry("e2", call({ id: "now" }))];
  const asking = askedInCards(entries, [piSelect, { id: "p9", title: "Run ls?", options: [{ id: "allow", label: "Allow", kind: "allow_once" }] }]);
  expect([...asking.keys()]).toEqual(["now"]);
  expect(asking.get("now")?.permission.id).toBe("p1");
  expect(askedInCards(entries, []).size).toBe(0);
});
