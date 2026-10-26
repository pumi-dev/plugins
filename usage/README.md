# usage

How much of your AI plans is left, in the side bar's **Usage** section: each plan signed in on this
Mac, its account and plan name, every window with its meter, what is left, when it resets and
whether it is spending faster than the window, plus credits, extra usage and the surfaces a week
went on. Its button reads the plans again; **Settings → Usage** has the rest.

## What it reads

Each plan is read with the sign-in the tool itself keeps, so there is nothing to set up:

| Plan | The sign-in it uses | What it asks |
| --- | --- | --- |
| **Claude** | Claude Code's login keychain item (`Claude Code-credentials`, or the profile's `…-xxxxxxxx` when `CLAUDE_CONFIG_DIR` is set), else `~/.claude/.credentials.json` | `api.anthropic.com/api/oauth/usage`: the session and weekly windows, the weekly ones scoped to a model, extra usage |
| **Codex** | `~/.codex/auth.json` (`$CODEX_HOME`), else OpenCode's OpenAI sign-in in `~/.local/share/opencode/auth.json` | `chatgpt.com/backend-api/wham/usage`: the primary and secondary windows, by their own lengths, plus code review and credits |
| **Copilot** | `gh auth token`, a Copilot editor plugin's `github-copilot/apps.json` or `hosts.json`, `$COPILOT_API_TOKEN`, or the token below | `api.github.com/copilot_internal/user`: premium requests and chat, by the month |
| **OpenRouter** | `$OPENROUTER_API_KEY`, or the key below | `openrouter.ai/api/v1/credits` and `/key`: prepaid credits and the key's own spending cap |

A plan that is not signed in is left out, not drawn empty. A Claude Code pointed at
another endpoint (`ANTHROPIC_BASE_URL`, an `apiKeyHelper`) is left alone: it is not spending the
plan, and its token would be refused.

Two keys can be set under **Settings → Usage → Keys**, kept in the login keychain: a GitHub token
for Copilot when `gh` is not signed in (`gh auth token` works), and an OpenRouter API key. A token
in the app's environment wins over nothing and loses to nothing but the setting itself.

## Settings

| Option | Default | What it does |
| --- | --- | --- |
| `every` | 5 min | How often the plans are read. The services rate limit these endpoints; the numbers move slowly. |
| `alert` | off | A notification once each window crosses the critical share, and not again until that window resets. |
| `claude`, `codex`, `copilot`, `openrouter` | on | Which plans may appear. A plan without a sign-in never does. |
| `resets` | time left | Count down (`2h 53m`), name the local time it comes back, or say nothing. |
| `tint` | on | Numbers and meters take the warning and error colours as a window fills. |
| `warn_at` / `crit_at` | 70% / 90% | Where the warning and error colours start, and where `alert` speaks. |

Everything is an option, so the same values can be set from anywhere:

```sh
pumi option set amresyd.usage.resets clock           # when each window comes back
pumi option set amresyd.usage.copilot_token "$(gh auth token)"
```

## Commands and functions

```sh
pumi call amresyd.usage.refresh                 # read them now (the palette has it too)
pumi call amresyd.usage.report | jq             # what the section has: windows, resets, errors
```

`amresyd.usage.refresh` is the palette's **Usage: read the plans again**.

## What it keeps, and what leaves the machine

The sign-ins are read where the tools keep them; the tokens go only to the service they belong to,
in the request that service's own client makes. Nothing is sent anywhere else, and the last
snapshot — numbers, accounts, resets, and why a read failed if it did — is kept in the plugin's
storage so a restart draws the numbers before the first read.

A failed read keeps the numbers it had and marks them: the side bar says why
(a refused sign-in, a rate limit, a service that answered otherwise). A read never asks twice at
once, and never more often than `every`.

## Add a plan

A plan is one module in `src/providers`: how it finds the sign-in (`signIn`), what it asks (`ask`),
and how the answer becomes a report (`parse`, which is pure and tested from a fixture). Then a line
in `src/providers/index.ts`, its option in `package.json`, and a fixture in `test/providers.test.ts`.

## Install

```sh
pumi plugin add ./usage
```

## Develop

```sh
bun test            # the model, the settings, every parser, and a whole read
bun run check       # types, through the pumi checkout beside this one
```
