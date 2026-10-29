// A press: a `div` that acts like a button. The SDK used to give a `Button`; it does not any
// more, so this is the same thing built from an element: the `button` role (or the one a list
// wants, `option`), a tab stop, pressed by a click, Enter or Space.
import { useRef, type ReactNode } from "react";
import type { EventPayload, KeyEvent, StyleDesc } from "pumi";

/** A mouse event, which an element's handler can keep from its ancestors' (as the DOM's). */
export type PressEvent = EventPayload & { stopPropagation?(): void };

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

/**
 * A plain click, on an element and anything in it: the primary button let go where it went down.
 * A drag (a text selection) or a second click of a double one is not a tap. Spread its handlers on
 * the element; `onTap` runs on the release.
 */
export function useTap(onTap: (event: PressEvent) => void): { onMouseDown(event: PressEvent): void; onMouseUp(event: PressEvent): void } {
  const down = useRef<{ x: number; y: number } | null>(null);
  return {
    onMouseDown: (event) => {
      down.current = (event.button ?? 0) === 0 ? { x: event.x ?? 0, y: event.y ?? 0 } : null;
    },
    onMouseUp: (event) => {
      const at = down.current;
      down.current = null;
      if (!at || (event.button ?? 0) !== 0 || (event.clickCount ?? 1) > 1) return;
      if (Math.hypot((event.x ?? 0) - at.x, (event.y ?? 0) - at.y) > 4) return;
      onTap(event);
    },
  };
}

/** Around a field of its own in the chat (an answer, an edit): a click in it stays its own, not a tap of the chat's. */
export function OwnClicks({ style, children }: { style?: StyleDesc; children?: ReactNode }) {
  return (
    <div onMouseUp={(event: PressEvent) => event.stopPropagation?.()} style={style}>
      {children}
    </div>
  );
}
