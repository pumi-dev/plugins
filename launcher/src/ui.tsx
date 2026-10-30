// The launcher's block (`pumi_dev.launcher.new`): a list of what to open in this tab, the same as
// the `+` menu's (the most used first), each with its key, the same letter as there. A press on a
// row, its key, or Enter on the one the arrows chose opens it in the list's place (`replace`, the
// same tab); Escape closes the tab.
import { Fragment, useMemo, useRef, useState } from "react";
import { Icon, useMetrics, useTextSize, useTheme, type RendererProps } from "pumi";
import * as kit from "pumi/theme";
import { call, useSlot, via } from "pumi/theme";
import { byLetter, fromSlot, kinds, type Kind, type NewTab, type Place, type SlotAction } from "./kinds.ts";

const swallow = (err: unknown) => console.error(`launcher: ${String((err as Error)?.message ?? err)}`);

/** Picks a file and opens it in `place`, from tab `at` (which names the server). */
async function openFile(at: string, place: Place) {
  const picked = await call(via(at, "fs.pick"), { kind: "file" });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (typeof path === "string" && path) await call(via(at, "tab.open"), "file", { path }, place);
}

/** The `+` menu's list; a pumi before `useNewTabs` has the `tab.new` slot's actions instead. */
const useNewTabs = (kit as { useNewTabs?: () => NewTab[] }).useNewTabs;
const useList: () => Kind[] = useNewTabs
  ? () => {
      const list = useNewTabs();
      return useMemo(() => kinds(list, openFile), [list]);
    }
  : () => {
      const { actions } = useSlot("tab.new");
      return useMemo(() => fromSlot(actions as SlotAction[], openFile), [actions]);
    };

export function New({ tab, focused }: RendererProps) {
  const id = tab.id;
  const ts = useTextSize();
  const t = useTheme();
  const m = useMetrics();
  const list = useList();
  const [chosen, setChosen] = useState(0);
  const opening = useRef(false);
  const pick = (k: Kind | undefined) => {
    if (!k || opening.current) return;
    opening.current = true;
    Promise.resolve(k.open(id, { kind: "tiled", replace: id }))
      .catch(swallow)
      .finally(() => (opening.current = false));
  };
  return (
    <div
      // Mounted again as the tab takes the focus, so the keys come here and not to the last one.
      key={focused ? "focused" : "unfocused"}
      autoFocus={focused}
      tabIndex={0}
      onMouseDown={() => {
        if (!focused) call(via(id, "tab.focus"), id).catch(swallow);
      }}
      onKeyDown={(e: any) => {
        const mods = e.modifiers ?? {};
        if (mods.cmd || mods.ctrl || mods.alt) return;
        const key = String(e.key ?? "").toLowerCase();
        const count = Math.max(list.length, 1);
        let handled = true;
        if (key === "up") setChosen((i) => (i + count - 1) % count);
        else if (key === "down") setChosen((i) => (i + 1) % count);
        else if (key === "enter") pick(list[chosen]);
        else if (key === "escape") call(via(id, "tab.close"), id).catch(swallow);
        else {
          const k = byLetter(list, key);
          if (k) pick(k);
          else handled = false;
        }
        if (handled) {
          e.preventDefault?.();
          e.stopPropagation?.();
        }
      }}
      style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, alignItems: "center", justifyContent: "center", padding: 24, overflowY: "scroll", keyboardFocusDim: false }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 360, gap: 2 }}>
        {list.map((k, i) => (
          <Fragment key={k.id}>
            {i > 0 && list[i - 1]!.group !== k.group ? <div style={{ height: 1, flexShrink: 0, marginTop: 6, marginBottom: 6, marginLeft: 10, marginRight: 10, backgroundColor: t.border }} /> : null}
            <div
              role="button"
              aria-label={k.title}
              onClick={() => pick(k)}
              onMouseEnter={() => setChosen(i)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                height: 34,
                flexShrink: 0,
                paddingLeft: 10,
                paddingRight: 8,
                borderRadius: m.radius,
                cursor: "pointer",
                backgroundColor: i === chosen ? t.hover : "transparent",
              }}
            >
              <Icon name={k.icon} size={16} color={t.text} />
              <text style={{ fontSize: ts(14), color: t.text, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{k.title}</text>
              <div style={{ flexGrow: 1, minWidth: 16 }} />
              {k.keys ? <text style={{ fontSize: ts(12), color: t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{k.keys}</text> : null}
              {k.letter ? (
                <div style={{ display: "flex", width: 22, height: 22, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: m.radiusSmall, backgroundColor: t.active }}>
                  <text style={{ fontSize: ts(12), color: t.muted }}>{k.letter}</text>
                </div>
              ) : null}
            </div>
          </Fragment>
        ))}
        {list.length === 1 ? (
          <text style={{ fontSize: ts(12), color: t.faint, paddingLeft: 10, paddingTop: 10 }}>Install plugins (Terminal, Browser, Agents…) to open more here.</text>
        ) : null}
      </div>
    </div>
  );
}
