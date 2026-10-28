// A call that asks the user: its questions, and the answers its result gives.
import { expect, test } from "bun:test";

import type { Tool } from "../../src/conversation/model.ts";
import { answersOf, picked, questionOutcome, questionsOf } from "../../src/conversation/question.ts";

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
