// The composer a new flight is written in: a brief, the folder, and the agent that flies it. It is
// drawn over the board (the board itself is over the window), so filing one is two keystrokes from
// anywhere the board is open.
import { useState } from "react";
import { Icon, useMetrics, useTheme } from "pumi";

import { Press, tint } from "./kit.tsx";

export function Button({ label, kind = "ghost", onClick, disabled }: { label: string; kind?: "primary" | "ghost" | "danger"; onClick(): void; disabled?: boolean }) {
  const t = useTheme();
  const m = useMetrics();
  const colors =
    kind === "primary"
      ? { backgroundColor: t.accent, color: t.accentText, hover: { backgroundColor: tint(t.accent, 0.9) } }
      : kind === "danger"
        ? { backgroundColor: t.error, color: t.window, hover: { backgroundColor: tint(t.error, 0.9) } }
        : { backgroundColor: t.active, color: t.text, hover: { backgroundColor: t.hover } };
  return (
    <Press onClick={onClick} disabled={disabled} style={{ height: 26, paddingLeft: 12, paddingRight: 12, borderRadius: m.radiusSmall, ...colors }}>
      <text style={{ fontSize: m.fontSize - 1, fontWeight: 500, color: disabled ? t.faint : (colors as { color: string }).color, whiteSpace: "nowrap" }}>{label}</text>
    </Press>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange(value: string): void }) {
  const t = useTheme();
  const m = useMetrics();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, flexGrow: 1, minWidth: 0 }}>
      <text style={{ fontSize: m.fontSize - 3, color: t.faint }}>{label}</text>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 26, paddingLeft: 7, paddingRight: 7, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, backgroundColor: t.editor }}>
        <input
          value={value}
          placeholder={placeholder ?? ""}
          onChange={(e: any) => onChange(e?.value ?? "")}
          style={{ flexGrow: 1, minWidth: 0, fontSize: m.fontSize - 2, color: t.text }}
        />
      </div>
    </div>
  );
}

/** A brief being written: `launch` says whether the agent takes off as soon as it is filed. */
export function Composer({
  agentDefault,
  cwdDefault,
  onClose,
  onFile,
}: {
  agentDefault: string;
  cwdDefault: string;
  onClose(): void;
  onFile(input: { brief: string; cwd: string; agent: string; launch: boolean }): void;
}) {
  const t = useTheme();
  const m = useMetrics();
  const [brief, setBrief] = useState("");
  const [cwd, setCwd] = useState(cwdDefault);
  const [agent, setAgent] = useState("");
  const can = brief.trim() !== "";

  const file = (launch: boolean) => {
    if (!can) return;
    onFile({ brief, cwd: cwd.trim(), agent: agent.trim(), launch });
    setBrief("");
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tint(t.window, 0.55),
      }}
    >
      <div
        onClick={(e: any) => e?.stopPropagation?.()}
        style={{
          width: 560,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
          borderRadius: m.radius + 4,
          backgroundColor: t.surface,
          borderWidth: 1,
          borderColor: t.border,
          boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: tint("#000000", 0.5) },
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="zap" size={13} color={t.accent} />
          <text style={{ flexGrow: 1, fontSize: m.fontSize + 1, fontWeight: 600, color: t.text }}>New card</text>
          <text style={{ fontSize: m.fontSize - 3, color: t.faint }}>a brief, and the agent that takes it</text>
        </div>
        <textarea
          value={brief}
          autoFocus
          placeholder="What should the agent do? This is the first message it gets, so put the whole ask in it — the board keeps it and hands it over again if it has to fly a second time."
          minRows={4}
          maxRows={12}
          theme={{ bg: t.editor, border: t.border, text: t.text, textMuted: t.muted, textFaint: t.faint, accent: t.accent, caret: t.accent }}
          onChange={(e: any) => setBrief(e?.value ?? "")}
          onKeyDown={(e: any) => {
            const mod = e?.modifiers?.cmd === true || e?.modifiers?.ctrl === true;
            if (e?.key !== "enter" || !mod) return;
            e?.preventDefault?.();
            e?.stopPropagation?.();
            file(true);
          }}
          style={{ padding: 9, borderRadius: m.radiusSmall, borderWidth: 1, borderColor: t.border, fontSize: m.fontSize - 1, color: t.text, backgroundColor: t.editor }}
        />
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          <Field label="Folder" value={cwd} placeholder="pumi's own" onChange={setCwd} />
          <Field label="Agent" value={agent} placeholder={agentDefault || "pi"} onChange={setAgent} />
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <text style={{ flexGrow: 1, fontSize: m.fontSize - 3, color: t.faint }}>{"⌘ ↵ adds it and starts its agent behind the board"}</text>
          <Button label="Cancel" onClick={onClose} />
          <Button label="Add card" disabled={!can} onClick={() => file(false)} />
          <Button label="Add & start" kind="primary" disabled={!can} onClick={() => file(true)} />
        </div>
      </div>
    </div>
  );
}
