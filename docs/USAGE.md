# opencode-context-tree — usage

## Install

The short way — OpenCode registers both halves for you:

```sh
opencode plugin opencode-context-tree -g     # global; drop -g for the current project
```

By hand, the package name must be listed in **both** files (the TUI half is read from
`tui.json` only; listing it just in `opencode.json` gives you `/ctree` but no `/tree`):

```jsonc
// opencode.json (server half: crops, branch model, headless /ctree commands)
{ "plugin": [["opencode-context-tree", { "storage": "local" }]] }
// tui.json (TUI half: /tree, /branch, /merge, /decisions, gauge, sidebar card)
{ "plugin": [["opencode-context-tree", { "storage": "local", "jumpSummary": "ask" }]] }
```

Each half only sees the options of its own file, and both halves read `storage` — so if you
change it, **set the same `storage` in both files**, or the TUI and the server end up with
two different journals (crops written by one would never reach the other). The remaining
options only matter to the half that implements them (`storage` both; `jumpSummary`,
`hardCrop`, `keybinds` TUI-only). Plain `{ "plugin": ["opencode-context-tree"] }` in both
files is fine and uses the defaults.

From a checkout: `bun install && bun run build`, then list `/abs/path/dist/server.js` and
`/abs/path/dist/tui.js` instead of the package name.

Options: `storage` `"local"` (default, `.opencode/context-tree/` in the worktree, gitignored)
or `"global"` (OpenCode's state dir); `jumpSummary` `"ask"` (default, Pi behaviour) or `"never"`;
`hardCrop` `true` also sets OpenCode's own "compacted" flag on cropped tool parts so the
transcript shows `[Old tool result content cleared]` (reversible by undo, but it touches
OpenCode storage — off by default); `keybinds` overrides any route key by command name,
e.g. `{ "keybinds": { "open": "ctrl+t", "up": "k,up", "copy": "none" } }` — names are
`open up down page_up page_down half_up half_down screen_top screen_middle screen_bottom
first last prev_turn next_turn prev_branch next_branch fold unfold toggle fold_toggle
fold_open fold_close fold_open_all fold_close_all next_fold prev_fold go branch label
filter_pick filter_prev search search_next search_prev back crop crop_toggle_mode mark auto
undo merge inspector inspector_full inspector_up inspector_down consumers copy mode_duration
mode_turns lanes_off decisions export help`.

## Upgrading

OpenCode caches the version it installed and does not re-resolve `@latest` on restart. Pin the new
release, which also rewrites both config entries:

```sh
opencode plugin opencode-context-tree@0.2.0 -g --force     # drop -g for the current project
```

or delete `~/.cache/opencode/packages/opencode-context-tree@latest` and restart. `?` in `/tree` and
`/ctree status` print the running version.

## The loop

```
/branch            name it → you are on ⎇ name, a real OpenCode session (b in the tree
                   also asks "Model for this branch", Enter keeps the current one)
…side quest…
/merge             Squash → the branch model drafts a ◆ decision record → your $EDITOR →
                   save to confirm → the record lands in the trunk as one message; the
                   noisy turns stay on the branch
/tree              see where you are, what it costs, and jump anywhere
c … space … ⏎      crop a fat tool result (double space for protected ones) → the model
                   sees "[cropped: bash …]" from the next turn; the transcript keeps the text
u                  undo the last crop / branch / merge on this path (alias x)
```

`⏎` on any row above your current position asks Pi's tree-selector question, and the answer
is also the confirmation — there is no separate yes/no step:

| option | what it does |
|---|---|
| **No summary** | fork (or switch) clean; everything below the row you picked stays behind on the old session, out of the model's context |
| **Summarize everything below this point** (a switch reads "Summarize what you are leaving") | one model call drafts a Goal / Constraints / Progress / Key decisions / Next steps summary of exactly the turns the move abandons, and it lands at the destination as one `≣` message the model reads |
| **Summarize with a custom prompt** | the same, with your own focus ("just the API decisions", "keep the stack traces") |

The option lines say how much you are leaving — `drop the 3 turns · ~14k below this point`.
"Everything below this point" means what Pi means: the turns from where you are now back to
the point the two paths share, so redoing trunk turn 2 summarizes turns 2–3, while switching
from a branch to a sibling summarizes the branch's own turns and not the shared trunk.

While the summary is drafting, the status line says so — and keeps saying so:

```
⠹ summarizing 3 turns · ~14k · Progress · 1.2k chars · 4s · esc cancels
```

The spinner and the seconds counter mean it is still running; `Progress · 1.2k chars` is the
model's own draft as it arrives — the section it is writing and how much of it there is. The
same line covers the steps after it (`writing the ≣ summary into ⎇ try-redis`) and the merge
draft (`drafting the ◆ record for ⎇ try-redis`). Run one of these from the palette instead of
the tree — `/merge` from a session — and there is no status line to redraw, so you get a toast
naming the step instead.

`esc` on the choices puts you back on the same row with nothing done; `esc` while the summary
is being drafted cancels the draft *and* the move — nothing is forked until the summary is
ready, and the line reads `cancelling the branch summary` until it has unwound. A summary that
fails outright never blocks the move: you get a notice and go anyway.
Set `jumpSummary: "never"` for a plain confirm instead (the pure `pi-context-tree` stance);
a jump with nothing below the selected point skips the question too.

`/merge` asks how to close the branch:

| option | what it does |
|---|---|
| **Squash** | drafts a ◆ decision record you confirm — one model call, then your `$EDITOR` (or an in-app confirm when none is set); it lands in the trunk as one message |
| **Squash without LLM** | you write the record yourself, from the empty template |
| **Discard** | rejected; nothing lands in the trunk |
| **Tournament** | compare sibling branches and keep one — only offered when the branch has open siblings |

Every confirmation repeats the promise: *your transcript is never rewritten; the record is
appended to the trunk as a normal message.*

## Choosing what to do

Four things here spend or save context, and they differ in **what they preserve**, not just in
how much they save. Picking the wrong one is how you lose the thing you wanted to keep.

| you press | the model stops seeing | you keep | it costs | to reverse |
|---|---|---|---|---|
| `c` … `⏎` (result) | one fat tool *output* | the call, its arguments, everything else | nothing — no model call | `u` |
| `c` `t` … `⏎` (turn) | a whole question and its answers | everything else on the path | nothing | `u` |
| `gb` branch | nothing — nothing leaves this session | both lines of work, side by side | nothing (a fork is a copy) | `u` abandons the branch |
| `⏎` → *Summarize* | the turns the move leaves behind | a `≣` summary of them, at the destination | one model call | see the note below |
| `gm` merge → *Squash* | the branch's turns | one `◆` record of what you concluded, on the trunk | one model call + your edit | `u` re-opens the branch |
| *(nothing — you wait)* | everything, replaced by OpenCode's own summary | whatever its compaction chose | automatic | **not reversible** |

That last row is the reason the others exist. Auto-compaction is lossy and it picks for you;
everything above lets you pick first.

### Crop — stop sending something you no longer need

Reach for it when the gauge is filling **and you can name the fat thing**: a test run that
dumped 12k, a file read in full that has since been edited, an exploratory turn that went
nowhere. It is the cheapest option — no model call, instant, and `u` puts the text back in
context. The `⚠` marker (≥10k) and the `gs` consumers panel are there to find them for you.

Two things to know: a crop changes what is **sent from your next turn**, not what is stored —
your transcript keeps every character — and the model is told that `[cropped: …]` means
"removed on purpose, ask if you need it back", so it will ask rather than hallucinate.

### Branch — try it on a copy

Reach for it **before** the risky thing, not after: a refactor you might throw away, a second
opinion from a cheaper model, an approach you want to compare. A branch is a real OpenCode
session forked at this point, so this session's context is untouched whatever happens on it,
and you can hold two attempts side by side in the tree.

Branching costs nothing and deletes nothing, which makes it the safe default whenever you
catch yourself thinking "I hope this works".

### Merge — keep the conclusion, not the noise

Reach for it when a branch has **finished**, either way. *Squash* has the branch's own model
draft a `◆` decision record, you confirm it in `$EDITOR`, and that one message lands on the
trunk — the twenty noisy turns behind it stay on the branch, out of the trunk's context.
*Discard* lands nothing and marks the branch rejected, with an optional note on why.

This is the tool for "that whole line of enquiry is done" — where crop would be a hundred
small decisions, merge is one.

### Summarize on a jump — carry the gist back

Reach for it when you are **going back to an earlier point** and the work you are leaving is
worth remembering: `⏎` on an earlier row, then *Summarize everything below this point*. One
model call drafts Goal / Constraints / Progress / Key decisions / Next steps for exactly the
turns the move abandons, and it lands at the destination as one `≣` message.

Answer *No summary* when the abandoned turns were a dead end — you get the clean fork with
nothing carried over.

**On reversing it:** `u` has no undo for a landed `≣` summary itself. After a *fork* the
summary lives in the new branch, so `u` (which abandons that branch) takes it with you. After
a *switch* into an existing session, the `≣` message stays — crop it (`c` `t`) if you want it
gone.

### At 80% context

The gauge bands are `low` under 25%, `healthy` under 60%, `filling` under 85%, `red` above —
and a separate warning fires inside OpenCode's compaction reserve, because that is the point
where waiting stops being free. At `filling`, in order:

1. **`gs`** — look at where the context actually went. Guessing wastes the effort.
2. **`c` then `a` then `⏎`** — auto-marks every unprotected result ≥10k older than two turns.
   Usually the largest single win, and it costs nothing.
3. **`gm`** on any branch that is finished — a squash trades twenty turns for one record.
4. If the weight is in the line of work you are *still on*, **`gb`** a branch and continue
   there, or `⏎` back to a cleaner point with a summary. Both leave the heavy path intact
   behind you rather than destroying it.

## Folding the tool calls away

A turn where the model ran six tools is seven rows, and the one you skim for is the `●` user
turn. So every turn but **the one you are working in** opens folded, carrying what it holds:

```
│ ● T5 add a retry to the flaky test       ▸ 6 steps · ~12k · 1 ✗ · 2 ⚠
│ ● T6 now make it pass on CI
│ ⚙ [bash $ bun test src/foo.test.ts] → 3 failed …                        ~5.1k
│ ○ assistant: the failures share a timing assumption                       ~90
```

Nothing escapes a fold — the digest is the whole story: how many steps, their tokens, and how
many were errors (`✗`), fat (`⚠` ≥10k) or already cropped (`✂`).

| key | what it folds |
|---|---|
| `za` | toggle the turn you are on |
| `zo` `zc` | open it · close it |
| `zr` `zm` | open every fold · fold every turn (`zm` is the pure outline: one row per turn) |
| `zj` `zk` | jump to the next / previous folded turn |

Three things are deliberate:

- **Your folds beat the rule, and last as long as the tree is open.** `za` on a turn holds
  whatever the last-3 rule thinks, until you leave `/tree` — so every visit starts from the
  same clean outline rather than from folds you set days ago.
- **Crop mode opens everything.** `c` needs the tool results on screen to mark them, so it
  unfolds while it runs and puts your folds back when you leave. A live `/` search does the
  same, because a search that hid its own matches would look broken.
- **The timeline keeps every event.** Folding thins the row list, never the lanes — so with
  `1`/`2` on, a folded turn is still fully drawn there, and selecting it lights the whole span
  it stands for, red pills and all. Fold the rows, read the shape on the strip.

## `/tree` keys

| key | action |
|---|---|
| `↑↓` `j k` · `ctrl+f` `ctrl+b` · `ctrl+d` `ctrl+u` · `gg` `G` | move · page · half page · top / bottom |
| `H` `M` `L` | the top / middle / bottom row of what is on screen, without scrolling it |
| `{` `}` | previous / next `●` turn row. From a step, `{` lands on the turn that owns it first — the way `{` leaves the paragraph you are inside — so it doubles as "top of this turn". With the lanes on, the two keys scrub the timeline turn by turn, because the strip already rules its boundaries there |
| `[[` `]]` (or `[` `]`) | previous / next branch row |
| `← →` `h l` · `Tab` | fold / unfold a branch inline |
| `za` · `zo` `zc` | fold / open / close the turn the cursor is in (from a step row, the turn that owns it — the cursor rides up to it) |
| `zr` `zm` | open every fold · fold every turn (vim spells these `zR`/`zM`; OpenCode's key parser does not match a shifted second stroke, and with one fold level vim's `zr`/`zm` mean the same thing) |
| `zj` `zk` | next / previous folded turn |
| `⏎` | go here — the footer names what it will do for the row you are on: switch to a `⎇` branch, fork & prefill a user turn, fork after a step. Opens Pi's one question (below), which is also the confirmation; `u` undoes it |
| `gb` | branch here: name it, then "Model for this branch" (Enter keeps the current one) |
| `gm` | merge: Squash / Squash without LLM / Discard / Tournament (siblings only) |
| `c` `space` `a` `t` `⏎` | crop mode: mark (`space` alone enters it on a croppable row), auto-mark (≥10k tokens, older than 2 turns), result⇄turn, apply |
| `u` | undo |
| `gd` `ge` | decisions panel, export `ctree-decisions.md` |
| `gs` | consumers: what is filling the context (`⏎` opens a bucket, `space` marks one entry for crop, `y` copies one). Includes a `≡ system prompt` bucket broken down by part (base prompt, `AGENTS.md`, …) once the plugin has seen one request for the session — it is not croppable, but it is counted, so the total reconciles with the `ctx …` gauge |
| `i` | inspector pane on/off (auto-hidden under 110 columns) |
| `i` `I` `PgUp` `PgDn` | inspector in the side pane / full screen; page through a long payload or result. The pane shows every line it has, sized to your terminal, with `12–40 of 118` at the foot when there is more; `y` copies the untruncated text. Below 110 columns the side pane does not fit, so `i` opens full screen directly |
| `g1` `g2` `g0` | timeline lanes, x-axis by duration / one cell per event; `g0` off. `│` marks a turn boundary, and the lanes show whatever the `gf` filter shows — so `tools-only` is the "what did I run" view in both the rows and the lanes. Folding never thins them |
| `m` | mark: label the selected message (vim's *set mark*) |
| `gf` | filter picker (default · no-tools · tools-only · user-only · labeled · all) |
| `/` `n` `N` | live search: typing re-filters the rows, `⏎` keeps the filter, `esc` clears; `n` `N` next / previous match |
| `y` | copy the selected text — the terminal's clipboard when it allows it, else `.opencode/context-tree/last-copy.txt` |
| `?` | help pane under the tree: how to read the screen + every key (`?` or `esc` closes) |
| `q` `esc` | back (esc leaves crop mode / a panel / a search first) |

The footer follows the panel and the row under the cursor — on the tree `⏎ fork & prefill
this turn  gb branch  gm merge  c crop  u undo  gs consumers  ? help  q back`; the rest live
behind `?`.

The keys follow vim: `j k`, `ctrl+f`/`ctrl+b`, `ctrl+d`/`ctrl+u`, `gg`/`G`, `H M L`, `{ }`,
`[[ ]]`, `/ n N`, `y`, `u`, `m`, and the whole `z` fold family mean what they mean there. The
verbs vim has no word for — branch, merge, filter, the panels — live behind `g`, the way LSP
plugins put theirs (`gd`, `gr`, `gi`). Two deliberate exceptions: `?` is help rather than
reverse search (`/` with `N` covers that), and `q`/`esc` is back.

Palette: **Context tree**, **Branch here**, **Merge branch**, **Decisions**, **Label this point**.
`ctrl+q` opens the tree.

## Reading the screen

```
┌ Context tree · Fix flaky test · trunk                  ctx ▓▓░░░ ~46k/200k · filling
│ filter: default   4/24 rows
│ ● user: build yourself a tool that reads the context window…              ~1.2k
│ ○ assistant: I'll start by inspecting my environment…                      0.3k
│ ⚙ [bash $ ls -la ~/Documents/] → total 744 …                              ~2.1k
│ ● user: decompress the session and show the structure                     ~0.2k
│ ╰⎇ try-redis  ▸ squashed · 9 turns                                         ~22k
│ ╰⎇ fix-flaky  ▾ open · 6 turns  ← here                                     ~14k
│ │ ● user: the bun test is flaky, find the race                            ~0.4k
│ │ ⚙ [bash $ bun test src/foo.test.ts] ⚠                                    ~4.7k
│ ◆ Decision: try-redis · Outcome: switched to a write-through cache…        ~0.9k
└ ⏎ fork & prefill this turn  b branch  m merge  c crop  u undo  s consumers  ? help  q back
```

- `/tree` is an outline of the *whole* tree: one content-forward row per message (`● user:` /
  `○ assistant:`) and tool step (`⚙ [bash $ …]` / `[tool: arg] → out`). From anywhere you see the
  whole tree — your branch open with `← here`, the rest folded to their `⎇` header (`→` opens one).
- The Input/Model/Tools lanes and the right-hand inspector (DeepSeek-Harness trajectory) are OFF by
  default so the first screen is the clean outline; `1`/`2` bring in the lanes, `i` the inspector.
  On an assistant step the inspector also breaks its tokens down: `Prompt 2.3k fresh · 40.4k cached`
  and `Reply 0.5k out · 0.2k thinking`.
  The lanes are an event strip — one `▬` pill per prompt / model step / tool call on a shared time
  axis, coloured by lane (nothing is scaled by tokens); the row you are on draws inverted.
- On long sessions the lanes show a window of the timeline: it opens at the newest events, stays
  put while the cursor moves inside it, and follows the cursor in steps when it nears an edge
  (`gg`/`G` jump it to the start/end). `…37` / `12…` at the edges count hidden events, and a dim
  `all` track under the lanes shows where the window sits, with red ticks at failed tool calls.
- On a long session the lanes are a window on that axis, and the window follows the cursor: move up
  into older rows (`k`, `gg`) and it scrolls back in steps, `G` returns to the newest. `…12` next to
  `Input` and `12…` after the lane count the events hidden either side, and the `all` line under
  `Tools` is the whole timeline in miniature — `━` is the part you are looking at, red `·` is a
  failed tool call outside it.
- The header's context string is the same one the prompt gauge shows, character for
  character. The lanes only appear once there are three turns to plot; a session with no
  messages says so instead of drawing an empty frame.
- `⎇` rows hang off the message they were forked from. Colours: open green, squashed blue,
  rejected red, abandoned/deleted grey.
- From inside a branch, its own `⎇` row is drawn at the fork point with `← here`; the rows
  below it are the branch's own turns. The header reads `⎇ <branch> ← <trunk title>`.
- Rows the model is not shown — an ancestor's turns past the point where your path forked — are
  dimmed, under a `── not in this branch's context ──` line.
- `┆⎇` rows at the bottom are branches you cannot reach on the active path (siblings, or the
  trunk continuing past your fork point); `⏎` switches to them, `→` expands them.
- Sessions made with OpenCode's own `/fork` are adopted into the tree automatically (matched
  to their parent by the copied message prefix; they show under the session's title).
- Tokens: a leading `~` means estimated (chars/4); assistant steps use the model's own counts.
  Step durations and lane heights are read from the same data — estimated wherever the `~` is.
- `⚠` ≥10k tokens, `✂` cropped, `✗` tool error, `◆` decision record, `◇` branch summary.

The right end of the status line (second line, under the `ctx …` gauge) is the same figure for
the row your cursor is on: `T2 reply · prompt 43.7k · 30.1k cached` — the whole prompt the
provider was actually sent at that point, **system prompt and tool definitions included**,
because that is what `tokens.input` covers. Read it against the gauge above it: the gauge is
now, this is where the cursor is, and the gap between them is everything after that point.

It comes from the provider, not an estimate, so it has no `~`. An assistant step reports its
own message's prompt; a user turn reports the reply *to* it (the first prompt that included
it); a turn with no reply yet says `not sent yet`. Branch headers have none — their token
column is already a subtree total. On a terminal too narrow to hold both, the figure is
dropped rather than wrapped.

One caveat: it is **history**. An older row's figure is what went out at the time, so it does
not shrink when you later crop or merge something above it — the estimated per-row column does,
because it is recomputed from the transcript each time.
- A branch you just made says `just branched, nothing here yet` — there is nothing to unfold.
- The gauge on the prompt line: `⎇ fix-flaky · ctx ▓▓░░░ ~46k/200k · filling · 95% cached
  ▲+24% (bash)` — the context of the next prompt (the same figure as OpenCode's own sidebar),
  bands relative to the model's window (<25% low · <60% healthy · <85% filling · red; absolute
  8k/32k/64k when the window is unknown), how much of that prompt the provider served from its
  cache (shown once the provider reports cache tokens; the bar's dim cells are the cached part,
  and `0% cached` right after a crop, merge or fork means the cache was reset), then the jump
  since the last look and what caused it. One toast when you enter red; one when OpenCode's
  auto-compaction is near.
- The sidebar card, under a **Context tree** heading: `⎇ <branch>` and, on its own line,
  `open · from "<the session you forked>"` — or `trunk · 2 branches` when you are on the
  trunk. Active crops add `✂ 2 crops · ~31k hidden`, caching providers add `40.4k cached of
  42.7k (95%)`; last line is the `/tree · ctrl+q` hint.

## Headless (desktop / web / scripts)

`/ctree status` · `/ctree branch <name> [provider/model]` · `/ctree merge --discard [note]` ·
`/ctree crop --top [--apply]` ·
`/ctree crop --auto [--apply] [--min-tokens N] [--older-than N] [--keep glob]` · `/ctree undo` ·
`/ctree decisions [--export [path]]` (no path → `./ctree-decisions.md`, relative to the
project directory). These run as OpenCode commands, so the model answers with a one-line
acknowledgement. (Squash merges need the TUI's `$EDITOR` gate.)

`/ctree branch` takes the whole rest of the line as the name unless the last word looks like
a model (`provider/model`): `/ctree branch fix flaky test` names the branch "fix flaky test",
`/ctree branch fix anthropic/claude-haiku-4-5` names it "fix" and runs it on that model.

`/ctree status` (and every other `/ctree` subcommand) is dispatched as a turn, so it queues
behind one already running — against a provider that never replied, it was measured sitting
stuck at `QUEUED` rather than answering. `/tree` opens synchronously from the local journal, with
its fork-adoption pass running off the critical path, so it is the one to reach for when a turn
looks stalled.

## What is (and is not) touched

- Branch = OpenCode session (`session.fork`). The plugin remembers `(parent, anchor)` in
  `.opencode/context-tree/<tree>.jsonl` (append-only) and mirrors it into `session.metadata`.
- Sessions you fork with OpenCode's own `/fork` are adopted into the tree automatically (the
  copied message prefix identifies the parent); they show up under it with their session
  title. Adoption only appends a journal line — the sessions themselves are untouched.
- Crops and hidden records are applied per request in the server plugin; OpenCode's own
  storage is never rewritten. `/undo` appends, never deletes.
- Decision records are ordinary user messages (`noReply`) tagged in part metadata; they are
  re-injected verbatim when OpenCode compacts.

## Releasing (maintainers)

GitHub → Actions → **Release** → *Run workflow*: pick `patch` / `minor` / `major` (relative to
the latest `v*` tag) or type an exact version. The workflow runs typecheck and tests, tags the
current `main` as `vX.Y.Z`, creates the GitHub Release with generated notes, and dispatches the
publish workflow on that tag, which publishes to npm through trusted publishing (OIDC, no token).
Tick *dry run* to see the version it would cut without doing anything.

The tag is the version: `package.json` on `main` says `0.0.0-dev` and is stamped from the tag at
publish time, so no commit ever has to land on the protected branch. Keep `CHANGELOG.md` by hand
(the workflow warns when the section for the new version is missing).

## Performance

Measured on commit `ace3d18` (OpenCode 1.18.26, macOS, 120-column pty, key-to-paint latency
from the harness driver's timing log; sessions built against the instant mock provider):

| session | rows | `/tree` open | `gg` | `G` | lanes `1` | `/` | consumers `s` | TUI RSS |
|---|---|---|---|---|---|---|---|---|
| 57 messages (real model) | 53 | 37 ms | – | – | 7 ms | 2 ms | 4 ms | – |
| 117 messages (50 turns) | 117 | 34 ms | 6 ms | 4 ms | 8 ms | 2 ms | 3 ms | 37 MB |
| 234 messages (100 turns) | 234 | 36 ms | 7 ms | 5 ms | 3 ms | 1 ms | 3 ms | 37 MB |
| 467 messages (200 turns) | 467 | 32 ms | 6 ms | 4 ms | 6 ms | 1 ms | 4 ms | 37 MB |

Startup to the prompt: +70 ms with the plugin (2.6 s vs 2.5 s). Headless `/ctree status` on 467
messages: 0.2 s. The crop transform that runs on every model request: 0.78 ms at 484 messages
with 66 active crops (0.03–0.27 ms on a 50-message session). Journals: 7–11 KB after a full
session with three branches, two records and several crops.

