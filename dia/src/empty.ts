// Dia's new tab: an orb over a field of what to start, drawn where the panes of an empty tab would
// be (`C.Empty` in theme.lua, which the panes ask for).
import { app, div, icon, text, type El } from "pumi";
import { label } from "./parts.ts";

/** The empty state: what it says, and the actions to start, each `[label, app action]`. */
export function empty(message: string, actions: [string, string][]): El {
  return div()
    .class("empty dia-empty")
    .child(div().class("dia-orb"))
    .child(
      div()
        .class("dia-ask")
        .child(
          div()
            .class("dia-ask-line")
            .child(icon("magnifying_glass"))
            .child(label("dia-ask-text", message)),
        )
        .child(
          div()
            .class("dia-ask-actions")
            .children(
              actions.map(([name, action]) =>
                div()
                  .class("dia-chip")
                  .onClick(() => {
                    app.run(action);
                    return true;
                  })
                  .child(icon(action === "open_file" ? "folder" : "plus"))
                  .child(text(name)),
              ),
            ),
        ),
    );
}
