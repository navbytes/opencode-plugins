/**
 * Which theme colour each run of the context gauge takes.
 *
 * A decision table rather than colours inline in the JSX, because the rule it encodes is one
 * a renderer keeps getting wrong and a test can hold: **readable text never takes a band
 * colour.** `success` / `warning` / `error` are chosen by a theme to be *distinguishable from
 * each other*, not to be readable as body text on that theme's background — so a gauge that
 * paints `84.7k/1M · low` in `success` is legible on a dark theme by luck and illegible on a
 * light one, which is exactly what shipped through 0.3.0-beta.2 (the whole gauge, `ctx`, bar,
 * numbers and all, was one band-coloured run).
 *
 * The bar keeps the band colour, because a bar is what colour is *for* here: it is a filled
 * shape rather than glyph strokes, so it survives a lower contrast ratio, and its colour is
 * the signal rather than a decoration on text that carries the same information anyway.
 *
 * Pure, no OpenCode/opentui/solid-js imports — see test/core-purity.test.ts.
 */
import type { ContextBand } from "./tokens.js"

/** A `TuiThemeCurrent` key. Named here so the table cannot name a colour that does not exist. */
export type ThemeToken = "text" | "textMuted" | "borderSubtle" | "success" | "warning" | "error"

/** The band colours, as the tree and the prompt slot both read them. */
export const BAND_TOKEN: Record<ContextBand, ThemeToken> = {
  low: "success",
  healthy: "success",
  filling: "warning",
  red: "error",
}

/** The tokens that a theme guarantees are readable on its own background. Everything the user
 *  is meant to *read* comes from this set; `test/gauge.test.ts` holds the table to it. */
export const READABLE: readonly ThemeToken[] = ["text", "textMuted"]

export type GaugeRoles = {
  /** `ctx ` — a label for the thing, not the thing. */
  label: ThemeToken
  /** Bar cells already served from the provider's cache. */
  cached: ThemeToken
  /** Bar cells of fresh context: the one run that carries the band. */
  fresh: ThemeToken
  /** Bar cells not yet used. Deliberately faint — it is the empty part of a bar. */
  empty: ThemeToken
  /** `84.7k/1M · low` — the payload, and the part that was illegible. */
  numbers: ThemeToken
  /** ` · 99% cached` — secondary by design. */
  cache: ThemeToken
}

export function gaugeRoles(band: ContextBand): GaugeRoles {
  return {
    label: "textMuted",
    cached: "textMuted",
    fresh: BAND_TOKEN[band],
    empty: "borderSubtle",
    numbers: "text",
    cache: "textMuted",
  }
}

/** The runs a reader is meant to read, as opposed to the bar they are meant to glance at. */
export const READ_ROLES: readonly (keyof GaugeRoles)[] = ["label", "numbers", "cache"]
