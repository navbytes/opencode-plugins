# Brief: did opencode-context-tree (or a hung LiteLLM connection) cause the 2026-09-04 hangs?

Handoff from the roost side. Read-only on roost; you own the investigation
on the plugin side. Goal: reproduce or rule out each hypothesis below with
numbers, not a fix. Fixes come after the diagnosis.

## What happened

On 2026-09-04, while a driven OpenCode session with this plugin loaded was
running inside roost (terminal multiplexer, `~/repos/roost`), roost wedged
twice: sustained ~100% CPU, every thread parked in a `sample`, and roost's
control socket accepting connections but never answering (`roost: connected,
but no reply within 30s`). Each episode lasted 30s or more. Neither was
captured: by the time `sample` ran the state was gone, and once the process
had already exited on its own.

roost's response was PR navbytes/roost#183: an opt-in stall watchdog
(`ROOST_WATCHDOG=1`) that captures a backtrace automatically next time. It
does not explain the hang; this brief is about finding the cause.

## Evidence that survives

Only the default roost workspace's logs survive
(`~/Library/Application Support/roost/`). The driven session ran against a
different roost instance (its `control.log`, which records every control
action unconditionally, has one request all day on 09-04), and that
instance's isolated state dir is gone. So the surviving data describes the
machine, not the wedged process.

From `perf.jsonl` (one line per minute: loop iterations, scheduling-stall
histogram, 1-minute load average), local time +0800, 2026-09-04:

| time  | load1  | loop iters/min | worst scheduling stall |
|-------|--------|----------------|------------------------|
| 07:43 | 7.1    | 1665           | 289 ms                 |
| 07:48 | 129.5  | 1706           | 239 ms                 |
| 08:13 | 81.2   | 1680           | 118 ms                 |
| 21:09 | 13.4   | 1709           | 365 ms                 |
| 23:55 | 115.3  | 1651           | 184 ms                 |

Normal is load1 around 5 to 8 and about 1650 iterations a minute. There is
one hole in the log, 07:48:03 to 07:50:13, during the load spike: either a
restart or a full minute with zero loop iterations. A second hole at 00:24
on 09-05 coincides with a roost restart (lock file mtime), so holes are not
proof of a wedge on their own.

The important fact is the load average. macOS load counts runnable threads.
A value above 100 means CPU-bound work at scale, not processes waiting on a
socket. Whatever happened at 07:48 and 23:55 was burning CPU across many
threads or processes. Correlate these two timestamps with your own logs
(`CTREE_DEBUG` files, `harness/pty-run.py` timing JSON, the isolated XDG
profile's OpenCode server logs) to identify what was running.

## Hypotheses, ranked by fit to the evidence

### H1. Plugin-driven request storm saturates the OpenCode server

`src/shared/adopt.ts`: for every adoptable session, one `messagesOf` fetch,
then up to `MAX_CANDIDATES = 40` more, sequential, per fork (`adopt.ts:24`,
`:31`, `:56-68`). Both halves run it, on every `session.created` with three
1-second retries (`src/server/index.ts:138-141`, `src/tui/index.tsx:99-102`),
and again on `/tree` open and `/ctree status`. In the scale scenario
(`scratchpad/perf-build.ts`, SIZES 50/100/200, forks auto-adopted) that is
potentially thousands of SDK round-trips into one Bun server. None of the
SDK calls carry a timeout or AbortSignal (`src/server/index.ts:109, 129, 180,
190, 199, 233`; `src/tui/index.tsx:86`; `src/tui/transcripts.ts:54, 56`), so
once the server is slow, callers pile up rather than fail.

Fits: the load average, the "100% CPU", and roost appearing wedged (a
starved machine makes every process look wedged; parked threads in a
`sample` are what starvation looks like).

Test: rerun the scale build with `CTREE_DEBUG` set and count SDK calls per
`session.created`; record `uptime` every 5s and the OpenCode server's CPU
(`top -pid <server>`) during the run; repeat with adoption stubbed out
(`messagesOf` returning `[]`). Report calls per event, peak load1, peak
server CPU, both ways.

### H2. Synchronous lock wait blocks a half's event loop

`src/shared/store.ts:126-158`: registry lock acquisition is a `for (;;)`
loop around `fs.openSync(.., "wx")` with `sleepSync(5)` (`store.ts:157`,
`:306`), bounded by `LOCK_TIMEOUT_MS = 250` (`store.ts:30`). Synchronous, so
it blocks the JavaScript event loop of whichever half runs it. Bounded, so
alone it cannot produce a 30s hang. Under H1-scale contention between the
two halves it could stack up.

Test: log lock wait durations; count how many writes hit the 250ms deadline
during the scale build. If it is rarely above a few ms, drop this one.

### H3. Hung LiteLLM connection

The plugin never references LiteLLM; the provider is configured at the
OpenCode server level. A model request that never returns hangs OpenCode's
turn and anything awaiting it, and the plugin's timeout-less SDK calls would
hang with it. That explains an OpenCode "hang". It does not explain a load
average above 100 (a blocked socket is not runnable), and it does not
explain roost wedging (roost never talks to LiteLLM).

Test: point the isolated profile at a blackhole endpoint (a listener that
accepts and never replies, e.g. a tiny Python server that sleeps forever),
send one turn. Observe: does the TUI stay interactive? Does `/tree` open?
Does load1 rise? Does roost keep answering `roost fleet list`? Expected if
H3 is the whole story: TUI idle but responsive, load flat, roost fine.

### H4. roost's own bug

If H1 to H3 all reproduce cleanly without wedging roost, the wedge lives in
roost. The watchdog exists for that case; see below.

## Run so evidence survives next time

- Launch roost with `ROOST_WATCHDOG=1 ROOST_DEBUG=1` and a dedicated
  `ROOST_STATE=<dir>`. Do not delete that dir after the run. It will hold
  `control.log`, `perf.jsonl`, `roost.log`, and on a stall `watchdog.log`
  plus `watchdog-<ts>.sample.txt` (a full all-threads backtrace).
- Set `CTREE_DEBUG=<file>` for the plugin.
- Run `opencode serve` as its own process so its CPU is visible separately
  from the TUI.
- Record `uptime` every 5s to a file for the whole run.
- At the first sign of a hang: `top -l 1 -o cpu | head -20`, then
  `sample <pid> 2 -f <file>` for the OpenCode server, the TUI, and roost.
- Keep everything on one clock; note the time when the hang starts.

## Report back

For each of H1 to H3: reproduced or cleared, with the numbers the test
asked for. If reproduced, the minimal trigger (session count, event) and
the proposed fix (timeouts and AbortSignal on SDK calls, capping or
batching adoption, an async lock wait, or moving lock waits out of hooks).
If nothing reproduces, say so and hand H4 back to roost with the watchdog
artifacts from the next occurrence.
