// The view `strip` (package.json's `pumi.contributes.views`): the buttons at the end of a pi pane's
// strip, past its dot and title. It is placed in that pane's `PaneStrip` slot, so it rides the strip
// the pane already has rather than a bar of its own.
import { component, div, type El, notify, View } from "pumi";

import { copy, fork } from "./actions.ts";
import { message } from "./errors.ts";

/** Which pane's session the strip is for: the pane it was opened for, or (opened any other way) the
 * pane it is in. */
interface StripArgs {
  pane?: number;
}

/** One of the strip's buttons: one of the app's icons, with what it does in the tooltip rather than
 * a label. */
function button(id: string, icon: string, tip: string): El {
  return component("button", { icon, tooltip: tip, variant: "ghost", size: "small" }).id(id);
}

/** What a button that could not do its thing tells the user. */
function failed(err: unknown): void {
  notify(`pi-session: ${message(err)}`, "error");
}

export class Strip extends View<StripArgs> {
  /** The pane whose session its buttons act on, read when they do so it is never stale. */
  private get at(): number {
    return this.cx.args?.pane ?? this.cx.pane.id;
  }

  render(): El {
    const at = this.at;
    return div()
      .id("strip")
      .class("pi-session")
      .sizeFull()
      .flex()
      .itemsCenter()
      .justifyEnd()
      .gap1()
      .child(
        button("fork", "git_branch", "Fork: open pi --fork <session> beside this pane").onClick(() => {
          fork(at).catch(failed);
        }),
      )
      .child(
        button("copy", "copy", "Copy the session's id, path and directory").onClick(() => {
          copy(at).then((summary) => notify(`Copied\n${summary}`, "info"), failed);
        }),
      );
  }
}
