// What the agent asks the user. A call that asks questions (`question.ts`) is drawn as them: each
// question, its tag, its choices with what they mean, and — once answered — the choice taken. While
// it waits, the card says so and offers the place to answer (the agent's own screen). A request pumi
// holds (`Permission`, a permission or a question) is drawn with a button per answer, and a field
// when a question takes words.
import { useState } from "react";
import { Icon, useMetrics, useTheme } from "pumi";

import { answerHint } from "../keys.ts";
import { allows, type Permission, type PermissionOption, type Tool } from "../model.ts";
import { answersOf, picked, questionOutcome, questionsOf, type Question } from "../question.ts";
import { Inline, Mono } from "./markdown.tsx";
import { keepTyping, OwnClicks, Press } from "./press.tsx";
import { tint, useTextTheme, useType } from "./style.ts";

export interface QuestionCardProps {
  tool: Tool;
  /** Whether the agent waits on it now. */
  waiting?: boolean;
  /** Where to answer it while it waits (the agent's terminal); without, the card only says it waits. */
  onAnswerElsewhere?(): void;
  /** What `onAnswerElsewhere`'s button says. */
  elsewhereLabel?: string;
  onLink?(url: string): void;
}

/** A call that asks questions, drawn as the questions. */
export function QuestionCard({ tool, waiting = false, onAnswerElsewhere, elsewhereLabel = "Answer in the terminal", onLink }: QuestionCardProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const questions = questionsOf(tool) ?? [];
  const answers = answersOf(tool);
  const outcome = questionOutcome(tool, answers);
  const open = tool.status === "running" || tool.status === "pending";
  const live = open && waiting;
  const tone = live ? t["agent.blocked"] : answers.size > 0 ? t.success : t.faint;
  const state = live ? "Waiting for your answer" : open ? "Asked" : answers.size > 0 ? "Answered" : (outcome ?? "Closed");
  return (
    <div
      role="group"
      aria-label={`${questions.length === 1 ? "A question" : `${questions.length} questions`}: ${state}`}
      style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRadius: m.radius, borderWidth: 1, borderColor: live ? tint(tone, 0.7) : t.border, backgroundColor: live ? tint(tone, 0.06) : t.surface, overflow: "hidden" }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 10, paddingRight: 10, borderBottomWidth: 1, borderColor: t.border }}>
        <Icon name={live ? "status_alert" : answers.size > 0 ? "status_check" : "status_ring"} size={12} color={tone} />
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: type.small, fontWeight: 600, color: t.text, whiteSpace: "nowrap" }}>{questions.length === 1 ? "Question" : `${questions.length} questions`}</text>
        </div>
        <text style={{ fontSize: type.tiny, color: tone, whiteSpace: "nowrap" }}>{state}</text>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 10 }}>
        {questions.map((question, at) => (
          <QuestionView key={at} question={question} answer={answers.get(question.question)} onLink={onLink} />
        ))}
      </div>
      {live && onAnswerElsewhere ? (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }}>
          <Button label={elsewhereLabel} icon="terminal" primary onPress={onAnswerElsewhere} />
        </div>
      ) : null}
    </div>
  );
}

function QuestionView({ question, answer, onLink }: { question: Question; answer: string | undefined; onLink?(url: string): void }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const custom = answer !== undefined && !question.options.some((option) => picked(answer, option.label)) ? answer : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {question.header ? (
          <div style={{ display: "flex", paddingLeft: 6, paddingRight: 6, height: 18, alignItems: "center", borderRadius: m.radiusSmall, backgroundColor: tint(t.accent, 0.16) }}>
            <text style={{ fontSize: type.tiny, fontWeight: 600, color: t.accent, whiteSpace: "nowrap" }}>{question.header}</text>
          </div>
        ) : null}
        {question.multiSelect ? <text style={{ fontSize: type.tiny, color: t.faint }}>Choose any</text> : null}
      </div>
      <Inline text={question.question} size={type.body} line={type.bodyLine} color={t.text} weight={600} onLink={onLink} />
      <div role={question.multiSelect ? "group" : "radiogroup"} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {question.options.map((option, at) => {
          const on = picked(answer, option.label);
          const dim = answer !== undefined && !on;
          return (
            <div
              key={at}
              role={question.multiSelect ? "checkbox" : "radio"}
              aria-checked={on}
              aria-label={`${option.label}${option.description ? `: ${option.description}` : ""}`}
              style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: on ? tint(t.accent, 0.8) : t.border, backgroundColor: on ? tint(t.accent, 0.12) : t.editor, opacity: dim ? 0.6 : 1 }}
            >
              <div style={{ display: "flex", flexDirection: "row", gap: 8, minWidth: 0 }}>
                <div style={{ display: "flex", height: type.smallLine, alignItems: "center", flexShrink: 0 }}>
                  {on ? <Icon name="status_check" size={12} color={t.accent} /> : <text style={{ fontSize: type.tiny, fontFamily: type.mono, color: t.faint, lineHeight: type.smallLine }}>{`${at + 1}`}</text>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                  <Inline text={option.label} size={type.small} line={type.smallLine} color={t.text} weight={on ? 650 : 550} onLink={onLink} />
                  {option.description ? <Inline text={option.description} size={type.small} line={type.smallLine} color={t.muted} onLink={onLink} /> : null}
                </div>
              </div>
              {option.preview ? (
                <div style={{ display: "flex", borderRadius: m.radiusSmall, backgroundColor: t.surface, marginLeft: 20 }}>
                  <Mono text={option.preview} padding={8} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {custom !== undefined ? (
        <div style={{ display: "flex", flexDirection: "row", gap: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: tint(t.accent, 0.8), backgroundColor: tint(t.accent, 0.12) }}>
          <Icon name="person" size={12} color={t.accent} />
          <Inline text={custom} size={type.small} line={type.smallLine} color={t.text} onLink={onLink} />
        </div>
      ) : null}
    </div>
  );
}

export interface PermissionCardProps {
  permission: Permission;
  /** An answer was picked: an option's id, or (a question that takes words) `""` and the text. */
  onAnswer(permissionId: string, optionId: string, text?: string): void;
  /** Take keyboard focus on the first answer when it appears. */
  autoFocus?: boolean;
  /** Its answers take ⌃1 … ⌃9 (`keys.ts`): each says its key. */
  keys?: boolean;
}

/** A request the agent waits on: what it is about, and a button per answer (a field for words). */
export function PermissionCard({ permission, onAnswer, autoFocus = false, keys = false }: PermissionCardProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const text = useTextTheme();
  const [words, setWords] = useState("");
  const question = permission.kind === "question";
  const tone = t["agent.blocked"];
  const takesText = question && (permission.text === true || permission.options.length === 0);
  const sendWords = () => {
    const answer = words.trim();
    if (answer !== "") onAnswer(permission.id, "", answer);
  };
  return (
    <div
      role="alertdialog"
      aria-label={`${question ? "The agent asks" : "The agent asks to"}: ${permission.title}`}
      style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: m.radius, borderWidth: 1, borderColor: tint(tone, 0.7), backgroundColor: tint(tone, 0.07) }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <div style={{ display: "flex", height: type.bodyLine, alignItems: "center" }}>
          <Icon name={question ? "status_alert" : "lock"} size={13} color={tone} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
          <text style={{ fontSize: type.tiny, color: tone }}>{question ? "Question" : "Permission"}</text>
          <Inline text={permission.title} size={type.body} line={type.bodyLine} color={t.text} weight={600} />
        </div>
      </div>
      {permission.detail ? (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 180, overflow: "hidden", borderRadius: m.radiusSmall, backgroundColor: t.editor, borderWidth: 1, borderColor: t.border }}>
          <Mono text={permission.detail} color={t.muted} padding={8} />
        </div>
      ) : null}
      {permission.options.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {permission.options.map((option, at) => (
            <AnswerButton key={option.id} option={option} question={question} autoFocus={autoFocus && at === 0} hint={keys ? answerHint(at) : undefined} onPress={() => onAnswer(permission.id, option.id)} />
          ))}
        </div>
      ) : null}
      {takesText ? (
        <OwnClicks style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 6, padding: 4, paddingLeft: 8, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.editor }}>
          <textarea
            aria-label="Your answer"
            value={words}
            placeholder="Type your answer…"
            minRows={1}
            maxRows={6}
            theme={text}
            autoFocus={autoFocus && permission.options.length === 0}
            onChange={(e) => setWords(e.value ?? "")}
            onKeyDown={keepTyping}
            onSubmit={() => sendWords()}
            style={{ flexGrow: 1, minWidth: 0, fontSize: type.body, color: t.text, backgroundColor: "transparent" }}
          />
          <Button label="Answer" primary disabled={words.trim() === ""} onPress={sendWords} />
        </OwnClicks>
      ) : null}
    </div>
  );
}

function AnswerButton({ option, question, autoFocus, hint, onPress }: { option: PermissionOption; question: boolean; autoFocus: boolean; hint?: string; onPress(): void }) {
  const primary = !question && allows(option.kind);
  const danger = option.kind === "reject_once" || option.kind === "reject_always";
  return <Button label={option.label} primary={primary} danger={danger} autoFocus={autoFocus} onPress={onPress} icon={option.kind === "allow_always" ? "check" : undefined} hint={hint} />;
}

export interface ButtonProps {
  label: string;
  icon?: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Its key, drawn faint after the label (`⌃1`). */
  hint?: string;
  onPress(): void;
}

/** The chat's button: the accent when it is the one to press, else quiet. */
export function Button({ label, icon, primary = false, danger = false, disabled = false, autoFocus, hint, onPress }: ButtonProps) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  const fg = disabled ? t.faint : primary ? t.accentText : danger ? t.error : t.text;
  return (
    <Press
      aria-label={label}
      title={hint ? `${label} (${hint})` : undefined}
      autoFocus={autoFocus}
      disabled={disabled}
      onClick={onPress}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 26,
        flexShrink: 0,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: m.radiusSmall,
        borderWidth: primary ? 0 : 1,
        borderColor: t.border,
        cursor: disabled ? "default" : "pointer",
        backgroundColor: disabled ? t.active : primary ? t.accent : t.editor,
        hover: disabled ? {} : { backgroundColor: primary ? t.accent : t.hover, opacity: primary ? 0.9 : 1 },
        focusVisible: { outlineWidth: 2, outlineColor: t.accent, outlineOffset: 1 },
      }}
    >
      {icon ? <Icon name={icon} size={11} color={fg} /> : null}
      <text style={{ fontSize: type.small, fontWeight: primary ? 600 : 500, color: fg, whiteSpace: "nowrap" }}>{label}</text>
      {hint ? <text style={{ fontSize: type.tiny, fontFamily: type.mono, color: fg, opacity: 0.6, whiteSpace: "nowrap" }}>{hint}</text> : null}
    </Press>
  );
}
