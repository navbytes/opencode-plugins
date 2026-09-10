import { describe, expect, test } from "bun:test"
import { applyFailure, applyLookup, collectChips, dueForRefresh, mapChips, markStale, MAX_CHIPS_PER_SESSION, mergeChips, refreshDelay, REFRESH_MS, staleAfterTurn, visibleChips } from "../src/core/tracker.js"
import type { PrChip } from "../src/core/pr.js"

const NOW = 1_000_000

describe("collectChips", () => {
  test("marks the PR a `gh pr create` printed as created here", () => {
    const [chip] = collectChips([{ command: "gh pr create --fill", output: "https://github.com/a/b/pull/3\n" }], NOW)
    expect(chip).toMatchObject({ number: 3, created: true, state: "unknown", seen: NOW, checked: 0 })
  })

  test("a PR merely viewed is tracked, but not as created here", () => {
    const [chip] = collectChips([{ command: "gh pr view 3", output: "https://github.com/a/b/pull/3" }], NOW)
    expect(chip).toMatchObject({ number: 3, created: false })
  })

  test("finds a PR named only in the command", () => {
    const [chip] = collectChips([{ command: "gh pr merge https://github.com/a/b/pull/9 --squash", output: "Merged" }], NOW)
    expect(chip!.number).toBe(9)
  })

  test("one chip per PR even when several calls mention it, and create wins", () => {
    const chips = collectChips(
      [
        { command: "gh pr view 3", output: "https://github.com/a/b/pull/3" },
        { command: "gh pr create --fill", output: "https://github.com/a/b/pull/3" },
      ],
      NOW,
    )
    expect(chips).toHaveLength(1)
    expect(chips[0]!.created).toBe(true)
  })

  test("keeps first-seen order across calls", () => {
    const chips = collectChips(
      [{ output: "https://github.com/a/b/pull/2" }, { output: "https://github.com/a/b/pull/1" }],
      NOW,
    )
    expect(chips.map((c) => c.number)).toEqual([2, 1])
  })

  test("no tool calls, no chips", () => {
    expect(collectChips([], NOW)).toEqual([])
    expect(collectChips([{ command: "ls", output: "a b c" }], NOW)).toEqual([])
  })
})

describe("mergeChips", () => {
  const seed = (over: Partial<PrChip> = {}): PrChip => ({
    host: "github.com",
    owner: "a",
    repo: "b",
    number: 1,
    url: "https://github.com/a/b/pull/1",
    key: "github.com/a/b#1",
    state: "merged",
    created: false,
    seen: 500,
    checked: 900,
    failures: 0,
    ...over,
  })

  test("a rescan never resets a state we already fetched", () => {
    const merged = mergeChips([seed()], collectChips([{ output: "https://github.com/a/b/pull/1" }], NOW))
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ state: "merged", seen: 500, checked: 900 })
  })

  test("a rescan can promote a chip to created here", () => {
    const merged = mergeChips([seed()], collectChips([{ command: "gh pr create", output: "https://github.com/a/b/pull/1" }], NOW))
    expect(merged[0]!.created).toBe(true)
  })

  test("new PRs are appended after the ones already on screen", () => {
    const merged = mergeChips([seed()], collectChips([{ output: "https://github.com/a/b/pull/2" }], NOW))
    expect(merged.map((c) => c.number)).toEqual([1, 2])
  })

  test("does not mutate the previous array or its chips", () => {
    const prev = [seed()]
    mergeChips(prev, collectChips([{ command: "gh pr create", output: "https://github.com/a/b/pull/1" }], NOW))
    expect(prev[0]!.created).toBe(false)
  })

  test("stops at the cap rather than letting one command mint a chip per PR in the repo", () => {
    const flood = collectChips([{ output: Array.from({ length: 200 }, (_, i) => `https://github.com/a/b/pull/${i + 1}`).join("\n") }], NOW)
    expect(flood.length).toBe(200)
    const merged = mergeChips([], flood)
    expect(merged).toHaveLength(MAX_CHIPS_PER_SESSION)
    // the cap keeps the earliest sightings, it does not evict them
    expect(merged[0]!.number).toBe(1)
  })

  test("a chip already on screen still updates once the cap is reached", () => {
    const full = mergeChips([], collectChips([{ output: Array.from({ length: 40 }, (_, i) => `https://github.com/a/b/pull/${i + 1}`).join("\n") }], NOW))
    const again = mergeChips(full, collectChips([{ command: "gh pr create", output: "https://github.com/a/b/pull/1" }], NOW))
    expect(again).toHaveLength(MAX_CHIPS_PER_SESSION)
    expect(again[0]!.created).toBe(true)
  })
})

describe("refresh policy", () => {
  const chip = (state: PrChip["state"], checked: number): PrChip => ({
    host: "github.com",
    owner: "a",
    repo: "b",
    number: 1,
    url: "u",
    key: "k",
    state,
    created: false,
    seen: 0,
    checked,
    failures: 0,
  })

  test("a brand new chip is due immediately", () => {
    expect(dueForRefresh(chip("unknown", 0), NOW)).toBe(true)
  })

  test("a merged PR is never re-fetched", () => {
    expect(REFRESH_MS.merged).toBe(Number.POSITIVE_INFINITY)
    expect(dueForRefresh(chip("merged", 0), NOW)).toBe(false)
  })

  test("an open PR waits out its interval, then is due", () => {
    expect(dueForRefresh(chip("open", NOW - 1_000), NOW)).toBe(false)
    expect(dueForRefresh(chip("open", NOW - REFRESH_MS.open), NOW)).toBe(true)
  })

  test("a finished turn restates everything except merged", () => {
    expect(staleAfterTurn(chip("open", NOW))).toBe(true)
    expect(staleAfterTurn(chip("closed", NOW))).toBe(true)
    expect(staleAfterTurn(chip("draft", NOW))).toBe(true)
    expect(staleAfterTurn(chip("merged", NOW))).toBe(false)
  })

  test("applyLookup stamps the state and keeps a title it already had", () => {
    const updated = applyLookup({ ...chip("unknown", 0), title: "Old" }, "open", undefined, NOW)
    expect(updated).toMatchObject({ state: "open", title: "Old", checked: NOW })
  })

  test("applyLookup takes a fresh title when gh returns one", () => {
    expect(applyLookup(chip("unknown", 0), "draft", "New", NOW).title).toBe("New")
  })

  test("a failing gh backs a chip off instead of being re-spawned every tick", () => {
    let c = chip("unknown", 0)
    expect(refreshDelay(c)).toBe(REFRESH_MS.unknown)
    c = applyFailure(c, NOW)
    expect(c.failures).toBe(1)
    expect(c.checked).toBe(NOW)
    expect(refreshDelay(c)).toBe(REFRESH_MS.unknown * 2)
    // it is not due again the moment the un-backed-off interval elapses
    expect(dueForRefresh(c, NOW + REFRESH_MS.unknown)).toBe(false)
  })

  test("the backoff settles rather than growing without bound", () => {
    let c = chip("unknown", 0)
    for (let i = 0; i < 50; i++) c = applyFailure(c, NOW)
    expect(refreshDelay(c)).toBe(REFRESH_MS.unknown * 64)
  })

  test("a merged PR stays never-refetched however many failures preceded it", () => {
    const c = applyFailure({ ...chip("merged", 0) }, NOW)
    expect(refreshDelay(c)).toBe(Number.POSITIVE_INFINITY)
  })

  test("a finished turn clears the backoff so a just-fixed gh is retried", () => {
    let c = chip("open", NOW)
    for (let i = 0; i < 5; i++) c = applyFailure(c, NOW)
    const fresh = markStale(c)
    expect(fresh).toMatchObject({ checked: 0, failures: 0 })
    expect(dueForRefresh(fresh, NOW)).toBe(true)
  })

  test("a success clears the backoff", () => {
    const failed = applyFailure(applyFailure(chip("unknown", 0), NOW), NOW)
    expect(applyLookup(failed, "open", undefined, NOW).failures).toBe(0)
  })
})

describe("mapChips", () => {
  const chip = (key: string, state: PrChip["state"] = "unknown"): PrChip => ({ host: "github.com", owner: "a", repo: "b", number: 1, url: "u", key, state, created: false, seen: 0, checked: 0, failures: 0 })

  test("updates the same PR in every session that tracks it", () => {
    const before = { s1: [chip("k"), chip("other")], s2: [chip("k")] }
    const after = mapChips(before, "k", (c) => ({ ...c, state: "merged" }))
    expect(after.s1![0]!.state).toBe("merged")
    expect(after.s2![0]!.state).toBe("merged")
    expect(after.s1![1]!.state).toBe("unknown")
  })

  test("returns the identical object when the key is not tracked, so nothing re-renders", () => {
    const before = { s1: [chip("k")] }
    expect(mapChips(before, "absent", (c) => ({ ...c, state: "merged" }))).toBe(before)
  })

  test("does not mutate the previous state", () => {
    const before = { s1: [chip("k")] }
    mapChips(before, "k", (c) => ({ ...c, state: "closed" }))
    expect(before.s1[0]!.state).toBe("unknown")
  })
})

describe("visibleChips", () => {
  const chip = (key: string): PrChip => ({ host: "github.com", owner: "a", repo: "b", number: 1, url: "u", key, state: "open", created: false, seen: 0, checked: 0, failures: 0 })

  test("hides exactly what was dismissed", () => {
    expect(visibleChips([chip("x"), chip("y")], new Set(["x"])).map((c) => c.key)).toEqual(["y"])
  })

  test("nothing dismissed, nothing hidden", () => {
    expect(visibleChips([chip("x")], new Set())).toHaveLength(1)
  })
})
