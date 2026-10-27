# tab-rename

Names each view after what its agents are working on, with Apple's on-device model, so the side
bar reads `Key Binding Fix` and `Screenshot UI Redesign` instead of the title of whatever tab is in
front.

```text
  π - Fixing double-press c key binding bug - me      →  Key Binding Fix
  ✳ Migrate billing webhooks to Stripe v2             →  Billing Webhooks Stripe
```

Each time an agent's tab title changes (pi's `π - <session> - <folder>`, Claude Code's
`✳ <summary>`), the view it is in is named again from the titles of every agent in it, the one in
front first. A tab counts as an agent's when it has `@agent` or `@agent.status`
(`pumi skill add` installs the hooks). Titles that name no task (`π - pumi`, `Claude Code`) are
skipped, and the same titles are never asked about twice.

## Your names win

A view you named yourself (in the side bar, or `pumi view update`) is left alone. Give it back
its automatic name (`pumi call view.update @2 '{"name": null}'`) or run **Tab Rename: name this tab
after its agents** (`amresyd.tab_rename.rename`, with `{ tab }` or the current view) and it is
named by its agents again.

## The model

It needs macOS 26 or later with Apple Intelligence on, and `swiftc` (the Xcode command line tools).
The first time it is needed, `swift/namer.swift` is built into the package's cache and then runs
beside the package, answering over JSON lines; it exits after three minutes without a request
and is started again when it is next needed. Without the model, a notice says why, and it is tried
again ten minutes later (or when you run the command).

## Options

| Option | Default | |
| --- | --- | --- |
| `amresyd.tab_rename.max_words` | `3` | How many words a name may have (1 to 6). |
