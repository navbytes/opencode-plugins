/** @jsxImportSource @opentui/solid */
/**
 * The sidebar card: one line of working-tree figures, then a GitHub-coloured chip per
 * pull request the session has touched.
 */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { For, Show } from "solid-js"
import { PR_STATE_COLOR, PR_STATE_LABEL, type PrChip } from "../core/pr.js"
import { clip, compact, fileCountLabel, type DiffSummary } from "../core/stats.js"

type Color = string | RGBA

/** `@opentui/solid`'s `SpanProps` omits `fg`/`bg`, though the renderable behind it takes both. */
function Span(props: { fg?: Color; bg?: Color; children?: JSX.Element }) {
  return <span {...(props as any)} />
}

/** Same cast, for the link span: an OSC 8 hyperlink, so the chip opens the PR. */
function Link(props: { href: string; fg?: Color; bg?: Color; children?: JSX.Element }) {
  return <a {...(props as any)} />
}

/**
 * The host sidebar is 42 columns with 2 of padding each side; a longer branch name wraps
 * and orphans its tail.
 */
export const CARD_COLUMNS = 38

export type ChipRowProps = {
  chip: PrChip
  theme: TuiThemeCurrent
  onDismiss: (key: string) => void
}

/**
 * `#20 Merged ×` — the badge takes GitHub's own state colour with white text, the way the
 * badge on the pull request page does; `×` beside it is the close affordance.
 */
export function ChipRow(props: ChipRowProps): JSX.Element {
  const color = () => (props.chip.state === "unknown" ? undefined : PR_STATE_COLOR[props.chip.state])
  const label = () => `#${props.chip.number} ${PR_STATE_LABEL[props.chip.state]}`
  return (
    <box flexDirection="row" marginRight={1}>
      <Show
        when={color()}
        fallback={
          // No state yet (gh is still answering, missing, or logged out): a plain badge,
          // so a chip never lies about which colour GitHub would paint it.
          <text fg={props.theme.textMuted}>
            <Link href={props.chip.url} fg={props.theme.textMuted}>{` ${label()} `}</Link>
          </text>
        }
      >
        <text bg={color()} fg="#ffffff">
          <Link href={props.chip.url} fg="#ffffff" bg={color()}>{` ${label()} `}</Link>
        </text>
      </Show>
      <text fg={props.theme.textMuted} onMouseDown={() => props.onDismiss(props.chip.key)}>
        {" ×"}
      </text>
    </box>
  )
}

export type CardProps = {
  theme: TuiThemeCurrent
  branch?: string
  /** Undefined until OpenCode has actually answered — draws no figures at all. */
  summary?: DiffSummary
  /** False in a folder OpenCode does not see as a repo: no branch, no figures, no claim. */
  git: boolean
  chips: readonly PrChip[]
  /** Set when `gh` could not answer — shown once, under the chips, instead of silence. */
  note?: string
  onDismiss: (key: string) => void
}

export function Card(props: CardProps): JSX.Element {
  return (
    <box flexDirection="column">
      <text fg={props.theme.text}>
        <b>Git Stats</b>
      </text>
      <Show when={props.git && props.branch}>
        <text>
          {/* the glyph carries the colour, the branch name is text to read */}
          <Span fg={props.theme.accent}>⎇ </Span>
          <Span fg={props.theme.text}>{clip(props.branch!, CARD_COLUMNS - 2)}</Span>
        </text>
      </Show>
      <Show when={props.git && props.summary}>
        <Show
          when={props.summary!.files > 0}
          fallback={<text fg={props.theme.textMuted}>working tree clean</text>}
        >
          {/* the same two theme tokens the host's own Modified Files section paints with */}
          <text>
            <Span fg={props.theme.diffAdded}>{`+${compact(props.summary!.additions)} `}</Span>
            <Span fg={props.theme.diffRemoved}>{`-${compact(props.summary!.deletions)} `}</Span>
            <Span fg={props.theme.textMuted}>{`· ${fileCountLabel(props.summary!.files)}`}</Span>
          </text>
        </Show>
      </Show>
      <Show when={props.chips.length}>
        <box flexDirection="row" flexWrap="wrap">
          <For each={props.chips}>{(chip) => <ChipRow chip={chip} theme={props.theme} onDismiss={props.onDismiss} />}</For>
        </box>
      </Show>
      <Show when={props.note}>
        <text fg={props.theme.textMuted}>{clip(props.note!, CARD_COLUMNS)}</text>
      </Show>
    </box>
  )
}
