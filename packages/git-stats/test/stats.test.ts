import { describe, expect, test } from "bun:test"
import { EMPTY_SUMMARY, clip, compact, fileCountLabel, summarize } from "../src/core/stats.js"

describe("summarize", () => {
  test("adds up a working tree", () => {
    expect(summarize([
      { file: "a.ts", additions: 10, deletions: 2 },
      { file: "b.ts", additions: 1, deletions: 0 },
    ])).toEqual({ files: 2, additions: 11, deletions: 2 })
  })

  test("a clean tree is zero, not a crash", () => {
    expect(summarize([])).toEqual(EMPTY_SUMMARY)
    expect(summarize(undefined)).toEqual(EMPTY_SUMMARY)
  })

  test("counts a file the endpoint reported without figures", () => {
    expect(summarize([{ file: "bin", additions: 0, deletions: 0, status: "added" }])).toEqual({ files: 1, additions: 0, deletions: 0 })
  })
})

describe("fileCountLabel", () => {
  test("singular and plural", () => {
    expect(fileCountLabel(1)).toBe("1 file")
    expect(fileCountLabel(0)).toBe("0 files")
    expect(fileCountLabel(7)).toBe("7 files")
  })
})

describe("clip", () => {
  test("leaves anything that fits alone", () => {
    expect(clip("main", 38)).toBe("main")
    expect(clip("exactly-ten", 11)).toBe("exactly-ten")
  })

  test("never exceeds the width it was given", () => {
    const out = clip("a-very-long-feature-branch-name-indeed", 12)
    expect(out).toBe("a-very-long…")
    expect(out).toHaveLength(12)
  })

  test("degenerate widths do not produce garbage", () => {
    expect(clip("main", 0)).toBe("")
    expect(clip("main", -3)).toBe("")
    expect(clip("main", 1)).toBe("…")
  })
})

describe("compact", () => {
  test("leaves small numbers alone", () => {
    expect(compact(0)).toBe("0")
    expect(compact(999)).toBe("999")
  })

  test("shortens thousands so the line fits a narrow sidebar", () => {
    expect(compact(1000)).toBe("1k")
    expect(compact(1234)).toBe("1.2k")
    expect(compact(12345)).toBe("12k")
  })
})
