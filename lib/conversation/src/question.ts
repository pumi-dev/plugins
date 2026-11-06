// A tool call that asks the user questions (Claude's `AskUserQuestion`, pi's `ask_user_question`,
// any whose input is `{questions: [{question, options}]}`), read for the chat to draw as questions
// rather than a call: what is asked, the choices, and what the user answered once the result says.
// No `import … from "pumi"` here.
import type { Tool } from "./model.ts";

export interface QuestionOption {
  label: string;
  description?: string;
  /** Text to show beside it (a mockup, a snippet). */
  preview?: string;
}

export interface Question {
  question: string;
  /** Its short tag (`Auth method`). */
  header?: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

/** What the user answered, by the question's text; absent while it is not answered. */
export type Answers = Map<string, string>;

const NAMES = new Set(["askuserquestion", "ask_user_question", "ask_user", "askuser", "request_user_input"]);

/** The questions a call asks, when it is a call that asks some. */
export function questionsOf(tool: Tool): Question[] | undefined {
  const input = tool.input && typeof tool.input === "object" ? (tool.input as Record<string, unknown>) : undefined;
  const raw = input?.questions;
  if (!Array.isArray(raw)) return undefined;
  const named = NAMES.has(tool.title.toLowerCase().replace(/^.*:\s*/, ""));
  const out: Question[] = [];
  for (const each of raw) {
    if (!each || typeof each !== "object") continue;
    const q = each as Record<string, unknown>;
    const question = typeof q.question === "string" ? q.question : undefined;
    if (!question) continue;
    const options = Array.isArray(q.options)
      ? q.options.flatMap((option): QuestionOption[] => {
          if (typeof option === "string") return [{ label: option }];
          if (!option || typeof option !== "object") return [];
          const o = option as Record<string, unknown>;
          const label = typeof o.label === "string" ? o.label : undefined;
          if (!label) return [];
          return [{ label, ...(typeof o.description === "string" && o.description ? { description: o.description } : {}), ...(typeof o.preview === "string" && o.preview ? { preview: o.preview } : {}) }];
        })
      : [];
    out.push({ question, ...(typeof q.header === "string" && q.header ? { header: q.header } : {}), multiSelect: q.multiSelect === true, options });
  }
  // A call of another name that happens to take `questions` must look like these to count.
  if (out.length === 0 || (!named && out.every((q) => q.options.length === 0))) return undefined;
  return out;
}

/**
 * The answers a question call's result gives: `"question"="answer"` pairs, as Claude Code and pi's
 * ask-user tool both write them (`User has answered your questions: "Q"="A". …`).
 */
export function answersOf(tool: Tool): Answers {
  const answers: Answers = new Map();
  if (tool.status !== "completed") return answers;
  const text = tool.content.map((part) => (part.type === "text" ? part.text : part.type === "terminal" ? part.output : "")).join("\n");
  const pair = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = pair.exec(text); m; m = pair.exec(text)) answers.set(unescape(m[1]!), unescape(m[2]!));
  return answers;
}

function unescape(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

/** Whether the option `label` is (one of) the answer `answer`: a multi-select answer joins them with `, `. */
export function picked(answer: string | undefined, label: string): boolean {
  if (answer === undefined) return false;
  if (answer === label) return true;
  return answer.split(/,\s*/).includes(label);
}

/** How a question call ended, in words, when the user did not answer it. */
export function questionOutcome(tool: Tool, answers: Answers): string | undefined {
  if (tool.status === "running" || tool.status === "pending") return undefined;
  if (tool.status === "canceled") return "Stopped before it was answered";
  if (tool.status === "failed") return "Not answered";
  if (answers.size === 0) {
    const text = tool.content.map((part) => (part.type === "text" ? part.text : "")).join(" ");
    return /declin|cancel|dismiss|skip/i.test(text) ? "Dismissed" : undefined;
  }
  return undefined;
}
