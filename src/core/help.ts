/**
 * The keymap's defaults and the `?` pane's text — data, not rendering, so the route draws it
 * and a test can hold the two against each other (`test/help.test.ts`: every verb the pane
 * names is spelled the way `DEFAULT_KEYS` binds it, which is exactly the drift that shipped
 * a help pane saying `b branch` after branch had moved to `gb`).
 *
 * The pane teaches rather than lists: a verb line says what the key is *for*, because the
 * commands here (crop, merge, a summarizing jump) are not ones a user can guess the purpose
 * of from the name. Every line is one terminal row, unwrapped — keep them under ~100 columns.
 *
 * Pure, no OpenCode/opentui/solid-js imports — see test/core-purity.test.ts.
 */

/** Plugin option `keybinds: { <command>: "k,up" | [..] | "none" }` overrides these. */
export const DEFAULT_KEYS: Record<string, string[]> = {
  up: ["up", "k"],
  down: ["down", "j"],
  // vim's H / M / L: the top, middle and bottom of what is on screen
  screen_top: ["shift+h"],
  screen_middle: ["shift+m"],
  screen_bottom: ["shift+l"],
  half_up: ["ctrl+u"],
  half_down: ["ctrl+d"],
  page_up: ["ctrl+b"],
  page_down: ["ctrl+f"],
  // a sequence, so bare `g` is free (and never fires on its own)
  first: ["gg"],
  last: ["shift+g"],
  // `[[` / `]]` is vim's section motion; the single-bracket spellings stay as aliases
  prev_branch: ["[[", "["],
  next_branch: ["]]", "]"],
  prev_turn: ["{"],
  next_turn: ["}"],
  fold: ["left", "h"],
  unfold: ["right", "l"],
  // vim's fold vocabulary, on turns: the tree already had folds, it just had no verbs
  fold_toggle: ["za"],
  fold_open: ["zo"],
  fold_close: ["zc"],
  // vim spells "all folds" zR/zM, but this host's binding parser does not match a shifted
  // second stroke (verified in the TUI e2e), and with a single fold level vim's own zr/zm
  // — one level less/more folding — mean exactly the same thing here
  fold_open_all: ["zr"],
  fold_close_all: ["zm"],
  next_fold: ["zj"],
  prev_fold: ["zk"],
  toggle: ["tab"],
  go: ["return"],
  branch: ["gb"],
  crop: ["c"],
  crop_toggle_mode: ["t"],
  mark: ["space"],
  auto: ["a"],
  undo: ["u"],
  merge: ["gm"],
  inspector: ["i"],
  inspector_full: ["shift+i"],
  inspector_up: ["pageup"],
  inspector_down: ["pagedown"],
  consumers: ["gs"],
  copy: ["y"],
  // bare digits are counts in vim, so the lane modes move behind `g` and leave them free
  mode_duration: ["g1"],
  mode_turns: ["g2"],
  lanes_off: ["g0"],
  decisions: ["gd"],
  export: ["ge"],
  // vim's "set mark": a label is a bookmark on a message
  label: ["m"],
  filter_pick: ["gf"],
  // no default: the picker replaced the step-back, and every free single stroke is a vim
  // motion. Still a command, so `keybinds: { filter_prev: "..." }` can give it one.
  filter_prev: [],
  search: ["/"],
  search_next: ["n"],
  search_prev: ["shift+n"],
  // terminals disagree on whether "?" carries the shift flag, so bind both spellings
  help: ["?", "shift+/"],
  back: ["q", "escape"],
}

/**
 * The `?` pane, given the running version. It sits under the rows and takes its height from
 * them, so it stays as short as it can while still saying what each verb is *for*.
 */
export function helpLines(version: string): string[] {
  return [
    `? help · ? or esc closes · opencode-context-tree ${version}`,
    "What this is",
    "  the tree is every turn of this session and its branches; the right column is what each costs",
    "  nothing here rewrites your transcript — crop and merge change what the *model* is sent next",
    "Move",
    "  ↑↓ j k · ctrl+f ctrl+b page · ctrl+d ctrl+u half page · H M L screen top/middle/bottom · gg G",
    "  { } turn rows (the lanes scrub with them) · [[ ]] (or [ ]) branch rows",
    "  h l ← → fold/unfold a branch · Tab toggle · / live search · n N next/prev match",
    "  za fold this turn · zo zc open/close · zr all open · zm all folded · zj zk between folds",
    "Act",
    "  ⏎ go here — fork at this point, or switch to a ⎇ branch; the footer says which for this row",
    "     a summarizing jump carries the turns you leave over as one ≣ message (esc stays put)",
    "  gb branch — try something risky on a copy; this session keeps its context either way",
    "  gm merge — end a branch: one ◆ record of what you concluded lands on the trunk, not the noise",
    "  c crop — stop sending a fat tool result you no longer need (space mark · a auto · t result⇄turn",
    "     · ⏎ apply · esc leave) — the transcript keeps the text, u puts it back in context",
    "  u undo — reverse the last crop, branch or merge on this path",
    "  m mark this message so you can find it again · y copy the row · ge export decisions",
    "Views",
    "  gs consumers — what is actually filling the context, biggest first: where to point crop",
    "  gd decisions — every ◆ record confirmed on this tree",
    "  gf filter — which rows to show (tools-only is \"what did I run\") · the lanes follow it",
    "  i inspector · I full screen · PgUp/PgDn scroll it · g1 g2 lanes (duration/turns x-axis) · g0 off",
    "Legend",
    "  ● user · ○ assistant · ⚙ tool step · ◆ decision · ≣ summary · ⎇ branch (a real OpenCode session)",
    "  │ ├ ╰ draw the topology · ▾ open ▸ folded · ← here is the session you are in",
    "  dim rows are not sent to the model; ── not in this branch's context ── is where your path forked",
    "  right column is tokens; ~ estimated · ⚠ ≥10k · ✂ cropped · ✗ tool error",
    "  status-line right: the prompt really sent at the cursor · history, not re-costed after a crop",
    "  ⎇ colours: open green · squashed blue · rejected/discarded red · abandoned grey",
    "  lanes: Input green you / grey context · Model purple answer / grey thinking · Tools orange call / red failed",
    "  the lanes are a window that follows the cursor: …N / N… are events hidden either side, all = whole session",
    "  │ in the lanes is a turn boundary · the lanes show what the gf filter shows (→ tools-only = just calls)",
  ]
}

/** The verbs the pane must name, and the command whose binding spells them. */
export const HELP_VERBS = ["go", "branch", "merge", "crop", "undo", "label", "copy", "export", "consumers", "decisions", "filter_pick", "inspector", "fold_toggle", "fold_open_all", "fold_close_all", "next_turn", "prev_branch", "search", "help", "back"] as const
