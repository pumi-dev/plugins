// The table's own menu, where it was pressed with the right button: a cell's (copy, edit, rows and
// columns in and out) or a column name's (sort, rename, columns in and out). Items are data, made
// when the menu opens, each with what it runs.
import { useMetrics, useTheme } from "pumi";

/** One thing the menu does. */
export interface MenuItem {
  label: string;
  /** The keys that do it too, as the menu shows them (`⌘C`). */
  keys?: string;
  disabled?: boolean;
  /** It takes something out: drawn as a warning. */
  danger?: boolean;
  run(): void;
}

/** An item, or `-` for the rule between groups. */
export type MenuEntry = MenuItem | "-";

/** Where a menu opens, in window px. */
export interface MenuAt {
  x: number;
  y: number;
}

export function Menu({ at, items, close }: { at: MenuAt; items: MenuEntry[]; close(): void }) {
  const t = useTheme();
  const m = useMetrics();
  // No rule first, last, or twice in a row: a group that has nothing to show leaves none.
  const shown = items.filter((item, i) => item !== "-" || (i > 0 && i < items.length - 1 && items[i - 1] !== "-"));
  return (
    <anchored position={at} fit="snap" snapMargin={8} deferred occlude onMouseDownOutside={close}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 200, padding: 4, borderRadius: m.radius, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}>
        {shown.map((item, i) =>
          item === "-" ? (
            <div key={`rule${i}`} style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: 6, marginRight: 6, backgroundColor: t.border }} />
          ) : (
            <div
              key={item.label}
              onClick={() => {
                if (item.disabled) return;
                close();
                item.run();
              }}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 16,
                height: 26,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: m.radiusSmall,
                cursor: item.disabled ? "default" : "pointer",
                hover: item.disabled ? undefined : { backgroundColor: t.hover },
              }}
            >
              <text style={{ flexGrow: 1, fontSize: 13, color: item.disabled ? t.faint : item.danger ? t.error : t.text, whiteSpace: "nowrap" }}>{item.label}</text>
              {item.keys ? <text style={{ fontSize: 12, color: t.faint, whiteSpace: "nowrap" }}>{item.keys}</text> : null}
            </div>
          ),
        )}
      </div>
    </anchored>
  );
}
