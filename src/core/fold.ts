/**
 * Turn folding (DESIGN.md §7.5): collapse a turn's steps into its `●` row, so the outline
 * reads as an outline. A turn where the model ran six tools costs seven rows and exactly one
 * of them is the skeleton you are skimming — reasoning parts were already collapsed for that
 * reason (`tree.ts#emitAssistantRows`); this is the same argument applied to tool calls.
 *
 * A post-pass over built rows rather than a branch inside the emitter: the emitter already
 * decides *what exists* (the `Filter`), and folding only decides *what is drawn now*. Keeping
 * them apart is what lets the event strip stay complete while the rows collapse — the strip is
 * built from the transcript and the filter, never from these rows.
 *
 * Pure, no OpenCode/opentui/solid-js imports — see test/core-purity.test.ts.
 */
import type { Row, StepRow, TurnRow } from "./tree.js"

/** What a folded turn swallowed, drawn as the `●` row's own suffix. */
export type FoldSummary = {
  /** Step rows hidden — what the filter would have shown, so rows and strip agree. */
  steps: number
  /** Their tokens, rolled into the turn row so the column still totals. */
  tokens: number
  estimated: boolean
  errors: number
  warns: number
  cropped: number
  /** The hidden steps' message ids, in this row's own session — the timeline lights these. */
  messageIDs: string[]
}

/**
 * How folded the tree is. `base` is the posture for turns the user has not touched:
 * `auto` keeps the last `openTurns` open — one by default, the turn you are working in, with
 * everything above it compressed; `all` folds every turn (`zm`); `none` folds none (`zr`, and
 * crop mode, which needs every result on screen to mark). `manual` is the user's own
 * `za`/`zo`/`zc`, which wins over `base` — and lives only as long as the route is open.
 */
export type FoldPolicy = {
  base: "auto" | "all" | "none"
  openTurns: number
  manual: ReadonlyMap<string, boolean>
}

/** How many turns the `auto` posture leaves open: the current one. The tree is an outline
 *  first — everything above the turn you are working in is scrollback, and `za`/`l` opens any
 *  of it in one keystroke. */
export const DEFAULT_OPEN_TURNS = 1

export const NO_FOLDS: FoldPolicy = { base: "none", openTurns: DEFAULT_OPEN_TURNS, manual: new Map() }

/**
 * The policy in force, from the stored posture and what the route is doing. Crop mode and a
 * live search both force everything open: crop marks live on the step rows, and a search that
 * hid its own matches would read as broken. Neither disturbs the stored posture — leaving
 * either one puts your folds back.
 */
export function policyFor(input: {
  base: FoldPolicy["base"]
  openTurns?: number
  manual: ReadonlyMap<string, boolean>
  cropping?: boolean
  searching?: boolean
}): FoldPolicy {
  const forceOpen = Boolean(input.cropping || input.searching)
  return {
    base: forceOpen ? "none" : input.base,
    openTurns: input.openTurns ?? DEFAULT_OPEN_TURNS,
    manual: forceOpen ? new Map() : input.manual,
  }
}

/** A folded turn row: same row, plus what it is standing in for. */
export type FoldedTurnRow = TurnRow & { folded: true; fold: FoldSummary }

export function isFolded(row: Row): row is FoldedTurnRow {
  return row.kind === "turn" && row.folded === true
}

/** Step rows belong to the turn row above them: the emitter writes a `●` row and then that
 *  turn's assistant steps, so document order is the ownership. A step with no turn above it
 *  (a compaction summary opening a transcript) belongs to nothing and never folds. */
function ownerOfEach(rows: readonly Row[]): (number | undefined)[] {
  const owners: (number | undefined)[] = []
  let turn: number | undefined
  rows.forEach((row, i) => {
    if (row.kind === "turn") {
      turn = i
      owners[i] = undefined
      return
    }
    // a branch header or a separator ends the run: what follows is another session's rows
    if (row.kind === "branch" || row.kind === "separator") {
      turn = undefined
      owners[i] = undefined
      return
    }
    const owner = turn === undefined ? undefined : (rows[turn] as TurnRow)
    owners[i] = owner && owner.sessionID === row.sessionID ? turn : undefined
  })
  return owners
}

/** Index of the turn row that owns `index` — itself for a turn row. -1 when nothing owns it. */
export function ownerTurnIndex(rows: readonly Row[], index: number): number {
  if (index < 0 || index >= rows.length) return -1
  if (rows[index]!.kind === "turn") return index
  return ownerOfEach(rows)[index] ?? -1
}

function summarise(steps: readonly StepRow[]): FoldSummary {
  return {
    steps: steps.length,
    tokens: steps.reduce((n, s) => n + s.tokens, 0),
    estimated: steps.some((s) => s.estimated),
    errors: steps.filter((s) => s.isError).length,
    warns: steps.filter((s) => s.warn).length,
    cropped: steps.filter((s) => s.isCropped).length,
    messageIDs: [...new Set(steps.map((s) => s.messageID))],
  }
}

/** Turn rows the `auto` posture leaves open: the last `openTurns` of the path you are on.
 *  Off-path rows (an ancestor's abandoned tail, another branch) are not the conversation you
 *  are in, so they never count as recent — they fold with the rest of the scrollback. */
function recentTurns(rows: readonly Row[], openTurns: number): Set<number> {
  const onPath: number[] = []
  rows.forEach((row, i) => {
    if (row.kind === "turn" && row.inContext) onPath.push(i)
  })
  return new Set(openTurns <= 0 ? [] : onPath.slice(-openTurns))
}

function shouldFold(policy: FoldPolicy, row: TurnRow, index: number, recent: Set<number>): boolean {
  const manual = policy.manual.get(row.messageID)
  if (manual !== undefined) return manual
  if (policy.base === "none") return false
  if (policy.base === "all") return true
  return !recent.has(index)
}

/**
 * Collapse the steps of every folded turn, annotating its `●` row with what it swallowed.
 * A turn with no step rows is left alone: there is nothing to fold, and a `▸` caret on it
 * would read as a row that refuses to open.
 */
export function applyFolds(rows: readonly Row[], policy: FoldPolicy): Row[] {
  if (policy.base === "none" && policy.manual.size === 0) return rows as Row[]
  const owners = ownerOfEach(rows)
  const recent = recentTurns(rows, policy.openTurns)
  const hidden = new Map<number, StepRow[]>()
  rows.forEach((row, i) => {
    const owner = owners[i]
    if (owner === undefined || row.kind !== "step") return
    const turn = rows[owner] as TurnRow
    if (!shouldFold(policy, turn, owner, recent)) return
    const list = hidden.get(owner)
    if (list) list.push(row)
    else hidden.set(owner, [row])
  })
  if (hidden.size === 0) return rows as Row[]

  const out: Row[] = []
  rows.forEach((row, i) => {
    const steps = hidden.get(i)
    if (steps) {
      const turn = row as TurnRow
      const fold = summarise(steps)
      out.push({ ...turn, tokens: turn.tokens + fold.tokens, estimated: turn.estimated || fold.estimated, folded: true, fold })
      return
    }
    if (owners[i] !== undefined && hidden.has(owners[i]!)) return // swallowed
    out.push(row)
  })
  return out
}

/** `▸ 6 steps · ~12k · 1 ✗ · 2 ⚠` — what the fold is standing in for, in the row's own
 *  vocabulary (`⚠` ≥10k, `✗` tool error, `✂` cropped, as the legend already reads them).
 *  "steps", not `⚙`: a turn's hidden rows are tool calls *and* assistant text, and claiming
 *  six tool calls when two of them were replies would be a small lie on every folded row. */
export function foldDigest(fold: FoldSummary, formatTokens: (n: number) => string): string {
  const parts = [`${fold.steps} step${fold.steps === 1 ? "" : "s"}`, `${fold.estimated ? "~" : ""}${formatTokens(fold.tokens)}`]
  if (fold.errors > 0) parts.push(`${fold.errors} ✗`)
  if (fold.warns > 0) parts.push(`${fold.warns} ⚠`)
  if (fold.cropped > 0) parts.push(`${fold.cropped} ✂`)
  return `▸ ${parts.join(" · ")}`
}

/** Toggle one turn in the manual map, returning a new Map. `folded` states it outright
 *  (`zo`/`zc`); without it the entry flips whatever is on screen now. */
export function setManualFold(manual: ReadonlyMap<string, boolean>, messageID: string, folded: boolean): Map<string, boolean> {
  const next = new Map(manual)
  next.set(messageID, folded)
  return next
}

/** Index of the next/previous folded turn row from `index` (`zj` / `zk`), or `index` when
 *  there is none that way. */
export function nextFoldIndex(rows: readonly Row[], index: number, dir: 1 | -1): number {
  let i = index
  for (let step = 0; step < rows.length; step++) {
    i += dir
    if (i < 0 || i >= rows.length) return index
    if (isFolded(rows[i]!)) return i
  }
  return index
}
