// A press: a `div` that acts like a button. The SDK used to give a `Button`; it does not any
// more, so this is the same thing built from an element: the `button` role (or the one a list
// wants, `option`), a tab stop, pressed by a click, Enter or Space.
import type { ReactNode } from "react";
import type { EventPayload, KeyEvent, StyleDesc } from "pumi";

export interface PressProps {
  onClick?(event: EventPayload): void;
  onMouseEnter?(event: EventPayload): void;
  /** Whether it takes the press. A disabled press is out of the Tab order, unless it stays focusable. */
  disabled?: boolean;
  /** Keep a disabled press in the Tab order (it still takes no press). */
  focusableWhenDisabled?: boolean;
  autoFocus?: boolean;
  tabIndex?: number;
  /** Its role: `button` without one, `option` in a listbox. */
  role?: string;
  /** The tooltip. */
  title?: string;
  "aria-label"?: string;
  "aria-selected"?: boolean;
  "aria-expanded"?: boolean;
  style?: StyleDesc;
  children?: ReactNode;
}

/** `onClick`, unless it is disabled; Enter presses it on key down, Space on key up, as a browser does. */
export function Press({ onClick, onMouseEnter, disabled = false, focusableWhenDisabled = false, autoFocus, tabIndex, role, title, style, children, ...aria }: PressProps) {
  const press = (event: EventPayload) => {
    if (!disabled) onClick?.(event);
  };
  return (
    <div
      {...aria}
      role={role ?? "button"}
      title={title}
      autoFocus={autoFocus}
      tabIndex={disabled && !focusableWhenDisabled ? -1 : (tabIndex ?? 0)}
      onClick={press}
      onMouseEnter={onMouseEnter}
      onKeyDown={(event: KeyEvent) => {
        if (disabled) return;
        if (event.key === "enter" && !event.isHeld) press(event as unknown as EventPayload);
        // Space would otherwise scroll the list it is in; it fires on release.
        if (event.key === "space") event.preventDefault();
      }}
      onKeyUp={(event: KeyEvent) => {
        if (!disabled && event.key === "space") press(event as unknown as EventPayload);
      }}
      style={style}
    >
      {children}
    </div>
  );
}
