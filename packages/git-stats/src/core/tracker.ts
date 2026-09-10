/**
 * Which pull requests this session has touched, and when each chip is worth asking
 * `gh` about again. Pure over its inputs so the policy can be tested without a session.
 */
import { DEFAULT_HOSTS, findPrRefs, isPrCreateCommand, prKey, type PrChip, type PrState } from "./pr.js"

/** One finished tool call, reduced to the two fields a PR can hide in. */
export type ToolCall = { command?: string; output?: string }

/**
 * No sidebar wants more than this, and it is the backstop against one `gh pr list --json url`
 * minting a chip — and a `gh` process — per pull request in the repository.
 */
export const MAX_CHIPS_PER_SESSION = 24

/** Chips found in this pass, in first-seen order, all with state still unknown. */
export function collectChips(calls: readonly ToolCall[], now: number, hosts: readonly string[] = DEFAULT_HOSTS): PrChip[] {
  const found = new Map<string, PrChip>()
  for (const call of calls) {
    const created = isPrCreateCommand(call.command)
    // The command itself carries a PR URL for `gh pr merge <url>` and friends.
    for (const ref of [...findPrRefs(call.output, hosts), ...findPrRefs(call.command, hosts)]) {
      const key = prKey(ref)
      const prior = found.get(key)
      if (prior) {
        if (created) prior.created = true
        continue
      }
      found.set(key, { ...ref, key, state: "unknown", created, seen: now, checked: 0, failures: 0 })
    }
  }
  return [...found.values()]
}

/**
 * Fold a fresh scan into what we already knew: sightings and states already fetched
 * survive, so a re-render never resets a chip to "…" or reorders the row. Past the cap,
 * new pull requests are dropped rather than pushing the earlier ones out.
 */
export function mergeChips(prev: readonly PrChip[], next: readonly PrChip[], max = MAX_CHIPS_PER_SESSION): PrChip[] {
  const out = prev.map((c) => ({ ...c }))
  const byKey = new Map(out.map((c) => [c.key, c]))
  for (const chip of next) {
    const prior = byKey.get(chip.key)
    if (prior) {
      if (chip.created) prior.created = true
      continue
    }
    if (out.length >= max) continue
    const copy = { ...chip }
    out.push(copy)
    byKey.set(copy.key, copy)
  }
  return out
}

/**
 * How stale a state may get before it is worth another `gh` call. A merged PR is done, so
 * it is never re-fetched; everything else is cheap enough to keep honest. A session that
 * just went idle refreshes out of band (see `staleAfterTurn`), so these are floors, not
 * the only way a chip updates.
 */
export const REFRESH_MS: Record<PrState, number> = {
  unknown: 15_000,
  open: 90_000,
  draft: 90_000,
  closed: 300_000,
  merged: Number.POSITIVE_INFINITY,
}

/** Six doublings: a chip whose `gh` call keeps failing settles at ~16 minutes, not ~15 seconds. */
const MAX_BACKOFF_DOUBLINGS = 6

export function refreshDelay(chip: Pick<PrChip, "state" | "failures">): number {
  const base = REFRESH_MS[chip.state]
  if (!Number.isFinite(base)) return base
  return base * 2 ** Math.min(chip.failures, MAX_BACKOFF_DOUBLINGS)
}

export function dueForRefresh(chip: PrChip, now: number): boolean {
  return now - chip.checked >= refreshDelay(chip)
}

/** After a turn ends, anything not already merged may have just changed. */
export function staleAfterTurn(chip: PrChip): boolean {
  return chip.state !== "merged"
}

/**
 * Due again now. The backoff is cleared with it: a turn boundary is also when the user
 * may have installed `gh` or logged in, and one retry per turn is not a spawn storm.
 */
export function markStale(chip: PrChip): PrChip {
  return { ...chip, checked: 0, failures: 0 }
}

export function applyLookup(chip: PrChip, state: PrState, title: string | undefined, now: number): PrChip {
  return { ...chip, state, title: title ?? chip.title, checked: now, failures: 0 }
}

/** A `gh` call that did not answer: stamp the attempt and lengthen the next wait. */
export function applyFailure(chip: PrChip, now: number): PrChip {
  return { ...chip, checked: now, failures: chip.failures + 1 }
}

/** Dismissal is per session and per chip; the set is what the TUI persists in `api.kv`. */
export function visibleChips(chips: readonly PrChip[], dismissed: ReadonlySet<string>): PrChip[] {
  return chips.filter((c) => !dismissed.has(c.key))
}

/** Replace one chip wherever it appears, across every session that tracks it. */
export function mapChips(prev: Record<string, PrChip[]>, key: string, fn: (chip: PrChip) => PrChip): Record<string, PrChip[]> {
  let changed = false
  const next: Record<string, PrChip[]> = {}
  for (const [sessionID, list] of Object.entries(prev)) {
    const mapped = list.map((c) => (c.key === key ? fn(c) : c))
    if (mapped.some((c, i) => c !== list[i])) changed = true
    next[sessionID] = mapped
  }
  return changed ? next : prev
}
