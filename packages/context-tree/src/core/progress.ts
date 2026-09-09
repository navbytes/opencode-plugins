/**
 * Live feedback for the steps that take seconds — every LLM-backed flow (the branch summary
 * on a jump, the ◆ decision draft on a merge) reports through this, so a multi-second wait
 * reads as work in progress rather than a frozen tree (DESIGN.md §6.2, §7.6).
 *
 * Pure, like the rest of `core`: the flow reports, the route paints. A one-shot notice cannot
 * do this job — it is written once and then sits there, indistinguishable from a stale message
 * — so what a caller reports is *state*, redrawn on every frame with an elapsed counter.
 */

/** What a running step looks like on screen. `startedAt` is the clock the counter runs from. */
export type ProgressState = {
  /** the step, named as the user would name it: `summarizing 3 turns · ~14k` */
  label: string
  /** the live half: what the model has written so far, from `draftDetail` */
  detail?: string
  /** the way out, when there is one: `esc cancels` */
  hint?: string
  startedAt: number
}

/** Braille spinner: one cell wide in every terminal that draws the tree's own box glyphs. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

/** Frame duration, and so the route's redraw interval while a step runs. */
export const SPINNER_MS = 120

export function spinnerFrame(elapsedMs: number): string {
  const i = Math.floor(Math.max(0, elapsedMs) / SPINNER_MS) % SPINNER_FRAMES.length
  return SPINNER_FRAMES[i]!
}

/** How long it has been, as a wait is read: `4s`, `1m04s`. A step under a second reads `0s`
 *  rather than nothing, so the counter is there from the first frame. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`
}

/** `⠹ summarizing 3 turns · ~14k · ## Progress · 0.4k chars · 4s · esc cancels` */
export function formatProgress(state: ProgressState, now: number): string {
  const elapsed = Math.max(0, now - state.startedAt)
  return [`${spinnerFrame(elapsed)} ${state.label}`, state.detail, formatElapsed(elapsed), state.hint].filter(Boolean).join(" · ")
}

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*$/
/** `**Outcome:** …` — the decision template's fields are bold labels, not headings. */
const FIELD = /^\s{0,3}\*\*([^*\n]{1,40}?):?\*\*/

/** The last section the model has opened: a markdown heading (the summary format) or a bold
 *  field label (the ◆ record template). Undefined until it writes one. */
export function draftSection(text: string): string | undefined {
  let found: string | undefined
  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line)
    if (heading) {
      found = heading[1]
      continue
    }
    const field = FIELD.exec(line)
    if (field) found = field[1]
  }
  return found
}

/** `412 chars`, `1.4k chars` — the draft's size, at the precision a progress line can use. */
export function formatChars(n: number): string {
  return n < 1000 ? `${n} chars` : `${(n / 1000).toFixed(1)}k chars`
}

/** One phrase for a draft as it streams: the section being written, and how much of it there
 *  is. Empty text has nothing to say yet — the label alone carries the line until it does. */
export function draftDetail(text: string): string | undefined {
  const chars = text.trim().length
  if (chars === 0) return undefined
  const section = draftSection(text)
  return section ? `${section} · ${formatChars(chars)}` : formatChars(chars)
}
