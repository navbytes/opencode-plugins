<div align="center">

# opencode-context-tree

**See your whole [OpenCode](https://opencode.ai) session as a tree — then branch it, merge it, and crop it like source code.**

A Pi-style context tree with git-style controls (`/branch`, `/merge`, `/crop`, `/undo`)
and a DeepSeek-Harness-style trajectory view, in one screen, inside your terminal.

[![npm](https://img.shields.io/npm/v/opencode-context-tree?color=cb3837&logo=npm)](https://www.npmjs.com/package/opencode-context-tree)
[![CI](https://github.com/navbytes/opencode-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/navbytes/opencode-tree/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-%E2%89%A5%201.18-black)](https://opencode.ai)

</div>

![The context tree, viewed from the trunk](docs/screenshots/tree-trunk.png)

## Why

A long OpenCode session is a straight line that only grows. You cannot see what is
filling the context window, side quests are stuck in the transcript forever, and
auto-compaction eventually decides for you what gets forgotten.

This plugin gives that session a shape and a set of controls:

- **See it.** One screen shows every message and tool step in the session, with the
  branches drawn at the points they forked from, and what each one costs in tokens.
- **Branch it.** Take a side quest onto its own branch — optionally on a cheaper model —
  so the main thread never sees the noise.
- **Merge it.** Close a branch with a decision record you confirm yourself, so the trunk
  gets the conclusion instead of the twenty turns that produced it.
- **Crop it.** Stub the 40k-token `bash` output that is squatting in your context, and
  put it back with one key when you were wrong.

The screen stays close to Pi and to
[`pi-context-tree`](https://github.com/navbytes/pi-context-tree), so it is familiar if you
are coming from either, and the trajectory view follows the DeepSeek Harness.

> **Your transcript is never rewritten.** Crops are applied per request, so the model
> sees a stub while the stored message keeps its full text. Merges *append* a record;
> they never delete turns. Every branch, merge and crop is undoable with `u`.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [The screen](#the-screen)
- [Features](#features)
- [Keys](#keys)
- [Commands](#commands)
- [Configuration](#configuration)
- [How it maps onto OpenCode](#how-it-maps-onto-opencode)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Install

Requires **OpenCode 1.18 or newer**. One command registers both halves of the plugin:

```sh
opencode plugin opencode-context-tree -g     # every project (~/.config/opencode)
opencode plugin opencode-context-tree        # this project only (.opencode/)
```

Restart OpenCode, then press `ctrl+q` or run `/tree`.

<details>
<summary><b>Registering by hand</b></summary>

The plugin has two halves, and the package name must be listed in **both** config files.
`opencode.json` loads the server half (crops, branch model, headless `/ctree` commands);
`tui.json` loads the TUI half (`/tree`, `/branch`, `/merge`, the gauge, the sidebar card).
Listing it in only the first gives you `/ctree` but no `/tree`.

```jsonc
// opencode.json  (or ~/.config/opencode/opencode.jsonc)
{ "plugin": ["opencode-context-tree"] }

// tui.json       (or ~/.config/opencode/tui.json)
{ "plugin": ["opencode-context-tree"] }
```

</details>

<details>
<summary><b>Upgrading</b></summary>

OpenCode caches the version it installed and does not re-resolve `@latest` on restart.
Pin the new release, which also rewrites both config entries:

```sh
opencode plugin opencode-context-tree@<version> -g --force   # drop -g for this project only
```

The npm badge at the top of this page is the current version. Or delete `~/.cache/opencode/packages/opencode-context-tree@latest` and restart.
`?` inside `/tree` and `/ctree status` both print the version you are running.

</details>

## Quick start

The whole workflow is four moves:

```
/branch fix-flaky     name it → you are on a real OpenCode session, forked here
      …side quest…    the noisy turns live on the branch, not in your main thread
/merge                Squash → the model drafts a ◆ decision record → your $EDITOR →
                      save to confirm → the conclusion lands on the trunk as one message
/tree                 see where you are, what it costs, and jump anywhere
c space ⏎             crop a fat tool result — the model sees "[cropped: bash …]" from
                      the next turn; u puts it back
```

Pressing `⏎` on any earlier message forks from that point. This is Pi's fork flow whole:
one question with Pi's three answers — fork clean, summarize everything below that point,
or summarize it with your own prompt — and the answer is also the confirmation. The
summary covers exactly the turns the move leaves behind.

Drafting one takes a model call, so the status line shows it happening —
`⠹ summarizing 3 turns · ~14k · Progress · 1.2k chars · 4s · esc cancels`: the step, the
draft as it streams in, how long it has been, and the way out. The `◆` record a `/merge`
drafts reports the same way.

## The screen

`/tree` is an outline of the whole session. Every message and tool call is one
content-forward row, branches hang off the message they were forked from, and your
current branch is open while the rest stay folded:

```
┌ Context tree · Fix flaky test · trunk                                  ctx ~46k/200k · filling
│ filter: default 24 rows
│ ● user: build yourself a tool that reads the context window…                              ~1.2k
│ ○ assistant: I'll start by inspecting my environment…                                      0.3k
│ ⚙ [bash $ ls -la ~/Documents/] → total 744 …                                              ~2.1k
│ ● user: decompress the session and show the structure                                     ~0.2k
│ ╰⎇ try-redis  ▸ squashed · 9 turns                                                          ~22k
│ ╰⎇ fix-flaky  ▾ open · 6 turns  ← here                                                      ~14k
│ │ ● user: the bun test is flaky, find the race                                             ~0.4k
│ │ ⚙ [bash $ bun test src/foo.test.ts] ⚠                                                     ~4.7k
│ ◆ Decision: try-redis · Outcome: switched to a write-through cache…                         ~0.9k
└ ⏎ go  b branch  m merge  c crop  u undo  s consumers  ? help  q back
```

The footer always says what `⏎` will do for the row under the cursor. A leading `~` on a
token count means it is estimated; assistant steps use the model's own numbers.
Markers: `⚠` over 10k tokens · `✂` cropped · `✗` tool error · `◆` decision record.

## Features

### Branches you can see

From inside a branch, `← here` marks your position. Trunk rows past the fork point are
dimmed under `── not in this branch's context ──`, because the model is not sent them.

![The tree, viewed from inside a branch](docs/screenshots/tree-from-a-branch.png)

Sessions you create with OpenCode's own `/fork` are adopted into the tree automatically.

### Search and filters

`/` filters as you type, highlights the matches and counts the rows; `n` and `N` step
through them. `f` opens a filter picker — default, no-tools, user-only, labeled, all — and
the timeline lanes follow it, so `tools-only` becomes a "what did I run" view in both.

![Live search inside the tree](docs/screenshots/search.png)

### The trajectory view

The DeepSeek-Harness trajectory is one keystroke away rather than in your way. `1` and
`2` bring in the Input / Model / Tools lanes — one pill per event, coloured by lane and red
for a failed tool call — laid out either by duration (`1`) or one cell per event (`2`).
`0` hides them again. `i` opens the inspector, with each step's payload, result and timing.

The lanes appear once the session has three turns to plot, and on a long session they show
a window of the timeline that follows your cursor.

![The tree with trajectory lanes and the inspector open](docs/screenshots/tree-trajectory.png)

### Finding what fills your context

`s` breaks the context down by share of the tree and of the model window, expandable into
entries you can crop in place. It counts the system prompt too, broken down by part, so
you can see what your `AGENTS.md` actually costs. `D` renders the decision records.

| | |
|---|---|
| ![The consumers view](docs/screenshots/consumers.png) | ![The decisions panel](docs/screenshots/decisions.png) |
| ![The help pane](docs/screenshots/help.png) | ![The merge picker](docs/screenshots/merge-picker.png) |

### The gauge

On the prompt line: the context of your next prompt (the same figure OpenCode's own
sidebar shows), its band, and how much of it the provider served from cache. The bar's
dim cells are the cached part. `0% cached` right after a crop, merge or fork means the
cache was reset.

![The context gauge showing the provider cache share](docs/screenshots/gauge-cache.png)

## Keys

Vim-aligned, inside `/tree`. Press `?` for the full list without leaving the screen.

| Key | Action |
|---|---|
| `j` `k` · `ctrl+d` `ctrl+u` · `gg` `G` | move · half page · top / bottom |
| `[` `]` | previous / next branch row |
| `h` `l` · `Tab` | fold / unfold a branch inline |
| `⏎` | go here — the footer names what it will do for this row |
| `b` | branch here, naming it and optionally picking a model |
| `m` | merge: squash, squash without the model, discard, or tournament |
| `c` | crop mode — `space` mark, `a` auto-mark, `t` result⇄turn, `⏎` apply |
| `u` (`x`) | undo the last branch / merge / crop |
| `/` · `n` `N` | live search · next / previous match |
| `f` `F` | filter picker, forwards / back |
| `i` `I` | inspector in the side pane / full screen (`PgUp` `PgDn` to page) |
| `1` `2` · `0` | timeline lanes, x-axis by duration / one cell per event · off |
| `s` | what is filling the context |
| `D` `E` | decisions panel · export to `ctree-decisions.md` |
| `L` `y` | label this point · copy the selected text |
| `?` `q` | help · back |

## Commands

| Command | What it does |
|---|---|
| `/tree` (`ctrl+q`) | open the combined tree and trajectory view |
| `/branch <name> [model]` | fork here into a named branch, optionally on a cheaper model |
| `/merge [--pick \| --no-llm \| --discard \| --tournament]` | close the branch — see below |
| `/crop [--top \| --auto …]` | stub fat tool results or drop whole turns from what the model sees |
| `/undo` | revert the last branch, merge or crop |
| `/decisions [--export]` | list or export decision records |

`/merge` offers four ways to close a branch. **Squash** has the branch model draft a ◆
decision record that you confirm in `$EDITOR`. **Squash without LLM** hands you the empty
template to write yourself. **Discard** lands nothing. **Tournament** keeps one of several
sibling branches. In every case the record is appended to the trunk as a normal message.

For desktop, web or scripts there is a headless equivalent that needs no TUI:
`/ctree status`, `/ctree branch`, `/ctree merge --discard`, `/ctree crop`, `/ctree undo`
and `/ctree decisions`. See [docs/USAGE.md](docs/USAGE.md#headless-desktop--web--scripts).

## Configuration

Options go in the plugin entry of either config file. Both halves read `storage`, so if
you change it, **set the same value in both files** — otherwise the TUI and the server
keep two different journals and crops written by one never reach the other.

```jsonc
{ "plugin": [["opencode-context-tree", { "storage": "global", "jumpSummary": "never" }]] }
```

| Option | Values | Default | What it does |
|---|---|---|---|
| `storage` | `"local"` · `"global"` | `"local"` | where the journal lives — `.opencode/context-tree/` in the worktree (gitignored), or OpenCode's state dir |
| `jumpSummary` | `"ask"` · `"never"` | `"ask"` | whether jumping offers to summarize the turns you leave behind |
| `hardCrop` | `true` · `false` | `false` | also set OpenCode's own "compacted" flag on cropped parts, so the transcript itself shows them cleared — reversible, but it touches OpenCode storage |
| `keybinds` | object | — | override any key by command name, e.g. `{ "open": "ctrl+t", "copy": "none" }` |

The full list of rebindable command names is in
[docs/USAGE.md](docs/USAGE.md#install).

## How it maps onto OpenCode

Nothing here is a private data format bolted on the side. Each feature is one of
OpenCode's own primitives:

| Feature | Implementation |
|---|---|
| **branch** | a real OpenCode session created with `session.fork`; the plugin records `(parent, anchor)` in an append-only journal and mirrors it into `session.metadata` |
| **crop** | applied per request in `experimental.chat.messages.transform`, so the transcript keeps the originals and only the model sees stubs |
| **merge** | writes the confirmed record with `session.prompt({ noReply: true })` |
| **the UI** | a TUI plugin (`@opencode-ai/plugin/tui`): one route, two slots (gauge, sidebar card), dialogs and a keymap layer |

Because a branch is just a session and a decision record is just a message, everything
stays readable to OpenCode — and to you — if you ever remove the plugin.

## Performance

Measured against OpenCode 1.18.26 on a 120-column pty. Full method and the rest of the
numbers are in [docs/USAGE.md](docs/USAGE.md#performance).

| Session | `/tree` opens in | Search | Consumers | TUI memory |
|---|---|---|---|---|
| 57 messages | 37 ms | 2 ms | 4 ms | — |
| 117 messages | 34 ms | 2 ms | 3 ms | 37 MB |
| 467 messages | 32 ms | 1 ms | 4 ms | 37 MB |

Opening the tree does not get slower as the session grows. The crop transform that runs on
every model request costs 0.78 ms at 484 messages with 66 active crops, and 0.03–0.27 ms on
a 50-message session. Startup to the prompt grows by about 70 ms.

## Troubleshooting

**`/ctree` works but `/tree` does not exist.** The TUI half is not registered. Run the
install command again, or add the package name to `tui.json` as well as `opencode.json`.

**A crop or a branch is missing from one half.** The two halves are reading different
journals. Set the same `storage` value in both config files.

**A turn looks stuck.** `/ctree` subcommands are dispatched as turns, so they queue behind
one that is already running. `/tree` opens synchronously from the local journal, so reach
for that one instead.

**An upgrade did not take.** OpenCode kept the cached version. Pin the release with
`--force`, as described under [Install](#install).

## Development

```sh
bun install
bun run build
bun test              # unit tests
bun run typecheck
bun run test:e2e      # pty-driven end-to-end tests against a real OpenCode TUI
```

To run your checkout instead of the published package, list the built files by absolute
path rather than the package name:

```jsonc
// opencode.json  →  "plugin": ["/abs/path/opencode-tree/dist/server.js"]
// tui.json       →  "plugin": ["/abs/path/opencode-tree/dist/tui.js"]
```

[DESIGN.md](./DESIGN.md) is the long version: the research behind the design (Pi,
[`pi-context-tree`](https://github.com/navbytes/pi-context-tree), the OpenCode plugin and
SDK surface, the DeepSeek Harness trajectory view), the end-user flows, the data model,
the architecture, the edge cases and the roadmap. [CHANGELOG.md](./CHANGELOG.md) records
what changed in each release.

Issues and pull requests are welcome. Please run the typecheck and the unit tests before
opening one.

## License

[MIT](./LICENSE) © Naveen (navbytes)
