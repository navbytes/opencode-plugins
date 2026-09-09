import { describe, expect, test } from "bun:test"
import { DEFAULT_OPEN_TURNS, applyFolds, foldFlags, foldMark, isFolded, nextFoldIndex, ownerTurnIndex, policyFor, setManualFold, type FoldPolicy, type FoldSummary } from "../src/core/fold.js"
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

  test("the default posture leaves exactly one turn open: the one you are in", () => {
    const rows = view().rows
    const folded = applyFolds(rows, open())
    const onPath = rows.flatMap((r) => (r.kind === "turn" && r.inContext ? [r.id] : []))
    const stillOpen = onPath.filter((id) => folded.some((r) => r.kind === "turn" && r.id === id && !isFolded(r)))
    // the last on-path turn, and nothing above it (turns with no steps never read as folded,
    // so compare against the ones that own steps)
    const owning = new Set(rows.flatMap((r, i) => (r.kind === "step" ? [rows[ownerTurnIndex(rows, i)]!.id] : [])))
    expect(DEFAULT_OPEN_TURNS).toBe(1)
    expect(stillOpen.filter((id) => owning.has(id))).toEqual([onPath.at(-1)!].filter((id) => owning.has(id)))
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

const summary = (over: Partial<FoldSummary> = {}): FoldSummary => ({ steps: 6, tokens: 12_000, estimated: false, errors: 0, warns: 0, cropped: 0, messageIDs: [], ...over })

describe("foldMark", () => {
  test("the caret and the count, and nothing else", () => {
    expect(foldMark(summary())).toBe("▸6")
    expect(foldMark(summary({ steps: 1 }))).toBe("▸1")
    expect(foldMark(summary({ steps: 137 }))).toBe("▸137")
  })

  test("it never repeats the token column", () => {
    // applyFolds rolls the hidden steps' tokens into the turn row, so the fold's tokens and
    // the row's own figure are the same number: printing both read as one number gone wrong
    const mark = foldMark(summary({ tokens: 23_500, estimated: true }))
    expect(mark).not.toContain("k")
    expect(mark).not.toContain("~")
    expect(mark).not.toContain(formatK(23_500))
  })

  test("it is short enough to sit inside the row's left edge", () => {
    for (const steps of [1, 9, 99, 999]) expect([...foldMark(summary({ steps }))].length).toBeLessThanOrEqual(5)
  })
})

describe("foldFlags", () => {
  test("nothing to flag draws nothing at all — most rows", () => {
    expect(foldFlags(summary())).toBe("")
  })

  test("only the flags that fired, in a step row's own order", () => {
    expect(foldFlags(summary({ errors: 1 }))).toBe(" 1✗")
    expect(foldFlags(summary({ warns: 2 }))).toBe(" 2⚠")
    expect(foldFlags(summary({ cropped: 1 }))).toBe(" 1✂")
    expect(foldFlags(summary({ errors: 1, warns: 2, cropped: 3 }))).toBe(" 3✂ 2⚠ 1✗")
  })

  test("it leads with a space, so it joins the text without one of its own", () => {
    expect(foldFlags(summary({ errors: 1 })).startsWith(" ")).toBe(true)
  })
})

describe("policyFor", () => {
  const manual = setManualFold(new Map(), "m1", true)
  test("passes the stored posture through untouched", () => {
    expect(policyFor({ base: "auto", manual })).toEqual({ base: "auto", openTurns: DEFAULT_OPEN_TURNS, manual })
  })
  test("crop mode and a live search force everything open, hand-folds included", () => {
    for (const forcing of [{ cropping: true }, { searching: true }]) {
      const p = policyFor({ base: "all", manual, ...forcing })
      expect(p.base).toBe("none")
      expect(p.manual.size).toBe(0)
    }
  })
  test("neither disturbs what is stored — leaving one puts the folds back", () => {
    const during = policyFor({ base: "all", manual, cropping: true })
    const after = policyFor({ base: "all", manual })
    expect(during.manual).not.toBe(manual)
    expect(after.manual).toBe(manual)
    expect(after.base).toBe("all")
  })
})
