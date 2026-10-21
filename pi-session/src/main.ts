// `pi-session`: the buttons at the end of a pi pane's strip, past its dot and title. Fork opens
// `pi --fork <session>` in a pane beside it, in the same directory; Copy puts the session's id,
// path and directory on the clipboard.
//
// A pane is pi's when its agent's hook said so: `@agent` is `pi` and `@agent_session` is set
// (`pumi skill setup pi`). Its buttons are in that pane's `PaneStrip` slot (the view `strip`), at
// the row's end, so they ride the strip the pane already has.
import { on, pkg, view } from "pumi";

import { focusedOnly } from "./settings.ts";
import { Strip } from "./strip.ts";
import { sync } from "./sync.ts";

view("strip", Strip);

// A pane that becomes pi's (or stops being), and the option that says whose buttons show: its
// buttons follow, in the strip and on every other pi pane's.
on("option.changed", { match: ["@agent", "@agent_session", pkg.prefixed("focused_only")] }, () => {
  void sync();
});

// The buttons follow the focus, when only the focused pane has them.
on("pane.focused", () => {
  void focusedOnly().then((only) => (only ? sync() : undefined));
});

// What is there when the app starts already: panes restored with their sessions.
void sync();
