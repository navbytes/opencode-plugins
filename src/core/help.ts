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
 * A run of one help line, drawn in its own colour. The pane's whole job is to let a user find
 * one key without reading, and a key is only findable if it is drawn differently from the
 * prose around it — so the pane is built as segments and the route colours them, rather than
 * as flat strings the route can only colour a line at a time. (It did the latter until
 * 0.3.0-beta.3, with the salience exactly inverted: the headings, which name no keys at all,
 * were the one thing drawn in the accent colour, and every line that named a key was muted.)
 */
export type HelpKind = "heading" | "key" | "name" | "label" | "text" | "strong" | "glyph"
/** A `glyph`'s or a colour word's colour, named for what it means rather than for a palette
 *  entry, so the route maps it onto the same theme colours the tree itself draws with. */
export type HelpTone = "success" | "info" | "error" | "warning" | "accent" | "muted"
export type HelpSeg = { text: string; kind: HelpKind; tone?: HelpTone }

/** Columns a help row spends on chrome the pane does not control: the route's `padding={1}`
 *  either side and the `│ ` gutter it draws in front of every line. The route passes
 *  `cols() - HELP_CHROME`, the way every other line on the screen is budgeted. */
export const HELP_CHROME = 4
/** What the pane is written for when a caller does not say: a 100-column terminal. */
export const HELP_WIDTH = 96
/** A key column wider than this is one absurd rebind (`ctrl+shift+f12`) pushing every purpose
 *  in its section sideways. Past the cap that row alone goes ragged, as `:help` does. */
const MAX_KEY_COL = 8

const seg = (text: string, kind: HelpKind, tone?: HelpTone): HelpSeg => (tone ? { text, kind, tone } : { text, kind })
const txt = (text: string): HelpSeg => ({ text, kind: "text" })
const wide = (segs: readonly HelpSeg[]): number => segs.reduce((n, s) => n + [...s.text].length, 0)

/** The lines the pane is made of, before any of them knows how wide its columns are. */
type Body =
  | { row: "heading"; text: string }
  | { row: "prose"; segs: HelpSeg[] }
  /** `folds   za this turn · zo zc open/close · …` — a dim static label and packed clauses.
   *  For the sections where one key per row would cost twenty rows to tabulate. */
  | { row: "packed"; label: string; clauses: HelpSeg[][] }
  /** `gm  merge    end a branch: …` — a key column, a name column, and a purpose. For the
   *  sections whose verbs nobody can guess, which are the ones worth the columns. */
  | { row: "verb"; key: string; name: string; purpose: HelpSeg[] }
  /** Indented under the row above it, in that row's purpose column. */
  | { row: "cont"; segs: HelpSeg[] }

/**
 * The `?` pane. It sits under the tree rows and takes its height from them, so vertical space
 * is genuinely scarce — every row here is paid for out of the tree it explains.
 *
 * Two layouts, and the split is the point: **tabulate what the user cannot guess.** `Act` and
 * `Views` name operations with no analogue anywhere else (crop, merge, a summarizing jump), so
 * they get a key column and a name column and can be entered from either side — you scan the
 * keys if you think `gm`, the names if you think "merge". `Move` and `Legend` get a dim label
 * column and packed clauses instead: twenty motion clauses tabulated would be twenty rows, and
 * they are vim's own keys, which this audience mostly has already.
 */
export function helpSegments(version: string, overrides?: Record<string, string[]>, width = HELP_WIDTH): HelpSeg[][] {
  /** The key a verb answers to now. Every key named below comes from here, never a literal:
   *  `keybinds` can move any of them, and a pane that lies is worse than no pane. */
  const k = (command: string) => keyLabel(command, overrides)
  const ks = (command: string) => keyLabels(command, overrides)
  /** A `key text` clause, or nothing at all when the command is unbound. */
  const c = (command: string, text: string): HelpSeg[] => {
    const key = k(command)
    return key ? [seg(key, "key"), txt(` ${text}`)] : []
  }
  /** Every stroke of a command as one key run: `↑ k`, `[[ [`. */
  const all = (command: string, text: string): HelpSeg[] => {
    const keys = ks(command)
    return keys.length ? [seg(keys.join(" "), "key"), txt(` ${text}`)] : []
  }
  /** Two commands' first strokes as one run: `zo zc open/close`. */
  const both = (a: string, b: string, text: string): HelpSeg[] => {
    const keys = [k(a), k(b)].filter(Boolean)
    return keys.length ? [seg(keys.join(" "), "key"), txt(` ${text}`)] : []
  }
  /** ` (or h l)` — the second stroke of each of a pair, when both have one. Written out
   *  rather than folded into the key run: `← h → l` reads as four unrelated keys. */
  const alias = (a: string, b: string): HelpSeg[] => {
    const [, x] = ks(a)
    const [, y] = ks(b)
    return x && y ? [txt(" (or "), seg(`${x} ${y}`, "key"), txt(")")] : []
  }
  const g = (glyph: string, text: string, tone?: HelpTone): HelpSeg[] => [seg(glyph, "glyph", tone), txt(` ${text}`)]

  const body: Body[] = [
    // no "What this is" heading: the top of a document locates itself, and the row it costs
    // is one the pane cannot spare
    { row: "prose", segs: [txt("the tree is every turn of this session and its branches; the right column is what each costs")] },
    {
      row: "prose",
      segs: [seg("nothing here rewrites your transcript", "strong"), txt(" — crop and merge change what the "), seg("model", "strong"), txt(" is sent next")],
    },
    // an orientation claim, not a motion: it tells a first-time reader they may stop reading
    { row: "prose", segs: [txt("the row you are on names the key for what it can do — you do not have to know these")] },
    { row: "heading", text: "Move" },
    {
      row: "packed",
      label: "rows",
      clauses: [
        [seg([...ks("up"), ...ks("down")].join(" "), "key"), txt(" move")],
        both("screen_top", "screen_bottom", "screen top/bottom").length ? [seg([k("screen_top"), k("screen_middle"), k("screen_bottom")].filter(Boolean).join(" "), "key"), txt(" screen top/middle/bottom")] : [],
        both("first", "last", "first/last"),
        c("toggle", "toggle"),
      ],
    },
    {
      row: "packed",
      label: "jumps",
      clauses: [both("page_down", "page_up", "page"), both("half_down", "half_up", "half page"), both("prev_turn", "next_turn", "turns"), both("prev_branch", "next_branch", "branches")],
    },
    {
      row: "packed",
      label: "folds",
      clauses: [c("fold_toggle", "this turn"), both("fold_open", "fold_close", "open/close"), c("fold_open_all", "all open"), c("fold_close_all", "all folded"), both("next_fold", "prev_fold", "between folds")],
    },
    {
      row: "cont",
      segs: [
        seg([k("fold"), k("unfold")].filter(Boolean).join(" "), "key"),
        ...alias("fold", "unfold"),
        txt(" fold/unfold a branch — "),
        seg(k("unfold"), "key"),
        txt(" opens a folded turn, "),
        seg(k("fold"), "key"),
        txt(" never closes one"),
      ],
    },
    { row: "packed", label: "search", clauses: [c("search", "live search"), both("search_next", "search_prev", "next/prev match")] },
    { row: "heading", text: "Act" },
    {
      row: "verb",
      key: k("go"),
      name: "go here",
      purpose: [txt("fork at this point, or switch to a "), seg("⎇", "glyph"), txt(" branch — the footer says which for this row")],
    },
    { row: "cont", segs: [txt("a summarizing jump carries the turns you leave as one "), seg("≣", "glyph", "accent"), txt(" message (esc stays put)")] },
    { row: "verb", key: k("branch"), name: "branch", purpose: [txt("a real OpenCode session to try something risky in; this one keeps its context")] },
    {
      row: "verb",
      key: k("merge"),
      name: "merge",
      purpose: [txt("end a branch: one "), seg("◆", "glyph", "accent"), txt(" record of what you concluded, not the noise")],
    },
    {
      row: "verb",
      key: k("crop"),
      name: "crop",
      purpose: [txt("stop sending a fat tool result you no longer need — "), ...c("mark", "mark"), txt(" · "), ...c("auto", "auto")],
    },
    { row: "cont", segs: [txt("· "), ...c("crop_toggle_mode", "result⇄turn"), txt(" · "), ...c("go", "apply"), txt(" · esc leave — the transcript keeps it, "), seg(k("undo"), "key"), txt(" restores")] },
    { row: "verb", key: k("undo"), name: "undo", purpose: [txt("reverse the last crop, branch or merge on this path")] },
    {
      row: "verb",
      key: k("label"),
      name: "mark",
      purpose: [txt("bookmark a message to find it again · "), ...c("copy", "copy the row"), txt(" · "), ...c("export", "export the "), seg("◆", "glyph", "accent"), txt(" records")],
    },
    { row: "heading", text: "Views" },
    { row: "verb", key: k("consumers"), name: "consumers", purpose: [txt("what is actually filling the context, biggest first: where to point crop")] },
    { row: "verb", key: k("decisions"), name: "decisions", purpose: [txt("every "), seg("◆", "glyph", "accent"), txt(" record confirmed on this tree")] },
    { row: "verb", key: k("filter_pick"), name: "filter", purpose: [txt('which rows to show (tools-only is "what did I run") — the lanes follow it')] },
    {
      row: "verb",
      key: k("inspector"),
      name: "inspector",
      purpose: [txt("the selected row in full · "), ...c("inspector_full", "full screen"), txt(" · "), seg([k("inspector_up"), k("inspector_down")].filter(Boolean).join(" "), "key"), txt(" scroll it")],
    },
    {
      row: "verb",
      key: k("mode_duration"),
      name: "lanes",
      purpose: [txt("duration x-axis · "), ...c("mode_turns", "turns x-axis"), txt(" · "), ...c("lanes_off", "off")],
    },
    { row: "heading", text: "Legend" },
    {
      row: "packed",
      label: "rows",
      clauses: [g("●", "user"), g("○", "assistant", "muted"), g("⚙", "tool step", "muted"), g("◆", "decision", "accent"), g("≣", "summary", "accent"), g("⎇", "branch")],
    },
    {
      row: "packed",
      label: "tree",
      clauses: [g("│ ├ ╰", "topology", "muted"), g("▾", "open", "muted"), g("▸6", "folded, standing for 6 rows", "muted"), g("←", "the session you are in", "muted")],
    },
    {
      row: "cont",
      segs: [seg("──", "glyph", "muted"), txt(" not in this branch's context "), seg("──", "glyph", "muted"), txt(" is where your path forked · a dim row is not sent")],
    },
    {
      row: "packed",
      label: "cost",
      clauses: [[txt("right column is tokens")], g("~", "estimated", "muted"), g("⚠", "≥10k", "warning"), g("✂", "cropped", "accent"), g("✗", "tool error", "error")],
    },
    {
      row: "packed",
      label: "status",
      clauses: [[txt("right end is the prompt really sent here")], [txt("history, not re-costed after a crop")]],
    },
    // the colours are drawn, not named: showing one costs a column, spelling "green" in grey
    // costs six and asks the reader to take a monochrome word's word for it
    {
      row: "packed",
      label: "⎇",
      clauses: [g("█", "open", "success"), g("█", "squashed", "info"), g("█", "rejected/discarded", "error"), g("█", "abandoned", "muted")],
    },
    {
      row: "packed",
      label: "lanes",
      clauses: [
        [txt("Input "), seg("█", "glyph", "success"), txt(" you "), seg("█", "glyph", "muted"), txt(" context")],
        [txt("Model "), seg("█", "glyph", "accent"), txt(" answer "), seg("█", "glyph", "muted"), txt(" thinking")],
        [txt("Tools "), seg("█", "glyph", "warning"), txt(" call "), seg("█", "glyph", "error"), txt(" failed")],
      ],
    },
    {
      row: "cont",
      segs: [seg("│", "glyph", "muted"), txt(" turn boundary · …N / N… events hidden either side · all = the whole session")],
    },
  ]

  return layout(body, version, k("help"), ks("back").join(" / "), width)
}

/** `  ` indent, and the same again for a continuation that has no columns to sit under. */
const INDENT = "  "

function layout(body: readonly Body[], version: string, helpKey: string, backKeys: string, width: number): HelpSeg[][] {
  // Column widths are per *section*, not global: one `ctrl+shift+x` rebound in Act must not
  // push every label in Legend sideways. A section is a run between headings.
  const sections: Body[][] = []
  for (const row of body) {
    if (row.row === "heading" || sections.length === 0) sections.push([])
    sections.at(-1)!.push(row)
  }

  const out: HelpSeg[][] = [
    // the title's own key is a key, not part of the heading: `?` is the one stroke a reader
    // may already be holding down, and it has to look like the others
    clipSegs([seg(helpKey, "key"), seg(" help", "heading"), txt(" · "), seg(backKeys, "key"), txt(` closes · opencode-context-tree ${version}`)], width),
  ]
  for (const section of sections) {
    const keyCol = Math.min(MAX_KEY_COL, Math.max(0, ...section.map((r) => (r.row === "verb" ? [...r.key].length : 0))))
    const nameCol = Math.max(0, ...section.map((r) => (r.row === "verb" ? [...r.name].length : 0)))
    const labelCol = Math.max(0, ...section.map((r) => (r.row === "packed" ? [...r.label].length : 0)))
    // where a continuation line's text starts: under the purpose of the rows above it
    const contCol = keyCol > 0 ? INDENT.length + keyCol + 2 + nameCol + 2 : INDENT.length + labelCol + 2
    // a verb whose key the user unbound takes its continuation lines with it: an orphaned
    // `a summarizing jump carries…` under no verb at all is worse than the missing row
    let orphaned = false
    for (const row of section) {
      if (row.row !== "cont") orphaned = false
      if (row.row === "heading") {
        out.push([seg(row.text, "heading")])
        continue
      }
      if (row.row === "prose") {
        out.push([txt(INDENT), ...clipSegs(row.segs, width - INDENT.length)])
        continue
      }
      if (row.row === "cont") {
        if (!orphaned) out.push([txt(" ".repeat(contCol)), ...clipSegs(row.segs, width - contCol)])
        continue
      }
      if (row.row === "packed") {
        const head = `${INDENT}${row.label.padEnd(labelCol)}  `
        const kept = row.clauses.filter((cl) => cl.length > 0)
        // clauses are dropped from the right until the line fits, never wrapped (§7.6)
        let n = kept.length
        const join = (take: number) => kept.slice(0, take).flatMap((cl, i) => (i === 0 ? cl : [txt(" · "), ...cl]))
        while (n > 1 && [...head].length + wide(join(n)) > width) n--
        if (n === 0) continue
        out.push([seg(head.slice(0, INDENT.length), "text"), seg(row.label.padEnd(labelCol), "label"), txt("  "), ...clipSegs(join(n), width - [...head].length)])
        continue
      }
      // a verb with no key is a command the user unbound: drop the row rather than draw a
      // nameless one (its continuation, if any, goes with it — see `cont` below)
      if (!row.key) {
        orphaned = true
        continue
      }
      const pad = (n: number) => txt(" ".repeat(Math.max(1, n)))
      const used = INDENT.length + Math.max(keyCol, [...row.key].length) + 2 + nameCol + 2
      out.push([
        txt(INDENT),
        seg(row.key, "key"),
        pad(keyCol - [...row.key].length + 2),
        seg(row.name, "name"),
        pad(nameCol - [...row.name].length + 2),
        ...clipSegs(row.purpose, width - used),
      ])
    }
  }
  return out
}

/** Clip a run of segments to `room` columns, ending in `…`. Prose degrades from the right;
 *  a key or a name is never the thing that clips, because they are never last. */
function clipSegs(segs: readonly HelpSeg[], room: number): HelpSeg[] {
  if (room <= 0) return []
  if (wide(segs) <= room) return segs as HelpSeg[]
  const out: HelpSeg[] = []
  let left = room - 1
  for (const s of segs) {
    const chars = [...s.text]
    if (chars.length <= left) {
      out.push(s)
      left -= chars.length
      continue
    }
    if (left > 0) out.push({ ...s, text: chars.slice(0, left).join("") })
    out.push(txt("…"))
    return out
  }
  return out
}

/**
 * The pane as plain strings — what the drift tests assert against, and what any caller that
 * cannot colour anything gets. The segments are the source of truth; this is them joined.
 */
export function helpLines(version: string, overrides?: Record<string, string[]>, width = HELP_WIDTH): string[] {
  return helpSegments(version, overrides, width).map((line) => line.map((s) => s.text).join("").trimEnd())
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
