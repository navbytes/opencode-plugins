# Report: the 2026-09-04 roost hangs — cause found, plugin cleared

Answers `docs/2026-09-06-roost-hang-brief.md`. All times local (+0800).

## Verdict

1. **The wedges were not caused by the plugin, by an OpenCode request storm, or by
   a hung provider.** They were caused by the Python pty driver that had launched
   roost for the driven session. Every wedge landed within seconds of that driver
   hitting its own `--timeout`, at which point it stops draining the pty and exits,
   closing the pty master under a still-running roost. roost then spun at 99–100 %
   CPU with its main thread in `read(2)` on a hung-up stdin and its control socket
   accepting but never answering. That is roost's known "closed tab" hangup path
   (`tests/terminal_hangup.rs`, `infra::signals::watch_for_hangup`, PR #173,
   2026-09-02). Hypothesis H4, with a precise trigger.
2. **The load averages above 100 are a separate event**, unrelated to the wedges.
   Each spike coincides with `xcodebuild`, `simctl`, or `cargo build/test` jobs
   launched by worker agents in other Claude Code sessions (tripto, chessling,
   roost itself). The wedges themselves happened at load 5 to 47.
3. **H1, H2, H3 all cleared with numbers** (§4–§6): 3 SDK round-trips per fork
   event in the brief's scale scenario, 32 at worst under a 60-event storm, load1
   never above 16; registry lock waits at most 4 ms, no deadline hits; a provider
   that never replies leaves the TUI repainting, `/tree` opening in 16 ms, the
   server answering in 5 ms, and load falling.

## 1. The wedges, minute by minute

Source: the Claude Code transcript of the session that drove OpenCode inside roost
(`~/.claude/projects/*focused-torvalds*`), cross-checked against
`~/Library/Application Support/roost/perf.jsonl` (default workspace; the driven
instances used `ROOST_STATE=/tmp/roost-test-state{2,3,4,5}`, since deleted).

| # | roost launched | driver, `--timeout` | driver stops draining | first hung control call | load1 then |
|---|---|---|---|---|---|
| 1 | 23:27:56 | `harness/pty-run.py` 60 s | 23:28:56 (SIGTERM child, exit, master closed) | 23:29:02 `read 2`, reported 23:29:34 | 21 |
| 2 | 23:30:50 | `.scratch3/pty-stream.py` 90 s | 23:32:20 (exit, master closed) | reads hang from ~23:32:20; `status 2` + `read 2 --full` reported 23:34:15 | 5 |
| 3 | 23:36:37 | `pty-stream.py` 60 s | 23:37:37 | 23:37:40 `read 2`, reported 23:38:13 | 3–10 |
| 4 | 23:39:48 (debug build) | `pty-stream.py` 90 s | 23:41:18 | 23:41:40 "WEDGED at round 1"; process gone by 23:41:46 | 4 |

Corroboration from the same transcript:

- Episode 1: `ps` at 23:29:45 shows roost pid 45213 at 99.4 % CPU, state `RNs+`,
  0:50 of CPU time, i.e. spinning since ~23:28:56. `timeout 8 roost list` at
  23:30:05 exited 124.
- Episode 2: `ps` at 23:34:26 shows roost pid 46771 at 100 % CPU with 2:03 of CPU
  time: spinning since ~23:32:20, the driver's timeout, and idle before that.
  The captured stdout stopped growing at 23:32 (`/tmp/roost-stream.out`, 23 KB).
- Episode 3: roost sat at 0.0–1.1 % CPU through spawn, `first question`, `/tree`,
  and `y` (23:36:47 to 23:37:29). At 23:38:29, 52 s after the driver's timeout, it
  was at 99.0 % CPU and `sample 48797 3` was taken.
- Episode 4 was the debug build: it exited on its own instead of spinning, which is
  the "process had already exited" case in the brief.

Both scripts have the same shape: `while time.time() - start < timeout: select();
read()` then exit. `harness/pty-run.py` additionally sends SIGTERM to the child
first (`pty-run.py:125`). Neither waits for the child. Exiting closes the pty
master; the child keeps running with a hung-up controlling terminal.

## 2. The stack sample that was taken, then deleted

`/tmp/roost-hang-sample.txt` was captured at 23:38:29 (episode 3) and deleted at
23:42:33, but its content survives in the transcript's tool results. Release build,
no symbols. 1662 samples over 3 s:

```
Thread_8587570  DispatchQueue_1: com.apple.main-thread
  start → roost+0x1fc4c → … → roost+0x2e6d8
    1659  roost+0x31aa0 → read (libsystem_kernel)      <- 99.8 % of samples
Thread_8587574   __accept                              <- control-socket acceptor, idle
Thread_8587578   read                                  <- pane reader
Thread_8587916   read                                  <- pane reader
Thread_8587577 / 8587915 / 8591413   semaphore_wait_trap
Sort by top of stack: semaphore_wait_trap 4986, read 4983, __accept 1662
```

A thread that is 99 % CPU and 99.8 % "in read" is not blocked in read; it is
calling read in a tight loop that returns immediately. That is precisely the
`read(0, "", 1024) = 0` stdin-EOF spin described in `tests/terminal_hangup.rs`.
The acceptor thread is alive (so `roost list` connects), but the reply is produced
by the main loop, which never gets there (so "no reply within 30s").

Note: the brief's "every thread parked in a sample" matches this picture. Parked
threads plus one spinning main thread is what a process looks like when its main
loop is stuck in a syscall-return loop, not a starved machine.

## 3. The load spikes, and what was running

`perf.jsonl` for 09-04, every minute with load1 > 20, against the Bash commands
recorded in all Claude Code transcripts on this machine (main sessions and
subagents):

| window | peak load1 | what was running (session → command) |
|---|---|---|
| 07:48 | 129.5 (plus a 130 s gap in perf.jsonl) | tripto worker: `xcodebuild test -project Tripto.xcodeproj … iPhone 17 Pro` at 07:46:52 |
| 08:13–08:21 | 204.2 at 08:14 | tripto worker: `xcodebuild build` 08:11:52, `simctl erase/boot` 08:12:46, `xcodebuild test` (UI screenshots) 08:16:41, `swift gen_screenshots.swift` 08:19:05 |
| 11:26–11:28 | 36.6 | not traced minute by minute (below 50; opencode-tree build/test work was in progress) |
| 21:00–21:08 | 236.6 at 21:00 | chessling workers: `xcodebuild` 20:54:23, 20:55:11, 20:56:32; second simulator created and booted 20:59:33; `xctrace record` 21:01:56; plus opencode-tree `bun run typecheck` + `bun test` ×3 at 21:00:25–21:01:25 |
| 22:22–22:27 | 46.2 | not traced minute by minute (below 50) |
| 23:25 | 46.7 | not traced minute by minute (a chessling builder and an opencode-tree npm publish were both running) |
| 23:55 | 115.3 | this session, in roost: `cargo build` 23:50:10, `cargo test` 23:50:17/23:50:31/23:51:48, `cargo clippy` ×2, fresh branch `cargo build && cargo test` 23:53:43; chessling `simctl shutdown/boot` 23:54:55 |

Ten cores, 32 GB. A parallel `xcodebuild` or `cargo test` alone puts 100–200
runnable threads on this machine for a minute; that is the whole explanation for
load1 > 100. Kernel logs for the four windows show no jetsam kills or memory-
pressure events. During the 21:00 peak roost's own loop kept 1709 iterations a
minute with a 42 ms worst stall; during the 08:14 peak, 1708 and 23 ms. The load
did not stall roost's loop. The only perf.jsonl hole on 09-04 (07:48:03 →
07:50:13) happened with keys being typed into the default instance (keys=7 and 9),
during the tripto `xcodebuild test`; it cannot be tied to the plugin, which was
not running at that hour.

The driven OpenCode session with the plugin loaded ran 23:07–23:42, entirely
against the harness's mock provider (no LiteLLM, no network). The plugin's own
`CTREE_DEBUG` logs that survive from 09-03 and 09-04 show `/tree` opening in
5–35 ms and `transform.applyCrops` at 0.78 ms for 484 messages.

## 4. H1 — adoption request storm: cleared

Method: an instrumented build (uncommitted, in worktree
`.claude/worktrees/agent-a5f03202ca3c31812`, diff saved as
`scratchpad/h1h2/instrumentation.diff`) logs one `adopt.run` row per adoption
pass with the half, the trigger, and the number of `messagesOf` round-trips, and
one `lock.acquire` row per registry-lock acquisition. Same mock-provider harness as
the 09-04 driven session; `opencode serve` as its own process; a real TUI attached
to it; a sampler every 5 s. `CTREE_NO_ADOPT=1` makes `adopt()` return at once
(control). R1/R4 are the brief's scale scenario (50/100/200 turns, 2 native forks
each); R2/R3 are a deliberate storm (30 sessions × 4 turns, 2 forks each: 60
`session.created` events against a pool that grows to 90 sessions).

| run | `session.created` events | adopt passes | SDK calls per pass (median / max) | total SDK calls | adopted | peak load1 | peak server %cpu | build wall s |
|---|---|---|---|---|---|---|---|---|
| R1 scale, adoption on | 6 | 10 | 0 / 3 | 11 | 6 | 15.8 | 123 | 145 |
| R4 scale, adoption off | 6 | 20 | 0 / 0 | 0 | 0 | 8.1 | 94 | 123 |
| R2 storm, adoption on | 60 | 137 | 0 / 32 | 679 | 60 | 9.1 | 107 | 67 |
| R3 storm, adoption off | 60 | 181 | 0 / 0 | 0 | 0 | 8.7 | 92 | 78 |

- Per `session.created` event the server half makes 2 calls at the median and 3
  at most in the scale scenario; the worst single pass in the storm made 32
  (the 40-candidate bound is real). Total fetch time: 0.5 s over R1, 2.4 s over
  R2. Not thousands of round-trips: the title filter and the "already
  journaled" check cut the candidate pool before any fetch.
- The `/tree` open and `/ctree status` passes made 0 calls in every run.
- Server CPU during the build loop is dominated by the 350 prompts of the build
  itself (about 90–120 % of one core with or without adoption). `/tree` became
  interactive 2.6–3.3 s after attach regardless of session size.
- load1 never exceeded 16 in any run, and other agents' runs (H3, H4) overlapped
  on the same machine, so the load1 column is an upper bound on the plugin's
  contribution.
- One inefficiency confirmed: every `session.created` starts its own three-try
  `adoptSoon` loop, and a fork batch fires two. The first loop adopts both forks
  in one pass and stops; the second finds nothing left to adopt and still polls
  three times, one `session.list` each (R1: 3, 0, 0, 0 calls across the four rows
  of one batch). Harmless, but cheap to stop a loop as soon as a pass finds no
  adoptable session.

## 5. H2 — synchronous lock wait: cleared

Every registry-lock acquisition in the runs above, both halves:

| run | acquisitions | wait p50 / p95 / max ms | hit the 250 ms deadline |
|---|---|---|---|
| R1 | 9 | 1 / 1 / 1 | 0 |
| R2 storm | 90 | 0 / 1 / 4 | 0 |

`sleepSync` is `Atomics.wait` on a scratch buffer (`store.ts:304–308`), a real
sleep, not a busy loop. Max wait 4 ms under 60 fork events in a minute. Drop this
one.

## 6. H3 — hung provider: cleared as a cause of the wedge; one plugin finding

Method: the isolated profile's provider pointed at a listener that accepts, reads
the request, and never writes a byte (`scratchpad/h3/blackhole.mjs`). One turn
sent from the TUI (`hello`), then `ctrl+q`, then `/ctree status`, with a sampler
every 2 s; a second headless `opencode serve` against the same blackhole took the
API probe. Run B is the same script against the instant mock.

| | A: provider never replies | B: instant mock |
|---|---|---|
| time to `Ask anything` | 5.7 s | 5.9 s |
| `/tree` opens after `ctrl+q` | 16 ms | same path, instant |
| TUI still repainting during the hung turn | yes: spinner cycles, `esc interrupt` hint live | yes |
| `session.get` on the hung session from the API | 5 ms | 8 ms |
| `/ctree status` reply | never: shown as `QUEUED`, still queued at quit after 43 s | 186 ms |
| load1 during the hang | 11 → falling, never rising | 6.3 |
| server CPU during the hang | under 5 % | — |
| provider connection open | 263 s, closed only when the server was killed | per request |
| OpenCode gave up on its own | no; server stderr empty | — |

Expected if H3 were the whole story: TUI idle but responsive, load flat, roost
fine. Observed: exactly that. A stalled provider stalls the turn and nothing
else; it cannot produce a load average above 100 and did not touch roost (the
driven session on 09-04 used the mock provider anyway, §3). The roost bystander
in this run was skipped: `ROOST_STATE` under the scratchpad path exceeds the
`AF_UNIX` path limit and the CLI refused it. §7's R0 covers the same question
directly: roost answered `roost list` in 33 ms median for three minutes with an
OpenCode pane running the plugin.

Plugin finding from this run: `/ctree status` is dispatched as a turn and queues
behind the stuck one, so it is not an escape hatch while a provider hangs.
`/tree` is: it opens synchronously from the local journal, and the adoption pass
it kicks off runs off the critical path. Worth a line in USAGE.md, or answering
`/ctree status` from the TUI half.

## 7. Replay: the 09-04 sequence, same driver, current roost build

Binary: an unstripped copy of `~/repos/roost/target/debug/roost` built 09-06 from
`c3e2dff` (includes PR #173, the hangup rescue, and PR #183, the stall watchdog),
run with `ROOST_WATCHDOG=1 ROOST_DEBUG=1` and a dedicated `ROOST_STATE`. Same
OpenCode project, mock provider, plugin dist, and driven keys as 09-04 (`spawn
opencode`, `first question`, `/tree`, enter, `y`). A poller timed `roost list`
every 3 s. Artifacts in `scratchpad/h4/`.

| run | driver | wedged | after driver stopped | roost CPU | `roost list` |
|---|---|---|---|---|---|
| R0 control | drains for 600 s | no | — | 0.4–0.7 % | 33 ms median over 60 polls |
| R1 = 09-04 | `--timeout 60`, driver exits, master closes | no: roost **exits on its own** ~3 s later | — | — | connection refused from t+63 s |
| R2 variant | `--timeout 60`, driver stops reading but keeps the master open | **yes, sustained** | first hung call ~15 s after the driver stopped | 0.0 %, CPU time frozen | >12 s timeout on every poll for 90 s+; needed SIGKILL |
| R3 no pane | `--timeout 30`, master closes | no: exits at once | — | — | — |

- R1 shows PR #173 working: with the master closed, roost now exits with the
  forced-teardown path instead of spinning. The 09-04 release binary
  (`target/release/roost`, whatever was on disk at 23:06) therefore predates
  #173; its stack sample is the pre-#173 signature. The 09-04 debug build, built
  at 23:39 from a checkout that had #173, is the episode that "exited on its
  own". Both episode shapes are explained.
- R2 is a second, still-open way for a harness to wedge roost. Symbolized main
  thread from `R2.sample.txt`, 2350 of 2350 samples:

  ```
  Terminal::try_draw → apply_buffer_with_cursor → Terminal::show_cursor (cursor.rs:31)
    → CrosstermBackend::show_cursor (lib.rs:299) → Stdout::flush → BufWriter::flush_buf
    → write (libsystem_kernel)
  ```

  No thread reads the controlling tty (the fd-0 hangup watcher is quiet, correctly:
  there is no HUP). The main thread is blocked writing render output into a pty
  nobody drains, and the control socket's replies are produced by that same loop.
  The watchdog caught it: `state-R2/watchdog.log` records `stall_gap_ms: 3581`
  with `watchdog-1788706307.sample.txt` alongside. This is the artifact the brief
  asked for on the next occurrence, produced on demand.
- This is the same mechanism as the 2026-08-07 lesson already in the notes store
  ("a black-box harness that runs a TUI under a pty must drain the pty
  continuously"). It has now bitten twice.

## 8. What to fix, where

roost (hand-back for H4, with artifacts):

1. The 09-04 spin is fixed by PR #173; the only action is to make sure the
   binary people actually run has it (the homebrew 0.1.20 does).
2. R2 is open: a pty that stops being drained blocks the main loop inside
   `Terminal::draw` and takes the control socket down with it. Options, in order
   of how little they change: answer control requests from a thread that does not
   share the render path; or make stdout non-blocking and drop frames when the
   terminal is not consuming them. `state-R2/watchdog.log` and its sample show the
   exact frames.

opencode-tree harness (the actual cause of both 09-04 episodes):

3. `harness/pty-run.py` and any ad-hoc driver must not leave a child behind when
   their `--timeout` elapses. `pty-run.py:125` sends SIGTERM and exits; the
   09-04 ad-hoc `pty-stream.py` just exited. Either wait for the child to die
   (SIGTERM, grace, SIGKILL, `waitpid`) or keep draining until it does. A driver
   that launches roost for a multi-minute driven session needs a timeout longer
   than the session, or none.
4. Record the driver's stop time in its own log. Every hang report on 09-04 was
   dated by the control call that noticed it, 3 to 30 s later, which is why the
   correlation took a transcript reconstruction instead of a glance.

opencode-tree plugin (not implicated, still worth doing):

5. Stop an `adoptSoon` loop as soon as a pass finds nothing adoptable; the
   sibling loop of every fork batch polls three times for nothing (§4).
6. Put an `AbortSignal` with a timeout on the SDK calls listed in the brief. The
   measurements show they never pile up in the scenarios tested, but a timeout
   is the difference between "the plugin degraded" and "the plugin hung with the
   server" if a provider ever does stall the server.

Not worth doing: capping or batching adoption (max 32 round-trips under a
deliberate storm, 3 in the real scenario), async lock waits (max 4 ms), moving
lock waits out of hooks.

## 9. Artifacts

Scratchpad root:
`/private/tmp/claude-501/-Users-naveen-repos-opencode-tree/e22ef938-1e5c-4b0c-bdb7-82729cb4f90a/scratchpad/`

- `h1h2/`: `summary.md`, `summary.json`, `instrumentation.diff`,
  `ctree-R{1,2,3,4}.log` (every `adopt.run` and `lock.acquire` row),
  `sampler-R*.csv`, `manifest-R*.json`, the run scripts. Instrumented worktree:
  `.claude/worktrees/agent-a5f03202ca3c31812` (uncommitted).
- `h3/`: `screens-{A,B}.txt`, `timing-{A,B}.json`, `sampler-{A,B}.csv`,
  `blackhole.log` (accept and close times), `api-probe-{A,B}.json`,
  `ctree-tui-{A,B}.log`, `ctree-api-{A,B}.log`, the driver and blackhole scripts.
- `h4/`: `R{0,1,2,3}.poll.csv`, `R2.sample.txt`, `state-R2/watchdog.log`,
  `state-R2/watchdog-1788706307.sample.txt`, `state-R2/perf.jsonl`,
  `state-R2/control.log`, the driver and poller scripts, `roost-repro`.
- `control/tty-loss-homebrew.log`: homebrew roost 0.1.20, no pane; exits within
  5 s of the master closing; a 30 s no-drain window with the master open did
  not wedge it (nothing to draw).
- The 09-04 sample recovered from the transcript is quoted in §2; the original
  file was deleted at 23:42:33 that night.
- roost's default-workspace `perf.jsonl` and the Claude Code transcripts under
  `~/.claude/projects/` are the sources for §1 and §3 and were not modified.
