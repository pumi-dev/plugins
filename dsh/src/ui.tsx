/**
 * What a DSH pane draws: the harness agent's conversation — the person's prompts, the assistant's
 * replies, each tool call with its result — and, under it, the box that sends the next prompt.
 *
 * The worker owns the conversation (`src/main.ts`); this file folds what it posts on the pane's
 * channel and calls its exports. Every message it hears is the whole snapshot, so a pane that
 * mounts late draws the same thing as one that was open all along.
 */
import { useEffect, useRef, useState } from "react"
import { useChannel, useMetrics, useTheme, type ElementRef, type RendererProps } from "pumi"

import type { Snapshot } from "./harness.ts"
import { answer, attach, restart, send, snapshot as read, stop } from "./main.ts"

/** One pane. */
export function Chat({ tab, focused }: RendererProps) {
  const theme = useTheme()
  const metrics = useMetrics()
  const live = useChannel<Snapshot | null>(`chat/${tab.id}`, null)
  const [pulled, setPulled] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const scroller = useRef<ElementRef>(null)
  const state = live ?? pulled

  // The agent starts when the pane first draws; what it already has is read once, for a remount.
  useEffect(() => {
    let mounted = true
    void attach()
      .then(() => read())
      .then((now) => {
        if (mounted && now !== null) setPulled(now)
      })
      .catch((error: unknown) => console.error(`pumi-dsh: ${error instanceof Error ? error.message : String(error)}`))
    return () => {
      mounted = false
    }
  }, [tab.id])

  // Follow the tail while the conversation grows.
  const rows = state?.rows.length ?? 0
  useEffect(() => {
    scroller.current?.scrollTo?.(0, -1e9)
  }, [rows, state?.approval?.id])

  const status = state?.status ?? "starting"
  const running = status === "running"

  const submit = () => {
    const text = draft.trim()
    if (text === "" || busy) return
    setDraft("")
    setBusy(true)
    void send(text)
      .catch((error: unknown) => console.error(`pumi-dsh: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setBusy(false))
  }

  return (
    <div
      style={{
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.surface,
        color: theme.text,
        fontSize: metrics.fontSize,
        opacity: focused ? 1 : 0.98,
      }}
    >
      <Header state={state} status={status} theme={theme} radius={metrics.radiusSmall} />
      <div
        ref={scroller}
        style={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: "scroll",
          scrollbarColor: theme.faint,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingTop: 12,
          paddingRight: 14,
          paddingBottom: 12,
          paddingLeft: 14,
        }}
      >
        {state === null ? (
          <text style={{ color: theme.muted }}>Starting the harness…</text>
        ) : state.rows.length === 0 ? (
          <Empty state={state} theme={theme} />
        ) : (
          state.rows.map((row) => <Row row={row} key={row.id} theme={theme} metrics={metrics} />)
        )}
        {state?.approval ? (
          <Approval
            approval={state.approval}
            theme={theme}
            radius={metrics.radiusSmall}
            onDecide={(outcome) => answer(state.approval!.id, outcome)}
          />
        ) : null}
        {running ? <text style={{ color: theme.muted, fontSize: metrics.fontSize - 1 }}>Working…</text> : null}
      </div>
      <Composer
        draft={draft}
        running={running}
        stopped={status === "stopped" || status === "failed"}
        theme={theme}
        radius={metrics.radiusSmall}
        onChange={setDraft}
        onSubmit={submit}
        onStop={() => stop()}
        onRestart={() => {
          setBusy(true)
          void restart().finally(() => setBusy(false))
        }}
      />
    </div>
  )
}

/** The bar above the conversation: what this pane is, and whether it is working. */
function Header({
  state,
  status,
  theme,
  radius,
}: {
  state: Snapshot | null
  status: string
  theme: ReturnType<typeof useTheme>
  radius: number
}) {
  const dot = status === "running" ? theme["status.working"] : status === "failed" ? theme.error : status === "stopped" ? theme.faint : theme.success
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingTop: 8,
        paddingRight: 14,
        paddingBottom: 8,
        paddingLeft: 14,
        borderBottomWidth: 1,
        borderColor: theme.border,
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <text style={{ fontWeight: 600 }} title={state?.sessionId ?? ""}>
        {state?.title ?? "DeepSeek Harness"}
      </text>
      <div style={{ flexGrow: 1 }} />
      {state === null ? null : (
        <text style={{ color: theme.faint, fontSize: 11 }}>
          {`${state.provider}/${state.model}`}
          {state.permission !== null ? ` · ${state.permission}` : ""}
          {state.sandbox !== null ? ` · ${state.sandbox}` : ""}
        </text>
      )}
      <div
        style={{
          paddingTop: 2,
          paddingRight: 6,
          paddingBottom: 2,
          paddingLeft: 6,
          borderRadius: radius,
          backgroundColor: theme.hover,
          color: theme.muted,
          fontSize: 11,
        }}
      >
        <text>{state?.cwd ?? ""}</text>
      </div>
    </div>
  )
}

/** What a pane with no conversation says. */
function Empty({ state, theme }: { state: Snapshot; theme: ReturnType<typeof useTheme> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <text style={{ color: theme.muted }}>A DeepSeek Harness agent, in this pane.</text>
      <text style={{ color: theme.faint, fontSize: 11 }}>
        {`It runs in ${state.cwd} with its own tools, sandbox and plugins.`}
      </text>
      {state.error === null ? null : <text style={{ color: theme.error, fontSize: 11 }}>{state.error}</text>}
    </div>
  )
}

/** One row of the conversation. */
function Row({
  row,
  theme,
  metrics,
}: {
  row: Snapshot["rows"][number]
  theme: ReturnType<typeof useTheme>
  metrics: ReturnType<typeof useMetrics>
}) {
  if (row.kind === "user") {
    return (
      <div
        style={{
          alignSelf: "flex-end",
          maxWidth: "86%",
          paddingTop: 6,
          paddingRight: 10,
          paddingBottom: 6,
          paddingLeft: 10,
          borderRadius: metrics.radiusSmall,
          backgroundColor: theme.selected,
        }}
      >
        <text style={{ color: theme.text }}>{row.text}</text>
      </div>
    )
  }
  if (row.kind === "tool") {
    const tone = row.state === "error" ? theme.error : row.state === "running" ? theme["status.working"] : theme.muted
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <text style={{ color: tone, fontWeight: 600, fontSize: metrics.fontSize - 1 }}>{row.name ?? "tool"}</text>
          <text style={{ color: theme.faint, fontSize: 11 }}>
            {row.state === "running" ? "running…" : row.state === "error" ? "failed" : "done"}
          </text>
        </div>
        {row.text.trim() === "" ? null : (
          <div
            style={{
              paddingTop: 6,
              paddingRight: 8,
              paddingBottom: 6,
              paddingLeft: 8,
              borderRadius: metrics.radiusSmall,
              backgroundColor: theme.editor,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <text style={{ color: theme.muted, fontSize: 11 }}>{row.text}</text>
          </div>
        )}
      </div>
    )
  }
  if (row.kind === "error") {
    return <text style={{ color: theme.error, fontSize: metrics.fontSize - 1 }}>{row.text}</text>
  }
  if (row.kind === "note") {
    return <text style={{ color: theme.faint, fontSize: 11, fontStyle: "italic" }}>{row.text}</text>
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <text style={{ color: theme.text }}>{row.text}</text>
    </div>
  )
}

/** A tool waiting for the person's decision. */
function Approval({
  approval,
  theme,
  radius,
  onDecide,
}: {
  approval: NonNullable<Snapshot["approval"]>
  theme: ReturnType<typeof useTheme>
  radius: number
  onDecide: (outcome: "allowed-once" | "rejected") => void
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: radius,
        backgroundColor: theme.overlay,
        borderWidth: 1,
        borderColor: theme.warning,
      }}
    >
      <text style={{ color: theme.text, fontWeight: 600 }}>{`Allow ${approval.toolName} once?`}</text>
      {approval.reason === undefined ? null : <text style={{ color: theme.muted, fontSize: 11 }}>{approval.reason}</text>}
      <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
        <Button label="Allow once" tone={theme.accent} text={theme.accentText} radius={radius} onPress={() => onDecide("allowed-once")} />
        <Button label="Reject" tone={theme.hover} text={theme.text} radius={radius} onPress={() => onDecide("rejected")} />
      </div>
    </div>
  )
}

/** The box the next prompt is typed into. */
function Composer({
  draft,
  running,
  stopped,
  theme,
  radius,
  onChange,
  onSubmit,
  onStop,
  onRestart,
}: {
  draft: string
  running: boolean
  stopped: boolean
  theme: ReturnType<typeof useTheme>
  radius: number
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  onRestart: () => void
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
        paddingTop: 8,
        paddingRight: 14,
        paddingBottom: 10,
        paddingLeft: 14,
        borderTopWidth: 1,
        borderColor: theme.border,
      }}
    >
      <div
        style={{
          flexGrow: 1,
          minWidth: 0,
          paddingTop: 6,
          paddingRight: 8,
          paddingBottom: 6,
          paddingLeft: 8,
          borderRadius: radius,
          backgroundColor: theme.editor,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <textarea
          value={draft}
          minRows={1}
          maxRows={8}
          placeholder={stopped ? "The agent stopped; restart it to continue" : "Ask the harness anything…"}
          autoFocus
          onChange={(event: any) => onChange(String(event?.value ?? ""))}
          onSubmit={() => onSubmit()}
          style={{ backgroundColor: "transparent", color: theme.text, fontSize: 13 }}
        />
      </div>
      {running ? (
        <Button label="Stop" tone={theme.hover} text={theme.text} radius={radius} onPress={onStop} />
      ) : stopped ? (
        <Button label="Restart" tone={theme.accent} text={theme.accentText} radius={radius} onPress={onRestart} />
      ) : (
        <Button label="Send" tone={theme.accent} text={theme.accentText} radius={radius} onPress={onSubmit} />
      )}
    </div>
  )
}

/** A clickable label, in the theme's own colours. */
function Button({
  label,
  tone,
  text,
  radius,
  onPress,
}: {
  label: string
  tone: string
  text: string
  radius: number
  onPress: () => void
}) {
  return (
    <div
      onClick={onPress}
      style={{
        flexShrink: 0,
        paddingTop: 6,
        paddingRight: 12,
        paddingBottom: 6,
        paddingLeft: 12,
        borderRadius: radius,
        backgroundColor: tone,
        hover: { opacity: 0.85 },
        active: { opacity: 0.7 },
      }}
    >
      <text style={{ color: text, fontWeight: 600, fontSize: 12 }}>{label}</text>
    </div>
  )
}
