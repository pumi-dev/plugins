# tab-rename

Names each tab after what its agents are working on, with Apple's on-device model, so the tab bar
reads `Key Binding Fix` and `Screenshot UI Redesign` instead of `Tab 1`, `Tab 2`.

```text
  π - Fixing double-press c key binding bug - amr     →  Key Binding Fix
  ✳ Migrate billing webhooks to Stripe v2             →  Billing Webhooks Stripe
```

Each time an agent's tab title changes (pi's `π - <session> - <folder>`, Claude Code's
`✳ <summary>`), the tab is named again from it. A tab counts as an agent's when it has the Agents
plugin's trait (`@pumi_dev.agents.agent`) or a `@status` (`pumi skill add` installs the hooks).
Titles that name no task (`π - pumi`, `Claude Code`) are skipped, and the same titles are never
asked about twice.

## Names

The core keeps one title per tab (`tab.title`): the program's, until something else sets it. That
means a name you gave (`pumi tab update %2 --title 'Bill'`) and the agent's own are the same field,
so the agent's next title replaces yours, and this names the tab again from it — there is no
separate "yours" title to leave alone any more. **Tab Rename: name this tab after its agents**
(`amresyd.tab_rename.rename`, with `{ tab }` or the current tab) names it now, without waiting for
the agent to say something new.

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
