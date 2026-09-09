/** @jsxImportSource @opentui/solid */
/**
 * The context gauge (DESIGN.md §6.7): `ctx ▓▓░░░ ~2.3k/32.8k · low · 95% cached`. One
 * component so the prompt slot and the `/tree` header can never drift apart. Renders the exact
 * characters `formatContext` would, just recoloured — and which colour each run takes is
 * `core/gauge.ts#gaugeRoles`, not a decision made here, so a test can hold the one rule that
 * matters: the bar carries the band colour and the text never does. See that file for why.
 */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { Show, type JSX } from "solid-js"
import { bandFor, cacheShare, contextBarCells, formatK, type ContextSize } from "../core/tokens.js"
import { gaugeRoles } from "../core/gauge.js"

/** `@opentui/solid`'s `SpanProps` omits `fg`/`bg` even though the `SpanRenderable` it wraps
 *  accepts them the same as `<text fg=...>`'s `TextRenderable` does — one cast here rather
 *  than at every run below. */
export function Span(props: { fg: unknown; children?: JSX.Element }) {
  return <span {...(props as any)} />
}

export function ContextGauge(props: { theme: TuiThemeCurrent; size: ContextSize; limit?: number; showCachedSuffix?: boolean }) {
  const band = () => bandFor(props.size.tokens, props.limit)
  /** `core/gauge.ts` decides which theme colour each run takes; this only looks it up. The
   *  rule it enforces: the bar carries the band, the text never does. */
  const role = () => gaugeRoles(band())
  const fg = (which: keyof ReturnType<typeof gaugeRoles>) => props.theme[role()[which]]
  const share = () => cacheShare(props.size)
  const cells = () => contextBarCells(props.size, props.limit ?? 0)
  const numbers = () => `${props.size.estimated ? "~" : ""}${formatK(props.size.tokens)}${props.limit ? `/${formatK(props.limit)}` : ""} · ${band()}`
  return (
    // one <text> of <span>s, not a row box: a box's children lay out side by side and clip
    // instead of soft-wrapping, which broke the narrow sidebar card (DESIGN.md §7 wrapping note)
    <text>
      <Span fg={fg("label")}>ctx </Span>
      <Show when={props.limit}>
        <Span fg={fg("cached")}>{"▓".repeat(cells().cached)}</Span>
        <Span fg={fg("fresh")}>{"▓".repeat(cells().fresh)}</Span>
        <Span fg={fg("empty")}>{"░".repeat(cells().empty)}</Span>
        <Span fg={fg("numbers")}> </Span>
      </Show>
      <Span fg={fg("numbers")}>{numbers()}</Span>
      {/* the narrow sidebar card passes false: its own absolute line right below already says it */}
      <Show when={share() !== undefined && props.showCachedSuffix !== false}>
        <Span fg={fg("cache")}>{` · ${share()}% cached`}</Span>
      </Show>
    </text>
  )
}
