/**
 * Everything on screen that names a key: the keymap's defaults, the `?` pane, the row hint,
 * the footer. Data, not rendering — the route draws it, and `test/help.test.ts` holds the
 * text against the bindings, which is exactly the drift that shipped a help pane saying
 * `b branch` after branch had moved to `gb`.
 *
 * The rule this file exists to enforce: **nothing names a key with a string literal.**
 * `keybinds` can move any command, so a hardcoded `za` is a lie waiting for its first user;
 * `keyLabel(command, overrides)` is the only way to spell one, and the help suite runs twice
 * — once on the defaults, once with every documented verb rebound — to prove it.
 *
 * The pane teaches rather than lists: a verb line says what the key is *for*, because the
 * commands here (crop, merge, a summarizing jump) are not ones a user can guess the purpose
 * of from the name. Every line is one terminal row, unwrapped and under 112 columns.
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
export function helpLines(version: string, overrides?: Record<string, string[]>): string[] {
  /** The key a verb answers to now. Every key named below comes from here, never a literal:
   *  `keybinds` can move any of them, and a pane that lies is worse than no pane. */
  const k = (command: string) => keyLabel(command, overrides)
  const ks = (command: string) => keyLabels(command, overrides)
  /** Both strokes of a pair, as `↑ k` / `{ }` — dropping the half that is unbound. */
  const pair = (a: string, b: string) => [k(a), k(b)].filter(Boolean).join(" ")
  /** The *second* stroke of each of a pair, when both have one: `(or h l)`. */
  const alsoPair = (a: string, b: string) => {
    const [, x] = ks(a)
    const [, y] = ks(b)
    return x && y ? ` (or ${x} ${y})` : ""
  }
  /** One `key text` clause — "" when the command is unbound, so the line can drop it. */
  const c = (command: string, text: string) => (k(command) ? `${k(command)} ${text}` : "")
  /** A line of clauses joined by ` · `, or "" when every clause came out empty. `keybinds`
   *  can unbind anything (`{ "copy": "none" }`), and a pane that answers with a headless
   *  `  — try something risky on a copy` is worse than one that says nothing. */
  const line = (...parts: string[]) => {
    const kept = parts.filter(Boolean)
    return kept.length ? `  ${kept.join(" · ")}` : ""
  }
  /** A verb and its continuation line: both go when the verb has no key. */
  const withTail = (head: string, tail: string) => (head ? [`  ${head}`, tail] : [])
  return [
    `${k("help")} help · ${ks("back").join(" / ")} closes · opencode-context-tree ${version}`,
    "What this is",
    "  the tree is every turn of this session and its branches; the right column is what each costs",
    "  nothing here rewrites your transcript — crop and merge change what the *model* is sent next",
    "Move",
    line(
      `${[...ks("up"), ...ks("down")].join(" ")} move`,
      `${pair("page_down", "page_up")} page`,
      `${pair("half_down", "half_up")} half page`,
      `${[k("screen_top"), k("screen_middle"), k("screen_bottom")].filter(Boolean).join(" ")} screen top/middle/bottom`,
      pair("first", "last"),
    ),
    line(`${pair("prev_turn", "next_turn")} turn rows (the lanes scrub with them)`, `${pair("prev_branch", "next_branch")}${alsoPair("prev_branch", "next_branch")} branch rows`),
    line(
      `${pair("fold", "unfold")}${alsoPair("fold", "unfold")} fold/unfold a branch`,
      c("toggle", "toggle"),
      c("search", "live search"),
      `${pair("search_next", "search_prev")} next/prev match`,
    ),
    line(
      c("fold_toggle", "fold this turn"),
      `${pair("fold_open", "fold_close")} open/close`,
      c("unfold", "opens one"),
      c("fold_open_all", "all open"),
      c("fold_close_all", "all folded"),
      `${pair("next_fold", "prev_fold")} between folds`,
    ),
    "  the row you are on names the key for what it can do — you do not have to know these",
    "Act",
    ...withTail(
      c("go", "go here — fork at this point, or switch to a ⎇ branch; the footer says which for this row"),
      "     a summarizing jump carries the turns you leave over as one ≣ message (esc stays put)",
    ),
    line(c("branch", "branch — try something risky on a copy; this session keeps its context either way")),
    line(c("merge", "merge — end a branch: one ◆ record of what you concluded lands on the trunk, not the noise")),
    ...withTail(
      c("crop", `crop — stop sending a fat tool result you no longer need (${c("mark", "mark")} · ${c("auto", "auto")} · ${c("crop_toggle_mode", "result⇄turn")}`),
      `     · ${c("go", "apply")} · esc leave) — the transcript keeps the text, ${k("undo")} puts it back in context`,
    ),
    line(c("undo", "undo — reverse the last crop, branch or merge on this path")),
    line(c("label", "mark this message so you can find it again"), c("copy", "copy the row"), c("export", "export decisions")),
    "Views",
    line(c("consumers", "consumers — what is actually filling the context, biggest first: where to point crop")),
    line(c("decisions", "decisions — every ◆ record confirmed on this tree")),
    line(c("filter_pick", 'filter — which rows to show (tools-only is "what did I run") · the lanes follow it')),
    line(
      c("inspector", "inspector"),
      c("inspector_full", "full screen"),
      `${pair("inspector_up", "inspector_down")} scroll it`,
      `${pair("mode_duration", "mode_turns")} lanes (duration/turns x-axis)`,
      c("lanes_off", "off"),
    ),
    "Legend",
    "  ● user · ○ assistant · ⚙ tool step · ◆ decision · ≣ summary · ⎇ branch (a real OpenCode session)",
    "  │ ├ ╰ draw the topology · ▾ open ▸ folded · ← here is the session you are in",
    "  dim rows are not sent to the model; ── not in this branch's context ── is where your path forked",
    "  right column is tokens; ~ estimated · ⚠ ≥10k · ✂ cropped · ✗ tool error",
    "  status-line right: the prompt really sent at the cursor · history, not re-costed after a crop",
    "  ⎇ colours: open green · squashed blue · rejected/discarded red · abandoned grey",
    "  lanes: Input green you / grey context · Model purple answer / grey thinking · Tools orange call / red failed",
    "  the lanes are a window that follows the cursor: …N / N… are events hidden either side, all = whole session",
    `  │ in the lanes is a turn boundary · the lanes show what the ${k("filter_pick")} filter shows (→ tools-only = just calls)`,
  ].filter(Boolean)
}

/** How a stroke is written on screen: as the user types it, not as the keymap stores it. */
const SPELLING: Record<string, string> = {
  return: "⏎",
  escape: "esc",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  space: "space",
  tab: "Tab",
}

/**
 * The key a command answers to *right now*, spelled for display — the only way anything on
 * screen may name a key. `keybinds` overrides a command per user, so a hardcoded "za" in a
 * hint or in the `?` pane is a lie waiting to happen (and one that shipped: the pane read
 * `b branch` for a while after branch moved to `gb`).
 *
 * The first binding wins, which is also the friendlier one wherever a command has two:
 * `fold: ["left", "h"]` shows `←`, `up: ["up", "k"]` shows `↑`. A command bound to nothing
 * (`keybinds: { copy: "none" }`, or `filter_prev` by default) returns "" — every caller must
 * be able to draw nothing rather than an empty gap.
 */
export function keyLabel(command: string, overrides?: Record<string, string[]>): string {
  return keyLabels(command, overrides)[0] ?? ""
}

/** Every stroke a command answers to, spelled — for the places worth naming the alias too
 *  (`↑ k`, `[[ [`). Empty when the command is unbound. */
export function keyLabels(command: string, overrides?: Record<string, string[]>): string[] {
  return (overrides?.[command] ?? DEFAULT_KEYS[command] ?? []).map(spellKey)
}

function spellKey(stroke: string): string {
  const parts = stroke.split("+")
  const spelled = parts.filter((p) => p !== "shift").map((p) => SPELLING[p] ?? p)
  // shift on a letter is that letter's capital — `shift+g` is `G`, the way the pane's prose
  // and vim both write it. On anything else shift has no shorter spelling, so it stays.
  if (parts[0] === "shift" && parts.length === 2) return /^[a-z]$/.test(spelled[0]!) ? spelled[0]!.toUpperCase() : `shift+${spelled[0]}`
  // every other modifier keeps its `+`, matching how the pane already writes `ctrl+f`
  return spelled.join("+")
}

/** The verbs the pane must name, and the command whose binding spells them. */
export const HELP_VERBS = ["go", "branch", "merge", "crop", "undo", "label", "copy", "export", "consumers", "decisions", "filter_pick", "inspector", "fold_toggle", "fold_open_all", "fold_close_all", "next_turn", "prev_branch", "search", "help", "back"] as const

/** What the row under the cursor can do, and the key that does it. */
export type RowAffordance = { kind: "fold-open" | "fold-close" | "branch-expand" | "branch-switch" | "crop" | "restore" }

/**
 * The hint for the selected row: the one action this row affords, named by its live key.
 * Cursor chrome, not content — it is drawn on the selected row only, so a search over row
 * text never matches it and an unselected row never pays for it.
 *
 * Returns "" when the row affords nothing, or when the command that would do it is unbound.
 */
export function rowHint(affordance: RowAffordance | undefined, overrides?: Record<string, string[]>): string {
  if (!affordance) return ""
  const say = (command: string, verb: string) => {
    const key = keyLabel(command, overrides)
    return key ? `${key} ${verb}` : ""
  }
  switch (affordance.kind) {
    case "fold-open":
      return say("fold_toggle", "open")
    case "fold-close":
      return say("fold_toggle", "fold")
    case "branch-expand":
      return say("unfold", "expand")
    case "branch-switch":
      return say("go", "switch")
    case "crop":
      return say("mark", "crop")
    case "restore":
      return say("undo", "restore")
  }
}

/**
 * A footer line that fits `width`, dropping verbs from the right until it does.
 *
 * The footer was the one line on screen with no width budget — the header and the status line
 * both have one — and it overflowed at about 97 columns, more with a long branch name, on
 * every terminal narrower than ~110. `head` (what `⏎` does here) and `tail` (`? help  q back`)
 * always survive: the tail is the route to everything the line dropped, so it is the last
 * thing worth cutting. Empty verbs — an unbound command — are dropped before any of this,
 * so nothing leaves a double gap behind.
 */
export function footerLine(head: string, verbs: readonly string[], tail: string, width: number): string {
  const kept = verbs.filter(Boolean)
  const join = (n: number) => [head, ...kept.slice(0, n), tail].filter(Boolean).join("  ")
  let n = kept.length
  while (n > 0 && [...join(n)].length > width) n--
  return join(n)
}
