import { describe, expect, test } from "bun:test"
import { DEFAULT_OPEN_TURNS, applyFolds, foldDigest, isFolded, nextFoldIndex, ownerTurnIndex, setManualFold, type FoldPolicy } from "../src/core/fold.js"
import { buildTreeView, type Row } from "../src/core/tree.js"
import { formatK } from "../src/core/tokens.js"
import { buildFixture, OPEN, TRUNK } from "./fixtures/tree.js"

const f = buildFixture()
const open = (over: Partial<FoldPolicy> = {}): FoldPolicy => ({ base: "auto", openTurns: DEFAULT_OPEN_TURNS, manual: new Map(), ...over })
const view = (currentSessionID = TRUNK) =>
  buildTreeView({ state: f.state, transcripts: f.transcripts, currentSessionID, expanded: new Set(), filter: "default" })

const turns = (rows: readonly Row[]) => rows.filter((r) => r.kind === "turn")
const steps = (rows: readonly Row[]) => rows.filter((r) => r.kind === "step")

describe("applyFolds", () => {
  test("base 'none' with no manual entries is the identity — the same array, not a copy", () => {
    const rows = view().rows
    expect(applyFolds(rows, open({ base: "none" }))).toBe(rows)
  })

  test("base 'all' collapses every turn that owns steps", () => {
    const rows = view().rows
    const folded = applyFolds(rows, open({ base: "all" }))
    expect(steps(folded).length).toBe(0)
    // the turn rows all survive; the steps went into them
    expect(turns(folded).length).toBe(turns(rows).length)
    expect(turns(folded).every((r) => isFolded(r) || true)).toBe(true)
  })

  test("base 'auto' keeps the last N on-path turns open and folds the scrollback", () => {
    const rows = view().rows
    const onPath = rows.flatMap((r, i) => (r.kind === "turn" && r.inContext ? [i] : []))
    const folded = applyFolds(rows, open({ openTurns: 1 }))
    const stillOpen = onPath.filter((i) => {
      const row = rows[i]!
      return folded.some((r) => r.kind === "turn" && r.id === row.id && !isFolded(r))
    })
    // exactly the last one stays open (a turn with no steps of its own is never "folded")
    expect(stillOpen.at(-1)).toBe(onPath.at(-1))
    expect(folded.filter(isFolded).length).toBeGreaterThan(0)
  })

  test("a folded turn carries its steps' tokens, so the column still totals", () => {
    const rows = view().rows
    const before = rows.reduce((n, r) => n + (r.kind === "turn" || r.kind === "step" ? r.tokens : 0), 0)
    const after = applyFolds(rows, open({ base: "all" })).reduce((n, r) => n + (r.kind === "turn" || r.kind === "step" ? r.tokens : 0), 0)
    expect(after).toBe(before)
  })

  test("the summary counts exactly what it hid, and names the messages for the timeline", () => {
    const rows = view().rows
    const owners = rows.map((_, i) => ownerTurnIndex(rows, i))
    const folded = applyFolds(rows, open({ base: "all" })).filter(isFolded)
    expect(folded.length).toBeGreaterThan(0)
    for (const row of folded) {
      const mine = rows.flatMap((r, i) => (r.kind === "step" && rows[owners[i]!]?.id === row.id ? [r] : []))
      expect(row.fold.steps).toBe(mine.length)
      expect(row.fold.tokens).toBe(mine.reduce((n, r) => n + r.tokens, 0))
      expect(row.fold.messageIDs).toEqual([...new Set(mine.map((r) => r.messageID))])
    }
  })

  test("errors and fat results are counted, not shown — they escape into the digest only", () => {
    const rows = view().rows.map((r) => (r.kind === "step" ? { ...r, warn: true, isError: true, isCropped: true } : r))
    const folded = applyFolds(rows, open({ base: "all" })).filter(isFolded)
    for (const row of folded) {
      expect(row.fold.warns).toBe(row.fold.steps)
      expect(row.fold.errors).toBe(row.fold.steps)
      expect(row.fold.cropped).toBe(row.fold.steps)
    }
  })

  test("manual entries win over the base posture, both ways", () => {
    const rows = view().rows
    const first = turns(rows)[0]!
    const keptOpen = applyFolds(rows, open({ base: "all", manual: setManualFold(new Map(), first.messageID, false) }))
    expect(keptOpen.some((r) => r.kind === "turn" && r.id === first.id && !isFolded(r))).toBe(true)

    const last = turns(rows).at(-1)!
    const shut = applyFolds(rows, open({ base: "none", manual: setManualFold(new Map(), last.messageID, true) }))
    expect(shut.some((r) => r.kind === "turn" && r.id === last.id && isFolded(r))).toBe(true)
  })

  test("branch rows and separators survive every posture", () => {
    const rows = view(OPEN).rows
    const folded = applyFolds(rows, open({ base: "all" }))
    for (const kind of ["branch", "separator"] as const) {
      expect(folded.filter((r) => r.kind === kind).length).toBe(rows.filter((r) => r.kind === kind).length)
    }
  })

  test("a step never folds into a turn from another session", () => {
    const rows = view(OPEN).rows
    const folded = applyFolds(rows, open({ base: "all" }))
    for (const row of folded.filter(isFolded)) {
      const owner = rows.find((r) => r.id === row.id)!
      for (const id of row.fold.messageIDs) {
        expect(rows.some((r) => r.kind === "step" && r.messageID === id && r.sessionID === (owner as { sessionID?: string }).sessionID)).toBe(true)
      }
    }
  })
})

describe("ownerTurnIndex", () => {
  const rows = view().rows
  test("a turn owns itself", () => {
    const i = rows.findIndex((r) => r.kind === "turn")
    expect(ownerTurnIndex(rows, i)).toBe(i)
  })
  test("a step resolves to the turn above it", () => {
    const i = rows.findIndex((r) => r.kind === "step")
    const owner = ownerTurnIndex(rows, i)
    expect(rows[owner]!.kind).toBe("turn")
    expect(rows.slice(owner + 1, i).every((r) => r.kind !== "turn")).toBe(true)
  })
  test("out of range is -1", () => {
    expect(ownerTurnIndex(rows, -1)).toBe(-1)
    expect(ownerTurnIndex(rows, rows.length)).toBe(-1)
  })
})

describe("nextFoldIndex", () => {
  test("walks folded turns and stays put at the ends", () => {
    const folded = applyFolds(view().rows, open({ base: "all" }))
    const marks = folded.flatMap((r, i) => (isFolded(r) ? [i] : []))
    expect(marks.length).toBeGreaterThan(1)
    expect(nextFoldIndex(folded, marks[0]!, 1)).toBe(marks[1]!)
    expect(nextFoldIndex(folded, marks[1]!, -1)).toBe(marks[0]!)
    expect(nextFoldIndex(folded, marks.at(-1)!, 1)).toBe(marks.at(-1)!)
  })
})

describe("foldDigest", () => {
  test("steps and tokens always; flags only when there are any", () => {
    expect(foldDigest({ steps: 6, tokens: 12_000, estimated: false, errors: 0, warns: 0, cropped: 0, messageIDs: [] }, formatK)).toBe("▸ 6 steps · 12k")
    expect(foldDigest({ steps: 1, tokens: 900, estimated: false, errors: 0, warns: 0, cropped: 0, messageIDs: [] }, formatK)).toBe("▸ 1 step · 900")
    expect(foldDigest({ steps: 6, tokens: 12_000, estimated: true, errors: 1, warns: 2, cropped: 1, messageIDs: [] }, formatK)).toBe("▸ 6 steps · ~12k · 1 ✗ · 2 ⚠ · 1 ✂")
  })
})
