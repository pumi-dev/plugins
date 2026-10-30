// A tool call that asks the user questions (Claude's `AskUserQuestion`, pi's `ask_user_question`,
// any whose input is `{questions: [{question, options}]}`), read for the chat to draw as questions
// rather than a call: what is asked, the choices, and what the user answered once the result says.
// No `import … from "pumi"` here.
import type { Entry, Permission, Tool } from "./model.ts";

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

// ── Answered in the card ─────────────────────────────────────────────────────────────────────
//
// A producer that asks the call's questions itself puts each up as a request (`Permission`, kind
// `question`): pi's ask-user tool, in RPC mode, as a `select` of `N. label — description` lines and a
// last `Type something.`, or an `input` for a multi-select; Codex as a request of the labels. Such a
// request is the card's to answer, so the chat does not draw it again under the timeline.

/** A request waiting that asks one of a call's questions: the card answers it. */
export interface Asking {
  permission: Permission;
  /** Which of the call's questions it asks. */
  question: number;
  /** The request's option each of that question's choices is; none: the choice goes as words. */
  choices: (string | undefined)[];
  /** It takes the user's own words (`""` and the text): a field. */
  words: boolean;
}

/** The request `permission` as one of `tool`'s questions, when it asks one of them and each choice can be sent. */
export function askingOf(tool: Tool, permission: Permission): Asking | undefined {
  if (permission.kind !== "question" || (tool.status !== "running" && tool.status !== "pending")) return undefined;
  const questions = questionsOf(tool);
  if (!questions) return undefined;
  let question = questions.findIndex((q) => permission.title.includes(q.question));
  if (question < 0 && permission.toolId === tool.id && questions.length === 1) question = 0;
  if (question < 0) return undefined;
  const used = new Set<string>();
  const choices = questions[question]!.options.map((option) => {
    const hit = permission.options.find((each) => !used.has(each.id) && sameChoice(each.label, option.label));
    if (hit) used.add(hit.id);
    return hit?.id;
  });
  // An option left over beside the choices is the way to one's own words (pi's `Type something.`).
  const words = permission.text === true || (choices.some((id) => id !== undefined) && permission.options.some((each) => !used.has(each.id)));
  if (!words && choices.some((id) => id === undefined)) return undefined;
  return { permission, question, choices, words };
}

/** Whether a request's option is the choice `label`: the same, or as pi writes it, `2. label — what it means`. */
function sameChoice(option: string, label: string): boolean {
  const bare = option.replace(/^\s*\d+[.)]\s+/, "").trim();
  return bare === label || bare.startsWith(`${label} — `);
}

/** The requests waiting that the open question calls answer, by the call's id (the latest call that asks it). */
export function askedInCards(entries: Entry[], permissions: Permission[]): Map<string, Asking> {
  const out = new Map<string, Asking>();
  const asks = permissions.filter((each) => each.kind === "question");
  if (asks.length === 0) return out;
  for (let at = entries.length - 1; at >= 0 && out.size < asks.length; at--) {
    const tool = entries[at]!.kind === "tool" ? entries[at]!.tool : undefined;
    if (!tool || (tool.status !== "running" && tool.status !== "pending") || out.has(tool.id)) continue;
    for (const permission of asks) {
      if ([...out.values()].some((each) => each.permission.id === permission.id)) continue;
      const asking = askingOf(tool, permission);
      if (asking) {
        out.set(tool.id, asking);
        break;
      }
    }
  }
  return out;
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
